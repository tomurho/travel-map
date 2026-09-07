import assert from "node:assert/strict";
import test from "node:test";
import decisions from "@/data/place-type-decisions.json";
import { normalizeApprovedPlaceType, getPlaceTypeGroup } from "@/lib/place-types";
import { findCanonicalCategory } from "@/lib/place-category";
import { filterAndSortFieldGuidePlaces, readFieldGuideFilters } from "@/lib/field-guide";
import { filterKyotoPreviewPlaces, readKyotoPreviewFilters } from "@/lib/kyoto-preview";
import type { Place } from "@/lib/place";

const places: Place[] = ["Café", "Ice cream & gelato", "Japanese restaurant", "Fusion", "Cider bar", "Tea house"].map((category, i) => ({
  id: String(i), name: `Place ${i}`, city: "Kyoto", category, status: "location", loved: null,
  district: "Center", address: "1 Main St", latitude: 35, longitude: 135,
  tabelog: "", subway: "",
}));

test("approved type migration is idempotent and preserves deferred distinctions", () => {
  for (const type of decisions.types) {
    const result = normalizeApprovedPlaceType(type.sourceType);
    assert.equal(result, type.decision === "approved" ? type.label : type.sourceType);
    assert.equal(normalizeApprovedPlaceType(result), result);
  }
  assert.equal(normalizeApprovedPlaceType("Tea Shop"), "Tea Shop");
  assert.equal(normalizeApprovedPlaceType("Tea shop"), "Tea shop");
  assert.equal(normalizeApprovedPlaceType("Unfamiliar specialty"), "Unfamiliar specialty");
  assert.equal(getPlaceTypeGroup("Shop"), null);
  assert.equal(getPlaceTypeGroup("Japanese tea specialty store"), "tea");
});

test("old searches and bookmarked filters still find merged types", () => {
  for (const [old, label, group] of [
    ["Cafe", "Café", "coffee"], ["Gelato", "Ice cream & gelato", "desserts"],
    ["Japanese Cuisine", "Japanese restaurant", "food"], ["Innovative", "Fusion", "food"],
    ["Cider Bar", "Cider bar", "bars"], ["Japanese tea specialty store", "Tea house", "tea"],
  ]) {
    const params = new URLSearchParams({ city: "Kyoto", category: old, q: old });
    const filters = readFieldGuideFilters(places, params);
    assert.equal(filters.category, label);
    assert.deepEqual(filterAndSortFieldGuidePlaces(places, filters, { nearbyActive: false, userLocation: null }).map((place) => place.category), [label]);
    const preview = readKyotoPreviewFilters(places, new URLSearchParams({ group, specialty: old, q: old }));
    assert.equal(preview.category, label);
    assert.deepEqual(filterKyotoPreviewPlaces(places, preview).map((place) => place.category), [label]);
  }
});

test("editor accepts approved old labels against current options without inventing types", () => {
  const options = places.map((place) => place.category);
  assert.equal(findCanonicalCategory("Gelato", options), "Ice cream & gelato");
  assert.equal(findCanonicalCategory("Cafe", options), "Café");
  assert.equal(findCanonicalCategory("Tea shop", ["Tea Shop", "Tea shop"]), "Tea shop");
  assert.equal(findCanonicalCategory("New type", options), null);
});
