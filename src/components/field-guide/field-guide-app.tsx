"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type CityCenter, MapView } from "@/components/map-view";
import { toggleFieldGuideLoved, toggleFieldGuideWantToGo } from "@/lib/field-guide";
import { getDistanceKm, type GeoPoint } from "@/lib/geo";
import {
  buildExplorerQuery, filterExplorerPlaces, getExplorerGroup,
  getExplorerSpecialties, matchesExplorerGroup, explorerGroups, readExplorerFilters,
  type ExplorerFilters, type ExplorerGroup,
} from "@/lib/field-guide-explorer";
import { getCategories, getCities, isPublicPlace } from "@/lib/filtering";
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

function getCityCenters(places: Place[]): CityCenter[] {
  const groups = new Map<string, { latitude: number; longitude: number; count: number }>();

  for (const place of places) {
    const group = groups.get(place.city) ?? { latitude: 0, longitude: 0, count: 0 };
    group.latitude += place.latitude;
    group.longitude += place.longitude;
    group.count += 1;
    groups.set(place.city, group);
  }

  return Array.from(groups, ([city, group]) => ({
    city,
    latitude: group.latitude / group.count,
    longitude: group.longitude / group.count,
  }));
}

function ExplorerSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
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

export function FieldGuideApp({ places, previewCity }: { places: Place[]; previewCity?: string }) {
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
  const [sheet, setSheet] = useState<"groups" | "specialties" | null>(null);
  const [specialtyQuery, setSpecialtyQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nearbyActive, setNearbyActive] = useState(false);
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "locating" | "found" | "error">("idle");
  const [locationMessage, setLocationMessage] = useState("");
  const [requestLocationNonce, setRequestLocationNonce] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLElement>(null);

  const group = getExplorerGroup(filters.group);
  const matches = useMemo(() => filterExplorerPlaces(publicPlaces, filters, { nearbyActive, userLocation: location }), [publicPlaces, filters, nearbyActive, location]);
  const specialties = useMemo(() => getExplorerSpecialties(publicPlaces, filters), [publicPlaces, filters]);
  const totalInGroup = useMemo(() => filterExplorerPlaces(publicPlaces, { ...filters, category: "all" }).length, [publicPlaces, filters]);
  const groupCounts = useMemo(() => new Map(explorerGroups.map((option) => [option.id, cityPlaces.filter((place) => matchesExplorerGroup(place, option.id)).length])), [cityPlaces]);
  const areas = useMemo(() => [...new Set(cityPlaces.filter((place) => matchesExplorerGroup(place, filters.group)).map((place) => place.district).filter(Boolean))].sort(), [cityPlaces, filters.group]);
  const selectedPlace = matches.find((place) => place.id === selectedId) ?? null;
  const cityCenters = useMemo(() => getCityCenters(publicPlaces), [publicPlaces]);
  const hasRefinements = filters.category !== "all" || filters.area !== "all" || filters.status !== "all" || filters.lovedOnly || !!filters.query;
  const filterKey = buildExplorerQuery(filters, "map");

  function navigate(next: ExplorerFilters, nextView: "map" | "list" = view) {
    window.history.replaceState(null, "", `${pathname}?${buildExplorerQuery(next, nextView, !previewCity)}`);
  }
  function updateFilters(next: ExplorerFilters) {
    setSelectedId(null);
    setEditingPlaceId(null);
    navigate(next);
  }
  function changeCity(city: string, fromNearby = false) {
    if (!fromNearby) { setNearbyActive(false); setLocationMessage(""); }
    updateFilters({ ...filters, city, group: "all", category: "all", area: "all", query: "" });
    setSheet(null);
  }
  function selectPlace(id: string | null) {
    setVisibleCount((count) => Math.max(count, matches.findIndex((place) => place.id === id) + 1));
    setSelectedId(id);
  }
  function changeGroup(next: ExplorerGroup) {
    updateFilters({ ...filters, group: next, category: "all", area: "all" });
    setSheet(null);
  }
  function selectSpecialty(category: string) {
    updateFilters({ ...filters, category });
    setSheet(null);
  }
  function clearFilters() {
    updateFilters({ ...filters, group: groupCounts.get(filters.group) ? filters.group : "all", category: "all", area: "all", query: "", status: "all", lovedOnly: false });
  }
  function openSpecialties() { setSpecialtyQuery(""); setSheet("specialties"); }
  function toggleNearby() {
    if (nearbyActive) { setNearbyActive(false); setLocationMessage(""); return; }
    setNearbyActive(true);
    setRequestLocationNonce((current) => current + 1);
  }
  function selectFromList(id: string) {
    selectPlace(id);
    navigate(filters, "map");
    requestAnimationFrame(() => mapRef.current?.focus({ preventScroll: true }));
  }

  useEffect(() => { setEditablePlaces(places); }, [places]);
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
    setSelectedId(null);
    setEditingPlaceId(null);
  }, [filterKey]);
  const matchingSpecialties = specialties.filter((specialty) => normalizePlaceSearch([
    specialty.label, ...getPlaceTypeAliases(specialty.category),
  ].join(" ")).includes(normalizePlaceSearch(specialtyQuery.trim())));

  useEffect(() => {
    const strip = stripRef.current;
    const selected = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (strip && selected) strip.scrollLeft = Math.max(0, selected.offsetLeft - strip.offsetLeft - 8);
  }, [filters.group, filters.category]);
  useEffect(() => {
    if (!listRef.current) return;
    const list = listRef.current;
    const selected = Array.from(list.querySelectorAll<HTMLElement>("[data-place-id]")).find((element) => element.dataset.placeId === selectedId);
    if (selected) list.scrollTop += selected.getBoundingClientRect().top - list.getBoundingClientRect().top;
    else list.scrollTop = 0;
  }, [filters, selectedId, view]);

  return <main className={`${base.page} ${styles.preview}`}>
    <a className={base.skipLink} href="#field-guide-results" onClick={() => navigate(filters, "list")}>Skip to places</a>
    <header className={styles.header}>
      <Link href={previewCity ? `/?city=${encodeURIComponent(previewCity)}` : "/"} className={styles.brand} aria-label="Field Guide home"><span>FG</span><strong>Field Guide</strong></Link>
      {previewCity ? <span className={styles.city}>{previewCity} <small>Preview</small></span> :
        <select className={styles.citySelect} aria-label="Current city" value={filters.city} onChange={(event) => changeCity(event.target.value)}>
          {cities.map((city) => <option key={city}>{city}</option>)}
        </select>}
      <h1 className={base.srOnly}>{filters.city} Field Guide</h1>
    </header>
    <div className={styles.workspace} data-view={view}>
      <section className={styles.filters} aria-label="Find a place">
        <label className={styles.search}><span aria-hidden="true">⌕</span><input aria-label="Search places, food, or areas" type="search" placeholder="Search places, food, or areas" value={filters.query} onChange={(event) => updateFilters({ ...filters, query: event.target.value })} /></label>
        <div className={styles.primary}>
          <button type="button" aria-pressed={nearbyActive} disabled={locationStatus === "locating"} onClick={toggleNearby}>{locationStatus === "locating" ? "Locating…" : "Nearby"}</button>
          <button type="button" aria-pressed={filters.lovedOnly} onClick={() => updateFilters({ ...filters, ...toggleFieldGuideLoved(filters) })}>♡ Loved</button>
          <button type="button" aria-pressed={filters.status === "want_to_go"} onClick={() => updateFilters({ ...filters, ...toggleFieldGuideWantToGo(filters) })}>Want to go</button>
        </div>
        <div className={styles.selectors}>
          <button type="button" aria-label={`Browse group: ${group.label}`} aria-haspopup="dialog" onClick={() => setSheet("groups")}><span>{group.label}</span><span aria-hidden="true">⌄</span></button>
          <select aria-label="Area" value={filters.area} onChange={(event) => updateFilters({ ...filters, area: event.target.value })}><option value="all">All areas</option>{areas.map((area) => <option key={area}>{area}</option>)}</select>
        </div>
        <div className={styles.specialties}>
          <div ref={stripRef} className={styles.strip} role="group" aria-label={`${group.label} specialties`}>
            <button type="button" aria-pressed={filters.category === "all"} onClick={() => selectSpecialty("all")}>{filters.group === "food" ? "All food" : "All"} · {totalInGroup}</button>
            {specialties.map((specialty) => <button key={specialty.category} type="button" aria-pressed={filters.category === specialty.category} onClick={() => selectSpecialty(specialty.category)}>{specialty.label} · {specialty.count}</button>)}
          </div>
          {specialties.length > 3 ? <button type="button" className={styles.more} aria-label="More specialties" aria-haspopup="dialog" onClick={openSpecialties}>More ⌄</button> : null}
        </div>
        {locationMessage ? <p className={styles.notice} role="status">{locationMessage}</p> : null}
      </section>
      <div className={styles.toolbar}>
        <span role="status" aria-live="polite">{matches.length} {matches.length === 1 ? "place" : "places"}{nearbyActive && location ? " · nearest first" : ""}</span>
        {hasRefinements ? <button className={styles.clear} type="button" onClick={clearFilters}>Clear</button> : null}
        <div className={styles.viewSwitch} role="group" aria-label="Browse places">
          <button type="button" aria-pressed={view === "map"} onClick={() => navigate(filters, "map")}>Map</button>
          <button type="button" aria-pressed={view === "list"} onClick={() => navigate(filters, "list")}>List</button>
        </div>
      </div>
      <section ref={mapRef} tabIndex={-1} className={styles.map} aria-label={`Map of ${filters.city}`}>
        <MapView places={matches} cityCenters={cityCenters} mapStyles={fieldGuideMapStyles} viewportCity={filters.city} followUserLocation={!previewCity && nearbyActive}
          selectedPlaceId={selectedPlace?.id ?? null} openPlaceId={selectedPlace?.id ?? null} requestLocationNonce={requestLocationNonce}
          onSelectPlace={selectPlace} onClosePlace={() => setSelectedId(null)} onNearbyCityDetected={(city) => { if (!previewCity && cities.includes(city) && city !== filters.city) changeCity(city, true); }}
          onUserLocationFound={(point) => { setLocation(point); setNearbyActive(true); }} onLocationStatusChange={(status, message) => { setLocationStatus(status); setLocationMessage(status === "error" ? message : ""); if (status === "error") setNearbyActive(false); }}
          showLocationMessage={false} showPlaceDetails={false} clusterMarkers />
        {!matches.length ? <div className={styles.mapEmpty}><strong>No matching places</strong><button type="button" onClick={clearFilters}>Clear filters</button></div> : null}
        {selectedPlace ? <div className={styles.selected}>
          <FieldGuidePlaceDetail
            place={selectedPlace}
            distanceKm={location ? getDistanceKm(location, selectedPlace) : null}
            onClose={() => setSelectedId(null)}
          />
        </div> : <div className={styles.legend}><span><i style={{ background: "#ef2b68" }} />Loved</span><span><i style={{ background: "#f59e0b" }} />Want to go</span><span><i style={{ background: "#9ca3af" }} />Been</span><span><i style={{ background: "#d1d5db" }} />Saved</span></div>}
      </section>
      <section className={styles.results} id="field-guide-results" tabIndex={-1} aria-label={`${filters.city} places`}>
        {isLocalhost && !previewCity ? <div className={styles.editToolbar}>
          <span>{isEditMode ? "Editing" : ""}</span>
          <button type="button" aria-pressed={isEditMode} onClick={() => { setIsEditMode((current) => !current); setEditingPlaceId(null); setEditMessage(""); }}>{isEditMode ? "Done" : "Edit list"}</button>
        </div> : null}
        {editMessage ? <p className={base.editNotice} role="status">{editMessage}</p> : null}
        <div className={styles.list} ref={listRef}>
          {matches.slice(0, visibleCount).map((place) => <FieldGuidePlaceCard key={place.id} place={place}
            isSelected={place.id === selectedId || place.id === editingPlaceId}
            onSelect={() => selectFromList(place.id)} distanceKm={location ? getDistanceKm(location, place) : null}
            isEditable={isEditMode && (editingPlaceId === null || editingPlaceId === place.id)}
            isEditing={editingPlaceId === place.id}
            onEdit={() => { setEditingPlaceId((current) => current === place.id ? null : place.id); setEditMessage(""); }}
            editor={isEditMode && editingPlaceId === place.id ? <FieldGuidePlaceEditor
              adminPassword={adminPassword} categories={allCategories} onAdminPasswordChange={setAdminPassword}
              onCancel={() => setEditingPlaceId(null)} place={place}
              onSaved={(savedPlace) => {
                setEditablePlaces((current) => current.map((candidate) => candidate.id === savedPlace.id ? savedPlace : candidate));
                setEditingPlaceId(null); setEditMessage(`Saved ${savedPlace.name}.`);
              }} /> : undefined} />)}
          {visibleCount < matches.length ? <button type="button" className={base.showMore} onClick={() => setVisibleCount((current) => current + resultBatchSize)}>Show {Math.min(resultBatchSize, matches.length - visibleCount)} more</button> : null}
          {!matches.length ? <div className={styles.empty}><h2>No matching places</h2><p>Try another specialty, area, or search.</p><button type="button" onClick={clearFilters}>Clear filters</button></div> : null}
        </div>
      </section>
    </div>
    {sheet === "groups" ? <ExplorerSheet title={`Explore ${filters.city}`} onClose={() => setSheet(null)}>
      <p className={styles.sheetIntro}>Choose a group, then explore its specialties.</p>
      <div className={styles.options}>{explorerGroups.map((option) => <button type="button" key={option.id} aria-pressed={filters.group === option.id} disabled={!groupCounts.get(option.id)} onClick={() => changeGroup(option.id)}><span>{option.label}</span><span>{groupCounts.get(option.id) || "No places yet"}</span></button>)}</div>
      {previewCity ? <Link className={styles.mainLink} href={`/?city=${encodeURIComponent(previewCity)}`}>Return to the main guide ↗</Link> : null}
    </ExplorerSheet> : null}
    {sheet === "specialties" ? <ExplorerSheet title={`${group.label} specialties`} onClose={() => setSheet(null)}>
      <input className={styles.sheetSearch} type="search" aria-label="Find a specialty" placeholder="Find a specialty" value={specialtyQuery} onChange={(event) => setSpecialtyQuery(event.target.value)} />
      <div className={styles.options}>
        <button type="button" aria-pressed={filters.category === "all"} onClick={() => selectSpecialty("all")}><span>All {group.label.toLowerCase()}</span><span>{totalInGroup}</span></button>
        {matchingSpecialties.map((specialty) => <button key={specialty.category} type="button" aria-pressed={filters.category === specialty.category} onClick={() => selectSpecialty(specialty.category)}><span>{specialty.label}</span><span>{specialty.count}</span></button>)}
        {!matchingSpecialties.length ? <p className={styles.sheetIntro}>No specialties match that search.</p> : null}
      </div>
    </ExplorerSheet> : null}
  </main>;
}
