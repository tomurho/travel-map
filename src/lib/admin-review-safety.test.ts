import assert from "node:assert/strict";
import test from "node:test";
import { OAuth2Client } from "google-auth-library";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

import { readFileSync } from "node:fs";
import { GET as getAdminPlaces } from "../../app/api/admin/places/route";
import { POST as decideRoute } from "../../app/api/admin/place-pipeline/review-candidates/route";
import { buildReviewCandidateQueue, decideReviewCandidate } from "@/lib/place-sheet-pipeline";
import { PipelineError } from "@/lib/pipeline-preview";
import type { Place } from "@/lib/place";

const headers = ["id", "rawName", "candidateName", "candidateAddress", "candidateLatitude", "candidateLongitude", "candidateGoogleMapsUrl", "candidateGooglePlaceId", "category", "area", "city", "status", "loved", "notes", "reviewStatus"];
const row = ["one", "Captured cafe", "Cafe One", "1 Street", "35", "139", "https://maps.google.com/?q=one", "GoogleOne", "Cafe", "Center", "Tokyo", "Location", "", "Review this venue", "Candidate"];
const place: Place = { id: "catalog-one", name: "Local Cafe", category: "Cafe", district: "", city: "Tokyo", address: "", latitude: 35, longitude: 139, status: "location", loved: null, tabelog: "", subway: "" };

function fixture() {
  const state = { values: [[...headers], [...row]], writes: [] as Array<{ range: string; values: string[][] }>, reads: 0 };
  const io: NonNullable<Parameters<typeof decideReviewCandidate>[1]> = {
    createGoogleSheetsAuthClient: async () => new OAuth2Client(),
    batchReadValues: async () => { state.reads += 1; return [structuredClone(state.values)]; },
    batchUpdateValues: async (_auth, _sheetId, updates) => { state.writes.push(...updates); },
    readPlacesJsonSnapshot: () => ({ places: [place], fileHash: "fixture", filePath: "fixture", raw: "fixture" }),
  };
  const candidate = buildReviewCandidateQueue(state.values, "sheet")[0];
  return { state, io, candidate };
}

test("public admin page passes no private catalogue into the client shell", () => {
  const page=readFileSync("app/admin/page.tsx","utf8");
  assert.match(page,/<CatalogueAdmin\s+publicUrl=/);
  assert.doesNotMatch(page,/readPlacesJsonSnapshot|getCatalogueStore/);
  assert.match(page,/isAdminEnabled/);
});

test("catalog endpoint requires the configured header and forbids caching private data", async () => {
  const priorPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "fixture-password";
  try {
    const denied = await getAdminPlaces(new NextRequest("http://localhost/api/admin/places"));
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).places, undefined);
    assert.match(denied.headers.get("cache-control") ?? "", /private, no-store/);
    const allowed = await getAdminPlaces(new NextRequest("http://localhost/api/admin/places", { headers: { "x-admin-password": "fixture-password" } }));
    assert.equal(allowed.status, 200);
    const records = (await allowed.json()).places;
    assert.ok(Array.isArray(records));
    assert.match(records[0].recordVersion, /^[a-f0-9]{64}$/);
    assert.match(allowed.headers.get("cache-control") ?? "", /private, no-store/);
  } finally {
    if (priorPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = priorPassword;
  }
});

test("Verify and Reject refuse changed reviewed values before writing", async () => {
  for (const decision of ["verify", "reject"] as const) {
    for (const field of headers) {
      const f = fixture();
      f.state.values[1][headers.indexOf(field)] += " changed";
      await assert.rejects(decideReviewCandidate({ sheetId: "sheet", id: f.candidate.id, rowNumber: f.candidate.rowNumber, expectedReviewStamp: f.candidate.reviewStamp, decision, edits: { category: "Cafe", status: "location" } }, f.io), (error: unknown) => error instanceof PipelineError && error.code === "PREVIEW_STALE" && error.status === 409, `${decision}: ${field}`);
      assert.equal(f.state.writes.length, 0, `${decision}: ${field}`);
    }
  }
});

