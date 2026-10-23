import assert from "node:assert/strict";
import test from "node:test";
import data from "@/data/places.json";
import type { Place } from "@/lib/place";
import { isPublicPlace } from "@/lib/filtering";
import { normalizePlaceCity } from "@/lib/place-city";
import {
  buildExplorerQuery, explorerGroups, filterExplorerPlaces,
  getExplorerAreas, getExplorerSpecialties, matchesExplorerGroup, normalizeExplorerArea, readExplorerFilters,
} from "@/lib/field-guide-explorer";

const places = data as Place[];

test("every city's default includes all public listings, including deferred types", () => {
  const cities = [...new Set(places.map((place) => normalizePlaceCity(place.city)))];
  for (const city of cities) {
    const filters = readExplorerFilters(places, new URLSearchParams({ city }));
    assert.equal(filters.group, "all");
    const expected = places.filter((place) => normalizePlaceCity(place.city) === city && isPublicPlace(place));
    assert.deepEqual(filterExplorerPlaces(places, filters).map((place) => place.id).sort(), expected.map((place) => place.id).sort());
  }
});

test("specialty counts compose with Loved, wishlist, and search in every city", () => {
  for (const city of [...new Set(places.map((place) => place.city))]) {
    for (const group of explorerGroups) {
      const refinements: Record<string, string>[] = [{ loved: "1" }, { status: "want_to_go" }, { q: "no-match-for-this-query" }];
      for (const refinement of refinements) {
        const filters = readExplorerFilters(places, new URLSearchParams({ city, group: group.id, ...refinement }));
        const specialties = getExplorerSpecialties(places, filters);
        assert.equal(specialties.reduce((sum, specialty) => sum + specialty.count, 0), filterExplorerPlaces(places, filters).length);
        for (const specialty of specialties) {
          assert.equal(specialty.count, filterExplorerPlaces(places, { ...filters, category: specialty.category }).length);
        }
      }
    }
  }
});

test("legacy category links, city preferences, and explicit empty groups survive rollout", () => {
  const legacy = readExplorerFilters(places, new URLSearchParams("city=Kyoto&category=Cider+Bar"));
  assert.equal(legacy.group, "bars");
  assert.equal(legacy.category, "Cider bar");
  assert.equal(filterExplorerPlaces(places, legacy).length, 1);
  assert.deepEqual(readExplorerFilters(places, new URLSearchParams(buildExplorerQuery(legacy, "list"))), legacy);
  assert.equal(readExplorerFilters(places, new URLSearchParams(), { rememberedCity: "Tokyo" }).city, "Tokyo");
  assert.equal(readExplorerFilters(places, new URLSearchParams("city=Kyoto"), { rememberedCity: "Tokyo" }).city, "Kyoto");
  const empty = readExplorerFilters(places, new URLSearchParams("city=Fukuoka&group=bars"));
  assert.equal(empty.group, "bars");
  assert.equal(filterExplorerPlaces(places, empty).length, 0);
});

test("Kyoto ward aliases share one filter without changing source labels or other cities", () => {
  const sample = places.find((place) => isPublicPlace(place) && place.city === "Kyoto")!;
  const fixtures = [
    { ...sample, id: "alias-short", district: "Nakagyo", category: "Coffee" },
    { ...sample, id: "alias-ward", district: "Nakagyo Ward", category: "Coffee" },
    { ...sample, id: "other-ward", district: "Kita", category: "Coffee" },
  ];
  const filters = readExplorerFilters(fixtures, new URLSearchParams("city=Kyoto&area=Nakagyo"));
  assert.equal(filters.area, "Nakagyo Ward");
  assert.deepEqual(getExplorerAreas(fixtures, filters), ["Kita Ward", "Nakagyo Ward"]);
  assert.deepEqual(filterExplorerPlaces(fixtures, filters).map((place) => place.id).sort(), ["alias-short", "alias-ward"]);
  assert.equal(fixtures[0].district, "Nakagyo");
  assert.equal(normalizeExplorerArea("Tokyo", "Nakagyo"), "Nakagyo");
  assert.equal(normalizeExplorerArea("Kyoto", "Unreviewed area"), "Unreviewed area");
  assert.deepEqual(readExplorerFilters(fixtures, new URLSearchParams(buildExplorerQuery(filters, "list"))), filters);
});

test("Other exposes deferred types without changing their distinct specialty labels", () => {
  const sample = places.find(isPublicPlace)!;
  const fixtures = [
    { ...sample, id: "deferred-upper", category: "Tea Shop" },
    { ...sample, id: "deferred-lower", category: "Tea shop" },
    { ...sample, id: "approved", category: "Coffee" },
  ];
  const filters = readExplorerFilters(fixtures, new URLSearchParams({ city: sample.city, group: "other" }));
  assert.deepEqual(filterExplorerPlaces(fixtures, filters).map((place) => place.id).sort(), ["deferred-lower", "deferred-upper"]);
  assert.deepEqual(getExplorerSpecialties(fixtures, filters).map((specialty) => specialty.label).sort(), ["Tea Shop", "Tea shop"].sort());
  for (const place of fixtures) {
    const assigned = explorerGroups.filter((option) => option.id !== "all" && matchesExplorerGroup(place, option.id));
    assert.equal(assigned.length, 1);
  }
  const legacy = readExplorerFilters(fixtures, new URLSearchParams({ city: sample.city, category: "Tea Shop" }));
  assert.equal(legacy.group, "other");
  assert.equal(legacy.category, "Tea Shop");
});
