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
  cityCenters: CityCenter[];
  selectedPlaceId: string | null;
  openPlaceId: string | null;
  onSelectPlace: (placeId: string | null) => void;
  onClosePlace: () => void;
  onNearbyCityDetected: (city: string) => void;
};

const defaultCenter = { lat: 1.3521, lng: 103.8198 };
const containerStyle = {
  width: "100%",
  height: "100%",
};

const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const nearbyCityRadiusKm = 80;

export type CityCenter = {
  city: string;
  latitude: number;
  longitude: number;
};

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

function getDistanceKm(
  firstPoint: google.maps.LatLngLiteral,
  secondPoint: google.maps.LatLngLiteral,
) {
  const earthRadiusKm = 6371;
  const firstLatitude = (firstPoint.lat * Math.PI) / 180;
  const secondLatitude = (secondPoint.lat * Math.PI) / 180;
  const latitudeDelta = ((secondPoint.lat - firstPoint.lat) * Math.PI) / 180;
  const longitudeDelta = ((secondPoint.lng - firstPoint.lng) * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function MapView({
  places,
  cityCenters,
  selectedPlaceId,
  openPlaceId,
  onSelectPlace,
  onClosePlace,
  onNearbyCityDetected,
}: MapViewProps) {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [placeDetails, setPlaceDetails] = useState<
    Record<string, PlaceLookupState>
  >({});
  const [activePhotoUrl, setActivePhotoUrl] = useState<string | null>(null);
  const [photoStartIndex, setPhotoStartIndex] = useState(0);
  const [isCompactPopup, setIsCompactPopup] = useState(false);
  const [userLocation, setUserLocation] = useState<google.maps.LatLngLiteral | null>(
    null,
  );
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "locating" | "found" | "error"
  >("idle");
  const [locationMessage, setLocationMessage] = useState("");
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

    if (selectedPlace) {
      map.panTo({
        lat: selectedPlace.latitude,
        lng: selectedPlace.longitude,
      });
      map.setZoom(Math.max(map.getZoom() ?? 2, 12));
      return;
    }

    if (userLocation && locationStatus === "found") {
      return;
    }

    if (places.length === 0) {
      map.setCenter(defaultCenter);
      map.setZoom(2);
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
  }, [isLoaded, locationStatus, map, places, selectedPlace, userLocation]);

  useEffect(() => {
    setPhotoStartIndex(0);
  }, [openPlaceId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 720px)");
    const updateCompactPopup = () => setIsCompactPopup(mediaQuery.matches);

    updateCompactPopup();
    mediaQuery.addEventListener("change", updateCompactPopup);

    return () => mediaQuery.removeEventListener("change", updateCompactPopup);
  }, []);

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

  function findNearbyCity(position: google.maps.LatLngLiteral) {
    let nearestCity: CityCenter | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const cityCenter of cityCenters) {
      const distance = getDistanceKm(position, {
        lat: cityCenter.latitude,
        lng: cityCenter.longitude,
      });

      if (distance < nearestDistance) {
        nearestCity = cityCenter;
        nearestDistance = distance;
      }
    }

    if (!nearestCity || nearestDistance > nearbyCityRadiusKm) {
      return null;
    }

    return nearestCity.city;
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("error");
      setLocationMessage("Location is not available in this browser.");
      return;
    }

    setLocationStatus("locating");
    setLocationMessage("Finding your location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        const nearbyCity = findNearbyCity(nextLocation);

        setUserLocation(nextLocation);
        setLocationStatus("found");
        setLocationMessage(
          nearbyCity
            ? `Centered near ${nearbyCity}.`
            : "Centered on your location.",
        );
        onSelectPlace(null);
        onClosePlace();
        map?.panTo(nextLocation);
        map?.setZoom(nearbyCity ? 13 : 12);

        if (nearbyCity) {
          onNearbyCityDetected(nearbyCity);
        }
      },
      (error) => {
        setLocationStatus("error");
        setLocationMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied."
            : "Could not find your location.",
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 10_000,
      },
    );
  }

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
  const photoWindowSize = isCompactPopup ? 3 : 6;
  const visiblePhotoUrls =
    openPlaceDetails?.status === "loaded"
      ? openPlaceDetails.photoUrls.slice(
          photoStartIndex,
          photoStartIndex + photoWindowSize,
        )
      : [];
  const canShowPreviousPhotos = photoStartIndex > 0;
  const canShowMorePhotos =
    openPlaceDetails?.status === "loaded"
      ? photoStartIndex + photoWindowSize < openPlaceDetails.photoUrls.length
      : false;
  const popupMaxWidth = isCompactPopup ? "min(88vw, 300px)" : "min(92vw, 520px)";
  const popupMaxHeight = isCompactPopup ? "220px" : "280px";
  const popupContentMaxHeight = isCompactPopup ? "172px" : "232px";
  const photoThumbSize = isCompactPopup ? 48 : 56;
  const photoGap = isCompactPopup ? 6 : 8;
  const photoNavWidth = isCompactPopup ? 24 : 28;
  const photoStripWidth =
    photoWindowSize * photoThumbSize + (photoWindowSize - 1) * photoGap;
  const popupShellStyle: CSSProperties = {
    position: "relative",
    width: "max-content",
    maxWidth: popupMaxWidth,
    pointerEvents: "auto",
  };
  const popupStyle: CSSProperties = {
    position: "relative",
    minWidth: isCompactPopup ? "0" : "220px",
    width: "max-content",
    maxWidth: popupMaxWidth,
    maxHeight: popupMaxHeight,
    overflow: "hidden",
    display: "block",
    padding: isCompactPopup ? "12px 12px 14px" : "16px 16px 18px",
    border: "1px solid rgba(31, 42, 47, 0.08)",
    borderRadius: isCompactPopup ? "16px" : "18px",
    background: "rgba(255, 250, 243, 0.98)",
    boxShadow: "0 18px 42px rgba(31, 42, 47, 0.18)",
    color: "var(--ink)",
  };
  const popupContentStyle: CSSProperties = {
    maxHeight: popupContentMaxHeight,
    overflowY: "scroll",
    overscrollBehavior: "contain",
    display: "grid",
    gap: "6px",
    paddingRight: "6px",
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
    fontSize: isCompactPopup ? "0.92rem" : "1rem",
    lineHeight: 1.2,
    paddingRight: "32px",
  };
  const photoCarouselStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `${photoNavWidth}px ${photoStripWidth}px ${photoNavWidth}px`,
    alignItems: "center",
    columnGap: `${photoGap}px`,
    width: "max-content",
    maxWidth: "100%",
  };
  const photoNavStyle: CSSProperties = {
    border: 0,
    width: `${photoNavWidth}px`,
    height: `${photoThumbSize}px`,
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
    gridAutoColumns: `${photoThumbSize}px`,
    gap: `${photoGap}px`,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "start",
    minWidth: 0,
    width: `${photoStripWidth}px`,
    maxWidth: `${photoStripWidth}px`,
  };
  const photoThumbStyle: CSSProperties = {
    width: `${photoThumbSize}px`,
    height: `${photoThumbSize}px`,
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
    width: `${photoThumbSize}px`,
    height: `${photoThumbSize}px`,
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
      onClick={onClosePlace}
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
      <div
        className="map-location-control"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <button
          disabled={locationStatus === "locating"}
          onClick={(event) => {
            event.stopPropagation();
            handleUseMyLocation();
          }}
          type="button"
        >
          {locationStatus === "locating" ? "Finding..." : "Use my location"}
        </button>
        {locationMessage ? (
          <p className={`map-location-message is-${locationStatus}`}>
            {locationMessage}
          </p>
        ) : null}
      </div>
      {userLocation ? (
        <MarkerF
          position={userLocation}
          zIndex={20}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#007aff",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
          }}
        />
      ) : null}
      {places.map((place) => {
        const isActive = place.id === openPlaceId;

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
            y: Math.round(-(height + (isCompactPopup ? 14 : 18))),
          })}
          mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          position={{
            lat: openPlace.latitude,
            lng: openPlace.longitude,
          }}
        >
          <div
            className="map-popup-shell"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
            style={popupShellStyle}
          >
            <div className="map-popup" style={popupStyle}>
              <button
                aria-label="Close place details"
                className="map-popup-close"
                onClick={(event) => {
                  event.stopPropagation();
                  onClosePlace();
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                style={popupCloseStyle}
                type="button"
              >
                ×
              </button>
              <div className="map-popup-content" style={popupContentStyle}>
                <strong style={popupTitleStyle}>{openPlace.name}</strong>
                <p>
                  {openPlace.category}
                  {openPlace.loved === true
                    ? " • Loved it"
                    : openPlace.status === "been"
                      ? " • Been"
                      : openPlace.status === "want_to_go"
                        ? " • Want to go"
                        : openPlace.district
                          ? ` • ${openPlace.district}`
                          : ""}
                </p>
                {openPlace.address ? <address>{openPlace.address}</address> : null}
                {openPlace.subway ? (
                  <p>Nearest subway: {openPlace.subway}</p>
                ) : null}
                {openPlace.tabelog ? (
                  <p>Tabelog score: {openPlace.tabelog}</p>
                ) : null}
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
                        onClick={(event) => {
                          event.stopPropagation();
                          setPhotoStartIndex((current) => Math.max(0, current - 6));
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
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
                            onClick={(event) => {
                              event.stopPropagation();
                              setActivePhotoUrl(photoUrl);
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onTouchStart={(event) => event.stopPropagation()}
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
                        onClick={(event) => {
                          event.stopPropagation();
                          setPhotoStartIndex((current) =>
                            Math.min(
                              current + 6,
                              Math.max(openPlaceDetails.photoUrls.length - 6, 0),
                            ),
                          );
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
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
          </div>
        </OverlayViewF>
      ) : null}
      {activePhotoUrl ? (
        <div
          className="map-photo-modal"
          onClick={(event) => {
            event.stopPropagation();
            setActivePhotoUrl(null);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          role="presentation"
        >
          <div
            className="map-photo-modal-content"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            role="presentation"
          >
            <button
              className="map-photo-modal-close"
              onClick={(event) => {
                event.stopPropagation();
                setActivePhotoUrl(null);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
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
