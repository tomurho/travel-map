"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { MapView } from "@/components/map-view";
import { PlaceStatusIcon } from "@/components/place-status-icon";
import { placeStatuses, type PlaceStatus } from "@/lib/place-status";
import { toggleFieldGuideLoved, toggleFieldGuideWantToGo } from "@/lib/field-guide";
import { getDistanceKm, type GeoPoint } from "@/lib/geo";
import {
  buildExplorerQuery, filterExplorerPlaces, getExplorerAreas, getExplorerGroup,
  getExplorerSpecialties, getExplorerRecovery, matchesExplorerGroup, explorerGroups, readExplorerFilters, specialtyLabel,
  type ExplorerFilters, type ExplorerGroup,
} from "@/lib/field-guide-explorer";
import { getCategories, getCities, isPublicPlace } from "@/lib/filtering";
import { getCityCenters } from "@/lib/map-viewport";
import { normalizePlaceCity } from "@/lib/place-city";
import { getPlaceTypeAliases, normalizePlaceSearch } from "@/lib/place-types";
import { FieldGuidePlaceEditor } from "./field-guide-place-editor";
import type { Place } from "@/lib/place";
import { FieldGuidePlaceCard, FieldGuidePlaceDetail } from "./field-guide-place-card";
import { fieldGuideMapStyles } from "./field-guide-map-styles";
import base from "./field-guide.module.css";
import styles from "./field-guide-explorer.module.css";

const lastCityStorageKey = "travel-field-guide:last-city:v1";
const resultBatchSize = 24;

function ExplorerSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousRegion = previousFocus?.closest<HTMLElement>("section[tabindex='-1']");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      // The empty-state trigger can disappear in the same commit as this sheet.
      requestAnimationFrame(() => {
        if (!dialog.isConnected) (previousFocus?.isConnected ? previousFocus : previousRegion)?.focus({ preventScroll: true });
      });
    };
  }, []);
  return <dialog ref={dialogRef} className={styles.sheet} aria-labelledby="explorer-sheet-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <div className={styles.sheetHeader}>
      <h2 id="explorer-sheet-title">{title}</h2>
      <button type="button" aria-label="Close panel" onClick={onClose}>×</button>
    </div>
    {children}
  </dialog>;
}

