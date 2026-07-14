"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type CityCenter, MapView } from "@/components/map-view";
import {
  countByStatus,
  getAvailableAreas,
  getAvailableCategories,
  getCities,
} from "@/lib/filtering";
import { getDistanceKm, type GeoPoint } from "@/lib/geo";
import {
  getGoogleMapsHandoffUrl,
  getPublicNotes,
  type Place,
  type PlaceFilterState,
  type PlaceStatus,
} from "@/lib/place";
import styles from "./travel-atlas-concept.module.css";

type TravelAtlasConceptProps = {
  places: Place[];
};

const batchSize = 24;

const statusOptions: Array<{ label: string; value: PlaceStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "Been", value: "been" },
  { label: "Want to go", value: "want_to_go" },
  { label: "Saved", value: "location" },
];

function getCityCenters(places: Place[]): CityCenter[] {
  const groups = new Map<string, { lat: number; lng: number; count: number }>();

  for (const place of places) {
    const group = groups.get(place.city) ?? { lat: 0, lng: 0, count: 0 };
    group.lat += place.latitude;
    group.lng += place.longitude;
    group.count += 1;
    groups.set(place.city, group);
  }

  return Array.from(groups, ([city, group]) => ({
    city,
    latitude: group.lat / group.count,
    longitude: group.lng / group.count,
  }));
}

function StatusMark({ place }: { place: Place }) {
  if (place.loved) {
    return <span className={`${styles.badge} ${styles.lovedBadge}`}>Loved</span>;
  }

  if (place.status === "want_to_go") {
    return <span className={`${styles.badge} ${styles.wantBadge}`}>Want to go</span>;
  }

  if (place.status === "been") {
    return <span className={`${styles.badge} ${styles.beenBadge}`}>Been</span>;
  }

  return <span className={`${styles.badge} ${styles.savedBadge}`}>Saved</span>;
}

