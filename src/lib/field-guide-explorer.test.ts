import assert from "node:assert/strict";
import test from "node:test";
import data from "@/data/places.json";
import type { Place } from "@/lib/place";
import { isPublicPlace } from "@/lib/filtering";
import { normalizePlaceCity } from "@/lib/place-city";
import {
  buildExplorerQuery, explorerGroups, filterExplorerPlaces,
  getExplorerSpecialties, readExplorerFilters,
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
