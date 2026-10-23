import type { Place } from "@/lib/place";

export type EditorialState = "saved" | "want_to_go" | "been" | "loved";

export function getEditorialState(place: Pick<Place, "status" | "loved">): EditorialState {
  if (place.loved) return "loved";
  if (place.status === "want_to_go") return "want_to_go";
  if (place.status === "been") return "been";
  return "saved";
}

export function getStoredEditorialStatus(
  state: EditorialState,
  original: Pick<Place, "status" | "loved">,
  statusChanged: boolean,
): Pick<Place, "status" | "loved"> {
  if (!statusChanged) return { status: original.status, loved: original.loved };
  if (state === "loved") return { loved: true, status: "been" };
  if (state === "been") return { loved: false, status: "been" };
  if (state === "want_to_go") return { loved: null, status: "want_to_go" };
  return { loved: null, status: "location" };
}
