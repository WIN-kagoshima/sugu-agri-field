/**
 * Tiny geographic helpers. Distances use the haversine formula on a
 * spherical Earth (R = 6,371,008.8 m). Accurate enough for "give me
 * fields within 5 km" queries.
 */

const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(x)));
}

/**
 * Approximate bounding box for a (lat, lng) ± radius_m query. Good enough
 * to pre-filter SQLite R*Tree results, which we then refine with haversine.
 */
export function bboxFromRadius(center: LatLng, radiusMeters: number): BoundingBox {
  const dLat = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng =
    (radiusMeters / (EARTH_RADIUS_M * Math.cos(toRadians(center.lat)))) * (180 / Math.PI);
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}

export function isValidLatLng(p: { lat: number; lng: number }): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}