test("review stamps bind the sheet, headers, row position, and source values", async () => {
  const f = fixture();
  const stamp = f.candidate.reviewStamp;
  assert.notEqual(buildReviewCandidateQueue(f.state.values, "other-sheet")[0].reviewStamp, stamp);
  const moved = [headers, Array(headers.length).fill(""), [...row]];
  assert.notEqual(buildReviewCandidateQueue(moved, "sheet")[0].reviewStamp, stamp);
  const reordered = [[...headers].reverse(), [...row].reverse()];
  assert.notEqual(buildReviewCandidateQueue(reordered, "sheet")[0].reviewStamp, stamp);
  await assert.rejects(decideReviewCandidate({ sheetId: "other-sheet", id: f.candidate.id, rowNumber: 2, expectedReviewStamp: stamp, decision: "reject" }, f.io), (error: unknown) => error instanceof PipelineError && error.status === 409);
  assert.equal(f.state.writes.length, 0);
});

test("fresh Verify and Reject write only the explicitly reviewed decision", async () => {
  for (const decision of ["verify", "reject"] as const) {
    const f = fixture();
    const result = await decideReviewCandidate({ sheetId: "sheet", id: f.candidate.id, rowNumber: 2, expectedReviewStamp: f.candidate.reviewStamp, decision, edits: { category: "Cafe", status: "want_to_go" } }, f.io);
    assert.equal(result.candidate.reviewStatus, decision === "verify" ? "Verified" : "Rejected");
    assert.equal(f.state.writes.length, decision === "verify" ? 4 : 1);
    assert.ok(f.state.writes.every((update) => update.range.endsWith("2")));
  }
});

test("missing review stamp rejects before Sheets access, including the HTTP route", async () => {
  const f = fixture();
  await assert.rejects(decideReviewCandidate({ sheetId: "sheet", id: "one", rowNumber: 2, decision: "reject" }, f.io), (error: unknown) => error instanceof PipelineError && error.code === "PREVIEW_REQUIRED");
  assert.equal(f.state.reads, 0);
  const priorPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "fixture-password";
  try {
    const response = await decideRoute(new NextRequest("http://localhost/api/admin/place-pipeline/review-candidates", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": "fixture-password" }, body: JSON.stringify({ sheetId: "sheet", id: "one", rowNumber: 2, decision: "reject", confirmWrite: true }) }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "PREVIEW_REQUIRED");
  } finally {
    if (priorPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = priorPassword;
  }
});

test("review decision route rejects malformed JSON and field types before provider access", async () => {
  const priorPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "fixture-password";
  const priorFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("Unexpected provider request"); };
  try {
    const valid = { sheetId: "sheet", id: "one", rowNumber: 2, decision: "reject", confirmWrite: true, expectedReviewStamp: "a".repeat(64) };
    const invalidBodies = ["{", "null", "[]", '"text"', "123", ...[
      { sheetId: 12 }, { sheetId: " " }, { id: [] }, { id: "" },
      { rowNumber: "2" }, { rowNumber: 1 }, { rowNumber: 2.5 },
      { decision: ["reject"] }, { decision: "approve" }, { expectedReviewStamp: {} },
      { decision: "verify" }, { decision: "verify", edits: null },
      { decision: "verify", edits: [] }, { decision: "verify", edits: { category: 1, status: "been" } },
      { decision: "verify", edits: { category: " ", status: "been" } },
      { decision: "verify", edits: { category: "Cafe", status: ["been"] } },
      { decision: "verify", edits: { category: "Cafe", status: "other" } },
    ].map((changes) => JSON.stringify({ ...valid, ...changes }))];
    for (const body of invalidBodies) {
      const response = await decideRoute(new NextRequest("http://localhost/api/admin/place-pipeline/review-candidates", {
        method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": "fixture-password" }, body,
      }));
      assert.equal(response.status, 400, body);
      assert.equal(typeof (await response.json()).error, "string", body);
    }
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = priorPassword;
  }
});
