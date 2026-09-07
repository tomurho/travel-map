import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { OAuth2Client } from "google-auth-library";
import { NextRequest } from "next/server";
import { buildPreviewHash, PipelineError } from "@/lib/pipeline-preview";
import { mergePublishedPlace, verificationFields } from "@/lib/published-place-merge";
import { buildPublishedSyncPlan, publishApprovedRows, resolvePublishedConflict, syncPublishedToApp } from "@/lib/place-sheet-pipeline";
import { readPlacesJsonSnapshot, writePlacesJsonAtomic } from "@/lib/places-json-store";
import type { Place } from "@/lib/place";
import { parseArgs as parsePublishArgs } from "../../scripts/publish-places-from-sheet";
import { parseArgs as parseSyncArgs } from "../../scripts/sync-published-places-to-json";

const publishedHeaders = ["id", "name", "category", "area", "city", "address", "latitude", "longitude", "googleMapsUrl", "googlePlaceId", "status", "loved", "notes", "verifiedStatus", "lastChecked"];
const reviewHeaders = ["id", "candidateName", "category", "area", "city", "candidateAddress", "candidateLatitude", "candidateLongitude", "candidateGoogleMapsUrl", "candidateGooglePlaceId", "status", "loved", "notes", "reviewStatus"];

function place(overrides: Partial<Place> = {}): Place {
  return { id: "one", name: "Cafe One", category: "Cafe", district: "Center", city: "Tokyo", address: "1 Street", latitude: 35, longitude: 139, googleMapsUrl: "https://maps.google.com/?q=one", googlePlaceId: "GoogleOne", status: "location", loved: null, notes: [], tabelog: "", subway: "", ...overrides };
}
function publishedRow(value = place()) {
  const fields = { ...value, area: value.district, loved: value.loved === null ? "" : String(value.loved), notes: Array.isArray(value.notes) ? value.notes.join(" | ") : value.notes, verifiedStatus: "Verified", lastChecked: "sheet-date" };
  return publishedHeaders.map((key) => String(fields[key as keyof typeof fields] ?? ""));
}
function reviewRow(value = place()) {
  const fields = { id: value.id, candidateName: value.name, category: value.category, area: value.district, city: value.city, candidateAddress: value.address, candidateLatitude: value.latitude, candidateLongitude: value.longitude, candidateGoogleMapsUrl: value.googleMapsUrl, candidateGooglePlaceId: value.googlePlaceId, status: value.status, loved: "", notes: "", reviewStatus: "Verified" };
  return reviewHeaders.map((key) => String(fields[key as keyof typeof fields] ?? ""));
}
function code(expected: string) {
  return (error: unknown) => error instanceof PipelineError && error.code === expected;
}

