import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { filterPlaces } from "@/lib/filtering";
import { formatProviderAttemptSummary } from "@/lib/admin-ui";
import { FreeGeocodingAccess } from "@/lib/free-geocoding";
import {
  fetchCandidatesFromGoogleMapsUrl,
  getAdminResolverSearchAttempts,
  summarizeAdminCandidates,
} from "@/lib/google-place-admin-resolver";
import {
  assertBroadLiveRunAllowed,
  assertNarrowFieldMask,
  getTextSearchCacheKey,
  GooglePlacesAccess,
  GooglePlacesLiveCallBlockedError,
  writeGooglePlacesCache,
} from "@/lib/google-places-access";
import { publicPlaceDetailsLookupEnabled } from "@/components/map-view";
import {
  assertAutoDecisionSafetyGate,
  assertCoordinateAuditFields,
  getTextSimilarity,
  verifyPlaceFromCandidates,
} from "@/lib/google-place-verification";
import { normalizeArea, normalizePlaceRow, normalizePlaces } from "@/lib/import";
import {
  getPlaceDetailsLookupAddress,
  hasMaterialCanonicalAddressDifference,
  type Place,
} from "@/lib/place";
import {
  acceptCandidateCoordinates,
  applyAdminSelectedCandidate,
  markVerifiedToday,
  useCanonicalAddress,
  validatePlaceVerification,
} from "@/lib/place-verification";
import {
  getCityAuditReport,
  parseArgs,
  readSelectedNames,
  selectPlacesForAudit,
  shouldUseGoogleCacheOnly,
  shouldWriteCandidateOutput,
} from "../../scripts/verify-places-google";

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "existing-place",
    name: "Existing Place",
    city: "Singapore",
    category: "Coffee",
    status: "location",
    loved: null,
    district: "Tiong Bahru",
    address: "56 Eng Hoon Street",
    latitude: 1.2854,
    longitude: 103.8272,
    tabelog: "",
    subway: "",
    ...overrides,
  };
}

