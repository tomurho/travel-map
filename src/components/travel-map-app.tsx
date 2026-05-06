"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type CityCenter, MapView } from "@/components/map-view";
import {
  countByStatus,
  filterPlaces,
  getAvailableAreas,
  getAvailableCategories,
  getCities,
} from "@/lib/filtering";
import { formatDistance, getDistanceKm, type GeoPoint } from "@/lib/geo";
import type { Place, PlaceFilterState } from "@/lib/place";

type TravelMapAppProps = {
  places: Place[];
  initialFilters: PlaceFilterState;
};

type RecommendedPlace = {
  place: Place;
  distanceKm: number;
  score: number;
  recommendationLabel: string;
};

type FilterOption = {
  label: string;
  value: string;
};

const defaultFilters: PlaceFilterState = {
  city: "all",
  status: "all",
  category: "all",
  area: "all",
  loved: "all",
};

function buildQuery(filters: PlaceFilterState) {
  const params = new URLSearchParams();

  if (filters.city !== "all") {
    params.set("city", filters.city);
  }

  if (filters.status !== "all") {
    params.set("status", filters.status);
  }

  if (filters.category !== "all") {
    params.set("category", filters.category);
  }

  if (filters.area !== "all") {
    params.set("area", filters.area);
  }

  if (filters.loved !== "all") {
    params.set("loved", filters.loved);
  }

  return params.toString();
}

function getCityCenters(places: Place[]): CityCenter[] {
  const cityGroups = new Map<
    string,
    {
      latitudeTotal: number;
      longitudeTotal: number;
      count: number;
    }
  >();

  for (const place of places) {
    const existingGroup = cityGroups.get(place.city) ?? {
      latitudeTotal: 0,
      longitudeTotal: 0,
      count: 0,
    };

    existingGroup.latitudeTotal += place.latitude;
    existingGroup.longitudeTotal += place.longitude;
    existingGroup.count += 1;
    cityGroups.set(place.city, existingGroup);
  }

  return Array.from(cityGroups, ([city, group]) => ({
    city,
    latitude: group.latitudeTotal / group.count,
    longitude: group.longitudeTotal / group.count,
  }));
}

function getRecommendationLabel(place: Place, distanceKm: number) {
  if (place.loved === true && distanceKm <= 2) {
    return "Closest loved pick";
  }

  if (place.loved === true) {
    return "Loved nearby";
  }

  if (place.status === "want_to_go") {
    return "Nearby wishlist";
  }

  if (place.status === "been") {
    return "Been nearby";
  }

  return "Nearby save";
}

function getRecommendationScore(place: Place, distanceKm: number) {
  const distanceScore = Math.max(0, 70 - distanceKm * 6);
  const lovedBoost = place.loved === true ? 90 : 0;
  const statusBoost =
    place.status === "been" ? 34 : place.status === "want_to_go" ? 28 : 8;

  return distanceScore + lovedBoost + statusBoost;
}

function getRecommendedPlaces(
  places: Place[],
  userLocation: GeoPoint | null,
): RecommendedPlace[] {
  if (!userLocation) {
    return [];
  }

  return places
    .map((place) => {
      const distanceKm = getDistanceKm(userLocation, {
        latitude: place.latitude,
        longitude: place.longitude,
      });

      return {
        place,
        distanceKm,
        score: getRecommendationScore(place, distanceKm),
        recommendationLabel: getRecommendationLabel(place, distanceKm),
      };
    })
    .sort((firstPlace, secondPlace) => {
      const scoreSort = secondPlace.score - firstPlace.score;

      if (scoreSort !== 0) {
        return scoreSort;
      }

      return firstPlace.distanceKm - secondPlace.distanceKm;
    });
}