function fixture(initialPlaces: Place[] = []) {
  const directory = mkdtempSync(path.join(tmpdir(), "travel-pipeline-contract-"));
  const filePath = path.join(directory, "places.json");
  writeFileSync(filePath, JSON.stringify(initialPlaces));
  const state = {
    published: [[...publishedHeaders], publishedRow()],
    review: [[...reviewHeaders], reviewRow()],
    writes: [] as string[],
    failAppend: false,
    raceJson: false,
  };
  const io: NonNullable<Parameters<typeof syncPublishedToApp>[1]> = {
    createGoogleSheetsAuthClient: async () => new OAuth2Client(),
    getSpreadsheetMetadata: async () => ({ sheets: ["Review", "Published"].map((title) => ({ properties: { title } })) }),
    readValues: async (_auth, _id, range) => structuredClone(range.includes("Review") ? state.review : state.published),
    readPlacesJsonSnapshot: () => readPlacesJsonSnapshot(filePath),
    writePlacesJsonAtomic: (places, options) => {
      if (state.raceJson) writeFileSync(filePath, JSON.stringify([place({ id: "concurrent" })]));
      const result = writePlacesJsonAtomic(places, { ...options, filePath, backupDirectory: path.join(directory, "backups") });
      state.writes.push("json");
      return result;
    },
    batchUpdateValues: async (_auth, _id, updates) => {
      state.writes.push("update");
      for (const update of updates) {
        const rowNumber = Number(update.range.match(/!A(\d+)/)?.[1]);
        state.published[rowNumber - 1] = update.values[0].map(String);
      }
    },
    appendValues: async (_auth, _id, _range, values) => {
      state.writes.push("append");
      state.published.push(...values.map((row) => row.map(String)));
      if (state.failAppend) throw new Error("Connection lost after server accepted append");
    },
  };
  return { state, io, filePath, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("merge retains every populated verification field, local editorial values, and app-only fields", () => {
  const evidence: Partial<Place> = {
    verifiedStatus: "Review", lastChecked: "local-date", verificationNotes: "Checked manually",
    canonicalName: "Canonical", canonicalAddress: "Canonical address", verifiedLatitude: 35,
    verifiedLongitude: 139, candidateCoordinateSource: "manual", coordinatePrecision: "manual",
    coordinateConfidence: "high", distanceDeltaMeters: 0, businessStatus: "OPERATIONAL",
    matchConfidence: 0, samePlaceDecision: "Unsure", samePlaceReason: "Reason",
    verificationDecision: "manually_verified", verificationSource: "manual", nameScore: 0,
    addressScore: 0, cityScore: 0, districtScore: 0, countryScore: 0, ambiguityScore: 0,
  };
  const existing = place({ ...evidence, category: "Local category", status: "been", loved: false, tabelog: "3.5", subway: "Station" });
  const result = mergePublishedPlace(existing, place({ verifiedStatus: "Yes", lastChecked: "sheet-date", notes: ["Published note"] }));
  assert.equal(result.kind, "merged");
  for (const field of verificationFields) assert.deepEqual(result.place[field], existing[field], field);
  for (const field of ["category", "status", "loved", "tabelog", "subway"] as const) assert.deepEqual(result.place[field], existing[field]);
  assert.deepEqual(result.place.notes, ["Published note"]);
});

test("closure is retained while unrelated rows sync; repeat preview has no changes", async () => {
  const closed = place({ verifiedStatus: "Closed/Moved", verificationNotes: "Closure confirmed" });
  const f = fixture([closed]);
  try {
    f.state.published.push(publishedRow(place({ id: "two" })));
    const preview = await syncPublishedToApp({ sheetId: "sheet" }, f.io);
    assert.equal(preview.preservedClosures.length, 1);
    assert.equal(preview.canApply, true);
    await syncPublishedToApp({ sheetId: "sheet", write: true, expectedPreviewHash: preview.previewHash }, f.io);
    assert.deepEqual(readPlacesJsonSnapshot(f.filePath).places.find((p) => p.id === "one"), closed);
    const again = await syncPublishedToApp({ sheetId: "sheet" }, f.io);
    assert.deepEqual(again.changes, []);
    assert.equal(again.canApply, false);
  } finally { f.cleanup(); }
});

test("verified venue changes block the entire write, including partial mode", async () => {
  for (const change of [{ latitude: 36 }, { address: "2 Street" }, { googlePlaceId: "OtherPlace" }, { name: "Other venue" }, { googleMapsUrl: "https://maps.google.com/?q=two" }]) {
    const f = fixture([place({ verifiedStatus: "Yes" })]);
    try {
      f.state.published = [publishedHeaders, publishedRow(place(change)), publishedRow(place({ id: "new" }))];
      const before = readFileSync(f.filePath, "utf8");
      const preview = await syncPublishedToApp({ sheetId: "sheet", allowPartial: true }, f.io);
      assert.equal(preview.canApply, false);
      assert.equal(preview.verificationConflicts.length, 1);
      assert.equal(preview.verificationConflicts[0].rowNumber, 2);
      await assert.rejects(syncPublishedToApp({ sheetId: "sheet", write: true, allowPartial: true, expectedPreviewHash: preview.previewHash }, f.io), code("VERIFICATION_CONFLICT"));
      assert.equal(readFileSync(f.filePath, "utf8"), before);
      assert.deepEqual(f.state.writes, []);
    } finally { f.cleanup(); }
  }
});

test("zero scores and dates protect verification; formatting and city aliases do not conflict", () => {
  for (const evidence of [{ nameScore: 0 }, { lastChecked: "local-date" }, { verifiedStatus: "No" as const }]) {
    assert.equal(mergePublishedPlace(place(evidence), place({ latitude: 36 })).kind, "conflict");
  }
  const existing = place({ city: "Taipei City", name: " Cafe   One ", verifiedStatus: "Yes" });
  assert.equal(mergePublishedPlace(existing, place({ city: "Taipei" })).kind, "merged");
  assert.equal(mergePublishedPlace(place(), place({ latitude: 36 })).place.latitude, 36);
  assert.equal(mergePublishedPlace(place({ loved: null }), place({ loved: true })).place.loved, null);
});

test("unchanged verified record remains idempotent without losing evidence", () => {
  const existing = place({ verifiedStatus: "Yes", lastChecked: "local-date", verificationNotes: "Evidence" });
  const plan = buildPublishedSyncPlan({ currentPlaces: [existing], publishedHeaders, publishedValues: [publishedHeaders, publishedRow()] });
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.nextPlaces)), [existing]);
});