test("normalizePlaceRow parses been rows with loved flag", () => {
  const result = normalizePlaceRow({
    "location name": "Tiong Bahru Bakery",
    City: "Singapore",
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
    assert.equal(result.place.city, "Singapore");
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

test("normalizePlaceRow treats status loved it as been and loved", () => {
  const result = normalizePlaceRow({
    "Location Name": "Astea",
    City: "Taipei",
    "Verified Category": "Tea house",
    Status: "Loved it",
    Area: "Daan",
    Address: "No. 1, Taipei",
    Latitude: 25.03,
    Longitude: 121.53,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.place.status, "been");
    assert.equal(result.place.loved, true);
  }
});

test("normalizePlaceRow imports Kyoto metadata", () => {
  const result = normalizePlaceRow({
    "Location Name": "京極かねよ (Kaneyo)",
    City: "Kyoto",
    "Verified Category": "Unagi",
    Status: "Been to",
    Area: "Nakagyo Ward",
    Address: "京都市中京区新京極六角",
    "Nearest Subway": "Kyoto Shiyakusho-mae Sta.",
    "Tabelog Score": 3.49,
    "Google Maps URL": "https://maps.google.com/?cid=123",
    "Verified?": "Yes",
    "Last Checked": "2026-05-08",
    "Verification Notes": "Confirmed from Google Maps.",
    Latitude: 35.00759227,
    Longitude: 135.76794884,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.place.city, "Kyoto");
    assert.equal(result.place.subway, "Kyoto Shiyakusho-mae Sta.");
    assert.equal(result.place.tabelog, "3.49");
    assert.equal(result.place.googleMapsUrl, "https://maps.google.com/?cid=123");
    assert.equal(result.place.verifiedStatus, "Yes");
    assert.equal(result.place.lastChecked, "2026-05-08");
    assert.equal(result.place.verificationNotes, "Confirmed from Google Maps.");
  }
});

test("normalizePlaceRow handles blank and nonstandard verification values", () => {
  const blankResult = normalizePlaceRow({
    "Location Name": "Blank QA",
    Category: "Coffee",
    Status: "Been",
    Latitude: 25.03,
    Longitude: 121.53,
  });
  const reviewResult = normalizePlaceRow({
    "Location Name": "Needs QA",
    Category: "Coffee",
    Status: "Been",
    "Verified?": "double-check",
    Latitude: 25.04,
    Longitude: 121.54,
  });

  assert.equal(blankResult.ok, true);
  assert.equal(reviewResult.ok, true);
  if (blankResult.ok && reviewResult.ok) {
    assert.equal(blankResult.place.verifiedStatus, "");
    assert.equal(reviewResult.place.verifiedStatus, "Review");
  }
});

test("normalizePlaceRow supports Tokyo status values", () => {
  const result = normalizePlaceRow({
    "Location Name": "ぶち旨屋 (Buchi Umaya)",
    City: "Tokyo",
    Category: "Okonomiyaki",
    Status: "Been there",
    Area: "Shinjuku",
    Address: "東京都新宿区西新宿7-22-34 新宿東海ビル 1F",
    Subway: "Seibu Shinjuku",
    Tabelog: 3.45,
    Latitude: 35.6966,
    Longitude: 139.69659,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.place.city, "Tokyo");
    assert.equal(result.place.status, "been");
    assert.equal(result.place.category, "Okonomiyaki");
    assert.equal(result.place.subway, "Seibu Shinjuku");
    assert.equal(result.place.tabelog, "3.45");
  }
});

test("normalizePlaceRow treats Tabelog resolution notes as neutral locations", () => {
  const result = normalizePlaceRow({
    "Location Name": "うどん 慎 (Udon Shin)",
    City: "Tokyo",
    Category: "Udon",
    Status:
      "Resolved via matched Tabelog listing; category, ward, address, rating, and nearest station confirmed.",
    Area: "Shibuya",
    Address: "東京都渋谷区代々木2-20-16 相馬ビル1F",
    Subway: "Shinjuku",
    Tabelog: 3.74,
    Latitude: 35.685535,
    Longitude: 139.698743,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.place.status, "location");
    assert.equal(result.place.city, "Tokyo");
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

test("normalizePlaceRow treats explicit Location status as neutral location", () => {
  const result = normalizePlaceRow({
    "Location Name": "96B cafe & roastery",
    City: "Ho Chi Minh City",
    Category: "Coffee",
    Status: "Location",
    Area: "District 1",
    Address: "Ho Chi Minh City",
    Latitude: 10.77,
    Longitude: 106.69,
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

test("normalizePlaces preserves ID when same place has reformatted address", () => {
  const result = normalizePlaces(
    [
      {
        "Location Name": "Tiong Bahru Bakery",
        City: "Singapore",
        Category: "Cafe",
        Status: "Location",
        Address: "56, Eng Hoon Street",
        Latitude: 1.2854,
        Longitude: 103.8272,
      },
    ],
    {
      existingPlaces: [
        makePlace({
          id: "stable-bakery-id",
          name: "Tiong Bahru Bakery",
          address: "56 Eng Hoon Street",
        }),
      ],
    },
  );

  assert.equal(result.places[0]?.id, "stable-bakery-id");
  assert.equal(result.migrationReport.idsPreserved, 1);
  assert.equal(result.migrationReport.idChangesAvoided, 1);
  assert.equal(result.migrationReport.newIdsGenerated, 0);
});

test("normalizePlaces preserves ID by unique city and name match", () => {
  const result = normalizePlaces(
    [
      {
        "Location Name": "Tiong Bahru Bakery",
        City: "Singapore",
        Category: "Cafe",
        Status: "Location",
        Address: "A newly reformatted address",
        Latitude: 1.2854,
        Longitude: 103.8272,
      },
    ],
    {
      existingPlaces: [
        makePlace({
          id: "unique-name-id",
          name: "Tiong Bahru Bakery",
          address: "56 Eng Hoon Street",
        }),
      ],
    },
  );

  assert.equal(result.places[0]?.id, "unique-name-id");
  assert.equal(result.migrationReport.idsPreserved, 1);
  assert.equal(result.migrationReport.idChangesAvoided, 1);
});

test("normalizePlaces does not guess when same-name matches are duplicated", () => {
  const result = normalizePlaces(
    [
      {
        "Location Name": "Blue Bottle",
        City: "Tokyo",
        Category: "Coffee",
        Status: "Location",
        Address: "Unknown new address",
        Latitude: 35.67,
        Longitude: 139.76,
      },
    ],
    {
      existingPlaces: [
        makePlace({
          id: "blue-bottle-a",
          name: "Blue Bottle",
          city: "Tokyo",
          address: "Address A",
        }),
        makePlace({
          id: "blue-bottle-b",
          name: "Blue Bottle",
          city: "Tokyo",
          address: "Address B",
        }),
      ],
    },
  );

  assert.notEqual(result.places[0]?.id, "blue-bottle-a");
  assert.notEqual(result.places[0]?.id, "blue-bottle-b");
  assert.equal(result.migrationReport.idsPreserved, 0);
  assert.equal(result.migrationReport.newIdsGenerated, 1);
  assert.equal(result.migrationReport.ambiguousIdMatches.length, 1);
  assert.deepEqual(result.migrationReport.ambiguousIdMatches[0]?.possibleIds, [
    "blue-bottle-a",
    "blue-bottle-b",
  ]);
});

test("normalizePlaces generates a new ID for brand-new places", () => {
  const result = normalizePlaces(
    [
      {
        "Location Name": "New Find",
        City: "Taipei",
        Category: "Coffee",
        Status: "Location",
        Address: "No. 1, Taipei",
        Latitude: 25.03,
        Longitude: 121.53,
      },
    ],
    {
      existingPlaces: [
        makePlace({
          id: "other-place",
          name: "Other Place",
          city: "Taipei",
          address: "No. 2, Taipei",
        }),
      ],
    },
  );

  assert.equal(result.places[0]?.id, "new-find-no-1-taipei");
  assert.equal(result.migrationReport.idsPreserved, 0);
  assert.equal(result.migrationReport.newIdsGenerated, 1);
  assert.equal(result.migrationReport.ambiguousIdMatches.length, 0);
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

test("normalizePlaceRow preserves Google candidate verification fields", () => {
  const result = normalizePlaceRow({
    "Location Name": "Coffee Along",
    Category: "Coffee",
    Status: "Been to",
    Area: "Da’an",
    Address: "No. 17, Taipei",
    Latitude: 25.03,
    Longitude: 121.53,
    "Google Maps URL": "https://maps.google.com/coffee-along",
    "Google Place ID": "abc123",
    "Canonical Name": "Coffee Along",
    "Canonical Address": "No. 17, Taipei City",
    "Verified Latitude": 25.031,
    "Verified Longitude": 121.531,
    "Candidate Coordinate Source": "google",
    "Coordinate Precision": "place_pin",
    "Coordinate Confidence": "high",
    "Distance Delta Meters": 18.4,
    "Business Status": "OPERATIONAL",
    "Match Confidence": 0.91,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.place.googlePlaceId, "abc123");
    assert.equal(result.place.canonicalAddress, "No. 17, Taipei City");
    assert.equal(result.place.verifiedLatitude, 25.031);
    assert.equal(result.place.verifiedLongitude, 121.531);
    assert.equal(result.place.candidateCoordinateSource, "google");
    assert.equal(result.place.coordinatePrecision, "place_pin");
    assert.equal(result.place.coordinateConfidence, "high");
    assert.equal(result.place.distanceDeltaMeters, 18.4);
    assert.equal(result.place.businessStatus, "OPERATIONAL");
    assert.equal(result.place.matchConfidence, 0.91);
  }
});

test("place details lookup prefers canonical address without changing marker coordinates", () => {
  const coffeeAlong = makePlace({
    name: "Coffee Along",
    city: "Taipei",
    address:
      "No. 17, Alley 2, Lane 345, Section 4, Ren'ai Rd, Daan District, Taipei City 106",
    canonicalAddress:
      "No. 167號, Wenchang St, Da’an District, Taipei City, 106",
    latitude: 25.032582899999998,
    longitude: 121.55337870000001,
    verifiedStatus: "Yes",
  });

  assert.equal(
    getPlaceDetailsLookupAddress(coffeeAlong),
    "No. 167號, Wenchang St, Da’an District, Taipei City, 106",
  );
  assert.equal(hasMaterialCanonicalAddressDifference(coffeeAlong), true);
  assert.equal(coffeeAlong.latitude, 25.032582899999998);
  assert.equal(coffeeAlong.longitude, 121.55337870000001);
});

test("normalizeArea removes Taipei District suffix and normalizes Daan spelling", () => {
  assert.equal(normalizeArea("Taipei", "Daan"), "Da’an");
  assert.equal(normalizeArea("Taipei", "Da’an District"), "Da’an");
  assert.equal(normalizeArea("Taipei", "Zhongshan District"), "Zhongshan");
  assert.equal(normalizeArea("Kyoto", "Nakagyo Ward"), "Nakagyo Ward");
});

test("filterPlaces excludes closed or moved places from the public map", () => {
  const basePlace = {
    id: "open-place",
    name: "Open Place",
    city: "Taipei",
    category: "Coffee",
    status: "location",
    loved: null,
    district: "Da’an",
    address: "Taipei",
    latitude: 25,
    longitude: 121,
    tabelog: "",
    subway: "",
  } satisfies Place;

  const result = filterPlaces(
    [
      basePlace,
      {
        ...basePlace,
        id: "closed-place",
        name: "Closed Place",
        verifiedStatus: "Closed/Moved",
      },
    ],
    {
      area: "all",
      category: "all",
      city: "all",
      loved: "all",
      status: "all",
    },
  );

  assert.deepEqual(
    result.map((place) => place.id),
    ["open-place"],
  );
});

test("markVerifiedToday sets verified status and today's date", () => {
  const place: { lastChecked: string; verifiedStatus: Place["verifiedStatus"] } = {
    lastChecked: "",
    verifiedStatus: "Review",
  };
  const result = markVerifiedToday(
    place,
    new Date(2026, 4, 8),
  );

  assert.equal(result.verifiedStatus, "Yes");
  assert.equal(result.lastChecked, "2026-05-08");
});

test("validatePlaceVerification requires Google Maps URL when verified", () => {
  const errors = validatePlaceVerification({
    googleMapsUrl: "",
    latitude: 25.03,
    longitude: 121.53,
    verifiedStatus: "Yes",
  });

  assert.equal(
    errors.includes("Google Maps URL is required when Verified? is Yes."),
    true,
  );
});

test("validatePlaceVerification validates latitude and longitude bounds", () => {
  const errors = validatePlaceVerification({
    googleMapsUrl: "https://maps.google.com/example",
    latitude: 91,
    longitude: -181,
    verifiedStatus: "Yes",
  });

  assert.equal(
    errors.includes("Latitude must be a number between -90 and 90."),
    true,
  );
  assert.equal(
    errors.includes("Longitude must be a number between -180 and 180."),
    true,
  );
  assert.equal(
    errors.includes("Valid latitude and longitude are required when Verified? is Yes."),
    true,
  );
});

test("verifyPlaceFromCandidates populates high-confidence Google candidate metadata", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street, Singapore",
    city: "Singapore",
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        googleMapsUri: "https://maps.google.com/existing",
        id: "google-place-1",
        location: { latitude: 1.285401, longitude: 103.827201 },
      },
    ],
    { today: new Date(2026, 4, 8) },
  );

  assert.equal(result.kind, "high_confidence");
  assert.equal(result.place.googlePlaceId, "google-place-1");
  assert.equal(result.place.googleMapsUrl, "https://maps.google.com/existing");
  assert.equal(result.place.canonicalName, "Existing Place");
  assert.equal(result.place.verifiedLatitude, 1.285401);
  assert.equal(result.place.lastChecked, "2026-05-08");
});

test("verifyPlaceFromCandidates marks multiple plausible Google candidates as ambiguous", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street, Singapore",
    city: "Singapore",
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        id: "google-place-1",
        location: { latitude: 1.285401, longitude: 103.827201 },
      },
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore 169875",
        id: "google-place-2",
        location: { latitude: 1.285402, longitude: 103.827202 },
      },
    ],
    { today: new Date(2026, 4, 8) },
  );

  assert.equal(result.kind, "ambiguous");
  assert.equal(result.place.verifiedStatus, "Review");
  assert.match(
    result.place.verificationNotes ?? "",
    /Multiple Google Places candidates need review/,
  );
});

test("verifyPlaceFromCandidates marks large distance deltas for review", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street, Singapore",
    city: "Singapore",
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        id: "google-place-1",
        location: { latitude: 1.2865, longitude: 103.8285 },
      },
    ],
    { today: new Date(2026, 4, 8) },
  );

  assert.equal(result.kind, "high_confidence");
  assert.equal(
    result.place.verificationDecision,
    "auto_corrected_from_text_search",
  );
  assert.equal(result.place.verifiedStatus, undefined);
  assert.equal(result.place.latitude, 1.2854);
});

