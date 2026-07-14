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
import {
  getPublicNotes,
  type Place,
  type PlaceFilterState,
  type PlaceStatus,
} from "@/lib/place";

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

type NearbyMode =
  | "off"
  | "all"
  | "want_to_go"
  | "loved";

type FilterOption = {
  label: string;
  value: string;
};

type InspectorDraft = {
  name: string;
  category: string;
  district: string;
  status: PlaceStatus;
  loved: boolean;
};

type StatusBadge =
  | {
      icon: "bookmark" | "heart";
      label: string;
      modifier: string;
    }
  | {
      icon: null;
      label: string;
      modifier: string;
    };

const defaultFilters: PlaceFilterState = {
  city: "all",
  status: "all",
  category: "all",
  area: "all",
  loved: "all",
};

const inspectorStatusOptions: Array<{ label: string; value: PlaceStatus }> = [
  { label: "Neutral", value: "location" },
  { label: "Want to go", value: "want_to_go" },
  { label: "Been", value: "been" },
];

function isLocalhostHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getInspectorDraft(place: Place): InspectorDraft {
  return {
    name: place.name,
    category: place.category,
    district: place.district,
    status: place.status,
    loved: place.loved === true,
  };
}

function draftsAreEqual(firstDraft: InspectorDraft, secondDraft: InspectorDraft) {
  return (
    firstDraft.name === secondDraft.name &&
    firstDraft.category === secondDraft.category &&
    firstDraft.district === secondDraft.district &&
    firstDraft.status === secondDraft.status &&
    firstDraft.loved === secondDraft.loved
  );
}

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

  return "Nearby save";
}

function matchesNearbyMode(place: Place, mode: NearbyMode) {
  if (mode === "off" || mode === "all") {
    return true;
  }

  if (mode === "want_to_go") {
    return place.status === "want_to_go";
  }

  if (mode === "loved") {
    return place.loved === true;
  }

  return false;
}

function getRecommendationScore(place: Place, distanceKm: number) {
  const distanceScore = Math.max(0, 80 - distanceKm * 7);
  const lovedBoost = place.loved === true ? 90 : 0;
  const statusBoost =
    place.status === "want_to_go" ? 42 : place.status === "been" ? 28 : 18;

  return distanceScore + lovedBoost + statusBoost;
}

