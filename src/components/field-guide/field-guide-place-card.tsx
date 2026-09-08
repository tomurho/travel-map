import { formatDistance } from "@/lib/geo";
import { getGoogleMapsHandoffUrl, getPublicNotes, type Place } from "@/lib/place";
import type { ReactNode } from "react";
import { compactPlaceAddress } from "@/lib/place-card-address";
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
  editor,
  isEditable,
  isEditing,
  isSelected,
  onEdit,
  onSelect,
  place,
}: {
  distanceKm: number | null;
  editor?: ReactNode;
  isEditable?: boolean;
  isEditing?: boolean;
  isSelected: boolean;
  onEdit?: () => void;
  onSelect: () => void;
  place: Place;
}) {
  return (
    <article
      aria-label={`${place.name}, ${getStatusLabel(place)}`}
      className={`${styles.placeCard}${isSelected ? ` ${styles.selectedCard}` : ""}`}
      data-place-id={place.id}
    >
      <div className={`${styles.placeCopy}${isEditable && !isEditing ? ` ${styles.placeCopyEditable}` : ""}`}>
        <div className={styles.placeTitleRow}>
          <button
            aria-label={`Show ${place.name} on map`}
            aria-pressed={isSelected}
            className={styles.placeNameLink}
            onClick={onSelect}
            type="button"
          >
            {place.name}
          </button>
          {place.loved ? (
            <span className={styles.lovedMark} title="Loved">
              <span aria-hidden="true">♥</span>
              <span className={styles.srOnly}>Loved</span>
            </span>
          ) : place.status === "want_to_go" ? (
            <span className={styles.wantMark} title="Want to go">
              <span className={styles.srOnly}>Want to go</span>
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
        {isEditable && !isEditing ? (
          <button className={styles.rowEditButton} onClick={onEdit} type="button">
            Edit
          </button>
        ) : null}
      </div>
      {editor}
    </article>
  );
}

export function FieldGuidePlaceDetail({
  distanceKm,
  onClose,
  place,
  hideCategory = false,
}: {
  distanceKm: number | null;
  onClose: () => void;
  place: Place;
  hideCategory?: boolean;
}) {
  const notes = getPublicNotes(place);

  return (
    <aside className={styles.placeDetail} aria-label={`Selected place: ${place.name}`}>
      <div className={styles.detailLayout}>
        <div className={styles.detailCopy}>
          <div className={styles.detailHeading}>
            <div>
              <p>
                {place.loved ? "♥ " : null}
                {getStatusLabel(place)}
              </p>
              <h2>{place.name}</h2>
              <span className={hideCategory ? styles.redundantCategory : undefined}>
                {place.category}
                <span className={styles.detailDistrict}>{place.district ? ` · ${place.district}` : ""}</span>
              </span>
            </div>
          </div>
          {place.address.trim() ? <p className={styles.detailAddress}>
            <span className={styles.fullAddress}>{place.address}</span>
            <span className={styles.compactAddress}>{compactPlaceAddress(place)}</span>
          </p> : null}
        </div>
        <div className={styles.detailActions}>
          <button
            aria-label="Close selected place"
            className={styles.detailClose}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
          <a
            className={styles.mapsHandoff}
            href={getGoogleMapsHandoffUrl(place)}
            rel="noopener noreferrer"
            target="_blank"
            aria-label={`Open ${place.name} in Google Maps (new tab)`}
          >
            <span className={styles.fullMapsLabel}>Open in Google Maps ↗</span>
            <span className={styles.compactMapsLabel}>Maps ↗</span>
          </a>
        </div>
      </div>
      {distanceKm === null ? null : (
        <p className={styles.detailDistance}>{formatDistance(distanceKm)} away</p>
      )}
      {notes.length > 0 ? (
        <div className={`${styles.detailNotes} ${styles.fullNotes}`}>
          <h3>Your notes</h3>
          {notes.slice(0, 2).map((note, index) => <p key={index}>{note}</p>)}
          {notes.length > 2 ? <details>
            <summary>Read {notes.length - 2} more {notes.length === 3 ? "note" : "notes"}</summary>
            {notes.slice(2).map((note, index) => <p key={index}>{note}</p>)}
          </details> : null}
        </div>
      ) : null}
      {notes.length > 0 ? <details className={styles.compactNotes}>
        <summary>Your notes</summary>
        {notes.map((note, index) => <p key={index}>{note}</p>)}
      </details> : null}
    </aside>
  );
}
