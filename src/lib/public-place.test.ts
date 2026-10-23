import assert from "node:assert/strict";
import test from "node:test";
import { toPublicPlace } from "@/lib/public-place";
import type { Place } from "@/lib/place";

test("public guides share an allowlist that removes internal evidence and retains edit versions", () => {
  const internal: Place = { id: "example", name: "Example", city: "Ho Chi Minh City", category: "Cafe", status: "been", loved: null, district: "", address: "Street", latitude: 10, longitude: 106, tabelog: "private source", subway: "private source", notes: ["Public note"], canonicalName: "Private candidate", verifiedStatus: "Review", verificationNotes: "Private review", lastChecked: "2026-10-23" };
  const visible = toPublicPlace(internal);
  assert.equal(visible.city, "Ho Chi Minh City");
  assert.equal(visible.loved, null);
  assert.deepEqual(visible.notes, ["Public note"]);
  assert.ok(visible.recordVersion);
  assert.equal(visible.tabelog, "");
  assert.equal(visible.subway, "");
  for (const key of ["canonicalName", "verifiedStatus", "verificationNotes", "lastChecked"]) assert.equal(Object.hasOwn(visible, key), false);
});