test("verifyPlaceFromCandidates maps closed Google businesses to Closed/Moved", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street, Singapore",
    city: "Singapore",
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "CLOSED_PERMANENTLY",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        id: "google-place-1",
        location: { latitude: 1.285401, longitude: 103.827201 },
      },
    ],
    { today: new Date(2026, 4, 8) },
  );

  assert.equal(result.kind, "closed_moved");
  assert.equal(result.place.verifiedStatus, "Closed/Moved");
});

test("verifyPlaceFromCandidates does not overwrite stored coordinates by default", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street, Singapore",
    latitude: 1.2854,
    longitude: 103.8272,
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(place, [
    {
      businessStatus: "OPERATIONAL",
      displayName: { text: "Existing Place" },
      formattedAddress: "56 Eng Hoon Street, Singapore",
      id: "google-place-1",
      location: { latitude: 1.285401, longitude: 103.827201 },
    },
  ]);

  assert.equal(result.place.latitude, 1.2854);
  assert.equal(result.place.longitude, 103.8272);
});

test("verifyPlaceFromCandidates applies safe coordinate updates only with explicit flag", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street, Singapore",
    latitude: 1.2854,
    longitude: 103.8272,
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        id: "google-place-1",
        location: { latitude: 1.285401, longitude: 103.827201 },
      },
    ],
    { applySafeCoordinateUpdates: true },
  );

  assert.equal(result.kind, "high_confidence");
  assert.equal(result.place.latitude, 1.285401);
  assert.equal(result.place.longitude, 103.827201);
});

test("verifyPlaceFromCandidates auto-verifies small deltas with auto decisions", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street, Singapore",
    city: "Singapore",
    latitude: 1.2854,
    longitude: 103.8272,
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        id: "google-place-1",
        location: { latitude: 1.285401, longitude: 103.827201 },
      },
    ],
    { applyAutoDecisions: true, today: new Date(2026, 4, 8) },
  );

  assert.equal(result.place.verificationDecision, "auto_verified_small_delta");
  assert.equal(result.place.samePlaceDecision, "Yes");
  assert.equal(result.place.verifiedStatus, "Yes");
  assert.equal(result.place.latitude, 1.285401);
  assert.equal(result.place.lastChecked, "2026-05-08");
});

test("getTextSimilarity handles bilingual names with collapsed spacing", () => {
  assert.equal(getTextSimilarity("朝炭 Asasumi", "朝炭Asasumi"), 1);
  assert.ok(getTextSimilarity("Sidoli radio.", "SIDOLI RADIO 小島裡") >= 0.6);
  assert.ok(getTextSimilarity("222", "222 Taipei") >= 0.75);
  assert.ok(getTextSimilarity("光生", "光生 MITSUO") >= 0.75);
  assert.ok(getTextSimilarity("煉丹爐", "煉丹爐 ｜潮汕火鍋") >= 0.75);
});

test("verifyPlaceFromCandidates preserves Quince-like small-delta review candidate metadata", () => {
  const place = makePlace({
    address:
      "37bis Ký Con, Phường Nguyễn Thái Bình, Bến Thành, Hồ Chí Minh, Vietnam",
    city: "Ho Chi Minh City",
    latitude: 10.766153,
    longitude: 106.699177,
    name: "Quince",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Quince Saigon" },
        formattedAddress: "37bis Ký Con, Bến Thành, Hồ Chí Minh",
        googleMapsUri: "https://maps.google.com/quince",
        id: "google-place-quince",
        location: { latitude: 10.766199, longitude: 106.6992167 },
      },
    ],
    {
      applyAutoDecisions: true,
      today: new Date(2026, 4, 8),
    },
  );

  assert.equal(result.kind, "high_confidence");
  assert.equal(result.place.googlePlaceId, "google-place-quince");
  assert.equal(result.place.googleMapsUrl, "https://maps.google.com/quince");
  assert.equal(result.place.verificationDecision, "auto_verified_small_delta");
  assert.equal(result.place.verifiedStatus, "Yes");
  assert.equal(result.place.latitude, 10.766199);
  assert.equal(result.place.samePlaceDecision, "Yes");
});

test("verifyPlaceFromCandidates auto-verifies nearby translated candidates with strong address evidence", () => {
  const place = makePlace({
    address: "No. 1, Taipei City",
    city: "Taipei",
    latitude: 25.052815,
    longitude: 121.54635,
    name: "祥和蔬食料理",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Serenity Vegetarian Restaurant" },
        formattedAddress: "No. 1, Taipei City, Taiwan",
        googleMapsUri: "https://maps.google.com/serenity",
        id: "google-place-serenity",
        location: { latitude: 25.05286, longitude: 121.54639 },
      },
    ],
    {
      applyAutoDecisions: true,
      today: new Date(2026, 4, 8),
    },
  );

  assert.equal(result.kind, "high_confidence");
  assert.equal(result.place.verificationDecision, "auto_verified_small_delta");
  assert.equal(result.place.verifiedStatus, "Yes");
  assert.equal(result.place.samePlaceDecision, "Yes");
  assert.equal(result.place.googleMapsUrl, "https://maps.google.com/serenity");
});

test("verifyPlaceFromCandidates auto-verifies near bilingual expanded names", () => {
  const place = makePlace({
    address: "No. 1, Taipei City",
    city: "Taipei",
    latitude: 25.05,
    longitude: 121.53,
    name: "朝炭 Asasumi",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "朝炭Asasumi" },
        formattedAddress: "No. 1, Taipei City, Taiwan",
        googleMapsUri: "https://maps.google.com/asasumi",
        id: "google-place-asasumi",
        location: { latitude: 25.0505, longitude: 121.5304 },
      },
    ],
    {
      applyAutoDecisions: true,
      today: new Date(2026, 4, 8),
    },
  );

  assert.equal(result.kind, "high_confidence");
  assert.equal(result.place.nameScore, 1);
  assert.equal(result.place.verificationDecision, "auto_verified_small_delta");
  assert.equal(result.place.verifiedStatus, "Yes");
  assert.equal(result.place.latitude, 25.0505);
});

test("verifyPlaceFromCandidates preserves plausible review candidate metadata", () => {
  const place = makePlace({
    address: "02 Thi Sách, Bến Nghé, Sài Gòn, Hồ Chí Minh 700000, Vietnam",
    city: "Ho Chi Minh City",
    latitude: 10.778112,
    longitude: 106.704796,
    name: "Rokusho",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Rokusho Saigon" },
        formattedAddress: "02 Thi Sách, Sài Gòn, Hồ Chí Minh 700000",
        googleMapsUri: "https://maps.google.com/rokusho",
        id: "google-place-rokusho",
        location: { latitude: 10.7767913, longitude: 106.7060953 },
      },
    ],
    {
      applyAutoDecisions: true,
      today: new Date(2026, 4, 8),
    },
  );

  assert.equal(result.kind, "high_confidence");
  assert.equal(result.place.verifiedStatus, "Review");
  assert.equal(result.place.verificationDecision, "candidate_only_review");
  assert.equal(result.place.googlePlaceId, "google-place-rokusho");
  assert.equal(result.place.googleMapsUrl, "https://maps.google.com/rokusho");
  assert.equal(result.place.canonicalName, "Rokusho Saigon");
  assert.equal(result.place.latitude, 10.778112);
});

test("verifyPlaceFromCandidates auto-corrects large deltas when name and address are strong", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street, Singapore",
    city: "Singapore",
    latitude: 1.2,
    longitude: 103.7,
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        id: "google-place-1",
        location: { latitude: 1.285401, longitude: 103.827201 },
      },
    ],
    { applyAutoDecisions: true },
  );

  assert.equal(
    result.place.verificationDecision,
    "auto_corrected_from_text_search",
  );
  assert.equal(result.place.samePlaceDecision, "Yes");
  assert.equal(result.place.verifiedStatus, "Yes");
  assert.equal(result.place.latitude, 1.285401);
  assert.equal(result.place.verificationSource, "text_search");
});

