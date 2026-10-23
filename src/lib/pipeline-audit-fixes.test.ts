import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { OAuth2Client } from "google-auth-library";
import {
  buildNewCaptureQueue, buildPlacePipelineStatus, buildPublishedSyncPlan,
  getPlacePipelineSnapshot, markCapturesReady, publishApprovedRows, syncPublishedToApp,
  buildReviewCandidateQueue,
} from "@/lib/place-sheet-pipeline";
import { createGoogleSheetsAuthClient, sheetsFetch } from "@/lib/google-sheets-oauth";
import { getCachedPlacePipelineSnapshot, invalidatePlacePipelineSnapshot } from "@/lib/place-pipeline-snapshot-cache";
import { PipelineError } from "@/lib/pipeline-preview";

const publishedHeaders = ["id", "name", "category", "area", "city", "address", "latitude", "longitude", "googleMapsUrl", "googlePlaceId", "status", "loved", "notes", "verifiedStatus", "lastChecked"];
const reviewHeaders = ["id", "rawName", "candidateName", "category", "area", "city", "candidateAddress", "candidateLatitude", "candidateLongitude", "candidateGoogleMapsUrl", "candidateGooglePlaceId", "status", "loved", "notes", "reviewStatus"];
const captureHeaders = ["rawName", "rawText", "cityHint", "countryHint", "sourceType", "sourceScreenshot", "sourceUrl", "notes", "intakeStatus"];
const publishedRow = ["one", "Cafe", "Cafe", "Center", "Tokyo", "1 Street", "35", "139", "https://maps.example/cafe", "g-one", "location", "", "", "Verified", "date"];
const reviewRow = ["one", "Cafe raw", "Cafe", "Cafe", "Center", "Tokyo", "1 Street", "35", "139", "https://maps.example/cafe", "g-one", "location", "", "", "verified"];
const snapshot = { fileHash: "hash", filePath: "fixture", raw: "[]", places: [] };
const isCode = (code: string) => (error: unknown) => error instanceof PipelineError && error.code === code;

function pipelineFixture() {
  const state = { published: [publishedHeaders, [...publishedRow]], review: [reviewHeaders, [...reviewRow]], writes: 0 };
  const io = {
    createGoogleSheetsAuthClient: async () => new OAuth2Client(),
    getSpreadsheetMetadata: async () => ({ sheets: ["Capture", "Review", "Published"].map((title) => ({ properties: { title } })) }),
    readValues: async (_auth: OAuth2Client, _id: string, range: string) => structuredClone(range.includes("Review") ? state.review : state.published),
    readPlacesJsonSnapshot: () => snapshot,
    batchUpdateValues: async () => { state.writes += 1; },
    appendValues: async () => { state.writes += 1; },
  };
  return { state, io };
}

test("invalid Published URL is a row-level preview error and a known Apply failure", async () => {
  const { state, io } = pipelineFixture();
  state.published[1][8] = "not-a-url";
  const plan = buildPublishedSyncPlan({ currentPlaces: [], publishedHeaders, publishedValues: state.published });
  assert.match(plan.validationErrors[0].errors.join(" "), /googleMapsUrl/);
  const preview = await syncPublishedToApp({ sheetId: "fixture" }, io);
  assert.equal(preview.canApply, false);
  assert.equal(preview.validationErrors[0].rowNumber, 2);
  await assert.rejects(syncPublishedToApp({ sheetId: "fixture", write: true, expectedPreviewHash: preview.previewHash }, io), isCode("VALIDATION_FAILED"));
  assert.equal(state.writes, 0);
});

test("publish preview reports invalid fields without permitting any write", async () => {
  const { state, io } = pipelineFixture();
  state.review[1][9] = "javascript:alert(1)";
  const preview = await publishApprovedRows({ sheetId: "fixture" }, io);
  assert.equal(preview.canApply, false);
  assert.match(preview.validationErrors[0].errors.join(" "), /googleMapsUrl/);
  assert.equal(preview.validationErrors[0].rowNumber, 2);
  await assert.rejects(publishApprovedRows({ sheetId: "fixture", write: true, expectedPreviewHash: preview.previewHash }, io), isCode("VALIDATION_FAILED"));
  assert.equal(state.writes, 0);
});

test("Sheet status casing has the same meaning for counts and publish eligibility", async () => {
  const { state, io } = pipelineFixture();
  state.published = [publishedHeaders];
  state.review[1][14] = "  vErIfIeD  ";
  const status = buildPlacePipelineStatus({ captureValues: [["intakeStatus"]], reviewValues: state.review, publishedValues: state.published, currentPlaces: [] });
  const preview = await publishApprovedRows({ sheetId: "fixture" }, io);
  assert.equal(status.review.verified, 1);
  assert.equal(status.readyToPublish, 1);
  assert.equal(preview.verifiedRowsFound, 1);
  assert.equal(preview.canApply, true);
});

