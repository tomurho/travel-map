import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFieldGuideQuery,
  filterAndSortFieldGuidePlaces,
  normalizeFieldGuideFilters,
  toggleFieldGuideLoved,
  toggleFieldGuideWantToGo,
  type FieldGuideFilters,
} from "@/lib/field-guide";
import type { Place } from "@/lib/place";

const places: Place[] = [
  {
    id: "loved-cafe",
    name: "Loved Cafe",
    city: "Test City",
    category: "Cafe",
    status: "been",
    loved: true,
    district: "North",
    address: "",
    latitude: 1,
    longitude: 1,
    tabelog: "",
    subway: "",
  },
  {
    id: "nearby-noodle",
    name: "Nearby Noodle",
    city: "Test City",
    category: "Noodles",
    status: "want_to_go",
    loved: null,
    district: "South",
    address: "",
    latitude: 0.01,
    longitude: 0.01,
    tabelog: "",
    subway: "",
  },
  {
    id: "saved-market",
    name: "Saved Market",
    city: "Test City",
    category: "Market",
    status: "location",
    loved: null,
    district: "West",
    address: "",
    latitude: 3,
    longitude: 3,
    tabelog: "",
    subway: "",
  },
  {
    id: "other-city",
    name: "Other City Place",
    city: "Elsewhere",
    category: "Cafe",
    status: "location",
    loved: null,
    district: "Center",
    address: "",
    latitude: 2,
    longitude: 2,
    tabelog: "",
    subway: "",
  },
];

const baseFilters: FieldGuideFilters = {
  city: "Test City",
  status: "all",
  category: "all",
  area: "all",
  lovedOnly: false,
  query: "",
};

test("field guide defaults to loved-first stable ordering", () => {
  const result = filterAndSortFieldGuidePlaces(places, baseFilters, {
    nearbyActive: false,
    userLocation: null,
  });

  assert.deepEqual(result.map((place) => place.id), [
    "loved-cafe",
    "nearby-noodle",
    "saved-market",
  ]);
});

test("field guide includes every status when no status filter is active", () => {
  const result = filterAndSortFieldGuidePlaces(places, baseFilters, {
    nearbyActive: false,
    userLocation: null,
  });

  assert.deepEqual(
    Array.from(new Set(result.map((place) => place.status))).sort(),
    ["been", "location", "want_to_go"],
  );
});

test("field guide sorts by straight-line distance only when Nearby is active", () => {
  const result = filterAndSortFieldGuidePlaces(places, baseFilters, {
    nearbyActive: true,
    userLocation: { latitude: 0, longitude: 0 },
  });

  assert.deepEqual(result.map((place) => place.id), [
    "nearby-noodle",
    "loved-cafe",
    "saved-market",
  ]);
});

test("field guide composes search, status, category, and area filters", () => {
  const result = filterAndSortFieldGuidePlaces(
    places,
    {
      ...baseFilters,
      status: "want_to_go",
      category: "Noodles",
      area: "South",
      query: "nearby",
    },
    { nearbyActive: false, userLocation: null },
  );

  assert.deepEqual(result.map((place) => place.id), ["nearby-noodle"]);
});

test("field guide normalizes invalid cities and persists non-location filters", () => {
  const normalized = normalizeFieldGuideFilters(places, {
    ...baseFilters,
    city: "Missing",
    lovedOnly: true,
    query: "coffee",
  });

  assert.equal(normalized.city, "Elsewhere");
  assert.equal(
    buildFieldGuideQuery(normalized),
    "city=Elsewhere&loved=1&q=coffee",
  );
});

test("Loved and Want to go toggle as a mutually exclusive pair", () => {
  const loved = toggleFieldGuideLoved({
    ...baseFilters,
    status: "want_to_go",
  });

  assert.equal(loved.lovedOnly, true);
  assert.equal(loved.status, "all");

  const wantToGo = toggleFieldGuideWantToGo(loved);
  assert.equal(wantToGo.lovedOnly, false);
  assert.equal(wantToGo.status, "want_to_go");

  const clearedWantToGo = toggleFieldGuideWantToGo(wantToGo);
  assert.equal(clearedWantToGo.lovedOnly, false);
  assert.equal(clearedWantToGo.status, "all");

  const clearedLoved = toggleFieldGuideLoved({
    ...baseFilters,
    lovedOnly: true,
  });
  assert.equal(clearedLoved.lovedOnly, false);
  assert.equal(clearedLoved.status, "all");
});

test("URL normalization preserves the exclusive filter rule", () => {
  const normalized = normalizeFieldGuideFilters(places, {
    ...baseFilters,
    lovedOnly: true,
    status: "want_to_go",
  });
  assert.equal(normalized.lovedOnly, true);
  assert.equal(normalized.status, "all");
  assert.equal(buildFieldGuideQuery(normalized), "city=Test+City&loved=1");
});

test("Nearby composes independently with Loved or Want to go", () => {
  const nearbyOptions = {
    nearbyActive: true,
    userLocation: { latitude: 0, longitude: 0 },
  };
  const lovedNearby = filterAndSortFieldGuidePlaces(
    places,
    toggleFieldGuideLoved(baseFilters),
    nearbyOptions,
  );
  const wantToGoNearby = filterAndSortFieldGuidePlaces(
    places,
    toggleFieldGuideWantToGo(baseFilters),
    nearbyOptions,
  );

  assert.deepEqual(lovedNearby.map((place) => place.id), ["loved-cafe"]);
  assert.deepEqual(wantToGoNearby.map((place) => place.id), ["nearby-noodle"]);
});
