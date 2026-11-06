import { formatDistance } from "@/lib/geo";
import { getGoogleMapsHandoffUrl, getPublicNotes, type Place } from "@/lib/place";
import type { ReactNode } from "react";
import { compactPlaceAddress } from "@/lib/place-card-address";
import { getPlaceStatus, placeStatuses } from "@/lib/place-status";
import { PlaceStatusIcon } from "@/components/place-status-icon";
import styles from "./field-guide.module.css";

function getStatusLabel(place: Place) {
  return placeStatuses[getPlaceStatus(place)].label;
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
        {details ? <p className={styles.placeStatus} style={{ color: placeStatuses[getPlaceStatus(place)].color }}><PlaceStatusIcon status={getPlaceStatus(place)} size={14} />{getStatusLabel(place)}</p> : null}
        <button
          aria-label={`${details ? "Hide" : "Show"} details for ${place.name}`}
          aria-expanded={Boolean(details)}
          aria-controls={`place-details-${place.id}`}
          className={styles.placeRowToggle}
          disabled={isEditing}
          onClick={onSelect}
          type="button"
        >
          <span className={styles.placeRowContent}>
            <span className={styles.placeTitleRow}>
              <span className={styles.placeName}>{place.name}</span>
              {!details ? <span className={styles.rowStatus} style={{ color: placeStatuses[getPlaceStatus(place)].color }}>
                <PlaceStatusIcon status={getPlaceStatus(place)} size={16} />
                <span className={styles.srOnly}>{getStatusLabel(place)}</span>
              </span> : null}
            </span>
            <small>{place.category}{place.district ? ` · ${place.district}` : ""}</small>
            {distanceKm === null ? null : <span className={styles.distance}>{formatDistance(distanceKm)} away</span>}
          </span>
          <svg className={styles.rowChevron} aria-hidden="true" viewBox="0 0 20 20"><path d="m5 7.5 5 5 5-5" /></svg>
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
              <p style={{ color: placeStatuses[getPlaceStatus(place)].color }}>
                <PlaceStatusIcon status={getPlaceStatus(place)} size={14} />
                {getStatusLabel(place)}
              </p>
              <h2>{place.name}</h2>
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
          {variant === "list" && onShowMap ? <button className={styles.showOnMap} type="button" onClick={onShowMap}>Show on this map</button> : null}
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
      <a className={styles.externalMaps}
        href={getGoogleMapsHandoffUrl(place)} rel="noopener noreferrer" target="_blank"
        aria-label={`Open ${place.name} in Google Maps (new tab)`}>
        Open in Google Maps <span aria-hidden="true">↗</span>
      </a>
    </aside>
  );
}