export function FieldGuideApp({ places, previewCity, sharedCatalogue = false }: { places: Place[]; previewCity?: string; sharedCatalogue?: boolean }) {
  const [editablePlaces, setEditablePlaces] = useState(places);
  const [rememberedCity, setRememberedCity] = useState<string | null>(null);
  const [hasRestoredCity, setHasRestoredCity] = useState(false);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [visibleCount, setVisibleCount] = useState(resultBatchSize);
  const publicPlaces = useMemo(() => editablePlaces.filter(isPublicPlace), [editablePlaces]);
  const cities = useMemo(() => getCities(publicPlaces), [publicPlaces]);
  const allCategories = useMemo(() => getCategories(publicPlaces), [publicPlaces]);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const filters = useMemo(() => readExplorerFilters(publicPlaces, new URLSearchParams(queryString), {
    fixedCity: previewCity, defaultGroup: previewCity ? "bars" : "all", rememberedCity,
  }), [publicPlaces, queryString, previewCity, rememberedCity]);
  const cityPlaces = useMemo(() => publicPlaces.filter((place) => normalizePlaceCity(place.city) === filters.city), [publicPlaces, filters.city]);
  const view = searchParams.get("view") === "list" ? "list" : "map";
  const oppositeView = view === "map" ? "list" : "map";
  const oppositeViewLabel = oppositeView === "map" ? "Map" : "List";
  const [sheet, setSheet] = useState<"categories" | null>(null);
  const [specialtyQuery, setSpecialtyQuery] = useState("");
  const [allChipsExpanded, setAllChipsExpanded] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retryRefreshNonce, setRetryRefreshNonce] = useState(0);
  const [revealPlaceNonce, setRevealPlaceNonce] = useState(0);
  const [revealListNonce, setRevealListNonce] = useState(0);
  const [selectedBottomInset, setSelectedBottomInset] = useState(0);
  const selectedCardRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nearbyActive, setNearbyActive] = useState(false);
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "locating" | "found" | "error">("idle");
  const [locationMessage, setLocationMessage] = useState("");
  const [requestLocationNonce, setRequestLocationNonce] = useState(0);
  const [cancelLocationNonce, setCancelLocationNonce] = useState(0);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearchOnOpen = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const listAnchorRef = useRef<{ id: string; top: number } | null>(null);
  const pendingListRevealRef = useRef<string | null>(null);
  const mapRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const previousCityRef = useRef(filters.city);

  const group = getExplorerGroup(filters.group);
  const matches = useMemo(() => filterExplorerPlaces(publicPlaces, filters, { nearbyActive, userLocation: location }), [publicPlaces, filters, nearbyActive, location]);
  const specialties = useMemo(() => getExplorerSpecialties(publicPlaces, { ...filters, group: "all", category: "all" }), [publicPlaces, filters]);
  const categoryGroups = useMemo(() => explorerGroups.filter((option) => option.id !== "all").map((option) => ({
    ...option,
    specialties: specialties.filter((specialty) => cityPlaces.some((place) => place.category === specialty.category && matchesExplorerGroup(place, option.id))),
  })), [specialties, cityPlaces]);
  const recovery = useMemo(() => matches.length ? null : getExplorerRecovery(publicPlaces, filters, { nearbyActive, userLocation: location }), [matches.length, publicPlaces, filters, nearbyActive, location]);
  const areas = useMemo(() => getExplorerAreas(publicPlaces, { ...filters, group: "all" }), [publicPlaces, filters]);
  const selectedPlace = matches.find((place) => place.id === selectedId) ?? null;
  const cityCenters = useMemo(() => getCityCenters(publicPlaces), [publicPlaces]);
  const filterKey = buildExplorerQuery(filters, "map");
  const hasCategory = filters.group !== "all" || filters.category !== "all";
  const categoryLabel = filters.category === "all" ? group.label : specialtyLabel(filters.category);
  const activeFilterCount = Number(hasCategory) + Number(filters.area !== "all") + Number(filters.lovedOnly || filters.status !== "all") + Number(!!filters.query) + Number(nearbyActive);
  const resultLabel = `${matches.length} ${matches.length === 1 ? "place" : "places"}`;
  const nearbyLabel = locationStatus === "locating" ? "Locating… ×" : "Nearby";

  function closeFilters() {
    setFiltersExpanded(false);
    filterToggleRef.current?.focus({ preventScroll: true });
  }
  function openSearch() {
    if (filtersExpanded) searchRef.current?.focus();
    else { focusSearchOnOpen.current = true; setFiltersExpanded(true); }
  }
  function resetFilters() {
    cancelNearby();
    updateFilters({ ...filters, group: "all", category: "all", area: "all", query: "", status: "all", lovedOnly: false });
  }

  function navigate(next: ExplorerFilters, nextView: "map" | "list" = view, history: "push" | "replace" = "push") {
    const url = `${pathname}?${buildExplorerQuery(next, nextView, !previewCity)}`;
    if (url === `${window.location.pathname}${window.location.search}`) return;
    if (history === "replace") window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }
  function updateFilters(next: ExplorerFilters, history: "push" | "replace" = "push") {
    setEditingPlaceId(null);
    navigate(next, view, history);
  }
  function changeCity(city: string, fromNearby = false) {
    if (!fromNearby) cancelNearby();
    updateFilters({ ...filters, city, group: "all", category: "all", area: "all", query: "" });
    setSheet(null);
  }
  function selectPlace(id: string | null) {
    pendingListRevealRef.current = id;
    setRevealListNonce((current) => current + 1);
    setVisibleCount((count) => Math.max(count, matches.findIndex((place) => place.id === id) + 1));
    setSelectedId(id);
  }
  function selectCategory(category: string, nextGroup: ExplorerGroup = "all") {
    updateFilters({ ...filters, group: nextGroup, category });
    setSheet(null);
  }
  function openCategories() { setSpecialtyQuery(""); setSheet("categories"); }
  function cancelNearby() {
    setCancelLocationNonce((current) => current + 1);
    setNearbyActive(false);
    setLocationStatus("idle");
    setLocationMessage("");
  }
  function toggleNearby() {
    if (nearbyActive) { cancelNearby(); return; }
    setNearbyActive(true);
    setRequestLocationNonce((current) => current + 1);
  }
  function selectFromList(id: string) {
    const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-place-id]") ?? []).find((element) => element.dataset.placeId === id);
    listAnchorRef.current = row ? { id, top: row.getBoundingClientRect().top } : null;
    pendingListRevealRef.current = null;
    setSelectedId(selectedId === id ? null : id);
  }
  function showView(nextView: "map" | "list") {
    setFiltersExpanded(false);
    navigate(filters, nextView);
    focusView(nextView);
  }
  function showSelectedOnMap() {
    setRevealPlaceNonce((current) => current + 1);
    showView("map");
  }
  function focusView(nextView: "map" | "list") {
    requestAnimationFrame(() => (nextView === "map" ? mapRef : resultsRef).current?.focus({ preventScroll: true }));
  }

  useLayoutEffect(() => {
    const map = mapRef.current;
    const card = selectedCardRef.current;
    if (!map || !card) { setSelectedBottomInset(0); return; }
    const measure = () => setSelectedBottomInset(Math.max(0, map.getBoundingClientRect().bottom - card.getBoundingClientRect().top + 16));
    const observer = new ResizeObserver(measure);
    observer.observe(map);
    observer.observe(card);
    measure();
    return () => observer.disconnect();
  }, [selectedPlace?.id, view]);
  useEffect(() => { setEditablePlaces(places); }, [places]);
  useEffect(() => {
    if (!sharedCatalogue) return;
    let stopped = false;
    let pending = false;
    let controller: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || pending) return;
      pending = true;
      setRefreshing(true);
      controller = new AbortController();
      timeout = setTimeout(() => controller?.abort(), 20_000);
      try {
        const response = await fetch("/api/catalogue", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Catalogue refresh failed");
        const payload = await response.json();
        if (!Array.isArray(payload.places)) throw new Error("Invalid catalogue response");
        if (!stopped) {
          setEditablePlaces(payload.places);
          setRefreshFailed(false);
        }
      } catch {
        if (!stopped) setRefreshFailed(true);
      } finally {
        clearTimeout(timeout);
        pending = false;
        if (!stopped) setRefreshing(false);
      }
    };
    if (retryRefreshNonce > 0) void refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      controller?.abort();
      clearTimeout(timeout);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sharedCatalogue, retryRefreshNonce]);
  useEffect(() => {
    if (previousCityRef.current !== filters.city && locationStatus === "locating") cancelNearby();
    previousCityRef.current = filters.city;
  }, [filters.city]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (filtersExpanded && focusSearchOnOpen.current) {
      searchRef.current?.focus();
      focusSearchOnOpen.current = false;
    }
  }, [filtersExpanded]);
  useEffect(() => {
    if (previewCity) return;
    setIsLocalhost(["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
    try { setRememberedCity(window.localStorage.getItem(lastCityStorageKey)); } catch { /* Storage is optional. */ }
    setHasRestoredCity(true);
  }, [previewCity]);
  useEffect(() => {
    if (previewCity || !hasRestoredCity || !filters.city) return;
    setRememberedCity(filters.city);
    try { window.localStorage.setItem(lastCityStorageKey, filters.city); } catch { /* Storage is optional. */ }
  }, [filters.city, hasRestoredCity, previewCity]);
  useEffect(() => {
    setVisibleCount(resultBatchSize);
    setEditingPlaceId(null);
    setAllChipsExpanded(false);
  }, [filterKey]);
  useEffect(() => {
    if (!selectedId) return;
    const index = matches.findIndex((place) => place.id === selectedId);
    if (index < 0) setSelectedId(null);
    else setVisibleCount((current) => Math.max(current, index + 1));
  }, [matches, selectedId]);
  const categoryQuery = normalizePlaceSearch(specialtyQuery.trim()).split(/\s+/).filter(Boolean);
  const matchingGroups = categoryGroups.map((option) => ({ ...option, specialties: option.specialties.filter((specialty) => {
    const text = normalizePlaceSearch([option.label, specialty.label, ...getPlaceTypeAliases(specialty.category)].join(" "));
    return categoryQuery.every((word) => text.includes(word));
  }) })).filter((option) => option.specialties.length);

  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    listAnchorRef.current = null;
    pendingListRevealRef.current = null;
  }, [filterKey, nearbyActive, location]);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || (isMobile && view !== "list")) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-place-id]"));
    const anchor = listAnchorRef.current;
    if (anchor) {
      const row = rows.find((element) => element.dataset.placeId === anchor.id);
      if (row) list.scrollTop += row.getBoundingClientRect().top - anchor.top;
      listAnchorRef.current = null;
      return;
    }
    const selected = rows.find((element) => element.dataset.placeId === pendingListRevealRef.current);
    if (!selected) return;
    const rowBounds = selected.getBoundingClientRect(), listBounds = list.getBoundingClientRect();
    if (rowBounds.top < listBounds.top || rowBounds.height > listBounds.height) list.scrollTop += rowBounds.top - listBounds.top;
    else if (rowBounds.bottom > listBounds.bottom) list.scrollTop += rowBounds.bottom - listBounds.bottom;
    pendingListRevealRef.current = null;
  }, [selectedId, view, isMobile, visibleCount, revealListNonce]);

  const filterChips = [
    ...(hasCategory ? [{ key: "category", label: categoryLabel, aria: `Clear ${categoryLabel} category filter`, clear: () => updateFilters({ ...filters, group: "all", category: "all" }) }] : []),
    ...(filters.lovedOnly ? [{ key: "loved", label: "♡ Loved", aria: "Clear Loved filter", clear: () => updateFilters({ ...filters, lovedOnly: false }) }] : []),
    ...(filters.status !== "all" ? [{ key: "status", label: "Want to go", aria: "Clear Want to go filter", clear: () => updateFilters({ ...filters, status: "all" }) }] : []),
    ...(filters.area !== "all" ? [{ key: "area", label: filters.area, aria: `Clear ${filters.area} area filter`, clear: () => updateFilters({ ...filters, area: "all" }) }] : []),
    ...(filters.query ? [{ key: "query", label: `“${filters.query}”`, aria: `Clear search: ${filters.query}`, clear: () => updateFilters({ ...filters, query: "" }) }] : []),
  ];
  const visibleChips = allChipsExpanded ? filterChips : filterChips.slice(0, 3);
  const recoveryLabel = recovery ? ({ area: "Show all areas", query: "Remove search", loved: "Show all personal statuses", status: "Show all personal statuses", category: "Show all specialties", group: "Show all categories" }[recovery.kind]) : "Clear all";
  const emptyTitle = recovery?.kind === "area" ? `No matching places in ${filters.area}` : "No matching places";
  const emptyDescription = recovery ? "Broaden one filter and keep your other choices." : "Try another category or clear all filters to explore this city.";
  const recoverResults = () => recovery ? updateFilters(recovery.filters) : resetFilters();

  return <main className={`${base.page} ${styles.preview}`} onKeyDown={(event) => {
    if (event.key === "Escape" && isMobile && filtersExpanded && !sheet && !event.defaultPrevented) { event.preventDefault(); closeFilters(); }
  }}>
    <a className={base.skipLink} href="#field-guide-results" onClick={(event) => {
      event.preventDefault();
      showView("list");
    }}>Skip to places</a>
    <header className={styles.header}>
      <Link href={previewCity ? `/?city=${encodeURIComponent(previewCity)}` : "/"} className={styles.brand} aria-label="Field Guide home"><span>FG</span><strong>Field Guide</strong></Link>
      {previewCity ? <span className={styles.city}>{previewCity} <small>Preview</small></span> :
        <select className={styles.citySelect} aria-label="Current city" value={filters.city} onChange={(event) => changeCity(event.target.value)}>
          {cities.map((city) => <option key={city}>{city}</option>)}
        </select>}
      <h1 className={base.srOnly}>{filters.city} Field Guide</h1>
      <div className={styles.mobileActions}>
        <button type="button" aria-label="Search places" aria-controls="explorer-filters" aria-expanded={filtersExpanded} onClick={openSearch}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
        </button>
        <button ref={filterToggleRef} type="button" aria-controls="explorer-filters" aria-expanded={filtersExpanded} onClick={() => setFiltersExpanded((current) => !current)}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></svg>
          Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
        </button>
      </div>
    </header>
    <p className={base.srOnly} role="status" aria-live="polite" aria-atomic="true">{matches.length} {matches.length === 1 ? "place" : "places"}{nearbyActive && location ? " · nearest first" : ""}</p>
    {locationMessage ? <p className={`${styles.notice} ${styles.locationNotice}`} data-error={locationStatus === "error"} role="status">{locationMessage}</p> : null}
    {refreshFailed ? <div className={styles.refreshNotice} role="status"><p><strong>Couldn’t refresh places.</strong> Showing your last loaded places.</p><button type="button" disabled={refreshing} onClick={() => setRetryRefreshNonce((current) => current + 1)}>{refreshing ? "Retrying…" : "Retry"}</button></div> : null}
    <div className={styles.workspace} data-view={view} data-filters-expanded={filtersExpanded}>
      <section id="explorer-filters" className={styles.filters} aria-label="Find a place">
        <label className={styles.search}><span aria-hidden="true">⌕</span><input ref={searchRef} aria-label="Search places, food, or areas" type="search" placeholder="Search places, food, or areas" value={filters.query} onChange={(event) => updateFilters({ ...filters, query: event.target.value }, "replace")} /></label>
        <div className={styles.primary}>
          <button type="button" aria-pressed={nearbyActive} aria-label={locationStatus === "locating" ? "Cancel Nearby location request" : undefined} onClick={toggleNearby}>{locationStatus === "locating" ? "Locating… ×" : "Nearby"}</button>
          <button type="button" aria-pressed={filters.lovedOnly} onClick={() => updateFilters({ ...filters, ...toggleFieldGuideLoved(filters) })}>♡ Loved</button>
          <button type="button" aria-pressed={filters.status === "want_to_go"} onClick={() => updateFilters({ ...filters, ...toggleFieldGuideWantToGo(filters) })}>Want to go</button>
        </div>
        <div className={styles.selectors}>
          <button type="button" aria-label={`Choose category: ${categoryLabel}`} aria-haspopup="dialog" onClick={openCategories}><span>{categoryLabel}</span><span aria-hidden="true">⌄</span></button>
          {areas.length ? <select aria-label="Area" value={filters.area} onChange={(event) => updateFilters({ ...filters, area: event.target.value })}><option value="all">All areas</option>{areas.map((area) => <option key={area}>{area}</option>)}</select> : null}
        </div>
        <div className={styles.filterFooter}>
          <button type="button" onClick={resetFilters}>Clear all</button>
          <button className={styles.showResults} type="button" onClick={() => { setFiltersExpanded(false); focusView(view); }}>Show {resultLabel}</button>
        </div>
      </section>
      <div className={styles.toolbar} inert={isMobile && filtersExpanded}>
        <div className={styles.resultSummary}>
          <span className={styles.resultCount}>{resultLabel}{activeFilterCount ? <small> · {activeFilterCount} {activeFilterCount === 1 ? "filter" : "filters"}</small> : null}{nearbyActive && location ? <small className={styles.sortLabel}>Nearest first</small> : null}</span>
          {activeFilterCount ? <button className={styles.clear} type="button" onClick={resetFilters}>Clear all</button> : null}
          <div className={styles.browseActions} role="group" aria-label="Browse places">
            <button type="button" aria-pressed={nearbyActive} aria-label={locationStatus === "locating" ? "Cancel Nearby location request" : undefined} onClick={toggleNearby}>{nearbyLabel}</button>
            <button type="button" onClick={() => showView(oppositeView)}>{oppositeViewLabel}</button>
          </div>
        </div>
        {filterChips.length ? <div className={styles.activeFilters} role="group" aria-label="Active filters">
          {visibleChips.map((chip) => <button key={chip.key} type="button" data-active="true" title={chip.label} aria-label={chip.aria} onClick={chip.clear}>{chip.label} ×</button>)}
          {filterChips.length > 3 ? <button type="button" aria-expanded={allChipsExpanded} onClick={() => setAllChipsExpanded((current) => !current)}>{allChipsExpanded ? "Show fewer" : `+${filterChips.length - 3} more`}</button> : null}
        </div> : null}
      </div>
      <section ref={mapRef} tabIndex={-1} className={styles.map} inert={isMobile && filtersExpanded} aria-label={`Map of ${filters.city}`}>
        <MapView places={matches} cityCenters={cityCenters} mapStyles={fieldGuideMapStyles} viewportCity={filters.city} followUserLocation={!previewCity && nearbyActive}
          selectedPlaceId={selectedPlace?.id ?? null} openPlaceId={selectedPlace?.id ?? null} requestLocationNonce={requestLocationNonce}
          isVisible={!isMobile || view === "map"} revealPlaceNonce={revealPlaceNonce} selectedPlaceBottomInset={selectedBottomInset}
          cancelLocationNonce={cancelLocationNonce} onViewList={() => showView("list")}
          onSelectPlace={selectPlace} onClosePlace={() => setSelectedId(null)} onNearbyCityDetected={(city) => { if (!previewCity && cities.includes(city) && city !== filters.city) changeCity(city, true); }}
          onUserLocationFound={(point) => { setLocation(point); setNearbyActive(true); }} onLocationStatusChange={(status, message) => { setLocationStatus(status); setLocationMessage(status === "locating" ? "" : message); if (status === "error") setNearbyActive(false); }}
          showLocationMessage={false} showPlaceDetails={false} clusterMarkers />
        {!matches.length ? <div className={styles.mapEmpty}><strong>{emptyTitle}</strong><button type="button" onClick={recoverResults}>{recoveryLabel}{recovery ? ` · ${recovery.count}` : ""}</button></div> : null}
        {selectedPlace ? <div ref={selectedCardRef} className={styles.selected}>
          <FieldGuidePlaceDetail
            place={selectedPlace}
            hideCategory={filters.category === selectedPlace.category}
            distanceKm={location ? getDistanceKm(location, selectedPlace) : null}
            onClose={() => setSelectedId(null)}
          />
        </div> : <div className={styles.legend}>{Object.entries(placeStatuses).map(([status, details]) => <span key={status} style={{ color: details.color }}><PlaceStatusIcon status={status as PlaceStatus} size={15} />{details.label}</span>)}</div>}
      </section>
      <section ref={resultsRef} className={styles.results} id="field-guide-results" tabIndex={-1} inert={isMobile && filtersExpanded} aria-label={`${filters.city} places`}>
        {isLocalhost && !sharedCatalogue && !previewCity && !isMobile ? <div className={styles.editToolbar}>
          <span>{isEditMode ? "Editing" : ""}</span>
          <button type="button" aria-pressed={isEditMode} onClick={() => { setIsEditMode((current) => !current); setEditingPlaceId(null); setEditMessage(""); }}>{isEditMode ? "Done" : "Edit list"}</button>
        </div> : null}
        {editMessage ? <p className={base.editNotice} role="status">{editMessage}</p> : null}
        <div className={styles.list} ref={listRef}>
          {matches.slice(0, visibleCount).map((place) => <FieldGuidePlaceCard key={place.id} place={place}
            isSelected={place.id === selectedId || place.id === editingPlaceId}
            onSelect={() => selectFromList(place.id)} distanceKm={location ? getDistanceKm(location, place) : null}
            details={selectedId === place.id && editingPlaceId !== place.id ? <div className={styles.listDetails}><FieldGuidePlaceDetail place={place} hideCategory={filters.category === place.category} distanceKm={location ? getDistanceKm(location, place) : null} variant="list" onShowMap={showSelectedOnMap} /></div> : undefined}
            isEditable={!isMobile && isEditMode && (editingPlaceId === null || editingPlaceId === place.id)}
            isEditing={editingPlaceId === place.id}
            onEdit={() => { setEditingPlaceId((current) => current === place.id ? null : place.id); setEditMessage(""); }}
            editor={!isMobile && isEditMode && editingPlaceId === place.id ? <FieldGuidePlaceEditor
              adminPassword={adminPassword} categories={allCategories} onAdminPasswordChange={setAdminPassword}
              onCancel={() => setEditingPlaceId(null)} place={place}
              onSaved={(savedPlace) => {
                setEditablePlaces((current) => current.map((candidate) => candidate.id === savedPlace.id ? savedPlace : candidate));
                setEditingPlaceId(null); setEditMessage(`Saved ${savedPlace.name}.`);
              }} /> : undefined} />)}
          {visibleCount < matches.length ? <button type="button" className={base.showMore} onClick={() => setVisibleCount((current) => current + resultBatchSize)}>Show {Math.min(resultBatchSize, matches.length - visibleCount)} more</button> : null}
          {!matches.length ? <div className={styles.empty}><h2>{emptyTitle}</h2><p>{emptyDescription}</p><button type="button" onClick={recoverResults}>{recoveryLabel}{recovery ? ` · ${recovery.count} ${recovery.count === 1 ? "place" : "places"}` : ""}</button><button className={styles.emptyAlternative} type="button" onClick={openCategories}>Choose another category</button></div> : null}
        </div>
      </section>
    </div>
    {sheet === "categories" ? <ExplorerSheet title="Choose a category" onClose={() => setSheet(null)}>
      <input className={styles.sheetSearch} type="search" aria-label="Find a category" placeholder="Find a category" value={specialtyQuery} onChange={(event) => setSpecialtyQuery(event.target.value)} />
      <div className={styles.options}>
        <button type="button" aria-pressed={!hasCategory} onClick={() => selectCategory("all")}><span>All categories</span><span>{specialties.reduce((total, specialty) => total + specialty.count, 0)}</span></button>
      </div>
      {matchingGroups.map((option) => <section className={styles.categoryGroup} key={option.id} aria-label={option.label}>
        <h3>{option.label}</h3>
        <div className={styles.options}>
          {!specialtyQuery.trim() && option.specialties.length > 1 ? <button type="button" aria-pressed={filters.group === option.id && filters.category === "all"} onClick={() => selectCategory("all", option.id)}><span>All {option.label.toLowerCase()}</span><span>{option.specialties.reduce((total, specialty) => total + specialty.count, 0)}</span></button> : null}
          {option.specialties.map((specialty) => <button key={specialty.category} type="button" aria-pressed={filters.category === specialty.category} onClick={() => selectCategory(specialty.category)}><span>{specialty.label}</span><span>{specialty.count}</span></button>)}
        </div>
      </section>)}
      {!matchingGroups.length ? <p className={styles.sheetIntro}>No categories match that search.</p> : null}
      {previewCity ? <Link className={styles.mainLink} href={`/?city=${encodeURIComponent(previewCity)}`}>Return to the main guide ↗</Link> : null}
    </ExplorerSheet> : null}
  </main>;
}