test("verifyPlaceFromCandidates auto-corrects strong large deltas from Place ID", () => {
  const place = makePlace({
    address: "96B Phan Ngu, Ho Chi Minh City",
    city: "Ho Chi Minh City",
    googlePlaceId: "google-place-1",
    latitude: 10.7,
    longitude: 106.6,
    name: "96B cafe & roastery",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "96B cafe & roastery" },
        formattedAddress: "96B Phan Ngu, Ho Chi Minh City, Vietnam",
        googleMapsUri: "https://maps.google.com/example",
        id: "google-place-1",
        location: { latitude: 10.790111, longitude: 106.6967004 },
      },
    ],
    {
      applyAutoDecisions: true,
      candidateSource: "place_id",
      today: new Date(2026, 4, 8),
    },
  );

  assert.equal(result.place.verificationDecision, "auto_corrected_from_place_id");
  assert.equal(result.place.samePlaceDecision, "Yes");
  assert.equal(result.place.verifiedStatus, "Yes");
  assert.equal(result.place.latitude, 10.790111);
  assert.equal(result.place.verificationSource, "place_id");
});

test("verifyPlaceFromCandidates reviews untrusted machine-derived Place ID with weak evidence", () => {
  const place = makePlace({
    address: "No. 1, Real Cafe Road, Taipei",
    city: "Taipei",
    googlePlaceId: "google-place-bank",
    latitude: 25.036962,
    longitude: 121.5465811,
    name: "Branch",
    samePlaceDecision: "Unsure",
    verificationDecision: "candidate_only_review",
    verificationSource: "text_search",
    verifiedStatus: "Review",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Taipei Fubon Bank Anhe Branch" },
        formattedAddress:
          "No. 169號, Section 4, Ren'ai Rd, Da’an District, Taipei City, 106",
        id: "google-place-bank",
        location: { latitude: 25.0382013, longitude: 121.5522227 },
      },
    ],
    {
      applyAutoDecisions: true,
      candidateSource: "place_id",
    },
  );

  assert.equal(result.place.verificationDecision, "candidate_only_review");
  assert.equal(result.place.samePlaceDecision, "Unsure");
  assert.equal(result.place.verifiedStatus, "Review");
  assert.equal(result.place.latitude, 25.036962);
});

test("verifyPlaceFromCandidates downgrades previously verified rows when stricter policy only supports review", () => {
  const place = makePlace({
    address: "No. 1, Real Cafe Road, Taipei",
    city: "Taipei",
    googlePlaceId: "google-place-bank",
    latitude: 25.036962,
    longitude: 121.5465811,
    name: "Branch",
    samePlaceDecision: "Yes",
    samePlaceReason: "Previously auto-verified from a text search candidate.",
    verificationDecision: "auto_verified_small_delta",
    verificationSource: "text_search",
    verifiedStatus: "Yes",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Taipei Fubon Bank Anhe Branch" },
        formattedAddress:
          "No. 169號, Section 4, Ren'ai Rd, Da’an District, Taipei City, 106",
        id: "google-place-bank",
        location: { latitude: 25.0382013, longitude: 121.5522227 },
      },
    ],
    {
      applyAutoDecisions: true,
      candidateSource: "place_id",
    },
  );

  assert.equal(result.place.verificationDecision, "candidate_only_review");
  assert.equal(result.place.samePlaceDecision, "Unsure");
  assert.equal(result.place.verifiedStatus, "Review");
  assert.equal(result.place.latitude, 25.036962);
  assert.match(
    result.place.verificationNotes ?? "",
    /stricter Google identity policy/,
  );
});

test("verifyPlaceFromCandidates verifies expanded local names from Place ID", () => {
  const place = makePlace({
    address: "No. 16, Da'an Rd, Taipei",
    city: "Taipei",
    googlePlaceId: "google-place-hotpot",
    latitude: 25.01,
    longitude: 121.5,
    name: "煉丹爐",
    samePlaceDecision: "Unsure",
    verificationDecision: "candidate_only_review",
    verificationSource: "text_search",
    verifiedStatus: "Review",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "煉丹爐 ｜潮汕火鍋" },
        formattedAddress:
          "106, Taipei City, Da’an District, Lane 19, Section 1, Da'an Rd, 16號之一",
        id: "google-place-hotpot",
        location: { latitude: 25.011, longitude: 121.501 },
      },
    ],
    {
      applyAutoDecisions: true,
      candidateSource: "place_id",
    },
  );

  assert.equal(result.place.verificationDecision, "auto_corrected_from_place_id");
  assert.equal(result.place.samePlaceDecision, "Yes");
  assert.equal(result.place.verifiedStatus, "Yes");
  assert.equal(result.place.latitude, 25.011);
});

test("verifyPlaceFromCandidates verifies translated names with strong address and bounded distance", () => {
  const place = makePlace({
    address:
      "No. 3號, Lane 27, Section 4, Ren'ai Rd, Da’an District, Taipei City, 106",
    city: "Taipei",
    googlePlaceId: "google-place-noodles",
    latitude: 25.04,
    longitude: 121.545,
    name: "天下三絕 (Tien Hsia San Jyue)",
    samePlaceDecision: "Unsure",
    verificationDecision: "candidate_only_review",
    verificationSource: "text_search",
    verifiedStatus: "Review",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Tien Hsia San Chueh" },
        formattedAddress:
          "No. 3號, Lane 27, Section 4, Ren'ai Rd, Da’an District, Taipei City, 106",
        id: "google-place-noodles",
        location: { latitude: 25.03888, longitude: 121.5453168 },
      },
    ],
    {
      applyAutoDecisions: true,
      candidateSource: "place_id",
    },
  );

  assert.equal(result.place.verificationDecision, "auto_corrected_from_place_id");
  assert.equal(result.place.samePlaceDecision, "Yes");
  assert.equal(result.place.verifiedStatus, "Yes");
});

test("verifyPlaceFromCandidates auto-corrects large deltas from Google Maps URL", () => {
  const place = makePlace({
    address: "96B Phan Ngu, Ho Chi Minh City",
    city: "Ho Chi Minh City",
    googleMapsUrl: "https://maps.google.com/example",
    latitude: 10.7,
    longitude: 106.6,
    name: "96B cafe & roastery",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "96B cafe & roastery" },
        formattedAddress: "96B Đ. Phan Ngữ, Tân Định, Hồ Chí Minh, Vietnam",
        googleMapsUri: "https://maps.google.com/example",
        id: "google-place-1",
        location: { latitude: 10.790111, longitude: 106.6967004 },
      },
    ],
    {
      applyAutoDecisions: true,
      candidateSource: "google_maps_url",
      today: new Date(2026, 4, 8),
    },
  );

  assert.equal(
    result.place.verificationDecision,
    "auto_corrected_from_google_url",
  );
  assert.equal(result.place.samePlaceDecision, "Yes");
  assert.equal(result.place.verifiedStatus, "Yes");
  assert.equal(result.place.latitude, 10.790111);
  assert.equal(result.place.verificationSource, "google_maps_url");
});

test("verifyPlaceFromCandidates reviews resolved Google Maps URL when row evidence is weak", () => {
  const place = makePlace({
    address: "Old formatted address, Taipei",
    city: "Taipei",
    googleMapsUrl: "https://maps.google.com/example",
    latitude: 25.01,
    longitude: 121.5,
    name: "Coffee Along",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Coffee Along" },
        formattedAddress: "No. 167號, Wenchang St, Da’an District, Taipei City",
        googleMapsUri: "https://maps.google.com/resolved-coffee-along",
        id: "google-place-coffee-along",
        location: { latitude: 25.0325829, longitude: 121.5533787 },
      },
    ],
    {
      applyAutoDecisions: true,
      candidateSource: "google_maps_url",
      today: new Date(2026, 4, 9),
    },
  );

  assert.equal(result.place.verificationDecision, "candidate_only_review");
  assert.equal(result.place.samePlaceDecision, "Unsure");
  assert.equal(result.place.verifiedStatus, "Review");
  assert.equal(result.place.latitude, 25.01);
  assert.equal(result.place.longitude, 121.5);
  assert.match(
    result.place.samePlaceReason ?? "",
    /did not have strong enough row name\/address\/city evidence/,
  );
});

