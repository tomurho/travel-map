import assert from "node:assert/strict";
import test from "node:test";
import { findNearbyCity, getCityCenters, getColocatedPlaces, getMapOverviewPlaces, getMapPlacesKey, getSelectedPlacePanOffset } from "@/lib/map-viewport";
import type { Place } from "@/lib/place";

function place(id: string, latitude = 25, longitude = 121.5): Place {
  return { id, name: id, city: "Taipei", category: "Restaurant", status: "want_to_go", loved: null, latitude, longitude, district: "", address: "", tabelog: "", subway: "" };
}

test("map content identity ignores ordering and editorial fields, but includes IDs and coordinates", () => {
  const first = place("first"), second = place("second", 25.01);
  assert.equal(getMapPlacesKey([first, second]), getMapPlacesKey([{ ...second, name: "New name" }, first]));
  assert.notEqual(getMapPlacesKey([first]), getMapPlacesKey([second]));
  assert.notEqual(getMapPlacesKey([first]), getMapPlacesKey([{ ...first, latitude: 26 }]));
});

test("city overview keeps its streets visible while a distant saved trip remains selectable", () => {
  const city = [place("one"), place("two", 25.01), place("three", 25.02), place("four", 25.03), place("five", 25.04)];
  const trip = place("day-trip", 24.82, 121.02);
  const all = [...city, trip];
  assert.deepEqual(getMapOverviewPlaces(all), city);
  assert.deepEqual(getMapOverviewPlaces([trip]), [trip]);
  assert.equal(all.length, 6);
  assert.equal(getCityCenters(all)[0].latitude, 25.015);
  assert.equal(findNearbyCity({ latitude: 1.3, longitude: 103.8 }, getCityCenters(all)), null);
  assert.equal(findNearbyCity({ latitude: 25, longitude: 121.5 }, getCityCenters(all)), "Taipei");
});

test("small and multi-city result sets retain all overview pins", () => {
  const sparse = [place("first"), place("far", 24)];
  assert.deepEqual(getMapOverviewPlaces(sparse), sparse);
  const mixed = [...Array.from({ length: 5 }, (_, index) => place(String(index))), { ...place("far", 24), city: "Another city" }];
  assert.deepEqual(getMapOverviewPlaces(mixed), mixed);
});

test("distinct places sharing coordinates stay available as separate choices", () => {
  const venues = [place("ground-floor"), place("upper-floor"), place("across-street", 25.001)];
  assert.deepEqual([...getColocatedPlaces(venues).values()].map((group) => group.map(({ id }) => id)), [["ground-floor", "upper-floor"], ["across-street"]]);
});

test("selected pin offsets above the measured detail card, with room on short screens", () => {
  assert.equal(getSelectedPlacePanOffset(730, 250), 125);
  assert.equal(getSelectedPlacePanOffset(450, 500), 177);
  assert.equal(getSelectedPlacePanOffset(50, 500), 0);
});
