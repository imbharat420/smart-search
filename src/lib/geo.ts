// Shared by Discover.tsx (map + radius filter) and the assistant's "near me"
// chat handling, so there is exactly one haversine implementation in the app.

export interface Coords {
  lat: number
  lng: number
}

const EARTH_RADIUS_MILES = 3958.8

export function milesBetween(from: Coords, to: Coords): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(to.lat - from.lat)
  const dLng = toRad(to.lng - from.lng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a))
}
