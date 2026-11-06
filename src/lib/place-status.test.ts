import assert from "node:assert/strict";
import test from "node:test";
import { getPlaceStatus, placeStatuses } from "./place-status";

test("Loved takes priority without changing a place's stored status", () => {
  for (const status of ["location", "been", "want_to_go"] as const) {
    const place = { loved: true, status };
    assert.equal(getPlaceStatus(place), "loved");
    assert.equal(place.status, status);
  }
});

test("unrated and unloved places retain their distinct personal statuses", () => {
  for (const loved of [false, null]) {
    assert.equal(placeStatuses[getPlaceStatus({ loved, status: "location" })].label, "Saved");
    assert.equal(placeStatuses[getPlaceStatus({ loved, status: "been" })].label, "Been");
    assert.equal(placeStatuses[getPlaceStatus({ loved, status: "want_to_go" })].label, "Want to go");
  }
});
