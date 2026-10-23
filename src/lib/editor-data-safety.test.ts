import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import data from "@/data/places.json";
import type { Place } from "@/lib/place";
import { getEditorialState, getStoredEditorialStatus } from "@/lib/field-guide-editor-state";
import { getPlaceRecordVersion } from "@/lib/place-record-version";
import { PlacesJsonWriteConflictError, validatePlacesDataset, type PlacesJsonSnapshot } from "@/lib/places-json-store";
import {
  buildProductionPlaceFloatingEdit, getProductionPlaceVerificationInputErrors,
  getStagedPlaceInputErrors, planStagedPlace, publishStagedPlaces, updateProductionPlaceFloatingEdit,
  updateProductionPlaceVerification, stagedPlaceToPlace, type AdminFloatingPlaceEditInput,
  type AdminStagedPlaceInput,
} from "@/lib/admin-staging";

function makePlace(overrides: Partial<Place> = {}): Place {
  return { id: "editor-safety-fixture", name: "Cafe One", city: "Tokyo", category: "Café", status: "been", loved: null, district: "Center", address: "1 Street", latitude: 35, longitude: 139, tabelog: "3.5", subway: "Station", googleMapsUrl: "https://maps.google.com/?q=one", notes: ["Keep this note"], ...overrides };
}

function memoryStore(initial: Place[]) {
  let places = initial;
  let writes = 0;
  return {
    io: {
      readPlacesJsonSnapshot: (): PlacesJsonSnapshot => ({ places, raw: JSON.stringify(places), fileHash: "memory-version", filePath: "memory" }),
      writePlacesJsonAtomic: (next: Place[], options?: { expectedFileHash?: string }) => {
        assert.equal(options?.expectedFileHash, "memory-version");
        places = next;
        writes += 1;
        return { backupPath: null, fileHash: "next-memory-version", filePath: "memory" };
      },
    },
    get places() { return places; },
    get writes() { return writes; },
  };
}

test("category-only editing preserves all original Loved values until status changes", () => {
  for (const loved of [null, false, true]) {
    const original = makePlace({ loved });
    assert.deepEqual(getStoredEditorialStatus(getEditorialState(original), original, false), { status: "been", loved });
  }
  assert.deepEqual(getStoredEditorialStatus("been", makePlace(), true), { status: "been", loved: false });
  assert.deepEqual(getStoredEditorialStatus("want_to_go", makePlace({ loved: true }), true), { status: "want_to_go", loved: null });
});

test("local saves reject stale records and publish a fresh version after successful edits", () => {
  const original = makePlace();
  const store = memoryStore([original]);
  const input: AdminFloatingPlaceEditInput = { editMode: "field-guide-inline", expectedRecordVersion: getPlaceRecordVersion(original), category: "Café", status: "been", loved: true };
  const saved = updateProductionPlaceFloatingEdit(original.id, input, store.io);
  assert.ok(saved.place);
  assert.equal(store.writes, 1);
  assert.equal(saved.place.recordVersion, getPlaceRecordVersion(store.places[0]));
  assert.notEqual(saved.place.recordVersion, input.expectedRecordVersion);
  assert.equal(store.places[0].tabelog, original.tabelog);
  assert.equal(store.places[0].subway, original.subway);
  const stale = updateProductionPlaceFloatingEdit(original.id, input, store.io);
  assert.ok("error" in stale);
  assert.equal(stale.status, 409);
  assert.equal(store.writes, 1);
  assert.equal(store.places[0].loved, true);
});

test("inline editors cannot write hidden fields and floating inspector keeps its intended fields", () => {
  const original = makePlace();
  const stamp = getPlaceRecordVersion(original);
  const inline = { editMode: "field-guide-inline", expectedRecordVersion: stamp, category: "Café", status: "been", loved: null } as const;
  const rejected = buildProductionPlaceFloatingEdit(original, { ...inline, name: "Stale name" } as AdminFloatingPlaceEditInput, ["Café"]);
  assert.ok(rejected.error);
  assert.match(rejected.error, /only category and status/);
  const floating = buildProductionPlaceFloatingEdit(original, { ...inline, editMode: "floating-inspector", name: "New name", district: "New area", category: "New category" }, ["Café"]);
  assert.ok(floating.place);
  assert.equal(floating.place.name, "New name");
  assert.equal(floating.place.district, "New area");
  assert.equal(floating.place.category, "New category");
  assert.equal(floating.place.address, original.address);
  const changed = { ...original, verificationNotes: "New server evidence" };
  const stale = buildProductionPlaceFloatingEdit(changed, inline, ["Café"]);
  assert.ok("error" in stale);
  assert.equal(stale.status, 409);
  const missingVersion = buildProductionPlaceFloatingEdit(original, { ...inline, expectedRecordVersion: undefined } as unknown as AdminFloatingPlaceEditInput, ["Café"]);
  assert.ok("error" in missingVersion);
  assert.equal(missingVersion.status, 409);
  assert.equal(getPlaceRecordVersion({ ...original, recordVersion: "old", name: original.name }), stamp);
});

