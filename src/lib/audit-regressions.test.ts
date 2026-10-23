import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAdminAuthorized, isAdminEnabled } from "@/lib/admin-auth";
import { getCatalogWarnings } from "@/lib/catalog-quality";
import { getPlaceRecordVersion } from "@/lib/place-record-version";
import { deleteProductionPlace, getStagedRecordVersion, getStagingVersion, planStagedPlace, publishStagedPlaces, updateProductionPlaceVerification, type AdminStagedPlaceInput } from "@/lib/admin-staging";
import { PlacesJsonWriteConflictError, readPlacesJsonSnapshot, writePlacesJsonAtomic } from "@/lib/places-json-store";
import retiredPlaceIds from "@/data/place-id-aliases.json";
import catalog from "@/data/places.json";
import { buildPublishedSyncPlan } from "@/lib/place-sheet-pipeline";
import { getPublicNotes, type Place } from "@/lib/place";
import { mergePublishedPlace } from "@/lib/published-place-merge";

const original: Place = { id: "one", name: "Cafe", city: "Tokyo", category: "Cafe", status: "been", loved: true, district: "", address: "1 Street", latitude: 35, longitude: 139, googleMapsUrl: "https://maps.google.com/?q=cafe", tabelog: "", subway: "" };
const draft: AdminStagedPlaceInput = { name: "Draft", city: "Tokyo", category: "Cafe", draftStatus: "location", area: "", address: "", latitude: null, longitude: null, tabelog: "", subway: "", googleMapsUrl: "", verifiedStatus: "Review", lastChecked: "", verificationNotes: "", sourceLabel: "Manual", notes: [] };

test("production admin pages and APIs share the enablement rule even with a correct password", () => {
  const request = { headers: new Headers({ "x-admin-password": "secret" }) };
  for (const enableAdmin of [undefined, "false", "true"]) {
    const environment = { nodeEnv: "production", adminPassword: "secret", enableAdmin };
    assert.equal(isAdminEnabled(environment), enableAdmin === "true");
    assert.equal(isAdminAuthorized(request, environment), enableAdmin === "true");
  }
  assert.equal(isAdminAuthorized({ headers: new Headers() }, { nodeEnv: "development" }), true);
  assert.equal(isAdminAuthorized(request, { nodeEnv: "production", enableAdmin: "true" }), false);
});

test("catalog warnings identify repeated identities and distant pins without changing records", () => {
  const catalog = [original, { ...original, id: "two", googlePlaceId: "same" }, { ...original, id: "three" }];
  const duplicate = { ...original, googlePlaceId: "same" };
  assert.match(getCatalogWarnings(duplicate, catalog).join(" "), /Same Google Place ID.*two/);
  const distant = { ...original, id: "far", latitude: 36 };
  assert.match(getCatalogWarnings(distant, catalog).join(" "), /km from the center/);
  assert.deepEqual(getCatalogWarnings(original, catalog), []);
  assert.deepEqual(getCatalogWarnings({ ...distant, latitude: null }, catalog), []);
});

test("legacy staged edits require the viewed version and retries preserve draft identity", () => {
  const first = planStagedPlace(draft, []);
  assert.equal(planStagedPlace(draft, first.places).place.id, first.place.id);
  assert.throws(() => planStagedPlace({ ...draft, id: first.place.id }, first.places), PlacesJsonWriteConflictError);
  const updated = planStagedPlace({ ...draft, id: first.place.id, expectedRecordVersion: getStagedRecordVersion(first.place), address: "New" }, first.places);
  assert.equal(updated.place.address, "New");
  assert.notEqual(getStagingVersion(updated.places), getStagingVersion(first.places));
});

test("retained verification and deletion cannot overwrite a newer displayed record", () => {
  let writes = 0;
  const io = { readPlacesJsonSnapshot: () => ({ places: [original], raw: "[]", fileHash: "current", filePath: "memory" }), writePlacesJsonAtomic: () => { writes++; return { filePath: "memory", fileHash: "next", backupPath: null }; } };
  const stale = updateProductionPlaceVerification(original.id, { expectedRecordVersion: "old", latitude: 35, longitude: 139, googleMapsUrl: original.googleMapsUrl!, verifiedStatus: "Yes", lastChecked: "2026-10-23", verificationNotes: "Checked" }, io);
  assert.equal(stale.status, 409);
  assert.equal(deleteProductionPlace(original.id, "old", io).status, 409);
  assert.equal(writes, 0);
  assert.ok(deleteProductionPlace(original.id, getPlaceRecordVersion(original), io).place);
  assert.equal(writes, 1);
});

