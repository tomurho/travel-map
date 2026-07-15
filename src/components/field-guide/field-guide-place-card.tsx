import { formatDistance } from "@/lib/geo";
import { getGoogleMapsHandoffUrl, getPublicNotes, type Place } from "@/lib/place";
import styles from "./field-guide.module.css";

function getStatusLabel(place: Place) {
  if (place.loved) {
    return "Loved";
  }
  if (place.status === "want_to_go") {
    return "Want to go";
  }
  if (place.status === "been") {
    return "Been";
  }
  return "Saved";
}

export function FieldGuidePlaceCard({
  distanceKm,
  isSelected,
  place,
}: {
  distanceKm: number | null;
  isSelected: boolean;
  place: Place;
}) {
  return (
    <article
      aria-label={`${place.name}, ${getStatusLabel(place)}`}
      className={`${styles.placeCard}${isSelected ? ` ${styles.selectedCard}` : ""}`}
      data-place-id={place.id}
    >
      <div className={styles.placeCopy}>
        <div className={styles.placeTitleRow}>
          <a
            aria-label={`Open ${place.name} in Google Maps`}
            className={styles.placeNameLink}
            href={getGoogleMapsHandoffUrl(place)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {place.name}
          </a>
          {place.loved ? (
            <span className={styles.lovedMark} title="Loved">
              <span aria-hidden="true">♥</span>
              <span className={styles.srOnly}>Loved</span>
            </span>
          ) : null}
        </div>
        <small>
          {place.category}
          {place.district ? ` · ${place.district}` : ""}
        </small>
        {distanceKm === null ? null : (
          <span className={styles.distance}>{formatDistance(distanceKm)} away</span>
        )}
      </div>
    </article>
  );
}

export function FieldGuidePlaceDetail({
  distanceKm,
  onClose,
  place,
}: {
  distanceKm: number | null;
  onClose: () => void;
  place: Place;
}) {
  const notes = getPublicNotes(place).slice(0, 2);

  return (
    <aside className={styles.placeDetail} aria-label={`Selected place: ${place.name}`}>
      <button
        aria-label="Close selected place"
        className={styles.detailClose}
        onClick={onClose}
        type="button"
      >
        ×
      </button>
      <div className={styles.detailHeading}>
        <div>
          <p>
            {place.loved ? "♥ " : null}
            {getStatusLabel(place)}
          </p>
          <h2>
            <a
              aria-label={`Open ${place.name} in Google Maps`}
              className={styles.detailNameLink}
              href={getGoogleMapsHandoffUrl(place)}
              rel="noopener noreferrer"
              target="_blank"
            >
              {place.name}
            </a>
          </h2>
          <span>
            {place.category}
            {place.district ? ` · ${place.district}` : ""}
          </span>
        </div>
      </div>
      {distanceKm === null ? null : (
        <p className={styles.detailDistance}>{formatDistance(distanceKm)} away</p>
      )}
      {notes.length > 0 ? (
        <div className={styles.detailNotes}>
          {notes.map((note) => <p key={note}>{note}</p>)}
        </div>
      ) : null}
    </aside>
  );
}
