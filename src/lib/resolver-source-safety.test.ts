import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { FreeGeocodingAccess } from "@/lib/free-geocoding";
import { GooglePlacesAccess } from "@/lib/google-places-access";
import { resolveGoogleMapsUrlForProductionPlace } from "@/lib/google-place-admin-resolver";
import { readPlacesJsonSnapshot, writePlacesJsonAtomic } from "@/lib/places-json-store";
import type { Place } from "@/lib/place";
import { POST } from "../../app/api/admin/places/[id]/resolve-google-url/route";

const oldUrl = "https://www.google.com/maps/search/?api=1&query_place_id=ChIOldVenue12345";
const newUrl = "https://www.google.com/maps/search/?api=1&query_place_id=ChINewVenue67890";
function makePlace(): Place {
  return { id: "fixture", name: "Cafe", city: "Kyoto", category: "Coffee", district: "Nakagyo", address: "1 Street",
    latitude: 35, longitude: 135, status: "been", loved: null, tabelog: "", subway: "", googleMapsUrl: oldUrl,
    googlePlaceId: "ChIOldVenue12345", canonicalName: "Old venue", canonicalAddress: "Old address", verifiedLatitude: 35.1,
    verifiedLongitude: 135.1, verifiedStatus: "Yes", verificationDecision: "manually_verified", verificationSource: "manual",
    candidateCoordinateSource: "manual", coordinateConfidence: "high", verificationNotes: "Old evidence", matchConfidence: .9 };
}
function fixture(initial = makePlace()) {
  const directory = mkdtempSync(path.join(tmpdir(), "travel-resolver-safety-"));
  const filePath = path.join(directory, "places.json");
  writeFileSync(filePath, JSON.stringify([initial]));
  const options = {
    access: new GooglePlacesAccess({ cachePath: path.join(directory, "google.json"), cacheOnly: true }),
    freeAccess: new FreeGeocodingAccess({ cachePath: path.join(directory, "free.json"), liveEnabled: false }),
    readSnapshot: () => readPlacesJsonSnapshot(filePath),
    writePlaces: (places: Place[], expectedFileHash?: string) => writePlacesJsonAtomic(places, {
      filePath, expectedFileHash, backupDirectory: path.join(directory, "backups"),
    }),
    fetcher: (async () => { assert.fail("A cache-only test must not contact a provider."); }) as typeof fetch,
  };
  return { directory, options, stored: () => readPlacesJsonSnapshot(filePath).places[0], cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("unchanged resolver source retains its candidate without provider calls", async () => {
  const f = fixture();
  try {
    const result = await resolveGoogleMapsUrlForProductionPlace("fixture", ` ${oldUrl} `, "", f.options);
    assert.ok("place" in result);
    assert.equal(result.place?.verifiedStatus, "Yes");
    assert.equal(result.place?.googlePlaceId, "ChIOldVenue12345");
    assert.equal(result.providerAttempts?.[0].provider, "existing");
    assert.equal(result.place?.verifiedLatitude, 35.1);
  } finally { f.cleanup(); }
});

test("changed Maps link discards old candidate evidence when no new lookup is available", async () => {
  const f = fixture();
  try {
    const result = await resolveGoogleMapsUrlForProductionPlace("fixture", newUrl, "", f.options);
    assert.ok("place" in result);
    const stored = f.stored();
    assert.equal(stored.googleMapsUrl, newUrl);
    assert.equal(stored.verifiedStatus, "Review");
    for (const field of ["googlePlaceId", "canonicalName", "canonicalAddress", "verifiedLatitude", "verifiedLongitude", "matchConfidence", "candidateCoordinateSource"] as const) {
      assert.equal(stored[field], undefined, field);
    }
    assert.equal(stored.latitude, 35);
    assert.match(stored.verificationNotes ?? "", /evidence was cleared/);
    assert.ok(!result.providerAttempts?.some(attempt => attempt.provider === "existing"));
  } finally { f.cleanup(); }
});

test("a changed address or pin invalidates existing candidate evidence", async () => {
  for (const placeOverrides of [{ address: "2 New Street" }, { latitude: 36 }, { longitude: 136 }, { canonicalAddress: "New building" }]) {
    const f = fixture();
    try {
      const result = await resolveGoogleMapsUrlForProductionPlace("fixture", oldUrl, "", { ...f.options, placeOverrides });
      assert.ok("place" in result);
      assert.equal(f.stored().verifiedStatus, "Review");
      assert.equal(f.stored().verifiedLatitude, undefined);
      assert.ok(!result.providerAttempts?.some(attempt => attempt.provider === "existing"));
    } finally { f.cleanup(); }
  }
});

test("changed link resolves the new Place ID and keeps the candidate for review", async () => {
  const f = fixture();
  const requests: string[] = [];
  try {
    const result = await resolveGoogleMapsUrlForProductionPlace("fixture", newUrl, "synthetic", {
      ...f.options,
      access: new GooglePlacesAccess({ cachePath: path.join(f.directory, "new-google.json"), liveEnabled: true, confirmLiveApi: true, maxApiCalls: 1 }),
      fetcher: (async (url) => {
        requests.push(String(url));
        return Response.json({ id: "ChINewVenue67890", displayName: { text: "Cafe" }, formattedAddress: "1 Street, Kyoto",
          location: { latitude: 35.2, longitude: 135.2 }, googleMapsUri: newUrl, businessStatus: "OPERATIONAL" });
      }) as typeof fetch,
    });
    assert.ok("place" in result);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].endsWith("/ChINewVenue67890"));
    assert.equal(f.stored().googlePlaceId, "ChINewVenue67890");
    assert.equal(f.stored().verifiedLatitude, 35.2);
    assert.equal(f.stored().verifiedStatus, "Review");
    assert.equal(f.stored().latitude, 35);
  } finally { f.cleanup(); }
});

