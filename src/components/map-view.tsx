"use client";

import { useEffect, useMemo, useState } from "react";
import {
  GoogleMap,
  InfoWindowF,
  MarkerF,
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

export function MapView({
  places,
  selectedPlaceId,
  openPlaceId,
  onSelectPlace,
  onClosePlace,
}: MapViewProps) {
  const [map, setMap] = useState<google.maps.Map | null>(null);
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
              scale: isActive ? 10 : 7.5,
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
        <InfoWindowF
          onCloseClick={onClosePlace}
          position={{
            lat: openPlace.latitude,
            lng: openPlace.longitude,
          }}
        >
          <div className="map-popup">
            <strong>{openPlace.name}</strong>
            <p>
              {openPlace.category} •{" "}
              {openPlace.status === "been"
                ? "Been"
                : openPlace.status === "want_to_go"
                  ? "Want to go"
                  : "Location"}
            </p>
            {openPlace.district ? <p>{openPlace.district}</p> : null}
            {openPlace.loved === true ? <p>Loved it</p> : null}
            {openPlace.address ? <address>{openPlace.address}</address> : null}
          </div>
        </InfoWindowF>
      ) : null}
    </GoogleMap>
  );
}