test("sync preview binds rows, headers, order, sheet, options and the local snapshot", async () => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
    (f) => { f.state.published[1][1] = "Changed"; },
    (f) => { f.state.published.push(publishedRow(place({ id: "two" }))); },
    (f) => { f.state.published[0][1] = "renamedHeader"; },
    (f) => { f.state.published.splice(1, 0, []); },
    (f) => { writeFileSync(f.filePath, "[ ]\n"); },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    try {
      const preview = await syncPublishedToApp({ sheetId: "sheet" }, f.io);
      mutate(f);
      const before = readFileSync(f.filePath, "utf8");
      await assert.rejects(syncPublishedToApp({ sheetId: "sheet", write: true, expectedPreviewHash: preview.previewHash }, f.io), code("PREVIEW_STALE"));
      assert.deepEqual(f.state.writes, []);
      assert.equal(readFileSync(f.filePath, "utf8"), before);
    } finally { f.cleanup(); }
  }
  const f = fixture();
  try {
    const preview = await syncPublishedToApp({ sheetId: "sheet" }, f.io);
    for (const overrides of [{ sheetId: "another" }, { allowPartial: true }]) {
      await assert.rejects(syncPublishedToApp({ sheetId: "sheet", write: true, expectedPreviewHash: preview.previewHash, ...overrides }, f.io), code("PREVIEW_STALE"));
    }
    assert.deepEqual(f.state.writes, []);
  } finally { f.cleanup(); }
});

test("atomic JSON writer catches changes after apply preflight", async () => {
  const f = fixture();
  try {
    const preview = await syncPublishedToApp({ sheetId: "sheet" }, f.io);
    f.state.raceJson = true;
    await assert.rejects(syncPublishedToApp({ sheetId: "sheet", write: true, expectedPreviewHash: preview.previewHash }, f.io), code("PREVIEW_STALE"));
    assert.equal(readPlacesJsonSnapshot(f.filePath).places[0].id, "concurrent");
    assert.deepEqual(f.state.writes, []);
  } finally { f.cleanup(); }
});

test("partial sync cannot bypass duplicates; ordinary invalid rows require explicit matching partial preview", async () => {
  const f = fixture();
  try {
    f.state.published.push(publishedRow());
    let preview = await syncPublishedToApp({ sheetId: "sheet", allowPartial: true }, f.io);
    await assert.rejects(syncPublishedToApp({ sheetId: "sheet", allowPartial: true, write: true, expectedPreviewHash: preview.previewHash }, f.io), code("VALIDATION_FAILED"));
    f.state.published = [publishedHeaders, publishedRow(), publishedRow(place({ id: "bad", latitude: 91 }))];
    preview = await syncPublishedToApp({ sheetId: "sheet" }, f.io);
    await assert.rejects(syncPublishedToApp({ sheetId: "sheet", write: true, expectedPreviewHash: preview.previewHash }, f.io), code("VALIDATION_FAILED"));
    assert.deepEqual(f.state.writes, []);
    preview = await syncPublishedToApp({ sheetId: "sheet", allowPartial: true }, f.io);
    const result = await syncPublishedToApp({ sheetId: "sheet", allowPartial: true, write: true, expectedPreviewHash: preview.previewHash }, f.io);
    assert.equal(result.wrote, true);
    assert.equal(readPlacesJsonSnapshot(f.filePath).places.length, 1);
  } finally { f.cleanup(); }
});