export function TravelAtlasConcept({ places }: TravelAtlasConceptProps) {
  const cities = useMemo(() => getCities(places), [places]);
  const initialCity = cities.includes("Ho Chi Minh City")
    ? "Ho Chi Minh City"
    : cities[0] ?? "";
  const [filters, setFilters] = useState<PlaceFilterState>({
    city: initialCity,
    status: "all",
    category: "all",
    area: "all",
    loved: "all",
  });
  const [query, setQuery] = useState("");
  const [lovedOnly, setLovedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [openMapPlaceId, setOpenMapPlaceId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<GeoPoint | null>(null);

  const cityPlaces = useMemo(
    () => places.filter((place) => place.city === filters.city),
    [filters.city, places],
  );
  const counts = useMemo(() => countByStatus(cityPlaces), [cityPlaces]);
  const cityCenters = useMemo(() => getCityCenters(places), [places]);
  const categories = useMemo(
    () =>
      getAvailableCategories(places, {
        city: filters.city,
        status: filters.status,
        area: filters.area,
        loved: "all",
      }),
    [filters.area, filters.city, filters.status, places],
  );
  const areas = useMemo(
    () =>
      getAvailableAreas(places, {
        city: filters.city,
        status: filters.status,
        category: filters.category,
        loved: "all",
      }),
    [filters.category, filters.city, filters.status, places],
  );
  const filteredPlaces = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return cityPlaces
      .filter((place) => filters.status === "all" || place.status === filters.status)
      .filter(
        (place) =>
          filters.category === "all" || place.category === filters.category,
      )
      .filter((place) => filters.area === "all" || place.district === filters.area)
      .filter((place) => !lovedOnly || place.loved === true)
      .filter((place) => {
        if (!normalizedQuery) {
          return true;
        }

        return [place.name, place.category, place.district]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      })
      .sort((first, second) => {
        if (userLocation) {
          return (
            getDistanceKm(userLocation, {
              latitude: first.latitude,
              longitude: first.longitude,
            }) -
            getDistanceKm(userLocation, {
              latitude: second.latitude,
              longitude: second.longitude,
            })
          );
        }

        if (first.loved !== second.loved) {
          return first.loved ? -1 : 1;
        }

        return first.name.localeCompare(second.name);
      });
  }, [cityPlaces, filters.area, filters.category, filters.status, lovedOnly, query, userLocation]);
  const visiblePlaces = filteredPlaces.slice(0, visibleCount);
  const selectedPlace =
    filteredPlaces.find((place) => place.id === selectedPlaceId) ?? null;
  const selectedNotes = selectedPlace ? getPublicNotes(selectedPlace) : [];

  useEffect(() => {
    setVisibleCount(batchSize);
    setSelectedPlaceId(null);
    setOpenMapPlaceId(null);
  }, [filters, lovedOnly, query]);

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

  function selectPlace(placeId: string) {
    setSelectedPlaceId(placeId);
    setOpenMapPlaceId(placeId);
  }

  function updateCity(city: string) {
    setFilters({
      city,
      status: "all",
      category: "all",
      area: "all",
      loved: "all",
    });
    setLovedOnly(false);
    setQuery("");
  }

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#concept-results">
        Skip to places
      </a>

      <header className={styles.topbar}>
        <Link className={styles.brand} href="/concept">
          <span className={styles.brandMark}>TM</span>
          <span>
            <strong>Travel notebook</strong>
            <small>{places.length} places, personally kept</small>
          </span>
        </Link>
        <Link className={styles.originalLink} href="/">
          View original
          <span aria-hidden="true">↗</span>
        </Link>
      </header>

      <section className={styles.cityHeader} aria-labelledby="city-heading">
        <div>
          <p className={styles.eyebrow}>Now browsing</p>
          <h1 id="city-heading">{filters.city}</h1>
          <p className={styles.citySummary}>
            {cityPlaces.length} saved places · {counts.been} visited ·{" "}
            {cityPlaces.filter((place) => place.loved).length} loved
          </p>
        </div>
        <label className={styles.citySelect}>
          <span>Change city</span>
          <select value={filters.city} onChange={(event) => updateCity(event.target.value)}>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className={styles.controls} aria-label="Refine places">
        <label className={styles.searchField}>
          <span className={styles.srOnly}>Search places</span>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="m16.5 16.5 4 4" />
          </svg>
          <input
            type="search"
            placeholder="Search names, types, or areas"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className={styles.statusGroup} aria-label="Status">
          {statusOptions.map((option) => (
            <button
              aria-pressed={filters.status === option.value}
              className={filters.status === option.value ? styles.activeStatus : ""}
              key={option.value}
              onClick={() =>
                setFilters((current) => ({ ...current, status: option.value }))
              }
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          aria-pressed={lovedOnly}
          className={`${styles.lovedToggle}${lovedOnly ? ` ${styles.activeLoved}` : ""}`}
          onClick={() => setLovedOnly((current) => !current)}
          type="button"
        >
          <span aria-hidden="true">♥</span>
          Loved
        </button>

        <label className={styles.compactSelect}>
          <span>Type</span>
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters((current) => ({ ...current, category: event.target.value }))
            }
          >
            <option value="all">All types</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.compactSelect}>
          <span>Area</span>
          <select
            value={filters.area}
            onChange={(event) =>
              setFilters((current) => ({ ...current, area: event.target.value }))
            }
          >
            <option value="all">All areas</option>
            {areas.map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className={styles.workspace}>
        <section className={styles.mapPanel} aria-label={`Map of ${filters.city}`}>
          <div className={styles.mapHeading}>
            <div>
              <p className={styles.eyebrow}>Map notebook</p>
              <h2>{visiblePlaces.length} places mapped</h2>
            </div>
            <p>
              {filteredPlaces.length > visiblePlaces.length
                ? `${filteredPlaces.length - visiblePlaces.length} more available below`
                : "Map and list are in sync"}
            </p>
          </div>
          <div className={`map-frame ${styles.mapFrame}`}>
            <MapView
              places={visiblePlaces}
              cityCenters={cityCenters}
              selectedPlaceId={selectedPlaceId}
              openPlaceId={openMapPlaceId}
              requestLocationNonce={0}
              onSelectPlace={(placeId) => {
                setSelectedPlaceId(placeId);
                setOpenMapPlaceId(placeId);
              }}
              onClosePlace={() => setOpenMapPlaceId(null)}
              onNearbyCityDetected={(city) => {
                if (cities.includes(city)) {
                  updateCity(city);
                }
              }}
              onUserLocationFound={setUserLocation}
            />
          </div>
        </section>

        <aside className={styles.resultsPanel} id="concept-results">
          <div className={styles.resultsHeader}>
            <div>
              <p className={styles.eyebrow}>Your shortlist</p>
              <h2>{filteredPlaces.length} places</h2>
            </div>
            <span>{userLocation ? "Nearest first" : "Loved first"}</span>
          </div>

          {filteredPlaces.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>No matching places</strong>
              <p>Clear a refinement or try a broader search.</p>
              <button
                onClick={() => {
                  setFilters((current) => ({
                    ...current,
                    status: "all",
                    category: "all",
                    area: "all",
                  }));
                  setLovedOnly(false);
                  setQuery("");
                }}
                type="button"
              >
                Clear refinements
              </button>
            </div>
          ) : (
            <div className={styles.placeList}>
              {visiblePlaces.map((place) => {
                const distance = userLocation
                  ? getDistanceKm(userLocation, {
                      latitude: place.latitude,
                      longitude: place.longitude,
                    })
                  : null;

                return (
                  <article
                    className={`${styles.placeCard}${
                      selectedPlaceId === place.id ? ` ${styles.activeCard}` : ""
                    }`}
                    key={place.id}
                  >
                    <button
                      className={styles.cardButton}
                      onClick={() => selectPlace(place.id)}
                      type="button"
                    >
                      <span className={styles.cardCopy}>
                        <StatusMark place={place} />
                        <strong>{place.name}</strong>
                        <small>
                          {place.category}
                          {place.district ? ` · ${place.district}` : ""}
                          {distance === null ? "" : ` · ${distance.toFixed(1)} km`}
                        </small>
                      </span>
                      <span className={styles.cardArrow} aria-hidden="true">→</span>
                    </button>
                    <a
                      aria-label={`Open ${place.name} in Google Maps`}
                      className={styles.mapsLink}
                      href={getGoogleMapsHandoffUrl(place)}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Maps ↗
                    </a>
                  </article>
                );
              })}

              {visiblePlaces.length < filteredPlaces.length ? (
                <button
                  className={styles.showMore}
                  onClick={() => setVisibleCount((current) => current + batchSize)}
                  type="button"
                >
                  Show {Math.min(batchSize, filteredPlaces.length - visiblePlaces.length)} more
                </button>
              ) : null}
            </div>
          )}

          {selectedPlace ? (
            <section className={styles.selection} aria-live="polite">
              <p className={styles.eyebrow}>Selected place</p>
              <h3>{selectedPlace.name}</h3>
              <p>
                {selectedPlace.category}
                {selectedPlace.district ? ` · ${selectedPlace.district}` : ""}
              </p>
              {selectedNotes.slice(0, 2).map((note) => (
                <blockquote key={note}>{note}</blockquote>
              ))}
            </section>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