test("verifyPlaceFromCandidates keeps large deltas in review when address is weak", () => {
  const place = makePlace({
    address: "99 Different Road, Singapore",
    city: "Singapore",
    latitude: 1.2,
    longitude: 103.7,
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        id: "google-place-1",
        location: { latitude: 1.285401, longitude: 103.827201 },
      },
    ],
    { applyAutoDecisions: true },
  );

  assert.equal(result.place.verificationDecision, "candidate_only_review");
  assert.equal(result.place.verifiedStatus, "Review");
  assert.equal(result.place.latitude, 1.2);
});

test("verifyPlaceFromCandidates does not auto-correct multiple plausible candidates", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street, Singapore",
    city: "Singapore",
    latitude: 1.2,
    longitude: 103.7,
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        id: "google-place-1",
        location: { latitude: 1.285401, longitude: 103.827201 },
      },
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore 169875",
        id: "google-place-2",
        location: { latitude: 1.285402, longitude: 103.827202 },
      },
    ],
    { applyAutoDecisions: true },
  );

  assert.equal(result.kind, "ambiguous");
  assert.equal(result.place.verificationDecision, "ambiguous_multiple_candidates");
  assert.equal(result.place.latitude, 1.2);
});

test("verifyPlaceFromCandidates does not auto-correct wrong city or country", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street",
    city: "Taipei",
    latitude: 25.03,
    longitude: 121.53,
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        id: "google-place-1",
        location: { latitude: 1.285401, longitude: 103.827201 },
      },
    ],
    { applyAutoDecisions: true },
  );

  assert.equal(result.place.verificationDecision, "candidate_only_review");
  assert.equal(result.place.verifiedStatus, "Review");
  assert.equal(result.place.latitude, 25.03);
});

test("verifyPlaceFromCandidates does not auto-correct wrong city from Place ID", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street",
    city: "Taipei",
    googlePlaceId: "google-place-1",
    latitude: 25.03,
    longitude: 121.53,
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        id: "google-place-1",
        location: { latitude: 1.285401, longitude: 103.827201 },
      },
    ],
    {
      applyAutoDecisions: true,
      candidateSource: "place_id",
    },
  );

  assert.equal(result.place.verificationDecision, "candidate_only_review");
  assert.equal(result.place.verifiedStatus, "Review");
  assert.equal(result.place.latitude, 25.03);
});

test("verifyPlaceFromCandidates never auto-corrects closed or moved businesses", () => {
  const place = makePlace({
    address: "56 Eng Hoon Street, Singapore",
    city: "Singapore",
    latitude: 1.2,
    longitude: 103.7,
    name: "Existing Place",
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "CLOSED_PERMANENTLY",
        displayName: { text: "Existing Place" },
        formattedAddress: "56 Eng Hoon Street, Singapore",
        id: "google-place-1",
        location: { latitude: 1.285401, longitude: 103.827201 },
      },
    ],
    { applyAutoDecisions: true },
  );

  assert.equal(result.kind, "closed_moved");
  assert.equal(result.place.verificationDecision, "closed_or_moved");
  assert.equal(result.place.verifiedStatus, "Closed/Moved");
  assert.equal(result.place.latitude, 1.2);
});

test("assertAutoDecisionSafetyGate blocks too many large-delta city corrections", () => {
  const places = [
    makePlace({
      id: "one",
      city: "Taipei",
      distanceDeltaMeters: 500,
      verificationDecision: "auto_corrected_from_place_id",
    }),
    makePlace({
      id: "two",
      city: "Taipei",
      distanceDeltaMeters: 500,
      verificationDecision: "auto_corrected_from_google_url",
    }),
    makePlace({
      id: "three",
      city: "Taipei",
      verificationDecision: "candidate_only_review",
    }),
  ];

  assert.throws(
    () => assertAutoDecisionSafetyGate(places),
    /Safety gate stopped write/,
  );
});

test("assertCoordinateAuditFields blocks coordinate writes without audit fields", () => {
  const originalPlace = makePlace({
    id: "one",
    latitude: 1,
    longitude: 2,
  });
  const changedPlace = makePlace({
    id: "one",
    latitude: 3,
    longitude: 4,
    verificationDecision: undefined,
    samePlaceReason: "",
  });

  assert.throws(
    () => assertCoordinateAuditFields(new Map([[originalPlace.id, originalPlace]]), [
      changedPlace,
    ]),
    /missing verificationDecision, verificationSource, or samePlaceReason/,
  );
});

test("assertCoordinateAuditFields blocks accepted Google coordinates without audit fields", () => {
  const originalPlace = makePlace({
    id: "one",
    latitude: 1,
    longitude: 2,
  });
  const acceptedPlace = makePlace({
    id: "one",
    googlePlaceId: "ChIJ123",
    latitude: 1,
    longitude: 2,
    samePlaceReason: "",
    verificationDecision: undefined,
    verificationSource: undefined,
    verifiedLatitude: 1,
    verifiedLongitude: 2,
    verifiedStatus: "Yes",
  });

  assert.throws(
    () => assertCoordinateAuditFields(new Map([[originalPlace.id, originalPlace]]), [
      acceptedPlace,
    ]),
    /unsupported verificationDecision values/,
  );
});

test("assertCoordinateAuditFields blocks verified rows with review decisions", () => {
  const originalPlace = makePlace({
    id: "one",
    latitude: 1,
    longitude: 2,
  });
  const inconsistentPlace = makePlace({
    id: "one",
    latitude: 1,
    longitude: 2,
    samePlaceReason: "Candidate needs review.",
    verificationDecision: "candidate_only_review",
    verificationSource: "place_id",
    verifiedStatus: "Yes",
  });

  assert.throws(
    () =>
      assertCoordinateAuditFields(new Map([[originalPlace.id, originalPlace]]), [
        inconsistentPlace,
      ]),
    /unsupported verificationDecision|review\/closed verificationDecision/,
  );
});

test("assertCoordinateAuditFields allows accepted Google coordinates with audit fields", () => {
  const originalPlace = makePlace({
    id: "one",
    latitude: 1,
    longitude: 2,
  });
  const acceptedPlace = makePlace({
    id: "one",
    googlePlaceId: "ChIJ123",
    latitude: 1,
    longitude: 2,
    samePlaceReason: "Resolved from Google Place ID.",
    verificationDecision: "auto_corrected_from_place_id",
    verificationSource: "place_id",
    verifiedLatitude: 1,
    verifiedLongitude: 2,
    verifiedStatus: "Yes",
  });

  assert.doesNotThrow(() =>
    assertCoordinateAuditFields(new Map([[originalPlace.id, originalPlace]]), [
      acceptedPlace,
    ]),
  );
});

test("assertCoordinateAuditFields allows auto-corrected verified rows", () => {
  const originalPlace = makePlace({
    id: "one",
    latitude: 1,
    longitude: 2,
  });
  const verifiedPlace = makePlace({
    id: "one",
    googlePlaceId: "ChIJ123",
    latitude: 3,
    longitude: 4,
    samePlaceReason: "Resolved from Google Place ID.",
    verificationDecision: "auto_corrected_from_place_id",
    verificationSource: "place_id",
    verifiedLatitude: 3,
    verifiedLongitude: 4,
    verifiedStatus: "Yes",
  });

  assert.doesNotThrow(() =>
    assertCoordinateAuditFields(new Map([[originalPlace.id, originalPlace]]), [
      verifiedPlace,
    ]),
  );
});

test("assertCoordinateAuditFields allows closed/moved rows when status is Closed/Moved", () => {
  const originalPlace = makePlace({
    id: "one",
    latitude: 1,
    longitude: 2,
  });
  const closedPlace = makePlace({
    id: "one",
    latitude: 1,
    longitude: 2,
    samePlaceReason: "Google Places reports this business as closed.",
    verificationDecision: "closed_or_moved",
    verificationSource: "place_id",
    verifiedStatus: "Closed/Moved",
  });

  assert.doesNotThrow(() =>
    assertCoordinateAuditFields(new Map([[originalPlace.id, originalPlace]]), [
      closedPlace,
    ]),
  );
});

test("acceptCandidateCoordinates copies candidate coordinates into stored coordinates", () => {
  const result = acceptCandidateCoordinates(
    {
      latitude: 1.2854,
      longitude: 103.8272,
      lastChecked: "",
      verifiedLatitude: 1.285401,
      verifiedLongitude: 103.827201,
      verificationNotes: "Reviewed candidate.",
      verifiedStatus: "Review" as const,
    },
    new Date(2026, 4, 8),
  );

  assert.equal(result.latitude, 1.285401);
  assert.equal(result.longitude, 103.827201);
  assert.equal(result.verifiedStatus, "Yes");
  assert.equal(result.lastChecked, "2026-05-08");
  assert.match(
    result.verificationNotes ?? "",
    /candidate coordinates were accepted manually/,
  );
});