test("publish defaults to preview and binds both source tabs", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.state.review[1][1] = "Corrected"; },
    (f: ReturnType<typeof fixture>) => { f.state.review.push(reviewRow(place({ id: "new" }))); },
    (f: ReturnType<typeof fixture>) => { f.state.published[1][1] = "External edit"; },
    (f: ReturnType<typeof fixture>) => { f.state.review.splice(1, 0, []); },
  ]) {
    const f = fixture();
    try {
      const preview = await publishApprovedRows({ sheetId: "sheet" }, f.io);
      assert.equal(preview.wrote, false);
      mutate(f);
      await assert.rejects(publishApprovedRows({ sheetId: "sheet", write: true, expectedPreviewHash: preview.previewHash }, f.io), code("PREVIEW_STALE"));
      assert.deepEqual(f.state.writes, []);
    } finally { f.cleanup(); }
  }
});

test("unchanged publish applies updates and appends, then a fresh preview is a no-op", async (t) => {
  let timestamp = "2026-09-06T00:00:00.000Z";
  t.mock.method(Date.prototype, "toISOString", () => timestamp);
  const f = fixture();
  try {
    f.state.review = [reviewHeaders, reviewRow(place({ name: "Corrected" })), reviewRow(place({ id: "two" }))];
    const preview = await publishApprovedRows({ sheetId: "sheet" }, f.io);
    assert.equal(preview.canApply, true);
    assert.ok(preview.fieldChanges[0].fields.some((field) => field.field === "name" && field.before === "Cafe One" && field.after === "Corrected"));
    assert.ok(preview.fieldChanges.every((row) => row.fields.every((field) => field.field !== "lastChecked")));
    timestamp = "2026-09-06T01:00:00.000Z";
    const secondPreview = await publishApprovedRows({ sheetId: "sheet" }, f.io);
    assert.equal(secondPreview.previewHash, preview.previewHash);
    await publishApprovedRows({ sheetId: "sheet", write: true, expectedPreviewHash: preview.previewHash }, f.io);
    assert.deepEqual(f.state.writes, ["update", "append"]);
    const again = await publishApprovedRows({ sheetId: "sheet" }, f.io);
    assert.equal(again.canApply, false);
    assert.deepEqual(again.fieldChanges, []);
  } finally { f.cleanup(); }
});

test("an uncertain publish is not retried and the original preview becomes stale", async () => {
  const f = fixture();
  try {
    f.state.review = [reviewHeaders, reviewRow(place({ name: "Corrected" })), reviewRow(place({ id: "two" }))];
    f.state.failAppend = true;
    const preview = await publishApprovedRows({ sheetId: "sheet" }, f.io);
    await assert.rejects(publishApprovedRows({ sheetId: "sheet", write: true, expectedPreviewHash: preview.previewHash }, f.io), code("WRITE_OUTCOME_UNKNOWN"));
    assert.deepEqual(f.state.writes, ["update", "append"]);
    await assert.rejects(publishApprovedRows({ sheetId: "sheet", write: true, expectedPreviewHash: preview.previewHash }, f.io), code("PREVIEW_STALE"));
    assert.deepEqual(f.state.writes, ["update", "append"]);
  } finally { f.cleanup(); }
});

test("write calls reject missing or malformed hashes before any I/O", async () => {
  for (const operation of [publishApprovedRows, syncPublishedToApp]) {
    for (const expectedPreviewHash of [undefined, "bad"]) {
      await assert.rejects(operation({ sheetId: "sheet", write: true, expectedPreviewHash }, {
        createGoogleSheetsAuthClient: async () => { throw new Error("Unexpected I/O"); },
      }), code("PREVIEW_REQUIRED"));
    }
  }
});

