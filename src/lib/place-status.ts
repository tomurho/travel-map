import type { Place } from "./place";

/** Display status combines the saved status with the separate Loved flag. */
export type PlaceStatus = "loved" | "want_to_go" | "been" | "saved";

export const placeStatuses = {
  loved: { label: "Loved", color: "#a33753", background: "#a33753", foreground: "#ffffff" },
  want_to_go: { label: "Want to go", color: "#956514", background: "#956514", foreground: "#ffffff" },
  been: { label: "Been", color: "#48677f", background: "#48677f", foreground: "#ffffff" },
  saved: { label: "Saved", color: "#48677f", background: "#fffdf9", foreground: "#48677f" },
} as const satisfies Record<PlaceStatus, { label: string; color: string; background: string; foreground: string }>;

// The same 24-unit glyphs are used in the map image, list, and map legend.
export const placeStatusPaths: Record<PlaceStatus, readonly string[]> = {
  loved: ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"],
  want_to_go: ["M6 3h12v18l-6-4-6 4V3Z"],
  been: ["m5 12 4 4L19 6"],
  saved: ["M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z", "M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"],
};

export function getPlaceStatus(place: Pick<Place, "loved" | "status">): PlaceStatus {
  if (place.loved === true) return "loved";
  if (place.status === "want_to_go" || place.status === "been") return place.status;
  return "saved";
}

/** A 44px image leaves room for a touch target around the visible marker. */
export function createPlaceMarkerSvg(status: PlaceStatus, isActive: boolean) {
  const appearance = placeStatuses[status];
  const radius = isActive ? 17 : 15;
  const border = status === "saved" ? appearance.color : "#ffffff";
  const glyphScale = isActive ? 0.84 : 0.75;
  const offset = 22 - 12 * glyphScale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">${isActive ? '<circle cx="22" cy="22" r="20" fill="#fffdf9" stroke="#242321" stroke-width="2"/>' : ""}<circle cx="22" cy="22" r="${radius}" fill="${appearance.background}" stroke="${border}" stroke-width="2"/><g transform="translate(${offset} ${offset}) scale(${glyphScale})" fill="none" stroke="${appearance.foreground}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${placeStatusPaths[status].map((path) => `<path d="${path}"/>`).join("")}</g></svg>`;
}