test("atomic staging writes retain incomplete coordinates, backups, and concurrent writer checks", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-staging-"));
  const filePath = join(directory, "drafts.json");
  const validate = (records: unknown) => { assert.ok(Array.isArray(records)); };
  try {
    const initial = readPlacesJsonSnapshot(filePath, { allowMissing: true, validate });
    const incomplete = { ...original, latitude: null, longitude: null } as unknown as Place;
    const first = writePlacesJsonAtomic([incomplete], { filePath, expectedFileHash: initial.fileHash, validate, backupDirectory: directory });
    const second = writePlacesJsonAtomic([], { filePath, expectedFileHash: first.fileHash, validate, backupDirectory: directory });
    assert.ok(second.backupPath);
    assert.equal(JSON.parse(readFileSync(second.backupPath!, "utf8"))[0].latitude, null);
    assert.throws(() => writePlacesJsonAtomic([incomplete], { filePath, expectedFileHash: first.fileHash, validate }), PlacesJsonWriteConflictError);
    assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test("staged Publish reports committed data separately when newer drafts prevent cleanup", () => {
  const staged = planStagedPlace({ ...draft, latitude: 35, longitude: 139 }, []).places;
  let published = false;
  const result = publishStagedPlaces({ expectedStagingVersion: getStagingVersion(staged) }, {
    readStagedPlaces: () => staged,
    readPlacesJsonSnapshot: () => ({ places: [], raw: "[]", fileHash: "current", filePath: "memory" }),
    writePlacesJsonAtomic: () => { published = true; return { filePath: "memory", fileHash: "next", backupPath: null }; },
    clearStagedPlaces: () => { throw new PlacesJsonWriteConflictError("New draft arrived"); },
  });
  assert.equal(published, true);
  assert.equal(result.publishedCount, 1);
  assert.equal(result.stagingCleanupPending, true);
  assert.match(result.error!, /No staged drafts were removed.*Do not retry publication/);
});


test("approved merges retain canonical records and old Sheet IDs cannot restore duplicate cards", () => {
  const places = catalog as Place[];
  assert.equal(places.length, 705);
  for (const [retiredId, retainedId] of Object.entries(retiredPlaceIds)) {
    assert.equal(places.some((place) => place.id === retiredId), false);
    const retained = places.find((place) => place.id === retainedId)!;
    assert.ok(retained);
    const headers = ["id", "name", "category", "area", "city", "address", "latitude", "longitude", "googleMapsUrl", "googlePlaceId", "status", "loved", "notes", "verifiedStatus", "lastChecked"];
    const fields = { ...retained, id: retiredId, area: retained.district, notes: "", verifiedStatus: "Yes", loved: retained.loved === null ? "" : String(retained.loved) };
    const row = headers.map((key) => String(fields[key as keyof typeof fields] ?? ""));
    const plan = buildPublishedSyncPlan({ currentPlaces: [retained], publishedHeaders: headers, publishedValues: [headers, row] });
    assert.equal(plan.inserted, 0);
    assert.match(plan.validationErrors[0].errors.join(" "), new RegExp(`merged into ${retainedId}`));
  }
  const dayTrip = places.find((place) => place.id === "place_taipei_anan_sushi")!;
  assert.equal(dayTrip.city, "Taipei");
  assert.ok(Array.isArray(dayTrip.notes) && dayTrip.notes.includes("Day trip from Taipei: Zhubei, Hsinchu."));
});


test("the approved day-trip label survives Sheet-owned notes being replaced", () => {
  const dayTrip = (catalog as Place[]).find((place) => place.id === "place_taipei_anan_sushi")!;
  const result = mergePublishedPlace(dayTrip, { ...dayTrip, notes: [] });
  assert.equal(result.kind, "merged");
  if (result.kind !== "merged") return;
  assert.deepEqual(result.place.notes, []);
  assert.ok(getPublicNotes(result.place).includes("Day trip from Taipei: Zhubei, Hsinchu."));
  assert.equal(getPublicNotes(dayTrip).filter((note) => note === "Day trip from Taipei: Zhubei, Hsinchu.").length, 1);
});
