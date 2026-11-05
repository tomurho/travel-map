import assert from "node:assert/strict";
import test from "node:test";
import { lookupCataloguePlaces } from "@/lib/catalogue-lookup";
import { catalogueLookupInput } from "@/lib/catalogue-lookup-input";
import { createCatalogueEntry } from "@/lib/catalogue";
import { extractGooglePlaceIdFromUrl } from "@/lib/google-place-admin-resolver";

const mapsUrl = "https://www.google.com/maps/search/?api=1&query_place_id=ChILinkedVenue";
const googlePlace = {
  id: "ChILinkedVenue",
  displayName: { text: "Linked Cafe" },
  formattedAddress: "1 Linked Street, Kyoto",
  location: { latitude: 35, longitude: 135 },
  googleMapsUri: mapsUrl,
};

test("saved and supplied Maps links take priority over a different search name and city", async () => {
  for (const options of [{}, { mapsUrl }]) {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push(String(url));
      assert.equal(init?.method, "GET");
      assert.equal(init?.body, undefined);
      return Response.json(googlePlace);
    };
    const results = await lookupCataloguePlaces(
      { name: "Wrong Cafe", city: "Tokyo", mapsUrl },
      { ...options, query: "Another Cafe", apiKey: "fixture", fetcher },
    );
    assert.deepEqual(calls, ["https://places.googleapis.com/v1/places/ChILinkedVenue"]);
    assert.equal(results[0].googlePlaceId, googlePlace.id);
  }
});

test("short Maps links resolve their venue before any name search", async () => {
  const shortUrl = "https://maps.app.goo.gl/fixture";
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target === shortUrl)
      return new Response(null, { status: 302, headers: { location: mapsUrl } });
    if (target === mapsUrl) {
      const response = new Response("");
      Object.defineProperty(response, "url", { value: mapsUrl });
      return response;
    }
    return Response.json(googlePlace);
  };
  const results = await lookupCataloguePlaces(
    { name: "Wrong Cafe", city: "Tokyo" },
    { mapsUrl: shortUrl, apiKey: "fixture", fetcher },
  );
  assert.equal(results[0].googlePlaceId, googlePlace.id);
  assert.deepEqual(calls, [shortUrl, mapsUrl, "https://places.googleapis.com/v1/places/ChILinkedVenue"]);
});

test("text search includes the selected city when no link is supplied or a saved link is cleared", async () => {
  for (const input of [
    { name: "Original Cafe", city: "Kyoto" },
    { name: "Original Cafe", city: "Kyoto", mapsUrl },
  ]) {
    const fetcher: typeof fetch = async (url, init) => {
      assert.equal(String(url), "https://places.googleapis.com/v1/places:searchText");
      assert.equal(JSON.parse(String(init?.body)).textQuery, "Updated Cafe, Kyoto");
      return Response.json({ places: [googlePlace] });
    };
    await lookupCataloguePlaces(input, { mapsUrl: "", query: "Updated Cafe", apiKey: "fixture", fetcher });
  }
});

test("an unresolved Maps link reports an error without falling back to the place name", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url) => {
    calls.push(String(url));
    return new Response("No venue identifier");
  };
  await assert.rejects(
    lookupCataloguePlaces({ name: "Cafe", city: "Kyoto" }, { mapsUrl: "https://maps.app.goo.gl/unresolved", apiKey: "fixture", fetcher }),
    /clear it to search by name and city/,
  );
  assert.deepEqual(calls, ["https://maps.app.goo.gl/unresolved"]);
});

test("lookup defaults prefer a supplied link, then the saved link, then the current place link", () => {
  const entry = createCatalogueEntry({ name: "Original", city: "Kyoto", mapsUrl });
  entry.draft = {
    name: "Updated", city: "Osaka", googleMapsUrl: "https://maps.google.com/?q=updated",
  } as NonNullable<typeof entry.draft>;
  assert.deepEqual(catalogueLookupInput(entry), { query: "Updated", city: "Osaka", mapsUrl });
  assert.equal(catalogueLookupInput(entry, { mapsUrl: "https://maps.app.goo.gl/new" }).mapsUrl, "https://maps.app.goo.gl/new");
  assert.equal(catalogueLookupInput(entry, { mapsUrl: "" }).mapsUrl, "");
  delete entry.input.mapsUrl;
  assert.equal(catalogueLookupInput(entry).mapsUrl, entry.draft.googleMapsUrl);
  entry.input.mapsUrl = "";
  assert.equal(catalogueLookupInput(entry).mapsUrl, "");
});

