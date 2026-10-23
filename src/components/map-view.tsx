"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import type { GeoPoint } from "@/lib/geo";
import { findNearbyCity, getColocatedPlaces, getCoordinateKey, getMapOverviewPlaces, getMapPlacesKey, getSelectedPlacePanOffset, type CityCenter } from "@/lib/map-viewport";

export type { CityCenter } from "@/lib/map-viewport";
import type { Place } from "@/lib/place";
import { createLocationRequestGate } from "@/lib/location-request";
import { subscribeToGoogleMapsAuthFailure } from "@/lib/google-maps-auth";

type MapViewProps = {
  places: Place[];
  /** A hidden map stays mounted so ordinary Map/List changes preserve its view. */
  isVisible?: boolean;
  revealPlaceNonce?: number;
  selectedPlaceBottomInset?: number;
  cityCenters: CityCenter[];
  mapStyles?: google.maps.MapTypeStyle[];
  selectedPlaceId: string | null;
  openPlaceId: string | null;
  requestLocationNonce: number;
  cancelLocationNonce?: number;
  onViewList?: () => void;
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
    return "#48677f";
  }

  return "#6f899e";
}

function getMarkerAppearance(place: Place, isActive: boolean) {
  const isSavedPlace = place.status === "location";
  const isPriorityPlace = place.loved === true || place.status === "want_to_go";

  return {
    scale: isActive ? 12 : isPriorityPlace ? 7.8 : 6.3,
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
        fillColor: "#48677f",
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
    noClustererRedraw={Boolean(clusterer)}
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
  const placesKey = getMapPlacesKey(places);
  useEffect(() => {
    clusterer.setMap(map);
    return () => { clusterer.setMap(null); };
  }, [clusterer, map]);
  useEffect(() => {
    // MarkerF adds/removes each marker in its child effects. Flush once after
    // the whole batch, instead of reclustering after every removed city pin.
    clusterer.render();
  }, [clusterer, placesKey, openPlaceId]);

  return <>{places.map((place) => (
    <PlaceMarker
      // Remount when moving into/out of the clusterer's ownership.
      key={`${place.id}:${getCoordinateKey(place)}:${place.id === openPlaceId ? "selected" : "clustered"}`}
      clusterer={place.id === openPlaceId ? undefined : clusterer}
      place={place} isActive={place.id === openPlaceId} onSelectPlace={onSelectPlace}
    />
  ))}</>;
}

function ColocatedPlaceChooser({ places, onChoose, onClose }: {
  places: Place[];
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previousFocus?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialogRef} className="map-place-chooser" aria-labelledby="colocated-places-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <div className="map-place-chooser-header"><h2 id="colocated-places-title">Places at this location</h2><button type="button" aria-label="Close places at this location" onClick={onClose}>×</button></div>
    <p>Choose the place you want to see.</p>
    {places.map((place) => <button type="button" className="map-place-choice" key={place.id} onClick={() => { onChoose(place.id); onClose(); }}><strong>{place.name}</strong><span>{place.category} · {getStatusBadge(place)?.label ?? "Saved"}</span></button>)}
  </dialog>;
}

export function MapView({
  places,
  isVisible = true,
  revealPlaceNonce = 0,
  selectedPlaceBottomInset = 0,
  cityCenters,
  mapStyles,
  selectedPlaceId,
  openPlaceId,
  requestLocationNonce,
  cancelLocationNonce = 0,
  onViewList,
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
  const placesKey = getMapPlacesKey(places);
  const overviewPlaces = useMemo(() => getMapOverviewPlaces(places), [placesKey]);
  const colocatedPlaces = useMemo(() => getColocatedPlaces(places), [places]);
  const [chooserKey, setChooserKey] = useState<string | null>(null);
  const chooserPlaces = chooserKey ? colocatedPlaces.get(chooserKey) ?? [] : [];
  const [showAllPlacesKey, setShowAllPlacesKey] = useState<string | null>(null);
  const showAllPlaces = showAllPlacesKey === placesKey;
  const outlyingCount = places.length - overviewPlaces.length;
  const framedResultsRef = useRef<string | null>(null);
  const framedMapRef = useRef<google.maps.Map | null>(null);
  const selectionRef = useRef<string | null>(null);
  const handledRevealRef = useRef(0);
  const bottomInsetRef = useRef(selectedPlaceBottomInset);
  bottomInsetRef.current = selectedPlaceBottomInset;
  const locationRequests = useRef(createLocationRequestGate());
  const cancellationRef = useRef(cancelLocationNonce);
  cancellationRef.current = cancelLocationNonce;
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
  const [authenticationFailed, setAuthenticationFailed] = useState(false);
  useEffect(() => subscribeToGoogleMapsAuthFailure(window, () => setAuthenticationFailed(true)), []);
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
    if (!map || !isLoaded) return;
    if (framedMapRef.current !== map) {
      framedMapRef.current = map;
      framedResultsRef.current = null;
      lastFramedLocationRef.current = null;
      selectionRef.current = null;
    }
    if (!isVisible) return;
    const frameKey = `${viewportCity}:${placesKey}:${showAllPlaces}`;

    if (followUserLocation && userLocation && locationStatus === "found" && locationCityRef.current === viewportCity) {
      // City URL changes may render after the location callback. Center only once
      // the matching city is visible, rather than letting an old-city fit win.
      if (lastFramedLocationRef.current !== userLocation) {
        map.panTo(userLocation);
        map.setZoom(locationZoomRef.current);
        lastFramedLocationRef.current = userLocation;
        framedResultsRef.current = frameKey;
      }
      return;
    }
    lastFramedLocationRef.current = null;
    if (framedResultsRef.current === frameKey) return;
    framedResultsRef.current = frameKey;
    const visiblePlaces = showAllPlaces ? places : overviewPlaces;

    if (visiblePlaces.length === 0) {
      const cityCenter = cityCenters.find((center) => center.city === viewportCity);
      map.setCenter(cityCenter ? { lat: cityCenter.latitude, lng: cityCenter.longitude } : defaultCenter);
      map.setZoom(cityCenter ? 12 : 2);
      return;
    }

    // A one-point bounds fit zooms into the building and loses street context.
    if (visiblePlaces.length === 1) {
      map.setCenter({ lat: visiblePlaces[0].latitude, lng: visiblePlaces[0].longitude });
      map.setZoom(16);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    for (const place of visiblePlaces) {
      bounds.extend({
        lat: place.latitude,
        lng: place.longitude,
      });
    }

    map.fitBounds(bounds, 72);
  }, [cityCenters, followUserLocation, isLoaded, isVisible, locationStatus, map, overviewPlaces, places, placesKey, showAllPlaces, userLocation, viewportCity]);

  useEffect(() => {
    const selectionKey = selectedPlace ? `${selectedPlace.id}:${getCoordinateKey(selectedPlace)}` : null;
    const selectionChanged = selectionRef.current !== selectionKey;
    if (!selectedPlace || !isVisible) { selectionRef.current = selectionKey; return; }
    const requestedReveal = handledRevealRef.current !== revealPlaceNonce;
    if (!map || !isLoaded || !isVisible || !selectedPlace || (!selectionChanged && !requestedReveal)) return;
    // Wait for the revealed map and detail card to finish their layout.
    const frame = requestAnimationFrame(() => {
      selectionRef.current = selectionKey;
      handledRevealRef.current = revealPlaceNonce;
      google.maps.event.trigger(map, "resize");
      map.setZoom(Math.max(map.getZoom() ?? 2, clusterMarkers ? 17 : 12));
      map.setCenter({ lat: selectedPlace.latitude, lng: selectedPlace.longitude });
      const offset = getSelectedPlacePanOffset(map.getDiv().clientHeight, bottomInsetRef.current);
      if (offset) map.panBy(0, offset);
    });
    return () => cancelAnimationFrame(frame);
  }, [clusterMarkers, isLoaded, isVisible, map, revealPlaceNonce, selectedPlace?.id, selectedPlace?.latitude, selectedPlace?.longitude]);

  useEffect(() => {
    if (!map || !isVisible) return;
    // Resizing a mounted map must not fit its results again.
    const frame = requestAnimationFrame(() => google.maps.event.trigger(map, "resize"));
    return () => cancelAnimationFrame(frame);
  }, [isVisible, map]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 720px)");
    const updateCompactPopup = () => setIsCompactPopup(mediaQuery.matches);

    updateCompactPopup();
    mediaQuery.addEventListener("change", updateCompactPopup);

    return () => mediaQuery.removeEventListener("change", updateCompactPopup);
  }, []);

  useEffect(() => {
    locationRequests.current.cancel();
    setLocationStatus("idle");
    setLocationMessage("");
  }, [cancelLocationNonce]);
  useEffect(() => () => locationRequests.current.cancel(), []);
  useEffect(() => {
    if (requestLocationNonce !== 0) handleUseMyLocation();
  }, [requestLocationNonce]);

  function handleUseMyLocation() {
    const isLatestRequest = locationRequests.current.begin();
    const cancellation = cancellationRef.current;
    const isCurrentRequest = () => isLatestRequest() && cancellation === cancellationRef.current;
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
        if (!isCurrentRequest()) return;
        const nextLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        const nearbyCity = findNearbyCity({ latitude: nextLocation.lat, longitude: nextLocation.lng }, cityCenters);

        locationCityRef.current = nearbyCity;
        locationZoomRef.current = nearbyCity ? 13 : 12;
        setUserLocation(nextLocation);
        setLocationStatus("found");
        const nextLocationMessage = nearbyCity
          ? `Centered near ${nearbyCity}.`
          : "No saved city is near you. The current city stays on the map.";
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
        if (!isCurrentRequest()) return;
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

  if (!googleMapsApiKey || loadError || authenticationFailed) {
    return (
      <div className="map-status map-status-static">
        <strong>The map could not load.</strong>
        <p>You can still browse your saved places in List.</p>
        {onViewList ? <button type="button" onClick={onViewList}>View list</button> : null}
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

  function selectMarker(id: string) {
    const place = places.find((candidate) => candidate.id === id);
    const key = place ? getCoordinateKey(place) : null;
    if (key && (colocatedPlaces.get(key)?.length ?? 0) > 1) setChooserKey(key);
    else onSelectPlace(id);
  }

  return (
    <GoogleMap
      mapContainerClassName="map-canvas google-map"
      mapContainerStyle={containerStyle}
      onClick={onClosePlace}
      onLoad={setMap}
      onUnmount={() => setMap(null)}
      options={{
        clickableIcons: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
        mapTypeControl: false,
        styles: mapStyles,
        streetViewControl: false,
        zoomControl: true,
      }}
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
              openPlaceId={openPlaceId} onSelectPlace={selectMarker} />
          )}
        </GoogleMarkerClusterer>
      ) : places.map((place) => (
        <PlaceMarker key={place.id} place={place} isActive={place.id === openPlaceId}
          onSelectPlace={selectMarker} />
      ))}

      {outlyingCount && !showAllPlaces ? <div className="map-overview-notice" onClick={(event) => event.stopPropagation()}>
        <span>{outlyingCount} saved {outlyingCount === 1 ? "place is" : "places are"} outside this city view.</span>
        <button type="button" onClick={() => setShowAllPlacesKey(placesKey)}>Show all places</button>
      </div> : null}
      {chooserPlaces.length > 1 ? <ColocatedPlaceChooser places={chooserPlaces} onChoose={onSelectPlace} onClose={() => setChooserKey(null)} /> : null}

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