test("fingerprints ignore object key order but preserve row order and operation", () => {
  const base = { operation: "sync" as const, sheetId: "sheet", publishedValues: [["a"], ["b"]] };
  assert.equal(buildPreviewHash(base), buildPreviewHash({ publishedValues: base.publishedValues, sheetId: "sheet", operation: "sync" }));
  assert.notEqual(buildPreviewHash(base), buildPreviewHash({ ...base, publishedValues: [["b"], ["a"]] }));
  assert.notEqual(buildPreviewHash(base), buildPreviewHash({ ...base, operation: "publish" }));
});

test("CLI parsers keep preview defaults and forward explicit hashes", () => {
  assert.equal(parsePublishArgs(["--sheet-id", "sheet"]).write, false);
  assert.equal(parseSyncArgs(["--sheet-id", "sheet"]).dryRun, true);
  for (const parse of [parsePublishArgs, parseSyncArgs]) {
    const args = parse(["--sheet-id", "sheet", "--write", "--expected-preview-hash", "a".repeat(64)]);
    assert.equal(args.write, true);
    assert.equal(args.expectedPreviewHash, "a".repeat(64));
    assert.throws(() => parse(["--unknown"]), /Unknown option/);
  }
});

test("admin endpoints require preview hashes and retain authorization", async () => {
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "test-secret";
  try {
    const routes = [
      (await import("../../app/api/admin/place-pipeline/publish-approved/route")).POST,
      (await import("../../app/api/admin/place-pipeline/sync-published/route")).POST,
      (await import("../../app/api/admin/place-pipeline/resolve-conflict/route")).POST,
    ];
    for (const POST of routes) {
      const request = (password: string) => new NextRequest("http://localhost/api/admin/place-pipeline/test", {
        method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ sheetId: "sheet", write: true, confirmWrite: true }),
      });
      assert.equal((await POST(request("wrong"))).status, 401);
      const response = await POST(request("test-secret"));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "PREVIEW_REQUIRED");
    }
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  }
});


test("manual correction requires a preview, confirmation, and a verification note before I/O", async () => {
  const input = { sheetId: "sheet", id: "one", rowNumber: 2, expectedPreviewHash: "a".repeat(64), confirmVerified: true, verificationNote: "Checked venue" };
  const io = { createGoogleSheetsAuthClient: async () => { throw new Error("Unexpected I/O"); } };
  await assert.rejects(resolvePublishedConflict({ ...input, expectedPreviewHash: undefined }, io), code("PREVIEW_REQUIRED"));
  for (const change of [{ confirmVerified: false }, { verificationNote: "  " }, { rowNumber: 1 }, { id: "" }]) {
    await assert.rejects(resolvePublishedConflict({ ...input, ...change }, io), code("VALIDATION_FAILED"));
  }
});