test("Google Maps URL resolve-style candidate metadata does not overwrite stored coordinates", () => {
  const place = makePlace({
    address: "Old address",
    googleMapsUrl: "https://maps.google.com/?cid=123",
    latitude: 25.032,
    longitude: 121.553,
  });
  const result = verifyPlaceFromCandidates(
    place,
    [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Existing Place" },
        formattedAddress: "Verified canonical address, Taipei City, Taiwan",
        googleMapsUri: "https://maps.google.com/?cid=456",
        id: "google-place-existing",
        location: {
          latitude: 25.033,
          longitude: 121.554,
        },
      },
    ],
    {
      applyAutoDecisions: false,
      candidateSource: "google_maps_url",
      today: new Date(2026, 4, 10),
    },
  );

  assert.equal(result.place.latitude, 25.032);
  assert.equal(result.place.longitude, 121.553);
  assert.equal(result.place.googlePlaceId, "google-place-existing");
  assert.equal(result.place.canonicalName, "Existing Place");
  assert.equal(
    result.place.canonicalAddress,
    "Verified canonical address, Taipei City, Taiwan",
  );
  assert.equal(result.place.verifiedLatitude, 25.033);
  assert.equal(result.place.verifiedLongitude, 121.554);
  assert.equal(result.place.verificationSource, "google_maps_url");
  assert.equal(result.place.lastChecked, "2026-05-10");
});

test("useCanonicalAddress copies canonical address only when explicitly requested", () => {
  const unchangedPlace = useCanonicalAddress({
    address: "Original address",
    canonicalAddress: "",
  });
  const updatedPlace = useCanonicalAddress({
    address: "Original address",
    canonicalAddress: "Canonical address",
  });

  assert.equal(unchangedPlace.address, "Original address");
  assert.equal(updatedPlace.address, "Canonical address");
});

test("verifyPlaceFromCandidates keeps unresolvable URL rows in Review with useful notes", () => {
  const place = makePlace({ googleMapsUrl: "https://maps.app.goo.gl/example" });
  const result = verifyPlaceFromCandidates(place, [], {
    candidateSource: "google_maps_url",
    today: new Date(2026, 4, 10),
  });

  assert.equal(result.place.verifiedStatus, "Review");
  assert.equal(result.place.verificationDecision, "no_candidate_found");
  assert.equal(result.place.samePlaceDecision, "Unsure");
  assert.match(
    result.place.verificationNotes ?? "",
    /found no candidate match/,
  );
});

test("admin Google Maps resolver expands maps.app.goo.gl short links", async () => {
  const calls: string[] = [];
  const mockFetch = (async (url: string | URL | Request) => {
    const requestUrl = String(url);
    calls.push(requestUrl);

    if (requestUrl.includes("maps.app.goo.gl")) {
      return {
        ok: true,
        url: "https://www.google.com/maps/place/Ironwood+Coffee/data=!4m2!3m1!1sChIJironwood123",
      } as Response;
    }

    assert.match(requestUrl, /places\/ChIJironwood123$/);

    return {
      json: async () => ({
        businessStatus: "OPERATIONAL",
        displayName: { text: "Ironwood Coffee" },
        formattedAddress: "No. 1 Coffee Street, Taipei City, Taiwan",
        googleMapsUri: "https://maps.google.com/?cid=ironwood",
        id: "ChIJironwood123",
        location: {
          latitude: 25.04,
          longitude: 121.56,
        },
      }),
      ok: true,
    } as Response;
  }) as typeof fetch;

  const result = await fetchCandidatesFromGoogleMapsUrl(
    makePlace({ name: "Ironwood coffee", city: "Taipei" }),
    "https://maps.app.goo.gl/asv6t8jzFG48E",
    "test-key",
    mockFetch,
    new GooglePlacesAccess({
      cachePath: join("/private/tmp", `places-cache-short-${Date.now()}.json`),
      confirmLiveApi: true,
      liveEnabled: true,
      maxApiCalls: 2,
    }),
  );

  assert.equal(result.source, "google_maps_url");
  assert.equal(result.placeIdFromUrl, "ChIJironwood123");
  assert.equal(result.candidates[0]?.location?.latitude, 25.04);
  assert.equal(calls.length, 2);
  assert.match(result.resolutionNotes.join("\n"), /expanded/);
});

test("admin Google Maps resolver falls back to Text Search when Place ID is absent", async () => {
  const textSearchBodies: string[] = [];
  const mockFetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const requestUrl = String(url);

    if (requestUrl.includes("maps.app.goo.gl")) {
      return {
        ok: true,
        url: "https://www.google.com/maps/search/?api=1&query=Ironwood+coffee",
      } as Response;
    }

    assert.equal(requestUrl, "https://places.googleapis.com/v1/places:searchText");
    textSearchBodies.push(String(init?.body ?? ""));

    return {
      json: async () => ({
        places: [
          {
            businessStatus: "OPERATIONAL",
            displayName: { text: "Ironwood Coffee" },
            formattedAddress: "No. 1 Coffee Street, Taipei City, Taiwan",
            googleMapsUri: "https://maps.google.com/?cid=ironwood",
            id: "text-search-ironwood",
            location: {
              latitude: 25.04,
              longitude: 121.56,
            },
          },
        ],
      }),
      ok: true,
    } as Response;
  }) as typeof fetch;

  const result = await fetchCandidatesFromGoogleMapsUrl(
    makePlace({
      address: "Old address",
      canonicalAddress: "Canonical address",
      city: "Taipei",
      name: "Ironwood coffee",
    }),
    "https://maps.app.goo.gl/asv6t8jzFG48E",
    "test-key",
    mockFetch,
    new GooglePlacesAccess({
      cachePath: join("/private/tmp", `places-cache-fallback-${Date.now()}.json`),
      confirmLiveApi: true,
      liveEnabled: true,
      maxApiCalls: 10,
    }),
  );

  assert.equal(result.source, "text_search");
  assert.equal(result.candidates[0]?.id, "text-search-ironwood");
  assert.match(result.resolutionNotes.join("\n"), /Place ID was not found/);
  assert.ok(
    textSearchBodies.some((body) => body.includes("Old address")) &&
      textSearchBodies.some((body) => body.includes("Canonical address")),
  );
});

test("admin resolver search attempts include saved and canonical addresses", () => {
  const attempts = getAdminResolverSearchAttempts(
    makePlace({
      address: "Saved address",
      canonicalAddress: "Canonical address",
      city: "Taipei",
      district: "Da'an",
      name: "Ironwood coffee",
    }),
  );

  assert.ok(
    attempts.includes("Ironwood coffee, Saved address, Taipei"),
  );
  assert.ok(
    attempts.includes("Ironwood coffee, Canonical address, Taipei"),
  );
  assert.ok(attempts.includes("Ironwood coffee, Taipei"));
});

test("admin resolver can summarize multiple Google candidates for UI selection", () => {
  const place = makePlace({
    address: "No. 1, Taipei",
    city: "Taipei",
    name: "Beckhome",
  });
  const summaries = summarizeAdminCandidates(place, {
    candidates: [
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Roasting House - Beckhome Roasting House" },
        formattedAddress: "No. 1, Songshan District, Taipei City, Taiwan",
        googleMapsUri: "https://maps.google.com/beckhome-roasting",
        id: "candidate-1",
        location: { latitude: 25.05, longitude: 121.55 },
      },
      {
        businessStatus: "OPERATIONAL",
        displayName: { text: "Beckhome" },
        formattedAddress: "No. 16, Da'an District, Taipei City, Taiwan",
        googleMapsUri: "https://maps.google.com/beckhome",
        id: "candidate-2",
        location: { latitude: 25.04, longitude: 121.54 },
      },
    ],
    resolutionNotes: [],
    source: "text_search",
    textSearchQueries: [],
  });

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0]?.candidateCoordinateSource, "google_places");
  assert.equal(summaries[0]?.coordinatePrecision, "place_pin");
  assert.equal(typeof summaries[0]?.matchConfidence, "number");
});

