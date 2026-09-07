"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleMap,
  GoogleMarkerClusterer,
  type GoogleMarkerClustererProps,
  MarkerF,
  OverlayView,
  OverlayViewF,
  useJsApiLoader,
  useGoogleMap,
} from "@react-google-maps/api";
import { getDistanceKm, type GeoPoint } from "@/lib/geo";
import type { Place } from "@/lib/place";

type MapViewProps = {
  places: Place[];
  cityCenters: CityCenter[];
  mapStyles?: google.maps.MapTypeStyle[];
  selectedPlaceId: string | null;
  openPlaceId: string | null;
  requestLocationNonce: number;
  onSelectPlace: (placeId: string | null) => void;
  onClosePlace: () => void;
  onNearbyCityDetected: (city: string) => void;
  onUserLocationFound: (location: GeoPoint) => void;
  onLocationStatusChange?: (
    status: "idle" | "locating" | "found" | "error",
    message: string,
  ) => void;
  showLocationMessage?: boolean;
  showPlaceDetails?: boolean;
  clusterMarkers?: boolean;
  viewportCity?: string;
  followUserLocation?: boolean;
};

const defaultCenter = { lat: 1.3521, lng: 103.8198 };
const containerStyle = {
  width: "100%",
  height: "100%",
};

const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
export const publicPlaceDetailsLookupEnabled = false;
const nearbyCityRadiusKm = 80;