test("Maps response HTML with literal percentages and incomplete escapes still resolves the linked venue", async () => {
  const shortUrl = "https://maps.app.goo.gl/percent-fixture";
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === shortUrl)
      return new Response('<style>.panel { width: 100%; }</style><script>"%211sChILinkedVenue", "%E6%88", "%zz"</script>');
    return Response.json(googlePlace);
  };
  const results = await lookupCataloguePlaces({ name: "Cafe", city: "Taipei" }, { mapsUrl: shortUrl, apiKey: "fixture", fetcher });
  assert.equal(results[0].googlePlaceId, googlePlace.id);
  assert.deepEqual(calls, [shortUrl, "https://places.googleapis.com/v1/places/ChILinkedVenue"]);
});

test("Maps identifier extraction tolerates malformed escapes without inventing a venue", () => {
  assert.equal(extractGooglePlaceIdFromUrl('<style>width:100%</style>%E6%88%zz'), null);
  assert.equal(extractGooglePlaceIdFromUrl('https://www.google.com/maps/place/100%25%zz/data=%211sChILinkedVenue'), "ChILinkedVenue");
  assert.equal(extractGooglePlaceIdFromUrl('%E6%88%90%E8%94%B5%211sChILinkedVenue'), "ChILinkedVenue");
});

test("numeric-ID Maps links use the linked name and location, then accept only the identical venue ID", async () => {
  const shortUrl = "https://maps.app.goo.gl/numeric-id";
  const expanded = "https://www.google.com/maps/place/%E6%88%90%E8%94%B5/@25.0407,121.5423,17z/data=!1s0x3442abfdb1ac3b8b:0x9d22c31f56d3505c!3d25.0407174!4d121.5449077";
  const cid = BigInt("0x9d22c31f56d3505c").toString();
  for (const matching of [true, false]) {
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url) === shortUrl) {
        const response = new Response("100% width");
        Object.defineProperty(response, "url", { value: expanded });
        return response;
      }
      assert.equal(String(url), "https://places.googleapis.com/v1/places:searchText");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.textQuery, "成蔵");
      assert.deepEqual(body.locationBias, { circle: { center: { latitude: 25.0407174, longitude: 121.5449077 }, radius: 200 } });
      return Response.json({ places: [
        { ...googlePlace, id: "ChIWrongVenue", googleMapsUri: "https://maps.google.com/?cid=123" },
        ...(matching ? [{ ...googlePlace, googleMapsUri: `https://maps.google.com/?cid=${cid}` }] : []),
      ] });
    };
    const lookup = lookupCataloguePlaces({ name: "Wrong user name", city: "Wrong city" }, { mapsUrl: shortUrl, apiKey: "fixture", fetcher });
    if (matching) {
      const results = await lookup;
      assert.equal(results.length, 1);
      assert.equal(results[0].googlePlaceId, googlePlace.id);
    } else {
      await assert.rejects(lookup, /could not confirm the exact venue/);
    }
  }
});

test("Google address components prefill a district or area without using the city, street, or county", async () => {
  const cases = [
    { city: "Taipei City", components: [
      { longText: "Ren'ai Road", types: ["route"] },
      { longText: "Da’an District", types: ["administrative_area_level_2", "political"] },
      { longText: "Taipei City", types: ["administrative_area_level_1", "political"] },
    ], expected: "Da’an" },
    { city: "Kyoto", components: [
      { longText: "A smaller neighbourhood", types: ["neighborhood"] },
      { longText: "Nakagyo Ward", types: ["sublocality_level_1", "political"] },
      { longText: "Kyoto", types: ["locality"] },
    ], expected: "Nakagyo Ward" },
    { city: "New York", components: [
      { longText: "SoHo", types: ["neighborhood", "political"] },
      { longText: "New York", types: ["locality", "political"] },
    ], expected: "SoHo" },
    { city: "Ho Chi Minh", components: [
      { longText: "District 1", types: ["administrative_area_level_2", "political"] },
    ], expected: "District 1" },
    { city: "Kyoto", components: [
      { shortText: "Kamigyo Ward", types: ["sublocality_level_1", "political"] },
    ], expected: "Kamigyo Ward" },
    { city: "Springfield", components: [
      { longText: "Springfield", types: ["administrative_area_level_3", "political"] },
      { longText: "Greene County", types: ["administrative_area_level_2", "political"] },
      { longText: "Main Street", types: ["route"] },
    ], expected: "" },
    { city: "Kyoto", components: [], expected: "" },
  ];
  for (const { city, components, expected } of cases) {
    for (const withLink of [true, false]) {
      const fetcher: typeof fetch = async (_url, init) => {
        const mask = new Headers(init?.headers).get("X-Goog-FieldMask") ?? "";
        assert.ok(mask.split(",").includes(withLink ? "addressComponents" : "places.addressComponents"));
        const place = { ...googlePlace, addressComponents: components };
        return Response.json(withLink ? place : { places: [place] });
      };
      const results = await lookupCataloguePlaces({ name: "Fixture Cafe", city }, { mapsUrl: withLink ? mapsUrl : "", apiKey: "fixture", fetcher });
      assert.equal(results[0].district, expected);
    }
  }
});