test("admin candidate selection populates metadata without moving stored coordinates", () => {
  const place = makePlace({
    latitude: 25.01,
    longitude: 121.51,
  });
  const selectedPlace = applyAdminSelectedCandidate(place, {
    addressScore: 0.7,
    businessStatus: "OPERATIONAL",
    canonicalAddress: "No. 16, Taipei City, Taiwan",
    canonicalName: "Beckhome",
    distanceDeltaMeters: 1400,
    googleMapsUrl: "https://maps.google.com/beckhome",
    googlePlaceId: "candidate-2",
    latitude: 25.04,
    longitude: 121.54,
    matchConfidence: 0.82,
    nameScore: 1,
    provider: "text_search",
  });

  assert.equal(selectedPlace.latitude, 25.01);
  assert.equal(selectedPlace.longitude, 121.51);
  assert.equal(selectedPlace.verifiedLatitude, 25.04);
  assert.equal(selectedPlace.verifiedLongitude, 121.54);
  assert.equal(selectedPlace.googlePlaceId, "candidate-2");
  assert.equal(selectedPlace.samePlaceDecision, "manually_selected");
  assert.equal(selectedPlace.verificationDecision, "manually_selected_candidate");
  assert.equal(selectedPlace.verifiedStatus, "Review");
});

test("accepting an admin-selected candidate is still required to move the pin", () => {
  const selectedPlace = applyAdminSelectedCandidate(
    makePlace({ latitude: 25.01, longitude: 121.51 }),
    {
      addressScore: 0.7,
      businessStatus: "OPERATIONAL",
      canonicalAddress: "No. 16, Taipei City, Taiwan",
      canonicalName: "Beckhome",
      distanceDeltaMeters: 1400,
      googleMapsUrl: "https://maps.google.com/beckhome",
      googlePlaceId: "candidate-2",
      latitude: 25.04,
      longitude: 121.54,
      matchConfidence: 0.82,
      nameScore: 1,
      provider: "text_search",
    },
  );
  const acceptedPlace = acceptCandidateCoordinates(selectedPlace, new Date(2026, 4, 10));

  assert.equal(acceptedPlace.latitude, 25.04);
  assert.equal(acceptedPlace.longitude, 121.54);
  assert.equal(acceptedPlace.verifiedStatus, "Yes");
  assert.equal(acceptedPlace.verificationDecision, "manually_verified");
});

test("Google Places access blocks live calls without confirm flag", async () => {
  const access = new GooglePlacesAccess({
    cachePath: join("/private/tmp", `places-cache-no-confirm-${Date.now()}.json`),
    liveEnabled: true,
    maxApiCalls: 1,
  });
  let called = false;

  await assert.rejects(
    access.fetchJson("textSearch", "missing", "textSearch", async () => {
      called = true;
      return { places: [] };
    }),
    GooglePlacesLiveCallBlockedError,
  );
  assert.equal(called, false);
  assert.equal(access.counters.blockedByMissingConfirm, 1);
});

test("Google Places access enforces max-api-calls", async () => {
  const access = new GooglePlacesAccess({
    cachePath: join("/private/tmp", `places-cache-cap-${Date.now()}.json`),
    confirmLiveApi: true,
    liveEnabled: true,
    maxApiCalls: 1,
  });

  await access.fetchJson("textSearch", "first", "textSearch", async () => ({
    places: [],
  }));
  await assert.rejects(
    access.fetchJson("textSearch", "second", "textSearch", async () => ({
      places: [],
    })),
    /max API call cap/,
  );
  assert.equal(access.getLiveCallCount(), 1);
  assert.equal(access.counters.blockedByMaxApiCalls, 1);
});

test("Google Places cache-only mode never calls Google", async () => {
  const access = new GooglePlacesAccess({
    cacheOnly: true,
    cachePath: join("/private/tmp", `places-cache-only-${Date.now()}.json`),
    confirmLiveApi: true,
    liveEnabled: true,
    maxApiCalls: 1,
  });
  let called = false;

  await assert.rejects(
    access.fetchJson("placeDetails", "missing", "placeDetails", async () => {
      called = true;
      return { id: "place-1" };
    }),
    GooglePlacesLiveCallBlockedError,
  );
  assert.equal(called, false);
  assert.equal(access.getLiveCallCount(), 0);
});

test("Google Places cache hits avoid live calls", async () => {
  const cachePath = join("/private/tmp", `places-cache-hit-${Date.now()}.json`);
  const cacheKey = getTextSearchCacheKey({
    city: "Taipei",
    fieldMask: "places.id",
    query: "Ironwood coffee Taipei",
  });
  writeGooglePlacesCache(
    {
      placeDetails: {},
      textSearch: {
        [cacheKey]: { places: [{ id: "cached-place" }] },
      },
      urlExpansions: {},
      urlPlaceIds: {},
    },
    cachePath,
  );
  const access = new GooglePlacesAccess({
    cachePath,
    liveEnabled: false,
  });
  const result = await access.fetchJson<{ places: Array<{ id: string }> }>(
    "textSearch",
    cacheKey,
    "textSearch",
    async () => {
      throw new Error("should not call live fetcher");
    },
  );

  assert.equal(result.places[0]?.id, "cached-place");
  assert.equal(access.counters.cacheHits, 1);
  assert.equal(access.getLiveCallCount(), 0);
});

test("admin resolver respects per-request max call cap", async () => {
  const access = new GooglePlacesAccess({
    cachePath: join("/private/tmp", `places-cache-admin-cap-${Date.now()}.json`),
    confirmLiveApi: true,
    liveEnabled: true,
    maxApiCalls: 1,
  });
  const mockFetch = (async (url: string | URL | Request) => {
    const requestUrl = String(url);

    if (requestUrl.includes("maps.app.goo.gl")) {
      return {
        ok: true,
        url: "https://www.google.com/maps/place/Test/data=!4m2!3m1!1sChIJadmincap",
      } as Response;
    }

    return {
      json: async () => ({ id: "ChIJadmincap" }),
      ok: true,
    } as Response;
  }) as typeof fetch;

  await assert.rejects(
    fetchCandidatesFromGoogleMapsUrl(
      makePlace({ city: "Taipei", name: "Ironwood coffee" }),
      "https://maps.app.goo.gl/example",
      "test-key",
      mockFetch,
      access,
    ),
    /max API call cap/,
  );
  assert.equal(access.counters.urlExpansionAttempts, 1);
  assert.equal(access.counters.blockedByMaxApiCalls, 1);
});

test("admin resolver does not call Google when live usage is disabled", async () => {
  const access = new GooglePlacesAccess({
    cachePath: join("/private/tmp", `places-cache-disabled-${Date.now()}.json`),
    confirmLiveApi: true,
    liveEnabled: false,
    maxApiCalls: 5,
  });
  let called = false;

  const result = await fetchCandidatesFromGoogleMapsUrl(
    makePlace({ city: "Taipei", name: "Ironwood coffee" }),
    "https://maps.app.goo.gl/example",
    "test-key",
    (async () => {
      called = true;
      return { ok: true, url: "https://maps.google.com" } as Response;
    }) as typeof fetch,
    access,
  );
  assert.equal(called, false);
  assert.equal(result.candidates.length, 0);
  assert.equal(access.getLiveCallCount(), 0);
  assert.equal(access.counters.blockedByLiveDisabled > 0, true);
});

test("Google Places wildcard field masks are blocked", () => {
  assert.throws(() => assertNarrowFieldMask("*"), /Wildcard/);
  assert.doesNotThrow(() => assertNarrowFieldMask("places.id,places.location"));
});

test("free geocoding live lookup is disabled by default", async () => {
  const access = new FreeGeocodingAccess({
    cachePath: join("/private/tmp", `free-geocode-disabled-${Date.now()}.json`),
  });
  let called = false;
  const result = await access.searchOsm(
    "Ironwood coffee Taipei",
    (async () => {
      called = true;
      return { ok: true, json: async () => [] } as Response;
    }) as typeof fetch,
  );

  assert.equal(result, null);
  assert.equal(called, false);
  assert.equal(access.counters.blockedByLiveDisabled, 1);
});

