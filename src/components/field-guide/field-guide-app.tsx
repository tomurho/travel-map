"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FieldGuideFiltersPanel } from "@/components/field-guide/field-guide-filters";
import {
  FieldGuidePlaceCard,
  FieldGuidePlaceDetail,
} from "@/components/field-guide/field-guide-place-card";
import { type CityCenter, MapView } from "@/components/map-view";
import { getAvailableAreas, getAvailableCategories, getCities } from "@/lib/filtering";
import {
  buildFieldGuideQuery,
  filterAndSortFieldGuidePlaces,
  getDefaultFieldGuideCity,
  normalizeFieldGuideFilters,
  type FieldGuideFilters,
} from "@/lib/field-guide";
import { getDistanceKm, type GeoPoint } from "@/lib/geo";
import type { Place } from "@/lib/place";
import styles from "./field-guide.module.css";

type LocationStatus = "idle" | "locating" | "found" | "error";

const resultBatchSize = 24;

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
}: {
  initialFilters: FieldGuideFilters;
  places: Place[];
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

  const cities = useMemo(() => getCities(places), [places]);
  const cityCenters = useMemo(() => getCityCenters(places), [places]);
  const cityPlaces = useMemo(
    () => places.filter((place) => place.city === filters.city),
    [filters.city, places],
  );
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
  const filteredPlaces = useMemo(
    () =>
      filterAndSortFieldGuidePlaces(places, filters, {
        nearbyActive,
        userLocation,
      }),
    [filters, nearbyActive, places, userLocation],
  );
  const visiblePlaces = filteredPlaces.slice(0, visibleCount);
  const selectedPlace =
    visiblePlaces.find((place) => place.id === selectedPlaceId) ?? null;
  const selectedDistance = selectedPlace && userLocation
    ? getDistanceKm(userLocation, selectedPlace)
    : null;

  useEffect(() => {
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
  }, [filters, pathname, router, searchParams]);

  useEffect(() => {
    setVisibleCount(resultBatchSize);
    setSelectedPlaceId(null);
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
    if (selectedPlaceId && !visiblePlaces.some((place) => place.id === selectedPlaceId)) {
      setSelectedPlaceId(null);
    }
  }, [selectedPlaceId, visiblePlaces]);

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
          <div className={styles.mapMeta}>
            <span>{visiblePlaces.length} mapped</span>
            <span>
              {visiblePlaces.length < filteredPlaces.length
                ? `${filteredPlaces.length - visiblePlaces.length} more in results`
                : "Map and list in sync"}
            </span>
          </div>
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
              places={visiblePlaces}
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
            <span>
              {nearbyActive && userLocation ? "Sorted by distance" : "Loved first"}
            </span>
          </div>

          {filteredPlaces.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>No matching places</strong>
              <p>Try a different category, area, or search.</p>
              <button onClick={clearRefinements} type="button">Clear filters</button>
            </div>
          ) : (
            <div className={styles.placeList}>
              {visiblePlaces.map((place) => (
                <FieldGuidePlaceCard
                  distanceKm={
                    userLocation ? getDistanceKm(userLocation, place) : null
                  }
                  isSelected={selectedPlaceId === place.id}
                  key={place.id}
                  place={place}
                />
              ))}
              {visiblePlaces.length < filteredPlaces.length ? (
                <button
                  className={styles.showMore}
                  onClick={() => setVisibleCount((current) => current + resultBatchSize)}
                  type="button"
                >
                  Show {Math.min(resultBatchSize, filteredPlaces.length - visiblePlaces.length)} more
                </button>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