test("an invalid Verified row cannot hide a valid Candidate or New capture", async () => {
  const { state, io } = pipelineFixture();
  state.review[1][7] = "";
  const candidate = [...reviewRow]; candidate[0] = "candidate"; candidate[14] = "Candidate";
  state.review.push(candidate);
  const captureValues = [captureHeaders, ["Tea", "OCR evidence", "Tokyo", "Japan", "Screenshot", "source.png", "https://example.com", "Source note", "New"]];
  const result = await getPlacePipelineSnapshot({ sheetId: "fixture" }, {
    ...io,
    batchReadValues: async () => [captureValues, state.review, state.published],
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.captures.length, 1);
  assert.equal(result.status.readyToPublish, 0);
  assert.equal(result.status.validationIssues[0].section, "publish");
  assert.match(result.status.validationIssues[0].errors.join(" "), /latitude/);
  assert.ok(result.status.fetchedAt);
});

test("a malformed Published header does not hide the review and capture queues", async () => {
  const { state, io } = pipelineFixture();
  state.review[1][14] = "Candidate";
  const result = await getPlacePipelineSnapshot({ sheetId: "fixture" }, {
    ...io, batchReadValues: async () => [[captureHeaders], state.review, [["wrong-header"]]],
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.status.validationIssues[0].section, "sync");
});

function captureFixture() {
  const state = { values: [captureHeaders, ["Tea", "OCR evidence", "Tokyo", "Japan", "Screenshot", "source.png", "https://example.com", "Source note", " new "]], writes: [] as string[] };
  const io = {
    createGoogleSheetsAuthClient: async () => new OAuth2Client(),
    readValues: async () => structuredClone(state.values),
    batchUpdateValues: async (_auth: OAuth2Client, _id: string, updates: Array<{ range: string; values: string[][] }>) => {
      state.writes.push(...updates.map((update) => update.range));
      for (const update of updates) state.values[Number(update.range.match(/(\d+)$/)?.[1]) - 1][8] = update.values[0][0];
    },
  };
  const row = buildNewCaptureQueue(state.values, "fixture")[0];
  const input = { sheetId: "fixture", captures: [{ rowNumber: row.rowNumber, intakeId: row.intakeId, captureVersion: row.captureVersion }] };
  return { state, io, input, row };
}

test("New captures show their source and Mark ready changes only the selected status", async () => {
  const { state, io, input, row } = captureFixture();
  assert.equal(row.rawText, "OCR evidence");
  assert.equal(row.sourceScreenshot, "source.png");
  assert.match(row.sheetRowUrl, /Capture!A2/);
  const before = state.values[1].slice(0, 8);
  assert.deepEqual(await markCapturesReady(input, io), { readyCount: 1 });
  assert.deepEqual(state.values[1].slice(0, 8), before);
  assert.deepEqual(state.writes, ["'Capture'!I2"]);
});

test("changed capture contents, headers, row positions and Sheet invalidate Mark ready", async () => {
  for (const mutation of ["field", "header", "position", "sheet"] as const) {
    const { state, io, input } = captureFixture();
    if (mutation === "field") state.values[1][1] = "New source";
    if (mutation === "header") state.values[0] = [...captureHeaders, "extra"];
    if (mutation === "position") state.values.splice(1, 0, []);
    if (mutation === "sheet") input.sheetId = "other-sheet";
    await assert.rejects(markCapturesReady(input, io), isCode("PREVIEW_STALE"));
    assert.deepEqual(state.writes, []);
  }
});

test("duplicate Mark ready submissions produce one write; changed batches write nothing", async () => {
  const { state, io, input } = captureFixture();
  const outcomes = await Promise.allSettled([markCapturesReady(input, io), markCapturesReady(input, io)]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(state.writes.length, 1);
  const second = captureFixture();
  second.input.captures.push({ ...second.input.captures[0], rowNumber: 3 });
  await assert.rejects(markCapturesReady(second.input, second.io), isCode("PREVIEW_STALE"));
  assert.deepEqual(second.state.writes, []);
  await assert.rejects(markCapturesReady({ ...second.input, captures: [second.input.captures[0], second.input.captures[0]] }, second.io), isCode("VALIDATION_FAILED"));
});

test("missing OAuth token returns exact setup instructions without terminal input", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "travel-oauth-fixture-"));
  try {
    const clientPath = path.join(directory, "client.json");
    writeFileSync(clientPath, JSON.stringify({ installed: { client_id: "fixture", client_secret: "fixture" } }));
    await assert.rejects(createGoogleSheetsAuthClient({ clientPath, tokenPath: path.join(directory, "missing-token.json") }), /pnpm setup:google-sheets/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("OAuth provider token waits stop at the configured deadline", async () => {
  const client = new OAuth2Client();
  client.getAccessToken = () => new Promise(() => {});
  await assert.rejects(sheetsFetch(client, "fixture", { timeoutMs: 5 }), /timed out/);
});

test("Sheets provider fetch receives a deadline and never auto-retries a write", async (t) => {
  const client = new OAuth2Client();
  client.getAccessToken = async () => ({ token: "fixture" });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    calls += 1;
    assert.ok(options.signal instanceof AbortSignal);
    throw new DOMException("Expired", "TimeoutError");
  });
  await assert.rejects(sheetsFetch(client, "fixture", { method: "POST", timeoutMs: 5 }), /Expired/);
  assert.equal(calls, 1);
});


test("catalog identity and distant-city warnings remain advisory during candidate review", () => {
  const candidate = [...reviewRow]; candidate[14] = "Candidate";
  const catalog = [0, 1, 2].map((offset) => ({
    id: `local-${offset}`, name: "Saved cafe", city: "Tokyo", latitude: 35.7,
    longitude: 139.7, googlePlaceId: offset === 0 ? "g-one" : `g-${offset}`,
    category: "Cafe", district: "", address: "", status: "location" as const,
    loved: null, tabelog: "", subway: "",
  }));
  const row = buildReviewCandidateQueue([reviewHeaders, candidate], "fixture", catalog)[0];
  assert.deepEqual(row.validationIssues, []);
  assert.equal(row.warnings.length, 2);
  assert.match(row.warnings.join(" "), /Same Google Place ID/);
  assert.match(row.warnings.join(" "), /from the center/);
});

test("invalidated in-flight snapshot cannot refill the cache with old data", async () => {
  const sheetId = "cache-race-fixture";
  const status = buildPlacePipelineStatus({ captureValues: [["intakeStatus"]], reviewValues: [reviewHeaders], publishedValues: [publishedHeaders], currentPlaces: [] });
  const oldSnapshot = { captures: [], candidates: [], status: { ...status, fetchedAt: "old" } };
  const newSnapshot = { captures: [], candidates: [], status: { ...status, fetchedAt: "new" } };
  let finishOld!: (snapshot: typeof oldSnapshot) => void;
  let reads = 0;
  const loader = async () => {
    reads += 1;
    return reads === 1 ? new Promise<typeof oldSnapshot>((resolve) => { finishOld = resolve; }) : newSnapshot;
  };
  const pending = getCachedPlacePipelineSnapshot({ sheetId }, loader);
  invalidatePlacePipelineSnapshot(sheetId);
  const fresh = await getCachedPlacePipelineSnapshot({ sheetId }, loader);
  finishOld(oldSnapshot);
  await pending;
  assert.equal(fresh.snapshot.status.fetchedAt, "new");
  const cached = await getCachedPlacePipelineSnapshot({ sheetId }, loader);
  assert.equal(cached.cached, true);
  assert.equal(cached.snapshot.status.fetchedAt, "new");
  assert.equal(reads, 2);
  invalidatePlacePipelineSnapshot(sheetId);
});

test("expired OAuth access gives the same explicit setup command", async () => {
  const client = new OAuth2Client();
  client.getAccessToken = async () => { throw new Error("invalid_grant"); };
  await assert.rejects(sheetsFetch(client, "fixture"), /pnpm setup:google-sheets/);
});

test("capture-ready endpoint rejects unauthenticated and malformed requests before Sheets I/O", async () => {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../../app/api/admin/place-pipeline/capture-ready/route");
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "fixture-password";
  try {
    const request = (body: unknown, password = "fixture-password") => new NextRequest("http://localhost/api/admin/place-pipeline/capture-ready", {
      method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": password }, body: JSON.stringify(body),
    });
    assert.equal((await POST(request({}, "wrong"))).status, 401);
    assert.equal((await POST(request({ sheetId: "fixture", captures: [] }))).status, 400);
    assert.equal((await POST(request({ sheetId: "fixture", captures: [], confirmWrite: true }))).status, 422);
    assert.equal((await POST(request({ sheetId: "fixture", captures: [{ rowNumber: 2, intakeId: "id", captureVersion: "bad" }], confirmWrite: true }))).status, 422);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  }
});