test("free geocoding caches live results when explicitly enabled", async () => {
  const cachePath = join("/private/tmp", `free-geocode-cache-${Date.now()}.json`);
  const access = new FreeGeocodingAccess({
    cachePath,
    liveEnabled: true,
    minIntervalMs: 0,
  });
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return {
      json: async () => [
        {
          display_name: "Ironwood Coffee, Taipei City, Taiwan",
          importance: 0.7,
          lat: "25.04",
          lon: "121.56",
          type: "cafe",
        },
      ],
      ok: true,
    } as Response;
  }) as typeof fetch;

  const firstResult = await access.searchOsm("Ironwood coffee Taipei", fetcher);
  const secondAccess = new FreeGeocodingAccess({ cachePath });
  const secondResult = await secondAccess.searchOsm(
    "Ironwood coffee Taipei",
    fetcher,
  );

  assert.equal(calls, 1);
  assert.equal(firstResult?.[0]?.latitude, 25.04);
  assert.equal(secondResult?.[0]?.longitude, 121.56);
  assert.equal(secondAccess.counters.cacheHits, 1);
});

test("city-wide live Google Places runs are blocked without force", () => {
  assert.throws(
    () =>
      assertBroadLiveRunAllowed({
        confirmLiveApi: true,
        force: false,
        maxApiCalls: 100,
        rowCount: 26,
      }),
    /require --force/,
  );
  assert.doesNotThrow(() =>
    assertBroadLiveRunAllowed({
      confirmLiveApi: true,
      force: true,
      maxApiCalls: 100,
      rowCount: 26,
    }),
  );
});

test("city audit report counts verification readiness without live calls", () => {
  const report = getCityAuditReport([
    makePlace({
      name: "Verified",
      verifiedStatus: "Yes",
      googlePlaceId: "ChIJverified",
      verifiedLatitude: 25.1,
      verifiedLongitude: 121.5,
    }),
    makePlace({
      id: "review-place",
      name: "Review",
      verifiedStatus: "Review",
      canonicalName: "Review Candidate",
      googleMapsUrl: "https://maps.google.com/?cid=123",
    }),
    makePlace({
      id: "unverified-place",
      name: "Unverified",
      verifiedStatus: "No",
      address: "1 Test Street",
    }),
  ]);

  assert.equal(report.totalRows, 3);
  assert.equal(report.verifiedRows, 1);
  assert.equal(report.reviewRows, 1);
  assert.equal(report.unverifiedRows, 1);
  assert.equal(report.rowsWithGooglePlaceId, 1);
  assert.equal(report.rowsWithGoogleMapsUrl, 1);
  assert.equal(report.rowsWithCachedCandidateMetadata, 2);
  assert.equal(report.rowsWithNoCandidateMetadata, 1);
  assert.equal(report.eligibleForCacheOnlyVerification, 1);
  assert.equal(report.eligibleForFreeGeocodingAttempt, 1);
  assert.equal(report.rowsThatWouldRequireGoogleLiveLookup, 1);
  assert.equal(report.estimatedMaxGoogleCallsIfLiveEnabled > 0, true);
});

test("verify CLI cache-only and free-only modes keep Google cache-only", () => {
  assert.equal(
    shouldUseGoogleCacheOnly(parseArgs(["--dry-run", "--cache-only", "--city", "Tokyo"])),
    true,
  );
  assert.equal(
    shouldUseGoogleCacheOnly(parseArgs(["--dry-run", "--free-only", "--city", "Tokyo"])),
    true,
  );
});

test("verify CLI only-review limits rows processed", () => {
  const places = [
    makePlace({ id: "verified", name: "Verified", city: "Tokyo", verifiedStatus: "Yes" }),
    makePlace({ id: "review", name: "Review", city: "Tokyo", verifiedStatus: "Review" }),
    makePlace({ id: "unverified", name: "Unverified", city: "Tokyo", verifiedStatus: "No" }),
  ];
  const selected = selectPlacesForAudit(
    places,
    parseArgs(["--city", "Tokyo", "--only-review"]),
  );

  assert.deepEqual(
    selected.map((place) => place.id),
    ["review"],
  );
});

test("verify CLI only-unverified limits rows processed", () => {
  const places = [
    makePlace({ id: "verified", name: "Verified", city: "Tokyo", verifiedStatus: "Yes" }),
    makePlace({ id: "review", name: "Review", city: "Tokyo", verifiedStatus: "Review" }),
    makePlace({ id: "unverified", name: "Unverified", city: "Tokyo", verifiedStatus: "No" }),
  ];
  const selected = selectPlacesForAudit(
    places,
    parseArgs(["--city", "Tokyo", "--only-unverified"]),
  );

  assert.deepEqual(
    selected.map((place) => place.id),
    ["unverified"],
  );
});

test("verify CLI names-file limits rows processed", async () => {
  const namesPath = join("/private/tmp", `selected-google-lookups-${Date.now()}.txt`);
  writeFileSync(namesPath, "Selected One\n# ignored\nSelected Two\n");
  const options = parseArgs(["--city", "Tokyo", "--names-file", namesPath]);
  const names = await readSelectedNames(options);
  const selected = selectPlacesForAudit(
    [
      makePlace({ id: "one", name: "Selected One", city: "Tokyo" }),
      makePlace({ id: "two", name: "Selected Two", city: "Tokyo" }),
      makePlace({ id: "three", name: "Not Selected", city: "Tokyo" }),
    ],
    options,
    names,
  );

  assert.deepEqual(
    selected.map((place) => place.id),
    ["one", "two"],
  );
});

test("verify CLI report-only and no-write never write", () => {
  assert.equal(
    shouldWriteCandidateOutput(parseArgs(["--write-candidates", "--report-only"])),
    false,
  );
  assert.equal(
    shouldWriteCandidateOutput(parseArgs(["--write-candidates", "--no-write"])),
    false,
  );
  assert.equal(
    shouldWriteCandidateOutput(parseArgs(["--write-candidates", "--dry-run"])),
    false,
  );
});

test("verify CLI write mode only changes selected rows", () => {
  const options = parseArgs([
    "--write-candidates",
    "--city",
    "Tokyo",
    "--name",
    "Selected",
  ]);
  const selected = selectPlacesForAudit(
    [
      makePlace({ id: "selected", name: "Selected", city: "Tokyo" }),
      makePlace({ id: "other", name: "Other", city: "Tokyo" }),
    ],
    options,
    new Set(["Selected"]),
  );

  assert.equal(shouldWriteCandidateOutput(options), true);
  assert.deepEqual(
    selected.map((place) => place.id),
    ["selected"],
  );
});

test("public map details lookup is disabled by default to avoid paid Places calls", () => {
  assert.equal(publicPlaceDetailsLookupEnabled, false);
});

test("admin provider attempts are summarized for the main QA view", () => {
  assert.equal(formatProviderAttemptSummary([]), "No provider attempts yet.");
  assert.equal(
    formatProviderAttemptSummary([
      {
        detail: "No cached candidate was found.",
        provider: "cache",
        status: "miss",
      },
      {
        detail: "Google live lookup is disabled.",
        provider: "google_places",
        status: "blocked",
      },
    ]),
    "cache: miss. google_places: blocked",
  );
});

test("admin place pipeline renders the active ingest controls", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/admin-workflow.tsx"),
    "utf8",
  );

  assert.match(source, /Admin \/ Place Pipeline/);
  assert.match(source, /screenshotIntakePanel/);
  assert.match(source, /googleSheetsPipelinePanel/);
  assert.match(source, /Extract Places/);
  assert.match(source, /Coming back after a break/);
  assert.match(source, /intakeStatus = New/);
  assert.match(source, /intakeStatus = Ready/);
  assert.match(source, /intakeStatus = Enriched/);
  assert.match(source, /reviewStatus = Candidate/);
  assert.match(source, /reviewStatus = Verified/);
  assert.match(source, /verifiedStatus = Verified/);
  assert.match(source, /Process Ready Rows/);
  assert.match(source, /Publish Verified Reviews/);
  assert.match(source, /Update Travel Map/);
});

test("admin pipeline requires confirmations for paid and mutating actions", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/admin-workflow.tsx"),
    "utf8",
  );

  assert.match(source, /This will call Google Places for up to/);
  assert.match(source, /Apply the previewed changes to the travel map/);
  assert.match(source, /Preview Publish/);
  assert.match(source, /Apply Publish/);
  assert.match(source, /Preview Update/);
  assert.match(source, /Apply Update/);
  assert.match(source, /confirmLiveApi: true/);
  assert.match(source, /confirmWrite: write/);
});
