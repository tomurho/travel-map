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
  details,
  isEditable,
  isEditing,
  isSelected,
  onEdit,
  onSelect,
  place,
}: {
  distanceKm: number | null;
  editor?: ReactNode;
  details?: ReactNode;
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
      onClick={(event) => {
        if (isEditing || (event.target as Element).closest("a, button, input, select, textarea, summary, details, label")) return;
        onSelect();
      }}
    >
      <div className={`${styles.placeCopy}${isEditable && !isEditing ? ` ${styles.placeCopyEditable}` : ""}`}>
        {details ? <p className={styles.placeStatus}>{place.loved ? "♥ " : null}{getStatusLabel(place)}</p> : null}
        <div className={styles.placeTitleRow}>
          <a
            className={styles.placeNameLink}
            href={getGoogleMapsHandoffUrl(place)}
            rel="noopener noreferrer"
            target="_blank"
            aria-label={`Open ${place.name} in Google Maps (new tab)`}
          >
            {place.name}
          </a>
          {!details && place.loved ? (
            <span className={styles.lovedMark} title="Loved">
              <span aria-hidden="true">♥</span>
              <span className={styles.srOnly}>Loved</span>
            </span>
          ) : !details && place.status === "want_to_go" ? (
            <span className={styles.wantMark} title="Want to go">
              <span className={styles.srOnly}>Want to go</span>
            </span>
          ) : null}
        </div>
        <button
          aria-label={`${details ? "Hide" : "Show"} details for ${place.name}`}
          aria-expanded={Boolean(details)}
          aria-controls={`place-details-${place.id}`}
          className={styles.placeRowToggle}
          disabled={isEditing}
          onClick={onSelect}
          type="button"
        >
          <small>{place.category}{place.district ? ` · ${place.district}` : ""}</small>
          {distanceKm === null ? null : <span className={styles.distance}>{formatDistance(distanceKm)} away</span>}
        </button>
        {isEditable && !isEditing ? (
          <button className={styles.rowEditButton} onClick={onEdit} type="button">
            Edit
          </button>
        ) : null}
      </div>
      {editor}
      <div id={`place-details-${place.id}`} hidden={!details}>{details}</div>
    </article>
  );
}

export function FieldGuidePlaceDetail({
  distanceKm,
  onClose,
  place,
  hideCategory = false,
  onShowMap,
  variant = "map",
}: {
  distanceKm: number | null;
  onClose?: () => void;
  place: Place;
  hideCategory?: boolean;
  onShowMap?: () => void;
  variant?: "map" | "list";
}) {
  const notes = getPublicNotes(place);

  return (
    <aside className={styles.placeDetail} aria-label={`Selected place: ${place.name}`}>
      <div className={styles.detailLayout}>
        <div className={styles.detailCopy}>
          {variant === "map" ? <div className={styles.detailHeading}>
            <div>
              <p>
                {place.loved ? "♥ " : null}
                {getStatusLabel(place)}
              </p>
              <h2><a className={styles.detailNameLink} href={getGoogleMapsHandoffUrl(place)} rel="noopener noreferrer" target="_blank" aria-label={`Open ${place.name} in Google Maps (new tab)`}>{place.name}</a></h2>
              <span className={hideCategory ? styles.redundantCategory : undefined}>
                {place.category}
                <span className={styles.detailDistrict}>{place.district ? ` · ${place.district}` : ""}</span>
              </span>
            </div>
          </div> : null}
          {place.address.trim() ? <p className={styles.detailAddress}>
            <span className={styles.fullAddress}>{place.address}</span>
            <span className={styles.compactAddress}>{compactPlaceAddress(place)}</span>
          </p> : null}
        </div>
        <div className={styles.detailActions}>
          {variant === "map" ? <button
            aria-label="Close selected place"
            className={styles.detailClose}
            onClick={onClose}
            type="button"
          >
            ×
          </button> : null}
          {variant === "list" && onShowMap ? <button className={styles.mapsHandoff} type="button" onClick={onShowMap}>Map</button> : null}
        </div>
      </div>
      {variant === "list" || distanceKm === null ? null : (
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
