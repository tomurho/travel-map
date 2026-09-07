import assert from "node:assert/strict";
import test from "node:test";
import data from "@/data/places.json";
import type { Place } from "@/lib/place";
import { buildKyotoPreviewQuery, filterKyotoPreviewPlaces, getPreviewSpecialties, readKyotoPreviewFilters } from "@/lib/kyoto-preview";

const fixture = (id: string, category: string, overrides: Partial<Place> = {}): Place => ({
  id, name: id, city: "Kyoto", category, district: "Nakagyo Ward", address: "",
  latitude: 35, longitude: 135.7, tabelog: "", subway: "", status: "location", loved: null,
  ...overrides,
});
const places = [
  fixture("bar", "Bar"), fixture("wine", "Wine bar", { loved: true, status: "been" }),
  fixture("Swingin", "Cider Bar"), fixture("soba", "Soba", { status: "want_to_go" }),
  fixture("tempura", "Tempura", { district: "South" }), fixture("coffee", "Coffee"),
  fixture("cafe", "Cafe"), fixture("future-type", "New specialty"),
  fixture("tokyo", "Bar", { city: "Tokyo" }),
  fixture("closed", "Bar", { verifiedStatus: "Closed/Moved" }),
];
const read = (query: string) => readKyotoPreviewFilters(places, new URLSearchParams(query));

test("Kyoto's bars include wine and cider without modifying original labels", () => {
  const before = JSON.stringify(places);
  const all = filterKyotoPreviewPlaces(places, read("group=bars"));
  assert.equal(all.length, 3);
  const cider = filterKyotoPreviewPlaces(places, read("group=bars&specialty=Cider+Bar"));
  assert.equal(cider.length, 1);
  assert.match(cider[0].name, /Swingin/);
  assert.equal(cider[0].category, "Cider Bar");
  assert.equal(all.filter((place) => place.category === "Wine bar").length, 1);
  assert.equal(JSON.stringify(places), before);
});

test("All places includes ungrouped records and excludes other cities and closures", () => {
  const all = filterKyotoPreviewPlaces(places, read("group=all"));
  assert.equal(all.length, 8);
  assert.ok(all.some((place) => place.id === "future-type"));
  assert.ok(!all.some((place) => ["closed", "tokyo"].includes(place.id)));
  // Check the real dataset without freezing editorial record counts in tests.
  const current = data as Place[];
  const expected = current.filter((place) => place.city === "Kyoto" && place.verifiedStatus !== "Closed/Moved");
  const actual = filterKyotoPreviewPlaces(current, readKyotoPreviewFilters(current, new URLSearchParams("group=all")));
  assert.deepEqual(actual.map((place) => place.id).sort(), expected.map((place) => place.id).sort());
});

test("food specialties stay distinct and broad coffee browsing includes both labels", () => {
  assert.equal(filterKyotoPreviewPlaces(places, read("group=food&specialty=Soba")).length, 1);
  assert.equal(filterKyotoPreviewPlaces(places, read("group=food&specialty=Tempura")).length, 1);
  assert.equal(filterKyotoPreviewPlaces(places, read("group=coffee")).length, 2);
  assert.equal(filterKyotoPreviewPlaces(places, read("group=coffee&q=coffee")).length, 2);
});

test("refined counts match results and zero results never silently broaden a specialty", () => {
  for (const query of ["group=bars", "group=food&loved=1", "group=food&status=want_to_go", "group=bars&area=Nakagyo+Ward", "group=bars&q=cider"]) {
    const filters = read(query);
    for (const specialty of getPreviewSpecialties(places, filters)) {
      assert.equal(specialty.count, filterKyotoPreviewPlaces(places, { ...filters, category: specialty.category }).length);
    }
  }
  const filters = read("group=bars&specialty=Cider+Bar&q=does-not-exist");
  assert.equal(filters.category, "Cider Bar");
  assert.equal(filterKyotoPreviewPlaces(places, filters).length, 0);
});

test("URL state restores filters and invalid combinations safely, without city preference writes", () => {
  const filters = read("group=bars&specialty=Cider+Bar&area=Nakagyo+Ward&loved=1&q=cider");
  const query = buildKyotoPreviewQuery(filters, "list");
  assert.deepEqual(read(query), filters);
  assert.equal(new URLSearchParams(query).get("view"), "list");
  assert.equal(read("group=missing&city=Tokyo").group, "bars");
  assert.equal(read("group=bars&specialty=Soba&area=Missing").category, "all");
  assert.equal(read("group=bars&specialty=Soba&area=Missing").area, "all");
  assert.equal(read("loved=1&status=want_to_go").status, "all");
});
