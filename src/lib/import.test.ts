import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlaceRow, normalizePlaces } from "@/lib/import";

test("normalizePlaceRow parses been rows with loved flag", () => {
  const result = normalizePlaceRow({
    "location name": "Tiong Bahru Bakery",
    category: "Cafe",
    status: "Been To",
    "loved it": "Yes",
    "district/neighborhood": "Tiong Bahru",
    address: "56 Eng Hoon St",
    latitude: "1.2854",
    longitude: "103.8272",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.place.status, "been");
    assert.equal(result.place.loved, true);
    assert.equal(result.place.latitude, 1.2854);
  }
});

test("normalizePlaceRow blanks loved for want to go rows", () => {
  const result = normalizePlaceRow({
    "location name": "Naoshima",
    category: "Island",
    status: "want to go",
    "loved it": "No",
    latitude: "34.4594",
    longitude: "133.9955",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.place.status, "want_to_go");
    assert.equal(result.place.loved, null);
  }
});

test("normalizePlaceRow treats blank status as a neutral location", () => {
  const result = normalizePlaceRow({
    "Location Name": "Terry Oolong roaster",
    "Verified Category": "Tea house",
    Area: "Daan",
    Address: "No. 223-13, Jinhua St, Daan District, Taipei City 106",
    Latitude: 25.0289644,
    Longitude: 121.5313956,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.place.status, "location");
    assert.equal(result.place.loved, null);
  }
});

test("normalizePlaces skips invalid coordinates and suffixes duplicates", () => {
  const result = normalizePlaces([
    {
      "location name": "Asakusa",
      category: "Neighborhood",
      status: "been",
      latitude: "35.7148",
      longitude: "139.7967",
    },
    {
      "location name": "Asakusa",
      category: "Neighborhood",
      status: "been",
      latitude: "35.7148",
      longitude: "139.7967",
    },
    {
      "location name": "Broken Place",
      category: "Museum",
      status: "been",
      latitude: "oops",
      longitude: "139.0",
    },
  ]);

  assert.equal(result.places.length, 2);
  assert.equal(result.places[1]?.id.endsWith("-2"), true);
  assert.equal(result.errors.length, 1);
});

test("normalizePlaceRow supports workbook headers", () => {
  const result = normalizePlaceRow({
    "Location Name": "Coffee Along",
    "Verified Category": "Cafe",
    Status: "Been to",
    "Loved it": "",
    Area: "Daan",
    Address: "No. 17, Alley 2, Lane 345, Section 4, Ren'ai Rd, Daan District, Taipei City 106",
    Latitude: 25.037255,
    Longitude: 121.5466,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.place.status, "been");
    assert.equal(result.place.loved, null);
    assert.equal(result.place.category, "Cafe");
    assert.equal(result.place.district, "Daan");
  }
});