test("atomic write conflicts return 409 and unexpected failures remain failures", () => {
  const original = makePlace();
  const store = memoryStore([original]);
  const input: AdminFloatingPlaceEditInput = { editMode: "field-guide-inline", expectedRecordVersion: getPlaceRecordVersion(original), category: "Café", status: "been", loved: true };
  for (const reason of ["places.json changed after it was read.", "Another places.json write is in progress."]) {
    const result = updateProductionPlaceFloatingEdit(original.id, input, { ...store.io, writePlacesJsonAtomic: () => { throw new PlacesJsonWriteConflictError(reason); } });
    assert.ok(result.error);
    assert.equal(result.status, 409);
    assert.match(result.error, /Reload/);
    assert.equal(store.writes, 0);
    assert.equal(store.places[0].loved, null);
  }
  assert.throws(() => updateProductionPlaceFloatingEdit(original.id, input, { ...store.io, writePlacesJsonAtomic: () => { throw new Error("Disk offline"); } }), /Disk offline/);
});

test("retained verification edits can deliberately clear Loved to null", () => {
  const original = makePlace({ loved: true });
  const store = memoryStore([original]);
  const saved = updateProductionPlaceVerification(original.id, { googleMapsUrl: original.googleMapsUrl!, latitude: 35, longitude: 139, verifiedStatus: "Yes", lastChecked: "2026-10-22", verificationNotes: "Checked", loved: null }, store.io);
  assert.ok(saved.place);
  assert.equal(saved.place.loved, null);
  assert.equal(store.writes, 1);
});

test("runtime schema accepts the current catalog and rejects malformed required and optional fields", () => {
  assert.doesNotThrow(() => validatePlacesDataset(data));
  const invalid: Record<string, unknown>[] = [
    { id: 1 }, { name: false }, { address: 123 }, { district: true }, { tabelog: {} },
    { subway: [] }, { notes: [123] }, { notes: null }, { googleMapsUrl: "javascript:alert(1)" },
    { googleMapsUrl: "https://user:password@maps.google.com/" }, { googlePlaceId: 42 },
    { verifiedLatitude: 91 }, { verifiedLongitude: Number.NaN }, { matchConfidence: "high" },
    { coordinateConfidence: "maybe" }, { verifiedStatus: "Closed" }, { loved: "yes" },
  ];
  for (const patch of invalid) assert.throws(() => validatePlacesDataset([{ ...makePlace(), ...patch }]), /Invalid place/, JSON.stringify(patch));
  assert.doesNotThrow(() => validatePlacesDataset([makePlace({ notes: "A public note", googleMapsUrl: "" })]));
  assert.ok(getProductionPlaceVerificationInputErrors({ googleMapsUrl: 3, latitude: 35, longitude: 139, verifiedStatus: "Yes", lastChecked: false, verificationNotes: "" }).length >= 2);
});

function draft(overrides: Partial<AdminStagedPlaceInput> = {}): AdminStagedPlaceInput {
  return { name: "A".repeat(90), city: "Tokyo", category: "Café", draftStatus: "been", area: "Center", address: "1 Street", latitude: 35, longitude: 139, tabelog: "3.5", subway: "Station", googleMapsUrl: "https://maps.google.com/?q=one", verifiedStatus: "Yes", lastChecked: "2026-10-22", verificationNotes: "Checked", sourceLabel: "Manual", notes: ["Keep this note"], ...overrides };
}

