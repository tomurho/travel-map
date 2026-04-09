"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MapView } from "@/components/map-view";
import {
  countByStatus,
  filterPlaces,
  getAvailableCategories,
  getAreas,
} from "@/lib/filtering";
import type { Place, PlaceFilterState } from "@/lib/place";

type TravelMapAppProps = {
  places: Place[];
  initialFilters: PlaceFilterState;
};

const defaultFilters: PlaceFilterState = {
  status: "all",
  category: "all",
  area: "all",
  loved: "all",
};

function buildQuery(filters: PlaceFilterState) {
  const params = new URLSearchParams();

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

  useEffect(() => {
    setFilters(initialFilters);
  }, [initialFilters]);

  const categories = useMemo(
    () =>
      getAvailableCategories(places, {
        status: filters.status,
        area: filters.area,
        loved: filters.loved,
      }),
    [places, filters.area, filters.loved, filters.status],
  );
  const areas = useMemo(() => getAreas(places), [places]);
  const counts = useMemo(() => countByStatus(places), [places]);
  const filteredPlaces = useMemo(
    () => filterPlaces(places, filters),
    [places, filters],
  );

  useEffect(() => {
    if (!filteredPlaces.some((place) => place.id === selectedPlaceId)) {
      setSelectedPlaceId(filteredPlaces[0]?.id ?? null);
    }
  }, [filteredPlaces, selectedPlaceId]);

  useEffect(() => {
    if (filters.category !== "all" && !categories.includes(filters.category)) {
      commitFilters({
        ...filters,
        category: "all",
      });
    }
  }, [categories, filters]);

  useEffect(() => {
    if (openMapPlaceId && !filteredPlaces.some((place) => place.id === openMapPlaceId)) {
      setOpenMapPlaceId(null);
    }
  }, [filteredPlaces, openMapPlaceId]);

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
    filteredPlaces.find((place) => place.id === selectedPlaceId) ?? null;
  const lovedFilterDisabled = filters.status !== "been";

  return (
    <main className="shell">
      <section className="hero panel">
        <h1>Places that stayed with me.</h1>
        <p>
          A living map of favorite finds, neighborhoods I still think about,
          and destinations still waiting for their turn. Filter by status,
          category, and whether a place earned a spot in the permanent memory
          bank.
        </p>
        <div className="stat-row">
          <span className="stat-chip">
            <strong>{places.length}</strong> pinned places
          </span>
          <span className="stat-chip">
            <span className="dot dot-been" />
            <strong>{counts.been}</strong> been
          </span>
          <span className="stat-chip">
            <span className="dot dot-want" />
            <strong>{counts.want_to_go}</strong> want to go
          </span>
          <span className="stat-chip">
            <span className="dot dot-location" />
            <strong>{counts.location}</strong> locations
          </span>
          <span className="stat-chip">
            <span className="dot dot-loved" />
            <strong>{places.filter((place) => place.loved === true).length}</strong> loved it
          </span>
        </div>
      </section>

      <section className="app-grid">
        <div className="panel map-panel">
          <div className="map-panel-header">
            <div>
              <h2>Travel map</h2>
              <p>The map lives here. Click a marker or choose a place from the list.</p>
            </div>
          </div>
          <div className="map-frame">
            <MapView
              places={filteredPlaces}
              selectedPlaceId={selectedPlaceId}
              openPlaceId={openMapPlaceId}
              onSelectPlace={(placeId) => {
                setSelectedPlaceId(placeId);
                setOpenMapPlaceId(placeId);
              }}
              onClosePlace={() => setOpenMapPlaceId(null)}
            />
          </div>
        </div>

        <aside className="sidebar">
          <section className="panel controls">
            <div className="controls-header">
              <div>
                <h2>Shape the map</h2>
                <p>
                  {isPending ? "Refreshing your view..." : "Filters update the map and the list together."}
                </p>
              </div>
              <button
                className="reset-button"
                onClick={() => commitFilters(defaultFilters)}
                type="button"
              >
                Reset filters
              </button>
            </div>
            <div className="filter-grid">
              <label>
                Status
                <select
                  value={filters.status}
                  onChange={(event) =>
                    commitFilters({
                      ...filters,
                      status: event.target.value as PlaceFilterState["status"],
                    })
                  }
                >
                  <option value="all">All statuses</option>
                  <option value="been">Been</option>
                  <option value="want_to_go">Want to go</option>
                  <option value="location">Location</option>
                </select>
              </label>

              <label>
                Category
                <select
                  value={filters.category}
                  onChange={(event) =>
                    commitFilters({
                      ...filters,
                      category: event.target.value,
                    })
                  }
                >
                  <option value="all">All categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Area
                <select
                  value={filters.area}
                  onChange={(event) =>
                    commitFilters({
                      ...filters,
                      area: event.target.value,
                    })
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

              <label>
                <span className="checkbox-row">
                  <span className="checkbox-label">Loved it</span>
                  <input
                    checked={filters.loved === "loved"}
                    onChange={(event) =>
                      commitFilters({
                        ...filters,
                        status: event.target.checked ? "been" : filters.status,
                        loved: event.target.checked ? "loved" : "all",
                      })
                    }
                    type="checkbox"
                  />
                </span>
              </label>
            </div>
          </section>

          <section className="panel list-panel">
            <h2>{filteredPlaces.length} places in view</h2>
            <p>
              Tap a card to fly the map there. Tap a marker to focus the card
              here.
            </p>

            {filteredPlaces.length === 0 ? (
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
                {filteredPlaces.map((place) => (
                  <button
                    key={place.id}
                    data-place-id={place.id}
                    className={`place-card ${selectedPlace?.id === place.id ? "is-active" : ""}`}
                    onClick={() => {
                      setSelectedPlaceId(place.id);
                      setOpenMapPlaceId(place.id);
                    }}
                    type="button"
                  >
                    <div className="place-card-header">
                      <div>
                        <h3>{place.name}</h3>
                        <div className="eyebrow">
                          <span>{place.category}</span>
                          {place.status === "been" || place.status === "want_to_go" ? (
                            <span className={`badge ${place.status}`}>
                              {place.status === "been" ? "Been" : "Want to go"}
                            </span>
                          ) : null}
                          {place.loved === true ? (
                            <span className="loved-badge">Loved it</span>
                          ) : null}
                        </div>
                      </div>
                      {place.district ? <span className="badge">{place.district}</span> : null}
                    </div>
                    <address>{place.address || "Address to be added"}</address>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}