function getRecommendedPlaces(
  places: Place[],
  userLocation: GeoPoint | null,
  mode: NearbyMode,
): RecommendedPlace[] {
  if (!userLocation) {
    return [];
  }

  return places
    .filter((place) => matchesNearbyMode(place, mode))
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

function getPlacesByDistance(
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
    .sort(
      (firstPlace, secondPlace) => firstPlace.distanceKm - secondPlace.distanceKm,
    );
}

function getStatusBadge(place: Place): StatusBadge | null {
  if (place.loved === true) {
    return {
      icon: "heart" as const,
      label: "Loved",
      modifier: "status-badge--loved",
    };
  }

  if (place.status === "want_to_go") {
    return {
      icon: "bookmark" as const,
      label: "Want to go",
      modifier: "status-badge--want-to-go",
    };
  }

  if (place.status === "been") {
    return {
      icon: null,
      label: "Been",
      modifier: "status-badge--been",
    };
  }

  return null;
}

function StatusBadgeIcon({ icon }: { icon: "bookmark" | "heart" }) {
  if (icon === "heart") {
    return (
      <svg
        aria-hidden="true"
        className="status-badge__icon"
        viewBox="0 0 24 24"
      >
        <path
          d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="status-badge__icon"
      viewBox="0 0 24 24"
    >
      <path d="M6 3h12v18l-6-4-6 4V3z" fill="currentColor" />
    </svg>
  );
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
  places: initialPlaces,
  initialFilters,
}: TravelMapAppProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [editablePlaces, setEditablePlaces] = useState<Place[]>(initialPlaces);
  const [filters, setFilters] = useState<PlaceFilterState>(initialFilters);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(
    initialPlaces[0]?.id ?? null,
  );
  const [openMapPlaceId, setOpenMapPlaceId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<GeoPoint | null>(null);
  const [nearbyMode, setNearbyMode] = useState<NearbyMode>("off");
  const [requestLocationNonce, setRequestLocationNonce] = useState(0);
  const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [inspectorDraft, setInspectorDraft] = useState<InspectorDraft | null>(null);
  const [inspectorMessage, setInspectorMessage] = useState<string | null>(null);
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [isSavingInspector, setIsSavingInspector] = useState(false);

  useEffect(() => {
    setFilters(initialFilters);
  }, [initialFilters]);

  useEffect(() => {
    setEditablePlaces(initialPlaces);
  }, [initialPlaces]);

  useEffect(() => {
    setIsLocalhost(isLocalhostHostname(window.location.hostname));
  }, []);

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
      getAvailableCategories(editablePlaces, {
        city: filters.city,
        status: filters.status,
        area: filters.area,
        loved: filters.loved,
      }),
    [editablePlaces, filters.area, filters.city, filters.loved, filters.status],
  );
  const cities = useMemo(() => getCities(editablePlaces), [editablePlaces]);
  const cityCenters = useMemo(() => getCityCenters(editablePlaces), [editablePlaces]);
  const areas = useMemo(
    () =>
      getAvailableAreas(editablePlaces, {
        city: filters.city,
        status: filters.status,
        category: filters.category,
        loved: filters.loved,
      }),
    [editablePlaces, filters.category, filters.city, filters.loved, filters.status],
  );
  const scopedPlaces = useMemo(
    () =>
      filters.city === "all"
        ? editablePlaces
        : editablePlaces.filter((place) => place.city === filters.city),
    [editablePlaces, filters.city],
  );
  const scopedCounts = useMemo(() => countByStatus(scopedPlaces), [scopedPlaces]);
  const filteredPlaces = useMemo(
    () => filterPlaces(editablePlaces, filters),
    [editablePlaces, filters],
  );
  const recommendedPlaces = useMemo(
    () => getRecommendedPlaces(filteredPlaces, userLocation, nearbyMode),
    [filteredPlaces, nearbyMode, userLocation],
  );
  const placesByDistance = useMemo(
    () => getPlacesByDistance(filteredPlaces, userLocation),
    [filteredPlaces, userLocation],
  );
  const placesInView = useMemo(
    () =>
      nearbyMode !== "off" && userLocation
        ? placesByDistance.map((recommendedPlace) => recommendedPlace.place)
        : filteredPlaces,
    [filteredPlaces, nearbyMode, placesByDistance, userLocation],
  );
  const recommendationByPlaceId = useMemo(
    () =>
      new Map(
        (nearbyMode !== "off" && userLocation
          ? placesByDistance
          : recommendedPlaces
        ).map((recommendedPlace) => [
          recommendedPlace.place.id,
          recommendedPlace,
        ]),
      ),
    [nearbyMode, placesByDistance, recommendedPlaces, userLocation],
  );
  const closestLovedPlaces = useMemo(
    () =>
      getRecommendedPlaces(filteredPlaces, userLocation, "loved")
        .filter((recommendedPlace) => recommendedPlace.place.loved === true)
        .slice(0, 3),
    [filteredPlaces, userLocation],
  );
  const closestWantToGoPlaces = useMemo(
    () =>
      getRecommendedPlaces(filteredPlaces, userLocation, "want_to_go")
        .filter((recommendedPlace) => recommendedPlace.place.status === "want_to_go")
        .slice(0, 3),
    [filteredPlaces, userLocation],
  );
  const topPicksNearYou = useMemo(() => {
    const seenPlaceIds = new Set<string>();

    return [...closestLovedPlaces, ...closestWantToGoPlaces]
      .filter((recommendedPlace) => {
        if (seenPlaceIds.has(recommendedPlace.place.id)) {
          return false;
        }

        seenPlaceIds.add(recommendedPlace.place.id);
        return true;
      })
      .slice(0, 3);
  }, [closestLovedPlaces, closestWantToGoPlaces]);
  const selectedPlace =
    placesInView.find((place) => place.id === selectedPlaceId) ?? null;

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
    if (!isAdminMode) {
      setInspectorDraft(null);
      setInspectorError(null);
      setInspectorMessage(null);
      return;
    }

    if (!selectedPlace) {
      setInspectorDraft(null);
      return;
    }

    setInspectorDraft(getInspectorDraft(selectedPlace));
    setInspectorError(null);
    setInspectorMessage(null);
  }, [isAdminMode, selectedPlace]);

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

  function activateNearbyMode(mode: Exclude<NearbyMode, "off">) {
    setNearbyMode((currentMode) => (currentMode === mode ? "off" : mode));

    if (!userLocation) {
      setRequestLocationNonce((current) => current + 1);
    }
  }

  function updateInspectorDraft(nextDraft: Partial<InspectorDraft>) {
    setInspectorDraft((currentDraft) =>
      currentDraft ? { ...currentDraft, ...nextDraft } : currentDraft,
    );
    setInspectorError(null);
    setInspectorMessage(null);
  }

  function updateInspectorStatus(status: PlaceStatus) {
    updateInspectorDraft({
      status,
      loved:
        status === "been"
          ? inspectorDraft?.loved ?? false
          : false,
    });
  }

  function updateInspectorLoved(loved: boolean) {
    updateInspectorDraft({
      loved,
      status: loved ? "been" : inspectorDraft?.status ?? "location",
    });
  }

  function cancelInspectorEdit() {
    if (!selectedPlace) {
      setInspectorDraft(null);
      return;
    }

    setInspectorDraft(getInspectorDraft(selectedPlace));
    setInspectorError(null);
    setInspectorMessage(null);
  }

  async function saveInspectorEdit() {
    if (!selectedPlace || !inspectorDraft) {
      return;
    }

    const name = inspectorDraft.name.trim();
    const category = inspectorDraft.category.trim();
    const district = inspectorDraft.district.trim();

    if (!name) {
      setInspectorError("Name is required.");
      return;
    }

    if (!category) {
      setInspectorError("Category is required.");
      return;
    }

    setIsSavingInspector(true);
    setInspectorError(null);
    setInspectorMessage(null);

    try {
      const response = await fetch(
        `/api/admin/places/${encodeURIComponent(selectedPlace.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(adminPassword ? { "x-admin-password": adminPassword } : {}),
          },
          body: JSON.stringify({
            editMode: "floating-inspector",
            name,
            category,
            district,
            status: inspectorDraft.status,
            loved: inspectorDraft.loved,
          }),
        },
      );
      const responsePayload = (await response.json()) as {
        error?: string;
        place?: Place;
      };

      if (!response.ok || !responsePayload.place) {
        throw new Error(responsePayload.error ?? "Could not save place.");
      }

      const savedPlace = responsePayload.place;

      setEditablePlaces((currentPlaces) =>
        currentPlaces.map((place) =>
          place.id === savedPlace.id ? savedPlace : place,
        ),
      );
      setInspectorDraft(getInspectorDraft(savedPlace));
      setInspectorMessage(`Saved ${savedPlace.name}.`);
    } catch (saveError) {
      setInspectorError(
        saveError instanceof Error ? saveError.message : "Could not save place.",
      );
    } finally {
      setIsSavingInspector(false);
    }
  }

  const baselineInspectorDraft = selectedPlace
    ? getInspectorDraft(selectedPlace)
    : null;
  const inspectorHasChanges =
    inspectorDraft !== null &&
    baselineInspectorDraft !== null &&
    !draftsAreEqual(inspectorDraft, baselineInspectorDraft);
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
  return (
    <main className="shell">
      {isLocalhost ? (
        <div className="floating-admin-toggle" aria-label="Local admin controls">
          <span>Admin Mode</span>
          <button
            aria-pressed={isAdminMode}
            className={isAdminMode ? "is-active" : ""}
            onClick={() => setIsAdminMode((currentValue) => !currentValue)}
            type="button"
          >
            {isAdminMode ? "On" : "Off"}
          </button>
        </div>
      ) : null}

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
            loved
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
            <StatusBadgeIcon icon="heart" />
            <strong>Loved</strong>
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
              places={placesInView}
              cityCenters={cityCenters}
              selectedPlaceId={selectedPlaceId}
              openPlaceId={openMapPlaceId}
              requestLocationNonce={requestLocationNonce}
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
                setNearbyMode((currentMode) =>
                  currentMode === "off" ? "all" : currentMode,
                );
              }}
            />
          </div>
        </div>

        <aside className="sidebar">
          <section className="panel list-panel">
            <div className="list-panel-sticky">
              <div className="list-panel-header">
                <div>
                  <h2>{placesInView.length} places in view</h2>
                  <p>
                    {nearbyMode !== "off" && userLocation
                      ? "Sorted by your location, endorsements, and nearby wishlist saves."
                      : "Tap a card to fly the map there. Tap a marker to focus the card here."}
                  </p>
                </div>
                <button
                  aria-pressed={nearbyMode !== "off"}
                  className={`nearby-chip nearby-primary-button${
                    nearbyMode !== "off" ? " is-active" : ""
                  }`}
                  onClick={() => activateNearbyMode("all")}
                  type="button"
                >
                  Near me
                </button>
              </div>
              {nearbyMode !== "off" && userLocation && topPicksNearYou.length > 0 ? (
                <div className="top-picks-section">
                  <div className="section-eyebrow">Top picks near you</div>
                  <div className="top-picks-row">
                    {topPicksNearYou.map((recommendedPlace) => {
                      const place = recommendedPlace.place;
                      const statusBadge = getStatusBadge(place);

                      return (
                        <button
                          className="top-pick-card"
                          key={place.id}
                          onClick={() => {
                            setSelectedPlaceId(place.id);
                            setOpenMapPlaceId(place.id);
                          }}
                          type="button"
                        >
                          <span className="top-pick-copy">
                            {statusBadge ? (
                              <span
                                className={`status-badge ${statusBadge.modifier}`}
                              >
                                {statusBadge.icon ? (
                                  <StatusBadgeIcon icon={statusBadge.icon} />
                                ) : null}
                                {statusBadge.label}
                              </span>
                            ) : null}
                            <strong>{place.name}</strong>
                            <span>
                              {place.category}
                              {place.district ? ` · ${place.district}` : ""}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="section-eyebrow all-places-heading">All places</div>
            </div>

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
                  const publicNotes = getPublicNotes(place);
                  const googleMapsUrl = place.googleMapsUrl?.trim();
                  const statusBadge = getStatusBadge(place);
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
                        <div className="place-card-main">
                          <div className="place-card-title-row">
                            {statusBadge ? (
                              <div className="status-badge-row">
                                <span
                                  className={`status-badge ${statusBadge.modifier}`}
                                >
                                  {statusBadge.icon ? (
                                    <StatusBadgeIcon icon={statusBadge.icon} />
                                  ) : null}
                                  {statusBadge.label}
                                </span>
                              </div>
                            ) : null}
                            <h3>
                              {googleMapsUrl ? (
                                <a
                                  className="place-name-link"
                                  href={googleMapsUrl}
                                  onClick={(event) => event.stopPropagation()}
                                  rel="noopener noreferrer"
                                  target="_blank"
                                >
                                  {place.name}
                                </a>
                              ) : (
                                <span>{place.name}</span>
                              )}
                            </h3>
                          </div>
                          <p className="place-card-meta">
                            {place.category}
                            {place.district ? ` · ${place.district}` : ""}
                          </p>
                        </div>
                        <span className="place-card-chevron" aria-hidden="true" />
                      </div>
                      {publicNotes.length > 0 ? (
                        <div className="place-notes">
                          {publicNotes.map((note) => (
                            <p key={note}>{note}</p>
                          ))}
                        </div>
                      ) : null}
                      {userLocation && recommendation ? (
                        <div className="place-recommendation-row">
                          <span>
                            {nearbyMode !== "off"
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

      {isLocalhost && isAdminMode ? (
        <aside className="floating-inspector" aria-label="Edit selected place">
          <div className="floating-inspector-header">
            <div>
              <p>Localhost Admin</p>
              <h2>Edit Place</h2>
            </div>
            <button
              aria-label="Close inspector"
              onClick={() => setIsAdminMode(false)}
              type="button"
            >
              x
            </button>
          </div>

          {!selectedPlace || !inspectorDraft ? (
            <div className="floating-inspector-empty">
              Select a place to edit.
            </div>
          ) : (
            <div className="floating-inspector-body">
              <div className="floating-inspector-selected">
                <span>Selected</span>
                <strong>{selectedPlace.name}</strong>
              </div>

              <label>
                <span>Name</span>
                <input
                  onChange={(event) =>
                    updateInspectorDraft({ name: event.target.value })
                  }
                  type="text"
                  value={inspectorDraft.name}
                />
              </label>

              <label>
                <span>Category</span>
                <input
                  onChange={(event) =>
                    updateInspectorDraft({ category: event.target.value })
                  }
                  type="text"
                  value={inspectorDraft.category}
                />
              </label>

              <label>
                <span>Area</span>
                <input
                  onChange={(event) =>
                    updateInspectorDraft({ district: event.target.value })
                  }
                  type="text"
                  value={inspectorDraft.district}
                />
              </label>

              <fieldset className="floating-inspector-status">
                <legend>Status</legend>
                {inspectorStatusOptions.map((option) => (
                  <label key={option.value}>
                    <input
                      checked={inspectorDraft.status === option.value}
                      name="floating-inspector-status"
                      onChange={() =>
                        updateInspectorStatus(option.value)
                      }
                      type="radio"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>

              <label className="floating-inspector-toggle">
                <input
                  checked={inspectorDraft.loved}
                  onChange={(event) =>
                    updateInspectorLoved(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>Loved</span>
              </label>

              <label>
                <span>Admin password</span>
                <input
                  autoComplete="current-password"
                  onChange={(event) => setAdminPassword(event.target.value)}
                  placeholder="Only needed when configured"
                  type="password"
                  value={adminPassword}
                />
              </label>

              <dl className="floating-inspector-readonly">
                <div>
                  <dt>ID</dt>
                  <dd>{selectedPlace.id}</dd>
                </div>
                <div>
                  <dt>City</dt>
                  <dd>{selectedPlace.city}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>{selectedPlace.address || "-"}</dd>
                </div>
                <div>
                  <dt>Latitude</dt>
                  <dd>{selectedPlace.latitude}</dd>
                </div>
                <div>
                  <dt>Longitude</dt>
                  <dd>{selectedPlace.longitude}</dd>
                </div>
                <div>
                  <dt>Google Maps URL</dt>
                  <dd>{selectedPlace.googleMapsUrl || "-"}</dd>
                </div>
                <div>
                  <dt>Google Place ID</dt>
                  <dd>{selectedPlace.googlePlaceId || "-"}</dd>
                </div>
              </dl>

              {inspectorHasChanges ? (
                <p className="floating-inspector-unsaved">Unsaved changes</p>
              ) : null}
              {inspectorMessage ? (
                <p className="floating-inspector-message is-success">
                  {inspectorMessage}
                </p>
              ) : null}
              {inspectorError ? (
                <p className="floating-inspector-message is-error">
                  {inspectorError}
                </p>
              ) : null}

              <div className="floating-inspector-actions">
                <button
                  disabled={isSavingInspector}
                  onClick={cancelInspectorEdit}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  disabled={
                    isSavingInspector ||
                    !inspectorHasChanges ||
                    !inspectorDraft.name.trim() ||
                    !inspectorDraft.category.trim()
                  }
                  onClick={saveInspectorEdit}
                  type="button"
                >
                  {isSavingInspector ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </aside>
      ) : null}
    </main>
  );
}