test("manual correction replaces only the selected venue and evidence, keeps a backup, and requires a fresh preview", async () => {
  const original = place({ verifiedStatus: "Review", canonicalName: "Old candidate", verifiedLatitude: 35, verificationNotes: "Old note", nameScore: 80, businessStatus: "CLOSED_TEMPORARILY", category: "Local category", status: "been", loved: false, tabelog: "3.5", subway: "Station", notes: ["Local note"] });
  const other = place({ id: "two", verifiedStatus: "Yes" });
  const f = fixture([original, other]);
  try {
    f.state.published = [publishedHeaders, publishedRow(place({ name: "Corrected Cafe", latitude: 36 })), publishedRow(place({ id: "two", address: "Changed other address" }))];
    const preview = await syncPublishedToApp({ sheetId: "sheet" }, f.io);
    const input = { sheetId: "sheet", id: "one", rowNumber: 2, expectedPreviewHash: preview.previewHash, confirmVerified: true, verificationNote: "  Checked the venue website and map pin  " };
    const result = await resolvePublishedConflict(input, f.io);
    const saved = readPlacesJsonSnapshot(f.filePath).places;
    assert.equal(result.requiresPreview, true);
    assert.equal(saved[0].name, "Corrected Cafe");
    assert.equal(saved[0].latitude, 36);
    for (const field of ["category", "status", "loved", "tabelog", "subway", "notes"] as const) assert.deepEqual(saved[0][field], original[field]);
    assert.equal(saved[0].verifiedStatus, "Yes");
    assert.equal(saved[0].verificationSource, "manual");
    assert.equal(saved[0].verificationDecision, "manually_verified");
    assert.equal(saved[0].verificationNotes, "Checked the venue website and map pin");
    assert.ok(Number.isFinite(Date.parse(saved[0].lastChecked!)));
    const newEvidence = ["verifiedStatus", "verificationSource", "verificationDecision", "verificationNotes", "lastChecked"];
    for (const field of verificationFields) if (!newEvidence.includes(field)) assert.equal(saved[0][field], undefined, field);
    assert.deepEqual(saved[1], other);
    assert.deepEqual(f.state.writes, ["json"]);
    const backupDir = path.join(path.dirname(f.filePath), "backups");
    assert.deepEqual(JSON.parse(readFileSync(path.join(backupDir, readdirSync(backupDir)[0]), "utf8")), [original, other]);
    await assert.rejects(resolvePublishedConflict(input, f.io), code("PREVIEW_STALE"));
    const refreshed = await syncPublishedToApp({ sheetId: "sheet" }, f.io);
    assert.deepEqual(refreshed.verificationConflicts.map((row) => row.id), ["two"]);
    await resolvePublishedConflict({ ...input, id: "two", rowNumber: 3, expectedPreviewHash: refreshed.previewHash }, f.io);
    const ready = await syncPublishedToApp({ sheetId: "sheet" }, f.io);
    assert.equal(ready.verificationConflicts.length, 0);
    assert.equal(ready.canApply, true); // Published notes are still a separate sync change.
    await syncPublishedToApp({ sheetId: "sheet", write: true, expectedPreviewHash: ready.previewHash }, f.io);
    assert.equal(readPlacesJsonSnapshot(f.filePath).places[0].verificationNotes, saved[0].verificationNotes);
  } finally { f.cleanup(); }
});

test("manual correction rejects changed sheet/local data and concurrent local writes", async () => {
  for (const changed of ["sheet", "local", "during-write"] as const) {
    const f = fixture([place({ verifiedStatus: "Yes" })]);
    try {
      f.state.published = [publishedHeaders, publishedRow(place({ latitude: 36 }))];
      const preview = await syncPublishedToApp({ sheetId: "sheet" }, f.io);
      if (changed === "sheet") f.state.published[1][1] = "Newer name";
      if (changed === "local") writeFileSync(f.filePath, JSON.stringify([place({ verifiedStatus: "Yes", notes: ["Newer note"] })]));
      if (changed === "during-write") f.state.raceJson = true;
      await assert.rejects(resolvePublishedConflict({ sheetId: "sheet", id: "one", rowNumber: 2, expectedPreviewHash: preview.previewHash, confirmVerified: true, verificationNote: "Checked" }, f.io), code("PREVIEW_STALE"));
      assert.deepEqual(f.state.writes, []);
      if (changed === "during-write") assert.equal(readPlacesJsonSnapshot(f.filePath).places[0].id, "concurrent");
    } finally { f.cleanup(); }
  }
});

test("manual correction cannot reopen a closure or select an ambiguous duplicate row", async () => {
  for (const mode of ["closed", "duplicate", "wrong-row"] as const) {
    const f = fixture([place({ verifiedStatus: mode === "closed" ? "Closed/Moved" : "Yes" })]);
    try {
      f.state.published = [publishedHeaders, publishedRow(place({ latitude: 36 }))];
      if (mode === "duplicate") f.state.published.push(publishedRow(place({ latitude: 37 })));
      const before = readFileSync(f.filePath, "utf8");
      const preview = await syncPublishedToApp({ sheetId: "sheet" }, f.io);
      await assert.rejects(resolvePublishedConflict({ sheetId: "sheet", id: "one", rowNumber: mode === "wrong-row" ? 3 : 2, expectedPreviewHash: preview.previewHash, confirmVerified: true, verificationNote: "Checked" }, f.io), code("PREVIEW_STALE"));
      assert.equal(readFileSync(f.filePath, "utf8"), before);
      assert.deepEqual(f.state.writes, []);
    } finally { f.cleanup(); }
  }
});
