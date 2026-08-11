"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FieldGuideFiltersPanel } from "@/components/field-guide/field-guide-filters";
import {
  FieldGuidePlaceCard,
  FieldGuidePlaceDetail,
} from "@/components/field-guide/field-guide-place-card";
import { FieldGuidePlaceEditor } from "@/components/field-guide/field-guide-place-editor";
import { type CityCenter, MapView } from "@/components/map-view";
import { getAvailableAreas, getAvailableCategories, getCategories, getCities } from "@/lib/filtering";
import {
  buildFieldGuideQuery,
  filterAndSortFieldGuidePlaces,
  normalizeFieldGuideFilters,
  resolveFieldGuideCityPreference,
  type FieldGuideFilters,
} from "@/lib/field-guide";
import { getDistanceKm, type GeoPoint } from "@/lib/geo";
import type { Place } from "@/lib/place";
import styles from "./field-guide.module.css";

type LocationStatus = "idle" | "locating" | "found" | "error";

const resultBatchSize = 24;
const lastCityStorageKey = "travel-field-guide:last-city:v1";

const fieldGuideMapStyles: google.maps.MapTypeStyle[] = [
  {
    elementType: "geometry",
    stylers: [{ color: "#f3eee7" }],
  },
  {
    elementType: "labels.text.fill",
    stylers: [{ color: "#4a4946" }],
  },
  {
    elementType: "labels.text.stroke",
    stylers: [{ color: "#fffdf9" }],
  },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#d4cbc0" }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: "#eee8df" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#ece7df" }],
  },
  {
    featureType: "poi",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#e8e9df" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#fffdfa" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#ded6cc" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#e7d7c3" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#343330" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#ddd7cf" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#d9e4e5" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#748287" }],
  },
];

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

