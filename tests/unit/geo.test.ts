import { describe, expect, it } from "vitest";
import { bboxFromRadius, haversineMeters, isValidLatLng } from "../../src/lib/geo.js";

describe("geo helpers", () => {
  it("computes haversine distance roughly correctly", () => {
    const a = { lat: 35.6762, lng: 139.6503 }; // Tokyo
    const b = { lat: 34.6937, lng: 135.5023 }; // Osaka
    const m = haversineMeters(a, b);
    // Expected ~395 km
    expect(m).toBeGreaterThan(390_000);
    expect(m).toBeLessThan(410_000);
  });

  it("returns 0 for the same point", () => {
    const a = { lat: 31.59, lng: 130.55 };
    expect(haversineMeters(a, a)).toBeLessThan(0.001);
  });

  it("computes a bounding box that includes the centre", () => {
    const center = { lat: 35, lng: 139 };
    const bbox = bboxFromRadius(center, 5_000);
    expect(bbox.minLat).toBeLessThan(center.lat);
    expect(bbox.maxLat).toBeGreaterThan(center.lat);
    expect(bbox.minLng).toBeLessThan(center.lng);
    expect(bbox.maxLng).toBeGreaterThan(center.lng);
  });

  it("validates lat/lng ranges", () => {
    expect(isValidLatLng({ lat: 0, lng: 0 })).toBe(true);
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: -181 })).toBe(false);
    expect(isValidLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
  });
});
