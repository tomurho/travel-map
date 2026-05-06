export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export function getDistanceKm(firstPoint: GeoPoint, secondPoint: GeoPoint) {
  const earthRadiusKm = 6371;
  const firstLatitude = (firstPoint.latitude * Math.PI) / 180;
  const secondLatitude = (secondPoint.latitude * Math.PI) / 180;
  const latitudeDelta = ((secondPoint.latitude - firstPoint.latitude) * Math.PI) / 180;
  const longitudeDelta =
    ((secondPoint.longitude - firstPoint.longitude) * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function formatDistance(distanceKm: number) {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }

  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)} km`;
  }

  return `${Math.round(distanceKm)} km`;
}
