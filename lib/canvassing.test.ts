import { describe, expect, it } from "vitest";
import { nearestProperty } from "./canvassing";

const prop = (id: number, lng: number, lat: number) =>
  ({ id, lng, lat }) as Parameters<typeof nearestProperty>[0][number];

describe("nearestProperty", () => {
  // ~1e-4 deg latitude ≈ 11.1 m
  it("returns the closest property within maxMeters", () => {
    const props = [prop(1, -81.344, 29.0711), prop(2, -81.3445, 29.0715)];
    expect(nearestProperty(props, -81.34401, 29.07111, 30)?.id).toBe(1);
  });
  it("returns null when nothing is within maxMeters", () => {
    const props = [prop(1, -81.344, 29.0711)];
    expect(nearestProperty(props, -81.344, 29.0741, 30)).toBeNull(); // ~333 m away
  });
  it("returns null for an empty list", () => {
    expect(nearestProperty([], -81.344, 29.0711, 30)).toBeNull();
  });
  it("prefers the first property when two are equidistant (stable tie-break)", () => {
    const d = 0.00009; // ~10 m at 29° N
    const props = [prop(1, -81.344, 29.0711 + d), prop(2, -81.344, 29.0711 - d)];
    expect(nearestProperty(props, -81.344, 29.0711, 30)?.id).toBe(1);
  });
});