function FilterMenu({
  id,
  isOpen,
  onSelect,
  options,
  selectedValue,
  setOpenMenu,
  title,
}: {
  id: string;
  isOpen: boolean;
  onSelect: (value: string) => void;
  options: FilterOption[];
  selectedValue: string;
  setOpenMenu: (id: string | null) => void;
  title: string;
}) {
  const selectedOption = options.find((option) => option.value === selectedValue);
  const isFiltered = selectedValue !== "all";
  const triggerLabel = isFiltered && selectedOption ? selectedOption.label : title;

  return (
    <div className={`filter-menu${isOpen ? " is-open" : ""}`} data-filter-menu>
      <button
        aria-expanded={isOpen}
        className={`filter-menu-trigger${isFiltered ? " is-filtered" : ""}`}
        onClick={() => setOpenMenu(isOpen ? null : id)}
        type="button"
      >
        <span>{triggerLabel}</span>
        <span className="filter-menu-chevron" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="filter-menu-panel" role="menu">
          {options.map((option) => (
            <button
              aria-checked={option.value === selectedValue}
              className={option.value === selectedValue ? "is-selected" : ""}
              key={option.value}
              onClick={() => {
                onSelect(option.value);
                setOpenMenu(null);
              }}
              role="menuitemradio"
              type="button"
            >
              <span className="filter-menu-radio" aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TravelMapApp({
  places,
  initialFilters,
}: TravelMapAppProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [filters, setFilters] = useState<PlaceFilterState>(initialFilters);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(
    places[0]?.id ?? null,
  );
  const [openMapPlaceId, setOpenMapPlaceId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<GeoPoint | null>(null);
  const [nearMeMode, setNearMeMode] = useState(false);
  const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null);

  useEffect(() => {
    setFilters(initialFilters);
  }, [initialFilters]);

  useEffect(() => {
    if (!openFilterMenu) {
      return;
    }

    function closeFilterMenu(event: MouseEvent | TouchEvent) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("[data-filter-menu]")
      ) {
        return;
      }

      setOpenFilterMenu(null);
    }

    function closeFilterMenuWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenFilterMenu(null);
      }
    }

    document.addEventListener("mousedown", closeFilterMenu);
    document.addEventListener("touchstart", closeFilterMenu);
    document.addEventListener("keydown", closeFilterMenuWithEscape);

    return () => {
      document.removeEventListener("mousedown", closeFilterMenu);
      document.removeEventListener("touchstart", closeFilterMenu);
      document.removeEventListener("keydown", closeFilterMenuWithEscape);
    };
  }, [openFilterMenu]);

  const categories = useMemo(
    () =>
      getAvailableCategories(places, {
        city: filters.city,
        status: filters.status,
        area: filters.area,
        loved: filters.loved,
      }),
    [places, filters.area, filters.city, filters.loved, filters.status],
  );
  const cities = useMemo(() => getCities(places), [places]);
  const cityCenters = useMemo(() => getCityCenters(places), [places]);
  const areas = useMemo(
    () =>
      getAvailableAreas(places, {
        city: filters.city,
        status: filters.status,
        category: filters.category,
        loved: filters.loved,
      }),
    [places, filters.category, filters.city, filters.loved, filters.status],
  );
  const scopedPlaces = useMemo(
    () =>
      filters.city === "all"
        ? places
        : places.filter((place) => place.city === filters.city),
    [filters.city, places],
  );
  const scopedCounts = useMemo(() => countByStatus(scopedPlaces), [scopedPlaces]);
  const filteredPlaces = useMemo(
    () => filterPlaces(places, filters),
    [places, filters],
  );
  const recommendedPlaces = useMemo(
    () => getRecommendedPlaces(filteredPlaces, userLocation),
    [filteredPlaces, userLocation],
  );
  const placesInView = useMemo(
    () =>
      nearMeMode
        ? recommendedPlaces.map((recommendedPlace) => recommendedPlace.place)
        : filteredPlaces,
    [filteredPlaces, nearMeMode, recommendedPlaces],
  );
  const recommendationByPlaceId = useMemo(
    () =>
      new Map(
        recommendedPlaces.map((recommendedPlace) => [
          recommendedPlace.place.id,
          recommendedPlace,
        ]),
      ),
    [recommendedPlaces],
  );
  const closestLovedPlaces = useMemo(
    () =>
      recommendedPlaces
        .filter((recommendedPlace) => recommendedPlace.place.loved === true)
        .slice(0, 3),
    [recommendedPlaces],
  );
  const closestWantToGoPlaces = useMemo(
    () =>
      recommendedPlaces
        .filter((recommendedPlace) => recommendedPlace.place.status === "want_to_go")
        .slice(0, 3),
    [recommendedPlaces],
  );

  useEffect(() => {
    if (
      selectedPlaceId &&
      !placesInView.some((place) => place.id === selectedPlaceId)
    ) {
      setSelectedPlaceId(null);
    }
  }, [placesInView, selectedPlaceId]);

  useEffect(() => {
    if (filters.category !== "all" && !categories.includes(filters.category)) {
      commitFilters({
        ...filters,
        category: "all",
      });
    }
  }, [categories, filters]);

  useEffect(() => {
    if (filters.area !== "all" && !areas.includes(filters.area)) {
      commitFilters({
        ...filters,
        area: "all",
      });
    }
  }, [areas, filters]);

  useEffect(() => {
    if (openMapPlaceId && !placesInView.some((place) => place.id === openMapPlaceId)) {
      setOpenMapPlaceId(null);
    }
  }, [placesInView, openMapPlaceId]);

  useEffect(() => {
    if (!selectedPlaceId) {
      return;
    }

    if (!window.matchMedia("(min-width: 1081px)").matches) {
      return;
    }

    const selectedCard = document.querySelector<HTMLElement>(
      `[data-place-id="${selectedPlaceId}"]`,
    );
    selectedCard?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedPlaceId]);

  function commitFilters(nextFilters: PlaceFilterState) {
    const normalizedFilters =
      nextFilters.status === "been"
        ? nextFilters
        : {
            ...nextFilters,
            loved: "all" as const,
          };

    setFilters(normalizedFilters);
    setSelectedPlaceId(null);
    setOpenMapPlaceId(null);

    startTransition(() => {
      const nextQuery = buildQuery(normalizedFilters);
      const currentQuery = searchParams.toString();

      if (nextQuery === currentQuery) {
        return;
      }

      const nextPath = nextQuery ? `${pathname}?${nextQuery}` : pathname;
      router.replace(nextPath, { scroll: false });
    });
  }

  const selectedPlace =
    placesInView.find((place) => place.id === selectedPlaceId) ?? null;
  const lovedFilterActive = filters.loved === "loved";
  const cityOptions = [
    { label: "All cities", value: "all" },
    ...cities.map((city) => ({ label: city, value: city })),
  ];
  const statusOptions: FilterOption[] = [
    { label: "All statuses", value: "all" },
    { label: "Been", value: "been" },
    { label: "Want to go", value: "want_to_go" },
    { label: "Location", value: "location" },
  ];
  const categoryOptions = [
    { label: "All categories", value: "all" },
    ...categories.map((category) => ({ label: category, value: category })),
  ];
  const areaOptions = [
    { label: "All areas", value: "all" },
    ...areas.map((area) => ({ label: area, value: area })),
  ];
  const nearbySections = [
    {
      countLabel: closestLovedPlaces.length,
      label: "Top loved nearby",
      places: closestLovedPlaces,
    },
    {
      countLabel: closestWantToGoPlaces.length,
      label: "Top want to go nearby",
      places: closestWantToGoPlaces,
    },
  ].filter((section) => section.places.length > 0);

  return (
    <main className="shell">
      <section className={`hero panel${openFilterMenu === "city" ? " is-menu-open" : ""}`}>
        <h1>Places that stayed with me.</h1>
        <p>
          A living map of favorite finds, neighborhoods I still think about,
          and destinations still waiting for their turn.
        </p>
        <div className="stat-row">
          <FilterMenu
            id="city"
            isOpen={openFilterMenu === "city"}
            onSelect={(city) =>
              commitFilters({
                ...filters,
                city,
                area: "all",
                category: "all",
              })
            }
            options={cityOptions}
            selectedValue={filters.city}
            setOpenMenu={setOpenFilterMenu}
            title="City"
          />
          <span className="stat-chip">
            <strong>{scopedPlaces.length}</strong> pinned places
          </span>
          <span className="stat-chip">
            <span className="dot dot-been" />
            <strong>{scopedCounts.been}</strong> been
          </span>
          <span className="stat-chip">
            <span className="dot dot-want" />
            <strong>{scopedCounts.want_to_go}</strong> want to go
          </span>
          <span className="stat-chip">
            <span className="dot dot-location" />
            <strong>{scopedCounts.location}</strong> locations
          </span>
          <span className="stat-chip">
            <span className="dot dot-loved" />
            <strong>{scopedPlaces.filter((place) => place.loved === true).length}</strong>{" "}
            loved it
          </span>
        </div>
      </section>

      <section
        className={`panel controls${
          openFilterMenu && openFilterMenu !== "city" ? " is-menu-open" : ""
        }`}
      >
        <div className="controls-header">
          <div>
            <h2>Shape the map</h2>
            {isPending ? <p>Refreshing your view...</p> : null}
          </div>
        </div>
        <div className="filter-row">
          <button
            aria-pressed={lovedFilterActive}
            className={`loved-filter-button${lovedFilterActive ? " is-active" : ""}`}
            onClick={() =>
              commitFilters({
                ...filters,
                status: lovedFilterActive ? filters.status : "been",
                loved: lovedFilterActive ? "all" : "loved",
              })
            }
            type="button"
          >
            <span className="loved-filter-mark" aria-hidden="true" />
            <strong>Loved it</strong>
          </button>

          <FilterMenu
            id="status"
            isOpen={openFilterMenu === "status"}
            onSelect={(status) =>
              commitFilters({
                ...filters,
                status: status as PlaceFilterState["status"],
              })
            }
            options={statusOptions}
            selectedValue={filters.status}
            setOpenMenu={setOpenFilterMenu}
            title="Status"
          />

          <FilterMenu
            id="category"
            isOpen={openFilterMenu === "category"}
            onSelect={(category) =>
              commitFilters({
                ...filters,
                category,
              })
            }
            options={categoryOptions}
            selectedValue={filters.category}
            setOpenMenu={setOpenFilterMenu}
            title="Category"
          />

          <FilterMenu
            id="area"
            isOpen={openFilterMenu === "area"}
            onSelect={(area) =>
              commitFilters({
                ...filters,
                area,
              })
            }
            options={areaOptions}
            selectedValue={filters.area}
            setOpenMenu={setOpenFilterMenu}
            title="Area"
          />
          <button
            className="reset-button"
            onClick={() => commitFilters(defaultFilters)}
            type="button"
          >
            Reset filters
          </button>
        </div>
      </section>

      <section className="app-grid">
        <div className="panel map-panel">
          <div className="map-frame">
            <MapView
              places={filteredPlaces}
              cityCenters={cityCenters}
              selectedPlaceId={selectedPlaceId}
              openPlaceId={openMapPlaceId}
              onSelectPlace={(placeId) => {
                setSelectedPlaceId(placeId);
                setOpenMapPlaceId(placeId);
              }}
              onClosePlace={() => setOpenMapPlaceId(null)}
              onNearbyCityDetected={(city) => {
                if (city === filters.city) {
                  return;
                }

                commitFilters({
                  ...filters,
                  city,
                  area: "all",
                  category: "all",
                });
              }}
              onUserLocationFound={(location) => {
                setUserLocation(location);
                setNearMeMode(true);
              }}
            />
          </div>
        </div>

        <aside className="sidebar">
          <section className="panel list-panel">
            <div className="list-panel-header">
              <div>
                <h2>{placesInView.length} places in view</h2>
                <p>
                  {nearMeMode && userLocation
                    ? "Sorted by your location, endorsements, and nearby wishlist saves."
                    : "Tap a card to fly the map there. Tap a marker to focus the card here."}
                </p>
              </div>
              {userLocation ? (
                <button
                  aria-pressed={nearMeMode}
                  className={`near-me-button${nearMeMode ? " is-active" : ""}`}
                  onClick={() => setNearMeMode((current) => !current)}
                  type="button"
                >
                  Near me
                </button>
              ) : null}
            </div>
            {userLocation && nearbySections.length > 0 ? (
              <div className="nearby-recommendation-grid">
                {nearbySections.map((section) => (
                  <div className="nearby-recommendation-panel" key={section.label}>
                    <div className="nearby-recommendation-header">
                      <span>{section.label}</span>
                      <strong>{section.countLabel}</strong>
                    </div>
                    <div className="nearby-recommendation-list">
                      {section.places.map((recommendedPlace) => (
                        <button
                          key={recommendedPlace.place.id}
                          onClick={() => {
                            setSelectedPlaceId(recommendedPlace.place.id);
                            setOpenMapPlaceId(recommendedPlace.place.id);
                          }}
                          type="button"
                        >
                          <span>{recommendedPlace.place.name}</span>
                          <strong>{formatDistance(recommendedPlace.distanceKm)}</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {placesInView.length === 0 ? (
              <div className="empty-state">
                <h3>No places match this combination yet.</h3>
                <p>
                  Try widening the filters to bring your full map back into
                  focus.
                </p>
                <button type="button" onClick={() => commitFilters(defaultFilters)}>
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="place-list">
                {placesInView.map((place) => {
                  const recommendation = recommendationByPlaceId.get(place.id) ?? null;
                  const selectPlace = () => {
                    setSelectedPlaceId(place.id);
                    setOpenMapPlaceId(place.id);
                  };

                  return (
                    <article
                      key={place.id}
                      data-place-id={place.id}
                      className={`place-card ${selectedPlace?.id === place.id ? "is-active" : ""}`}
                      onClick={selectPlace}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") {
                          return;
                        }

                        event.preventDefault();
                        selectPlace();
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="place-card-header">
                        <div>
                          <h3>{place.name}</h3>
                          <div className="eyebrow">
                            <span>{place.category}</span>
                            {place.loved === true ? (
                              <span className="loved-badge">Loved it</span>
                            ) : place.status === "been" || place.status === "want_to_go" ? (
                              <span className={`badge ${place.status}`}>
                                {place.status === "been" ? "Been" : "Want to go"}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {place.district ? <span className="badge">{place.district}</span> : null}
                      </div>
                      <address>{place.address || "Address to be added"}</address>
                      {userLocation && recommendation ? (
                        <div className="place-recommendation-row">
                          <span>
                            {nearMeMode
                              ? recommendation.recommendationLabel
                              : "Distance from you"}
                          </span>
                          <strong>{formatDistance(recommendation.distanceKm)} away</strong>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}