function CitySelect({
  cities,
  city,
  onChange,
}: {
  cities: string[];
  city: string;
  onChange: (city: string) => void;
}) {
  return (
    <label className={styles.citySelect}>
      <span className={styles.srOnly}>Current city</span>
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 21s6-5.1 6-12A6 6 0 0 0 6 9c0 6.9 6 12 6 12Z" />
        <circle cx="12" cy="9" r="2" />
      </svg>
      <select aria-label="Current city" onChange={(event) => onChange(event.target.value)} value={city}>
        {cities.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

export function FieldGuideApp({
  initialFilters,
  places,
  requestedCity,
}: {
  initialFilters: FieldGuideFilters;
  places: Place[];
  requestedCity: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState(() =>
    normalizeFieldGuideFilters(places, initialFilters),
  );
  const [nearbyActive, setNearbyActive] = useState(false);
  const [userLocation, setUserLocation] = useState<GeoPoint | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [locationMessage, setLocationMessage] = useState("");
  const [requestLocationNonce, setRequestLocationNonce] = useState(0);
  const [visibleCount, setVisibleCount] = useState(resultBatchSize);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [hasRestoredCityPreference, setHasRestoredCityPreference] = useState(false);
  const [editablePlaces, setEditablePlaces] = useState(places);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState("");

  const cities = useMemo(() => getCities(editablePlaces), [editablePlaces]);
  const cityCenters = useMemo(() => getCityCenters(editablePlaces), [editablePlaces]);
  const allCategories = useMemo(() => getCategories(editablePlaces), [editablePlaces]);
  const cityPlaces = useMemo(
    () => editablePlaces.filter((place) => place.city === filters.city),
    [editablePlaces, filters.city],
  );
  const categories = useMemo(
    () =>
      getAvailableCategories(editablePlaces, {
        city: filters.city,
        status: filters.status,
        area: filters.area,
        loved: "all",
      }),
    [editablePlaces, filters.area, filters.city, filters.status],
  );
  const areas = useMemo(
    () =>
      getAvailableAreas(editablePlaces, {
        city: filters.city,
        status: filters.status,
        category: filters.category,
        loved: "all",
      }),
    [editablePlaces, filters.category, filters.city, filters.status],
  );
  const filteredPlaces = useMemo(
    () =>
      filterAndSortFieldGuidePlaces(editablePlaces, filters, {
        nearbyActive,
        userLocation,
      }),
    [editablePlaces, filters, nearbyActive, userLocation],
  );
  const visibleListPlaces = filteredPlaces.slice(0, visibleCount);
  const selectedPlace =
    filteredPlaces.find((place) => place.id === selectedPlaceId) ?? null;
  const selectedDistance = selectedPlace && userLocation
    ? getDistanceKm(userLocation, selectedPlace)
    : null;

  useEffect(() => {
    setEditablePlaces(places);
  }, [places]);

  useEffect(() => {
    setIsLocalhost(["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
  }, []);

  useEffect(() => {
    if (!hasRestoredCityPreference) {
      return;
    }

    const nextQuery = buildFieldGuideQuery(filters);
    const currentQuery = searchParams.toString();

    if (nextQuery === currentQuery) {
      return;
    }

    startTransition(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      });
    });
  }, [filters, hasRestoredCityPreference, pathname, router, searchParams]);

  useEffect(() => {
    let rememberedCity: string | null = null;

    try {
      rememberedCity = window.localStorage.getItem(lastCityStorageKey);
    } catch {
      // Storage can be unavailable in restricted browser modes.
    }

    const city = resolveFieldGuideCityPreference(
      places,
      requestedCity,
      rememberedCity,
    );

    setFilters((current) =>
      current.city === city ? current : { ...current, city },
    );
    setHasRestoredCityPreference(true);
  }, [places, requestedCity]);

  useEffect(() => {
    if (!hasRestoredCityPreference || !filters.city) {
      return;
    }

    try {
      window.localStorage.setItem(lastCityStorageKey, filters.city);
    } catch {
      // The app remains usable when browser storage is unavailable.
    }
  }, [filters.city, hasRestoredCityPreference]);

  useEffect(() => {
    setVisibleCount(resultBatchSize);
    setSelectedPlaceId(null);
    setEditingPlaceId(null);
  }, [filters]);

  useEffect(() => {
    if (filters.category !== "all" && !categories.includes(filters.category)) {
      setFilters((current) => ({ ...current, category: "all" }));
    }
  }, [categories, filters.category]);

  useEffect(() => {
    if (filters.area !== "all" && !areas.includes(filters.area)) {
      setFilters((current) => ({ ...current, area: "all" }));
    }
  }, [areas, filters.area]);

  useEffect(() => {
    if (selectedPlaceId && !filteredPlaces.some((place) => place.id === selectedPlaceId)) {
      setSelectedPlaceId(null);
    }
  }, [filteredPlaces, selectedPlaceId]);

  function changeCity(city: string) {
    setFilters((current) => ({
      ...current,
      city,
      category: "all",
      area: "all",
      query: "",
    }));
  }

  function toggleNearby() {
    if (nearbyActive) {
      setNearbyActive(false);
      setLocationMessage(userLocation ? "Showing Loved places first." : "");
      return;
    }

    if (userLocation) {
      setNearbyActive(true);
      setLocationMessage("Sorted by straight-line distance from you.");
      return;
    }

    setNearbyActive(true);
    setRequestLocationNonce((current) => current + 1);
  }

  function clearRefinements() {
    setFilters((current) => ({
      ...current,
      status: "all",
      category: "all",
      area: "all",
      lovedOnly: false,
      query: "",
    }));
  }

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#field-guide-results">Skip to places</a>

      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark}>TF</span>
          <span>Travel Field Guide</span>
        </Link>
        <span className={styles.placeTotal}>{cityPlaces.length} saved places</span>
        <div className={styles.desktopCitySelect}>
          <CitySelect cities={cities} city={filters.city} onChange={changeCity} />
        </div>
      </header>

      <section className={styles.mobileCityHeader} aria-labelledby="field-guide-city">
        <p>Current city</p>
        <div>
          <h1 id="field-guide-city">{filters.city}</h1>
          <CitySelect cities={cities} city={filters.city} onChange={changeCity} />
        </div>
      </section>

      <div className={styles.workspace}>
        <FieldGuideFiltersPanel
          areas={areas}
          categories={categories}
          filters={filters}
          locationMessage={locationMessage}
          locationStatus={locationStatus}
          nearbyActive={nearbyActive}
          onChange={setFilters}
          onClear={clearRefinements}
          onToggleNearby={toggleNearby}
        />

        <section className={styles.mapPanel} aria-label={`Map of ${filters.city}`}>
          <div className={`map-frame ${styles.mapFrame}`}>
            <MapView
              cityCenters={cityCenters}
              mapStyles={fieldGuideMapStyles}
              onClosePlace={() => setSelectedPlaceId(null)}
              onLocationStatusChange={(status, message) => {
                setLocationStatus(status);
                setLocationMessage(
                  status === "found"
                    ? "Sorted by straight-line distance from you."
                    : message,
                );
                if (status === "error") {
                  setNearbyActive(false);
                }
              }}
              onNearbyCityDetected={(city) => {
                if (cities.includes(city) && city !== filters.city) {
                  changeCity(city);
                }
              }}
              onSelectPlace={setSelectedPlaceId}
              onUserLocationFound={(location) => {
                setUserLocation(location);
                setNearbyActive(true);
              }}
              openPlaceId={selectedPlaceId}
              places={filteredPlaces}
              requestLocationNonce={requestLocationNonce}
              selectedPlaceId={selectedPlaceId}
              showLocationMessage={false}
              showPlaceDetails={false}
            />
          </div>
          {selectedPlace ? (
            <FieldGuidePlaceDetail
              distanceKm={selectedDistance}
              onClose={() => setSelectedPlaceId(null)}
              place={selectedPlace}
            />
          ) : null}
        </section>

        <aside className={styles.resultsPanel} id="field-guide-results">
          <div className={styles.resultsHeader}>
            <div>
              <p>{nearbyActive && userLocation ? "Nearby" : "Places"}</p>
              <h2>{filteredPlaces.length} results</h2>
            </div>
            <div className={styles.resultsActions}>
              <span className={isEditMode ? styles.editingLabel : undefined}>
                {isEditMode
                  ? "Editing"
                  : nearbyActive && userLocation
                    ? "Sorted by distance"
                    : "Loved first"}
              </span>
              {isLocalhost ? (
                <button
                  aria-pressed={isEditMode}
                  className={styles.editModeButton}
                  onClick={() => {
                    setIsEditMode((current) => !current);
                    setEditingPlaceId(null);
                    setEditMessage("");
                  }}
                  type="button"
                >
                  {isEditMode ? "Done" : "Edit list"}
                </button>
              ) : null}
            </div>
          </div>

          {editMessage ? <p className={styles.editNotice} role="status">{editMessage}</p> : null}

          {filteredPlaces.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>No matching places</strong>
              <p>Try a different category, area, or search.</p>
              <button onClick={clearRefinements} type="button">Clear filters</button>
            </div>
          ) : (
            <div className={styles.placeList}>
              {visibleListPlaces.map((place) => (
                <FieldGuidePlaceCard
                  distanceKm={
                    userLocation ? getDistanceKm(userLocation, place) : null
                  }
                  editor={
                    isEditMode && editingPlaceId === place.id ? (
                      <FieldGuidePlaceEditor
                        categories={allCategories}
                        onCancel={() => setEditingPlaceId(null)}
                        onSaved={(savedPlace) => {
                          setEditablePlaces((current) =>
                            current.map((candidate) =>
                              candidate.id === savedPlace.id ? savedPlace : candidate,
                            ),
                          );
                          setEditingPlaceId(null);
                          setEditMessage(`Saved ${savedPlace.name}.`);
                        }}
                        place={place}
                      />
                    ) : undefined
                  }
                  isEditable={
                    isEditMode &&
                    (editingPlaceId === null || editingPlaceId === place.id)
                  }
                  isEditing={editingPlaceId === place.id}
                  isSelected={selectedPlaceId === place.id || editingPlaceId === place.id}
                  key={place.id}
                  onEdit={() => {
                    setEditingPlaceId((current) => current === place.id ? null : place.id);
                    setEditMessage("");
                  }}
                  place={place}
                />
              ))}
              {visibleListPlaces.length < filteredPlaces.length ? (
                <button
                  className={styles.showMore}
                  onClick={() => setVisibleCount((current) => current + resultBatchSize)}
                  type="button"
                >
                  Show {Math.min(resultBatchSize, filteredPlaces.length - visibleListPlaces.length)} more
                </button>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