export type CityCenter = {
  city: string;
  latitude: number;
  longitude: number;
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

function getMarkerColor(place: Place) {
  if (place.loved === true) {
    return "#ef2b68";
  }

  if (place.status === "want_to_go") {
    return "#f59e0b";
  }

  if (place.status === "been") {
    return "#9ca3af";
  }

  return "#d1d5db";
}

function getMarkerAppearance(place: Place, isActive: boolean) {
  const isSavedPlace = place.status === "location";
  const isPriorityPlace = place.loved === true || place.status === "want_to_go";

  return {
    scale: isActive ? 10 : isPriorityPlace ? 6.5 : 5.25,
    fillColor: getMarkerColor(place),
    fillOpacity: 1,
    strokeColor: isActive ? "#242321" : "#ffffff",
    strokeWeight: isActive ? 3 : isSavedPlace ? 1.25 : 2,
  };
}

function getMarkerZIndex(place: Place, isActive: boolean) {
  if (isActive) {
    return 30;
  }

  if (place.loved === true || place.status === "want_to_go") {
    return 20;
  }

  return 1;
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


type MapClusterer = Parameters<GoogleMarkerClustererProps["children"]>[0];
const clusterAlgorithmOptions = { radius: 100, maxZoom: 16 };
const clusterOptions: GoogleMarkerClustererProps["options"] = {
  algorithmOptions: clusterAlgorithmOptions,
  renderer: {
    render: ({ count, position }) => new google.maps.Marker({
      position,
      title: `${count} places. Zoom in to explore`,
      label: { text: String(count), color: "#ffffff", fontSize: "13px", fontWeight: "700" },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 22,
        fillColor: "#343330",
        fillOpacity: 1,
        strokeColor: "#fffdf9",
        strokeWeight: 3,
      },
      zIndex: 100 + count,
    }),
  },
};

function PlaceMarker({ place, isActive, onSelectPlace, clusterer }: {
  place: Place;
  isActive: boolean;
  onSelectPlace: (id: string) => void;
  clusterer?: MapClusterer;
}) {
  return <MarkerF
    clusterer={clusterer}
    title={`${place.name}, ${getStatusBadge(place)?.label ?? "Saved"}`}
    onClick={() => onSelectPlace(place.id)}
    position={{ lat: place.latitude, lng: place.longitude }}
    zIndex={isActive ? 1000 : getMarkerZIndex(place, false)}
    icon={{ path: google.maps.SymbolPath.CIRCLE, ...getMarkerAppearance(place, isActive) }}
  />;
}

function ClusteredPlaces({ clusterer, places, openPlaceId, onSelectPlace }: {
  clusterer: MapClusterer;
  places: Place[];
  openPlaceId: string | null;
  onSelectPlace: (id: string) => void;
}) {
  const map = useGoogleMap();
  useEffect(() => {
    clusterer.setMap(map);
    return () => { clusterer.setMap(null); };
  }, [clusterer, map]);

  return <>{places.map((place) => (
    <PlaceMarker
      // Remount when moving into/out of the clusterer's ownership.
      key={`${place.id}:${place.id === openPlaceId ? "selected" : "clustered"}`}
      clusterer={place.id === openPlaceId ? undefined : clusterer}
      place={place} isActive={place.id === openPlaceId} onSelectPlace={onSelectPlace}
    />
  ))}</>;
}

export function MapView({
  places,
  cityCenters,
  mapStyles,
  selectedPlaceId,
  openPlaceId,
  requestLocationNonce,
  onSelectPlace,
  onClosePlace,
  onNearbyCityDetected,
  onUserLocationFound,
  onLocationStatusChange,
  showLocationMessage = true,
  showPlaceDetails = true,
  clusterMarkers = false,
  viewportCity = places[0]?.city ?? "",
  followUserLocation = true,
}: MapViewProps) {
  const locationCityRef = useRef<string | null>(null);
  const locationZoomRef = useRef(13);
  const lastFramedLocationRef = useRef<google.maps.LatLngLiteral | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
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
      lastFramedLocationRef.current = null;
      return;
    }

    if (followUserLocation && userLocation && locationStatus === "found" && locationCityRef.current === viewportCity) {
      // City URL changes may render after the location callback. Center only once
      // the matching city is visible, rather than letting an old-city fit win.
      if (lastFramedLocationRef.current !== userLocation) {
        map.panTo(userLocation);
        map.setZoom(locationZoomRef.current);
        lastFramedLocationRef.current = userLocation;
      }
      return;
    }
    lastFramedLocationRef.current = null;

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
  }, [followUserLocation, isLoaded, locationStatus, map, places, userLocation, viewportCity]);

  useEffect(() => {
    if (!map || !isLoaded || !selectedPlace) {
      return;
    }

    map.panTo({
      lat: selectedPlace.latitude,
      lng: selectedPlace.longitude,
    });
    map.setZoom(Math.max(map.getZoom() ?? 2, clusterMarkers ? 15 : 12));
  }, [clusterMarkers, isLoaded, map, selectedPlace]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 720px)");
    const updateCompactPopup = () => setIsCompactPopup(mediaQuery.matches);

    updateCompactPopup();
    mediaQuery.addEventListener("change", updateCompactPopup);

    return () => mediaQuery.removeEventListener("change", updateCompactPopup);
  }, []);

  useEffect(() => {
    if (requestLocationNonce === 0 || locationStatus === "locating") {
      return;
    }

    handleUseMyLocation();
  }, [requestLocationNonce]);

  function findNearbyCity(position: google.maps.LatLngLiteral) {
    let nearestCity: CityCenter | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const cityCenter of cityCenters) {
      const distance = getDistanceKm(
        {
          latitude: position.lat,
          longitude: position.lng,
        },
        {
          latitude: cityCenter.latitude,
          longitude: cityCenter.longitude,
        },
      );

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
      onLocationStatusChange?.(
        "error",
        "Location is not available in this browser.",
      );
      return;
    }

    setLocationStatus("locating");
    setLocationMessage("Finding your location...");
    onLocationStatusChange?.("locating", "Finding your location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        const nearbyCity = findNearbyCity(nextLocation);

        locationCityRef.current = nearbyCity ?? viewportCity;
        locationZoomRef.current = nearbyCity ? 13 : 12;
        setUserLocation(nextLocation);
        setLocationStatus("found");
        const nextLocationMessage = nearbyCity
          ? `Centered near ${nearbyCity}.`
          : "Centered on your location.";
        setLocationMessage(nextLocationMessage);
        onLocationStatusChange?.("found", nextLocationMessage);
        onUserLocationFound({
          latitude: nextLocation.lat,
          longitude: nextLocation.lng,
        });
        onSelectPlace(null);
        onClosePlace();

        if (nearbyCity) {
          onNearbyCityDetected(nearbyCity);
        }
      },
      (error) => {
        const nextLocationMessage =
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied."
            : "Could not find your location.";
        setLocationStatus("error");
        setLocationMessage(nextLocationMessage);
        onLocationStatusChange?.("error", nextLocationMessage);
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

  const openPlaceGoogleMapsUrl = openPlace?.googleMapsUrl?.trim();
  const openPlaceStatusBadge = openPlace ? getStatusBadge(openPlace) : null;
  const placeDetailsContent = openPlace ? (
    <>
      {openPlaceGoogleMapsUrl ? (
        <a
          className="map-popup-title-link"
          href={openPlaceGoogleMapsUrl}
          onClick={(event) => event.stopPropagation()}
          rel="noopener noreferrer"
          target="_blank"
        >
          {openPlace.name}
        </a>
      ) : (
        <strong className="map-popup-title">{openPlace.name}</strong>
      )}
      <p className="map-popup-meta">
        {openPlace.category}
        {openPlace.district ? ` · ${openPlace.district}` : ""}
      </p>
      {openPlaceStatusBadge ? (
        <div className="status-badge-row">
          <span
            className={`status-badge status-badge--popup ${openPlaceStatusBadge.modifier}`}
          >
            {openPlaceStatusBadge.icon ? (
              <StatusBadgeIcon icon={openPlaceStatusBadge.icon} />
            ) : null}
            {openPlaceStatusBadge.label}
          </span>
        </div>
      ) : null}
    </>
  ) : null;

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
        styles: mapStyles,
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
        {showLocationMessage && locationMessage ? (
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
      {clusterMarkers ? (
        <GoogleMarkerClusterer options={clusterOptions}>
          {(clusterer) => (
            <ClusteredPlaces clusterer={clusterer} places={places}
              openPlaceId={openPlaceId} onSelectPlace={onSelectPlace} />
          )}
        </GoogleMarkerClusterer>
      ) : places.map((place) => (
        <PlaceMarker key={place.id} place={place} isActive={place.id === openPlaceId}
          onSelectPlace={onSelectPlace} />
      ))}

      {showPlaceDetails && openPlace && !isCompactPopup ? (
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
          <div
            className="map-popup-shell"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
          >
            <div className="map-popup">
              <button
                aria-label="Close place details"
                className="map-popup-close"
                onClick={(event) => {
                  event.stopPropagation();
                  onClosePlace();
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                type="button"
              >
                x
              </button>
              <div className="map-popup-content">{placeDetailsContent}</div>
            </div>
          </div>
        </OverlayViewF>
      ) : null}
      {showPlaceDetails && openPlace && isCompactPopup ? (
        <div
          className="map-mobile-sheet"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          <button
            aria-label="Close place details"
            className="map-mobile-sheet-close"
            onClick={(event) => {
              event.stopPropagation();
              onClosePlace();
            }}
            type="button"
          >
            x
          </button>
          <div className="map-mobile-sheet-handle" aria-hidden="true" />
          <div className="map-popup-content map-mobile-sheet-content">
            {placeDetailsContent}
          </div>
        </div>
      ) : null}
    </GoogleMap>
  );
}
