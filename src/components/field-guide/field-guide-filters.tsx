import {
  setFieldGuideStatus,
  toggleFieldGuideLoved,
  toggleFieldGuideWantToGo,
  type FieldGuideFilters,
} from "@/lib/field-guide";
import type { PlaceStatus } from "@/lib/place";
import styles from "./field-guide.module.css";

type LocationStatus = "idle" | "locating" | "found" | "error";

type FieldGuideFiltersProps = {
  areas: string[];
  categories: string[];
  filters: FieldGuideFilters;
  locationMessage: string;
  locationStatus: LocationStatus;
  nearbyActive: boolean;
  onChange: (filters: FieldGuideFilters) => void;
  onClear: () => void;
  onToggleNearby: () => void;
};

const statusOptions: Array<{ label: string; value: PlaceStatus | "all" }> = [
  { label: "All statuses", value: "all" },
  { label: "Been", value: "been" },
  { label: "Want to go", value: "want_to_go" },
  { label: "Saved", value: "location" },
];

export function FieldGuideFiltersPanel({
  areas,
  categories,
  filters,
  locationMessage,
  locationStatus,
  nearbyActive,
  onChange,
  onClear,
  onToggleNearby,
}: FieldGuideFiltersProps) {
  const hasRefinements =
    filters.status !== "all" ||
    filters.category !== "all" ||
    filters.area !== "all" ||
    filters.lovedOnly ||
    filters.query.trim().length > 0;

  return (
    <section className={styles.filtersPanel} aria-label="Find a place">
      <label className={styles.searchField}>
        <span className={styles.srOnly}>Search places, food, or areas</span>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m16.5 16.5 4 4" />
        </svg>
        <input
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="Search places, food, or areas"
          type="search"
          value={filters.query}
        />
      </label>

      <div className={styles.primaryFilters}>
        <button
          aria-pressed={nearbyActive}
          className={`${styles.filterPill} ${styles.nearbyPill}${
            nearbyActive ? ` ${styles.activeNearby}` : ""
          }`}
          disabled={locationStatus === "locating"}
          onClick={onToggleNearby}
          type="button"
        >
          {locationStatus === "locating" ? "Finding…" : "Nearby"}
        </button>
        <button
          aria-pressed={filters.lovedOnly}
          className={`${styles.filterPill} ${styles.lovedPill}${
            filters.lovedOnly ? ` ${styles.activeLoved}` : ""
          }`}
          onClick={() => onChange(toggleFieldGuideLoved(filters))}
          type="button"
        >
          <span aria-hidden="true">♥</span>
          Loved
        </button>
        <button
          aria-pressed={filters.status === "want_to_go"}
          className={`${styles.filterPill} ${styles.wantPill}${
            filters.status === "want_to_go" ? ` ${styles.activeWant}` : ""
          }`}
          onClick={() => onChange(toggleFieldGuideWantToGo(filters))}
          type="button"
        >
          Want to go
        </button>
      </div>

      <div className={styles.secondaryFilters}>
        <label>
          <span className={styles.srOnly}>Category</span>
          <select
            aria-label="Category"
            onChange={(event) =>
              onChange({ ...filters, category: event.target.value })
            }
            value={filters.category}
          >
            <option value="all">All types</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={styles.srOnly}>Area</span>
          <select
            aria-label="Area"
            onChange={(event) => onChange({ ...filters, area: event.target.value })}
            value={filters.area}
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
          <span className={styles.srOnly}>Status</span>
          <select
            aria-label="Status"
            onChange={(event) =>
              onChange(
                setFieldGuideStatus(
                  filters,
                  event.target.value as FieldGuideFilters["status"],
                ),
              )
            }
            value={filters.status}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {hasRefinements ? (
          <button className={styles.clearButton} onClick={onClear} type="button">
            Clear
          </button>
        ) : null}
      </div>

      {locationMessage ? (
        <p
          className={`${styles.locationNotice} ${
            locationStatus === "error" ? styles.locationError : ""
          }`}
          role="status"
        >
          {locationMessage}
        </p>
      ) : null}
    </section>
  );
}
