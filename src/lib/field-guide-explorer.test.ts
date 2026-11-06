import assert from "node:assert/strict";
import test from "node:test";
import data from "@/data/places.json";
import type { Place } from "@/lib/place";
import { isPublicPlace } from "@/lib/filtering";
import { normalizePlaceCity } from "@/lib/place-city";
import {
  buildExplorerQuery, explorerGroups, filterExplorerPlaces,
  getExplorerAreas, getExplorerRecovery, getExplorerSpecialties, matchesExplorerGroup, normalizeExplorerArea, readExplorerFilters,
  type ExplorerFilters,
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

test("choosing a group preserves a valid city area and its displayed result count", () => {
  const filters = readExplorerFilters(places, new URLSearchParams("city=Kyoto&group=all&area=Kita"));
  const specialties = getExplorerSpecialties(places, filters);
  const displayedBarCount = specialties.filter((specialty) => places.some((place) => place.category === specialty.category && matchesExplorerGroup(place, "bars")))
    .reduce((count, specialty) => count + specialty.count, 0);
  const next = readExplorerFilters(places, new URLSearchParams(buildExplorerQuery({ ...filters, group: "bars" }, "list")));
  assert.equal(next.area, "Kita Ward");
  assert.equal(displayedBarCount, 0);
  assert.equal(filterExplorerPlaces(places, next).length, displayedBarCount);
  assert.equal(getExplorerRecovery(places, next)?.kind, "area");
  assert.equal(readExplorerFilters(places, new URLSearchParams("city=Kyoto&group=bars&area=Unknown")).area, "all");
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

test("natural search matches all words independently across place, category, and area", () => {
  const filters = readExplorerFilters(places, new URLSearchParams("city=Kyoto"));
  const forward = filterExplorerPlaces(places, { ...filters, query: "tea house Higashiyama" });
  const reversed = filterExplorerPlaces(places, { ...filters, query: "Higashiyama tea house" });
  assert.ok(forward.length > 0);
  assert.deepEqual(reversed.map((place) => place.id), forward.map((place) => place.id));
  assert.ok(reversed.some((place) => place.name === "YUGEN"));
  assert.deepEqual(filterExplorerPlaces(places, { ...filters, query: " Higashiyama\tTEA  house\n" }), reversed);
  assert.equal(filterExplorerPlaces(places, { ...filters, query: "Higashiyama tea house impossible-term" }).length, 0);
});

test("word search retains approved type aliases, accent normalization, and public-only results", () => {
  const sample = places.find(isPublicPlace)!;
  const fixtures: Place[] = [
    { ...sample, id: "cafe", city: "Kyoto", name: "Café Étoile", category: "Café", district: "Nakagyo Ward" },
    { ...sample, id: "alias", city: "Kyoto", name: "A cider place", category: "Cider bar", district: "Nakagyo Ward" },
    { ...sample, id: "closed", city: "Kyoto", name: "Café Étoile closed", category: "Café", district: "Nakagyo Ward", verifiedStatus: "Closed/Moved" },
  ];
  const filters = readExplorerFilters(fixtures, new URLSearchParams("city=Kyoto"));
  assert.deepEqual(filterExplorerPlaces(fixtures, { ...filters, query: "nakagyo cafe etoile" }).map((place) => place.id), ["cafe"]);
  assert.deepEqual(filterExplorerPlaces(fixtures, { ...filters, query: "Nakagyo Cider Bar" }).map((place) => place.id), ["alias"]);
});

function recoveryFixture() {
  const sample = places.find(isPublicPlace)!;
  const fixtures: Place[] = [
    { ...sample, id: "near-tea", city: "Kyoto", name: "Morning tea", category: "Tea house", district: "Higashiyama Ward", loved: true, status: "been", latitude: 35, longitude: 135 },
    { ...sample, id: "far-tea", city: "Kyoto", name: "Evening tea", category: "Tea house", district: "Nakagyo Ward", loved: true, status: "been", latitude: 35.1, longitude: 135 },
    { ...sample, id: "coffee", city: "Kyoto", name: "Morning coffee", category: "Coffee", district: "Sakyo Ward", loved: false, status: "location", latitude: 35, longitude: 135 },
    { ...sample, id: "closed-tea", city: "Kyoto", name: "Morning tea closed", category: "Tea house", district: "Sakyo Ward", loved: true, status: "been", verifiedStatus: "Closed/Moved" },
    { ...sample, id: "other-city", city: "Tokyo", name: "Morning tea", category: "Tea house", district: "Sakyo Ward", loved: true, status: "been" },
  ];
  const filters: ExplorerFilters = { city: "Kyoto", group: "all", category: "Tea house", area: "Sakyo Ward", lovedOnly: true, status: "all", query: "tea" };
  return { fixtures, filters };
}

test("empty recovery removes only the area and counts the same public results with Nearby active", () => {
  const { fixtures, filters } = recoveryFixture();
  const nearby = { nearbyActive: true, userLocation: { latitude: 35.1, longitude: 135 } };
  const recovery = getExplorerRecovery(fixtures, Object.freeze(filters), nearby);
  assert.equal(recovery?.kind, "area");
  assert.deepEqual(recovery?.filters, { ...filters, area: "all" });
  assert.equal(recovery?.count, 2);
  assert.deepEqual(filterExplorerPlaces(fixtures, recovery!.filters, nearby).map((place) => place.id), ["far-tea", "near-tea"]);
  assert.equal(filters.area, "Sakyo Ward");
  assert.equal(getExplorerRecovery(fixtures, recovery!.filters, nearby), null);
});

test("empty recovery skips ineffective area changes and offers the query while retaining other choices", () => {
  const { fixtures, filters } = recoveryFixture();
  const current = { ...filters, area: "Higashiyama Ward", query: "does not exist" };
  const recovery = getExplorerRecovery(fixtures, current);
  assert.equal(recovery?.kind, "query");
  assert.deepEqual(recovery?.filters, { ...current, query: "" });
  assert.equal(recovery?.count, 1);
});

test("empty recovery can relax personal status, specialty, or broad group separately", () => {
  const { fixtures } = recoveryFixture();
  const base: ExplorerFilters = { city: "Kyoto", group: "all", category: "Coffee", area: "all", lovedOnly: false, status: "all", query: "" };
  const loved = getExplorerRecovery(fixtures, { ...base, lovedOnly: true });
  assert.equal(loved?.kind, "loved");
  assert.deepEqual(loved?.filters, base);
  const wanted = getExplorerRecovery(fixtures, { ...base, status: "want_to_go" });
  assert.equal(wanted?.kind, "status");
  assert.deepEqual(wanted?.filters, base);
  const category = getExplorerRecovery(fixtures, { ...base, category: "Tea house", area: "Sakyo Ward", query: "coffee" });
  assert.equal(category?.kind, "category");
  assert.deepEqual(category?.filters, { ...base, category: "all", area: "Sakyo Ward", query: "coffee" });
  assert.equal(category?.count, 1);
  const group = getExplorerRecovery(fixtures, { ...base, category: "all", group: "bars" });
  assert.equal(group?.kind, "group");
  assert.equal(group?.filters.city, "Kyoto");
  assert.equal(group?.count, 3);
});

test("empty recovery does not change the city or clear several blocking filters", () => {
  const { fixtures, filters } = recoveryFixture();
  assert.equal(getExplorerRecovery(fixtures, { ...filters, query: "no match" }), null);
  assert.equal(getExplorerRecovery(fixtures, { ...filters, city: "Matsue", area: "all", query: "" }), null);
  assert.equal(getExplorerRecovery([], filters), null);
});
