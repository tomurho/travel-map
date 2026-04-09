"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  GoogleMap,
  MarkerF,
  OverlayView,
  OverlayViewF,
  useJsApiLoader,
} from "@react-google-maps/api";
import type { Place } from "@/lib/place";

type MapViewProps = {
  places: Place[];
  selectedPlaceId: string | null;
  openPlaceId: string | null;
  onSelectPlace: (placeId: string | null) => void;
  onClosePlace: () => void;
};

const defaultCenter = { lat: 1.3521, lng: 103.8198 };
const containerStyle = {
  width: "100%",
  height: "100%",
};

const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

type PlaceLookupState =
  | {
      status: "loading";
    }
  | {
      status: "loaded";
      matched: boolean;
      openingHours: string[] | null;
      photoUrls: string[];
    }
  | {
      status: "error";
    };

export function MapView({
  places,
  selectedPlaceId,
  openPlaceId,
  onSelectPlace,
  onClosePlace,
}: MapViewProps) {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [placeDetails, setPlaceDetails] = useState<
    Record<string, PlaceLookupState>
  >({});
  const [activePhotoUrl, setActivePhotoUrl] = useState<string | null>(null);
  const [photoStartIndex, setPhotoStartIndex] = useState(0);
  const { isLoaded, loadError } = useJsApiLoader({
    id: "travel-map-google-maps",
    googleMapsApiKey,
  });

  const selectedPlace = useMemo(
    () => places.find((place) => place.id === selectedPlaceId) ?? null,
    [places, selectedPlaceId],
  );
  const openPlace = useMemo(
    () => places.find((place) => place.id === openPlaceId) ?? null,
    [openPlaceId, places],
  );

  useEffect(() => {
    if (!map || !isLoaded) {
      return;
    }

    if (places.length === 0) {
      map.setCenter(defaultCenter);
      map.setZoom(2);
      return;
    }

    if (selectedPlace) {
      map.panTo({
        lat: selectedPlace.latitude,
        lng: selectedPlace.longitude,
      });
      map.setZoom(Math.max(map.getZoom() ?? 2, 12));
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    for (const place of places) {
      bounds.extend({
        lat: place.latitude,
        lng: place.longitude,
      });
    }

    map.fitBounds(bounds, 72);
  }, [isLoaded, map, places, selectedPlace]);

  useEffect(() => {
    setPhotoStartIndex(0);
  }, [openPlaceId]);

  useEffect(() => {
    if (!openPlace) {
      return;
    }

    const existingDetails = placeDetails[openPlace.id];
    if (existingDetails) {
      return;
    }

    const controller = new AbortController();

    setPlaceDetails((current) => ({
      ...current,
      [openPlace.id]: { status: "loading" },
    }));

    const params = new URLSearchParams({
      name: openPlace.name,
      address: openPlace.address,
    });

    fetch(`/api/place-details?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Lookup failed");
        }

        return (await response.json()) as {
          matched: boolean;
          openingHours: string[] | null;
          photoUrls: string[];
        };
      })
      .then((data) => {
        setPlaceDetails((current) => ({
          ...current,
          [openPlace.id]: {
            status: "loaded",
            matched: data.matched,
            openingHours: data.openingHours,
            photoUrls: data.photoUrls,
          },
        }));
      })
      .catch((error: unknown) => {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }

        setPlaceDetails((current) => ({
          ...current,
          [openPlace.id]: { status: "error" },
        }));
      });

    return () => controller.abort();
  }, [openPlace]);

  if (!googleMapsApiKey) {
    return (
      <div className="map-status map-status-static">
        <strong>Google Maps API key missing</strong>
        <p>Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local` to render the map.</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="map-status map-status-static">
        <strong>Google Maps could not load</strong>
        <p>Check the API key, enabled APIs, billing, and allowed referrers.</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="map-status map-status-static">
        <strong>Loading Google Maps</strong>
        <p>The map should appear here in a moment.</p>
      </div>
    );
  }

  const openPlaceDetails = openPlace ? placeDetails[openPlace.id] : undefined;
  const visiblePhotoUrls =
    openPlaceDetails?.status === "loaded"
      ? openPlaceDetails.photoUrls.slice(photoStartIndex, photoStartIndex + 6)
      : [];
  const canShowPreviousPhotos = photoStartIndex > 0;
  const canShowMorePhotos =
    openPlaceDetails?.status === "loaded"
      ? photoStartIndex + 6 < openPlaceDetails.photoUrls.length
      : false;
  const popupShellStyle: CSSProperties = {
    position: "relative",
    width: "max-content",
    maxWidth: "min(92vw, 520px)",
    pointerEvents: "auto",
  };
  const popupStyle: CSSProperties = {
    position: "relative",
    minWidth: "220px",
    width: "max-content",
    maxWidth: "min(92vw, 520px)",
    display: "grid",
    gap: "6px",
    padding: "16px",
    border: "1px solid rgba(31, 42, 47, 0.08)",
    borderRadius: "18px",
    background: "rgba(255, 250, 243, 0.98)",
    boxShadow: "0 18px 42px rgba(31, 42, 47, 0.18)",
    color: "var(--ink)",
  };
  const popupCloseStyle: CSSProperties = {
    position: "absolute",
    top: "10px",
    right: "10px",
    width: "28px",
    height: "28px",
    border: 0,
    borderRadius: "999px",
    background: "rgba(31, 42, 47, 0.08)",
    color: "var(--ink)",
    cursor: "pointer",
    fontSize: "1.1rem",
    lineHeight: "1",
  };
  const popupTitleStyle: CSSProperties = {
    fontSize: "1rem",
    lineHeight: 1.2,
    paddingRight: "32px",
  };
  const photoCarouselStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "28px 376px 28px",
    alignItems: "center",
    columnGap: "8px",
    width: "max-content",
    maxWidth: "100%",
  };
  const photoNavStyle: CSSProperties = {
    border: 0,
    width: "28px",
    height: "56px",
    display: "grid",
    placeItems: "center",
    borderRadius: "999px",
    padding: 0,
    background: "rgba(31, 42, 47, 0.08)",
    color: "var(--ink)",
    cursor: "pointer",
    fontSize: "1.35rem",
    lineHeight: 1,
  };
  const photoStripStyle: CSSProperties = {
    display: "grid",
    gridAutoFlow: "column",
    gridAutoColumns: "56px",
    gap: "8px",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "start",
    minWidth: 0,
    width: "376px",
    maxWidth: "376px",
  };
  const photoThumbStyle: CSSProperties = {
    width: "56px",
    height: "56px",
    padding: 0,
    border: 0,
    background: "transparent",
    overflow: "hidden",
    borderRadius: "10px",
    lineHeight: 0,
    display: "block",
    cursor: "pointer",
  };
  const photoImageStyle: CSSProperties = {
    width: "56px",
    height: "56px",
    maxWidth: "none",
    maxHeight: "none",
    objectFit: "cover",
    display: "block",
    borderRadius: "10px",
  };

  return (
    <GoogleMap
      center={defaultCenter}
      mapContainerClassName="map-canvas google-map"
      mapContainerStyle={containerStyle}
      onLoad={setMap}
      onUnmount={() => setMap(null)}
      options={{
        clickableIcons: false,
        fullscreenControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        zoomControl: true,
      }}
      zoom={2}
    >
      {places.map((place) => {
        const isActive = place.id === selectedPlaceId;

        return (
          <MarkerF
            key={place.id}
            onClick={() => onSelectPlace(place.id)}
            position={{ lat: place.latitude, lng: place.longitude }}
            zIndex={isActive ? 10 : 1}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale:
                place.status === "location"
                  ? isActive
                    ? 7
                    : 5.25
                  : isActive
                    ? 10
                    : 7.5,
              fillColor:
                place.loved === true
                  ? "#30d158"
                  : place.status === "been"
                    ? "#0a84ff"
                    : place.status === "want_to_go"
                      ? "#af52de"
                      : "#8e8e93",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            }}
          />
        );
      })}

      {openPlace ? (
        <OverlayViewF
          getPixelPositionOffset={(width, height) => ({
            x: Math.round(-width / 2),
            y: Math.round(-(height + 18)),
          })}
          mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          position={{
            lat: openPlace.latitude,
            lng: openPlace.longitude,
          }}
        >
          <div className="map-popup-shell" style={popupShellStyle}>
            <div className="map-popup" style={popupStyle}>
              <button
                aria-label="Close place details"
                className="map-popup-close"
                onClick={onClosePlace}
                style={popupCloseStyle}
                type="button"
              >
                ×
              </button>
              <strong style={popupTitleStyle}>{openPlace.name}</strong>
              <p>
                {openPlace.category}
                {openPlace.status === "been"
                  ? " • Been"
                  : openPlace.status === "want_to_go"
                    ? " • Want to go"
                    : openPlace.district
                      ? ` • ${openPlace.district}`
                      : ""}
              </p>
              {openPlace.loved === true ? <p>Loved it</p> : null}
              {openPlace.address ? <address>{openPlace.address}</address> : null}
              {openPlaceDetails?.status === "loading" ? (
                <p>Loading Google details...</p>
              ) : null}
              {openPlaceDetails?.status === "loaded" &&
              openPlaceDetails.photoUrls.length === 0 &&
              !openPlaceDetails.openingHours?.length ? (
                <p>
                  {openPlaceDetails.matched
                    ? "Google found this place, but no photo or opening hours were available."
                    : "Google could not find a matching place for this location."}
                </p>
              ) : null}
              {openPlaceDetails?.status === "loaded" &&
              openPlaceDetails.photoUrls.length > 0 ? (
                <div className="map-popup-photo-group">
                  <div className="map-popup-photo-carousel" style={photoCarouselStyle}>
                    <button
                      className="map-popup-photo-nav"
                      aria-label="Previous photos"
                      disabled={!canShowPreviousPhotos}
                      onClick={() =>
                        setPhotoStartIndex((current) => Math.max(0, current - 6))
                      }
                      style={photoNavStyle}
                      type="button"
                    >
                      &#8249;
                    </button>
                    <div className="map-popup-photos" style={photoStripStyle}>
                      {visiblePhotoUrls.map((photoUrl, index) => (
                        <button
                          key={photoUrl}
                          className="map-popup-photo-link"
                          onClick={() => setActivePhotoUrl(photoUrl)}
                          style={photoThumbStyle}
                          type="button"
                        >
                          <img
                            alt={`${openPlace.name} photo ${photoStartIndex + index + 1}`}
                            className="map-popup-photo"
                            src={photoUrl}
                            style={photoImageStyle}
                          />
                        </button>
                      ))}
                    </div>
                    <button
                      className="map-popup-photo-nav"
                      aria-label="More photos"
                      disabled={!canShowMorePhotos}
                      onClick={() =>
                        setPhotoStartIndex((current) =>
                          Math.min(
                            current + 6,
                            Math.max(openPlaceDetails.photoUrls.length - 6, 0),
                          ),
                          )
                      }
                      style={photoNavStyle}
                      type="button"
                    >
                      &#8250;
                    </button>
                  </div>
                </div>
              ) : null}
              {openPlaceDetails?.status === "loaded" &&
              openPlaceDetails.openingHours?.length ? (
                <div className="map-popup-hours">
                  <strong>Opening hours</strong>
                  <ul>
                    {openPlaceDetails.openingHours.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {openPlaceDetails?.status === "error" ? (
                <p>Google details could not be loaded for this place.</p>
              ) : null}
            </div>
          </div>
        </OverlayViewF>
      ) : null}
      {activePhotoUrl ? (
        <div
          className="map-photo-modal"
          onClick={() => setActivePhotoUrl(null)}
          role="presentation"
        >
          <div
            className="map-photo-modal-content"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <button
              className="map-photo-modal-close"
              onClick={() => setActivePhotoUrl(null)}
              type="button"
            >
              Close
            </button>
            <img
              alt="Selected place photo"
              className="map-photo-modal-image"
              src={activePhotoUrl}
            />
          </div>
        </div>
      ) : null}
    </GoogleMap>
  );
}
