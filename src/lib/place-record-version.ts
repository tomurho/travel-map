import { createHash } from "node:crypto";
import type { Place } from "@/lib/place";

// Hash the complete stored record, including fields omitted from public pages.
// Sorting keys keeps the version stable when JSON property order changes.
export function getPlaceRecordVersion(place: Place) {
  const fields = Object.entries(place)
    .filter(([key]) => key !== "recordVersion")
    .sort(([first], [second]) => first.localeCompare(second));
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}