test("staged drafts survive slug collisions and repeated creation without replacing another draft", () => {
  const firstInput = draft();
  const first = planStagedPlace(firstInput, []);
  assert.deepEqual(stagedPlaceToPlace(first.place).notes, firstInput.notes);
  const second = planStagedPlace(draft({ name: `${firstInput.name} two`, address: "2 Street" }), first.places);
  assert.notEqual(first.place.id, second.place.id);
  assert.equal(second.places.length, 2);
  assert.equal(second.places[0].address, "1 Street");
  const retried = planStagedPlace(firstInput, second.places);
  assert.equal(retried.place.id, first.place.id);
  assert.equal(retried.places.length, 2);
  const updated = planStagedPlace(draft({ id: first.place.id, address: "New address" }), second.places);
  assert.equal(updated.place.id, first.place.id);
  assert.equal(updated.place.createdAt, first.place.createdAt);
  assert.equal(updated.places.length, 2);
  assert.equal(updated.places.find((place) => place.id === second.place.id)?.address, "2 Street");
  assert.throws(() => planStagedPlace(draft({ id: "missing" }), second.places), /no longer exists/);
  assert.throws(() => planStagedPlace(draft({ id: first.place.id }), first.places, [{ id: first.place.id }]), /published places/);
  assert.ok(getStagedPlaceInputErrors(draft({ notes: [123] as unknown as string[] })).length);
  assert.ok(getStagedPlaceInputErrors({ ...draft(), draftStatus: ["been"] }).some((error) => error.includes("draftStatus")));
});

test("incomplete unverified drafts can stage but cannot publish or become verified", () => {
  for (const coordinates of [{ latitude: null, longitude: null }, { latitude: null, longitude: 139 }, { latitude: 35, longitude: null }]) {
    const input = draft({ ...coordinates, verifiedStatus: "Review" });
    assert.deepEqual(getStagedPlaceInputErrors(input), []);
    const staged = planStagedPlace(input, []);
    assert.equal(staged.place.verifiedStatus, "Review");
    assert.equal(staged.place.latitude, input.latitude);
    assert.equal(staged.place.longitude, input.longitude);
    const unexpectedIo = () => { throw new Error("Incomplete drafts must stop before published data I/O."); };
    const result = publishStagedPlaces({}, { readStagedPlaces: () => staged.places, readPlacesJsonSnapshot: unexpectedIo, writePlacesJsonAtomic: unexpectedIo, clearStagedPlaces: unexpectedIo });
    assert.equal(result.publishedCount, 0);
    assert.match(result.validationError!, /valid coordinates/);
    assert.equal(result.places[0].id, staged.place.id);
    assert.throws(() => stagedPlaceToPlace(staged.place), /without coordinates/);
    assert.ok(getStagedPlaceInputErrors({ ...input, verifiedStatus: "Yes" }).some((error) => error.includes("latitude and longitude")));
  }
  const automaticReview = planStagedPlace(draft({ latitude: null, longitude: null, verifiedStatus: "" }), []);
  assert.equal(automaticReview.place.verifiedStatus, "Review");
  for (const latitude of ["35", Number.NaN, 91]) {
    assert.ok(getStagedPlaceInputErrors({ ...draft({ verifiedStatus: "Review" }), latitude }).some((error) => error.includes("latitude")));
  }
});

test("place and staging APIs return helpful 400 responses for malformed JSON and fields", async () => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "editor-safety-test-password";
  try {
    const { PATCH } = await import("../../app/api/admin/places/[id]/route");
    const { POST } = await import("../../app/api/admin/staged-places/route");
    for (const body of ["{", "null", "[]", JSON.stringify({ googleMapsUrl: 1, latitude: 35, longitude: 139, verifiedStatus: "Yes", lastChecked: false, verificationNotes: "" })]) {
      const request = new NextRequest("http://localhost/api/admin/places/missing-editor-safety-fixture", { method: "PATCH", headers: { "Content-Type": "application/json", "x-admin-password": "editor-safety-test-password" }, body });
      const response = await PATCH(request, { params: Promise.resolve({ id: "missing-editor-safety-fixture" }) });
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, "string");
    }
    for (const body of ["{", "null", JSON.stringify({ ...draft(), name: 3 }), JSON.stringify({ ...draft(), latitude: null })]) {
      const response = await POST(new NextRequest("http://localhost/api/admin/staged-places", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": "editor-safety-test-password" }, body }));
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, "string");
    }
  } finally {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
  }
});