test("a corrected canonical address is searched after old evidence is cleared", async () => {
  const f = fixture();
  const queries: string[] = [];
  f.options.freeAccess.searchOsm = async (query: string) => { queries.push(query); return []; };
  try {
    await resolveGoogleMapsUrlForProductionPlace("fixture", oldUrl, "", { ...f.options,
      placeOverrides: { canonicalAddress: "New corrected building" },
    });
    assert.ok(queries[0].includes("New corrected building"));
    assert.equal(f.stored().canonicalAddress, "New corrected building");
    assert.equal(f.stored().verifiedLatitude, undefined);
    assert.equal(f.stored().verifiedStatus, "Review");
  } finally { f.cleanup(); }
});

test("resolving a new link does not reopen a closed place", async () => {
  const f = fixture({ ...makePlace(), verifiedStatus: "Closed/Moved" });
  try {
    await resolveGoogleMapsUrlForProductionPlace("fixture", newUrl, "", f.options);
    assert.equal(f.stored().verifiedStatus, "Closed/Moved");
  } finally { f.cleanup(); }
});

test("resolver rejects malformed input before accessing the catalog or providers", async () => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousLive = process.env.GOOGLE_PLACES_LIVE_ENABLED;
  process.env.ADMIN_PASSWORD = "synthetic-audit-password";
  process.env.GOOGLE_PLACES_LIVE_ENABLED = "false";
  try {
    for (const body of ["{", "null", JSON.stringify({ googleMapsUrl: 123 }), JSON.stringify({ googleMapsUrl: "http://maps.google.com/" }),
      JSON.stringify({ googleMapsUrl: oldUrl, place: { address: 123 } }), JSON.stringify({ googleMapsUrl: oldUrl, place: { latitude: 100 } })]) {
      const response = await POST(new NextRequest("http://localhost/api/admin/places/not-a-real-id/resolve-google-url", {
        method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": "synthetic-audit-password" }, body,
      }), { params: Promise.resolve({ id: "not-a-real-id" }) });
      assert.equal(response.status, 400, body);
      assert.equal(typeof (await response.json()).error, "string");
    }
  } finally {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previousPassword;
    if (previousLive === undefined) delete process.env.GOOGLE_PLACES_LIVE_ENABLED; else process.env.GOOGLE_PLACES_LIVE_ENABLED = previousLive;
  }
});
