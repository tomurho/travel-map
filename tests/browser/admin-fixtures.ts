import type { Page } from "@playwright/test";

// A complete tall image with different top and bottom bands for inspection.
export const fixtureScreenshotPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAHgAAAHgCAYAAABuJqlIAAAEdElEQVR4nO3cMQ3CYBhF0U8UKprUAWqwVAtdys6OADz8yCC5nOHsL7n7m9vjvuiaXw9AYARG4D8lcJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHzXG9Fl0CxwkcJ3CcwHECxwkcJ3DcfN7nokvgOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI5zCB4ncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHOQSPEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4wSOEzhO4DiB4xyCxwkcJ3CcwHECxwkcJ3CcwHECxwkcJ3CcwHECxwkcJ3CcwHECxwkcJ3CcwHECxwkcJ3CcwHECxwkcJ3CcwHECxwkcJ3CcwHECxwkcJ3CcwHECxwkcJ3CcwHECxwkcJ3CcwHECxwkcJ3CcwHEOweMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4h+BxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnEPwOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOM4heJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRwncJzAcQLHCRznEDxO4DiB4wSOEzhO4DiB4wSOm+e+LboEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuC4Ly+Dm5qbpsCVAAAAAElFTkSuQmCC", "base64");

export const fixturePlace = {
  id: "fixture-cafe", name: "Fixture Cafe", category: "Coffee", city: "Kyoto", district: "Nakagyo",
  address: "1 Fixture Street, Kyoto", latitude: 35.01, longitude: 135.76,
  googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=Fixture+Cafe", googlePlaceId: "fixture-place-id",
  status: "location", loved: null, notes: [], tabelog: "", subway: "", verifiedStatus: "Yes",
};
export function populatedSnapshot() {
  return {
    checkedAt: "2026-10-23T02:30:00.000Z",
    status: {
      fetchedAt: "2026-10-23T02:30:00.000Z", appChanges: 0,
      capture: { new: 1, ready: 0, enriched: 1, other: 0, total: 2 },
      review: { candidate: 1, verified: 1, other: 0, total: 2 }, published: { total: 0, verified: 0 },
      readyToPublish: 0, recommendedAction: "fix_errors", validationErrors: 1,
      validationIssues: [{ section: "publish", rowNumber: 7, id: "invalid-fixture", errors: ["latitude must be a number."] }],
    },
    captures: [{
      intakeId: "capture-fixture", captureVersion: "capture-version-fixture", rowNumber: 3, rawName: "Captured Fixture Cafe", rawText: "Source screenshot says: Fixture Cafe in Kyoto.",
      cityHint: "Kyoto", countryHint: "Japan", sourceType: "screenshot", sourceScreenshot: "fixture-capture.png", sourceUrl: "https://example.com/fixture-source", notes: "Check this saved source before lookup.", status: "New",
      sheetRowUrl: "https://docs.google.com/spreadsheets/d/fixture-sheet/edit#gid=1&range=A3:K3",
    }],
    candidates: [{
      id: "candidate-fixture", rowNumber: 4, reviewStamp: "review-version-fixture", rawName: "Saved Fixture Match", candidateName: "Fixture Match", category: "Coffee", city: "Kyoto", area: "Nakagyo", candidateAddress: "2 Fixture Street, Kyoto",
      candidateLatitude: 35.02, candidateLongitude: 135.77, candidateGoogleMapsUrl: "https://www.google.com/maps/search/?api=1&query=Fixture+Match", candidateGooglePlaceId: "fixture-matching-id", status: "location", loved: null, notes: "Compare the captured name and map pin.", validationIssues: [], warnings: ["Google Place ID also belongs to Fixture Cafe. Check whether this is the same venue."],
    }],
  };
}
export function emptySnapshot() {
  const snapshot = populatedSnapshot();
  return { ...snapshot, captures: [], candidates: [], status: { ...snapshot.status,
    capture: { new: 0, ready: 0, enriched: 0, other: 0, total: 0 },
    review: { candidate: 0, verified: 0, other: 0, total: 0 }, recommendedAction: "up_to_date", validationErrors: 0, validationIssues: [],
  } };
}
export function conflictPreview() {
  return {
    wrote: false, previewHash: "fixture-conflict-preview", canApply: false, rowsRead: 1, inserted: 0, updated: 0, skipped: 0, changes: [], validationErrors: [], publishedTabId: 123,
    verificationConflicts: [{ id: fixturePlace.id, name: fixturePlace.name, rowNumber: 5,
      fields: [{ field: "address", before: fixturePlace.address, after: "9 Corrected Street, Kyoto" }],
      local: fixturePlace, published: { ...fixturePlace, address: "9 Corrected Street, Kyoto" },
    }],
  };
}
export type AdminFixtureState = {
  snapshot: ReturnType<typeof populatedSnapshot> | ReturnType<typeof emptySnapshot>;
  failSnapshot: boolean;
  snapshotGate?: Promise<void>;
  extractGate?: Promise<void>;
  reviewGate?: Promise<void>;
  failReview?: boolean;
  failPublish?: boolean;
  failScreenshotSend?: boolean;
  extractRequests: string[][];
  calls: Array<{ path: string; body: Record<string, unknown> }>;
  syncPreview: Record<string, unknown>;
  unknownRequests: string[];
};

/** All admin requests terminate in this fixture. Nothing reaches a live provider or Sheet. */
export async function installAdminFixtures(page: Page): Promise<AdminFixtureState> {
  const state: AdminFixtureState = {
    snapshot: populatedSnapshot(), failSnapshot: false, extractRequests: [], calls: [],
    syncPreview: conflictPreview(), unknownRequests: [],
  };
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/api/admin/places" && request.method() === "GET") return json({ places: [fixturePlace] });
    if (path === "/api/admin/place-pipeline/snapshot" && request.method() === "GET") {
      if (state.snapshotGate) await state.snapshotGate;
      return state.failSnapshot ? json({ error: "Fixture connection failed. Run pnpm setup:google-sheets, then Retry." }, 503) : json(state.snapshot);
    }
    if (path === "/api/admin/screenshot-intake/extract") {
      const form = await new Request("http://fixture.test", { method: "POST", headers: { "Content-Type": request.headers()["content-type"] }, body: new Uint8Array(request.postDataBuffer()!) }).formData();
      const imageIds = form.getAll("imageIds").map(String);
      const files = form.getAll("images") as File[];
      state.extractRequests.push(imageIds);
      const round = state.extractRequests.length;
      if (state.extractGate) await state.extractGate;
      return json({ results: imageIds.map((imageId, index) => round === 1 && index === 1
        ? { imageId, fileName: files[index].name, status: "error", error: "Fixture provider failed. Retry this image." }
        : { imageId, fileName: files[index].name, status: "success", rows: [{ fileName: files[index].name, rawName: round === 1 ? "Extracted Fixture Cafe" : "Retried Fixture Cafe", cityHint: "Kyoto", countryHint: "Japan", rawText: "Visible fixture text." }] }) });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    state.calls.push({ path, body });
    if (path === "/api/admin/place-pipeline/capture-ready") {
      state.snapshot = { ...state.snapshot, captures: [], status: { ...state.snapshot.status, capture: { ...state.snapshot.status.capture, new: 0, ready: 1 } } };
      return json({ readyCount: 1 });
    }
    if (path === "/api/admin/place-pipeline/sync-published") return json(state.syncPreview);
    if (path === "/api/admin/place-pipeline/review-new") {
      if (state.reviewGate) await state.reviewGate;
      return state.failReview ? json({ error: "Fixture lookup failed." }, 503) : json({ enrichedRows: 1 });
    }
    if (path === "/api/admin/place-pipeline/publish-approved" && state.failPublish) return json({ error: "Fixture Publish failed." }, 503);
    if (path === "/api/admin/place-pipeline/publish-approved") return json({ mode: "preview", wrote: false, canApply: true, rowsToPublish: 1, rowsToUpdate: 0, previewHash: "fixture-publish-preview", validationIssues: 0, validationErrors: [], verifiedRowsFound: 1 });
    if (path === "/api/admin/place-pipeline/resolve-conflict") return json({ updated: true });
    if (path === "/api/admin/screenshot-intake/send-to-capture" && state.failScreenshotSend) return json({ error: "Fixture Capture connection failed. Your drafts are kept. Retry Send to Capture." }, 503);
    if (path === "/api/admin/screenshot-intake/send-to-capture") return json({ rowsCreated: 2, rowsSkipped: 0, results: [] });
    state.unknownRequests.push(`${request.method()} ${path}`);
    return json({ error: "Unexpected fixture endpoint. Live requests are blocked." }, 500);
  });
  await page.route(/https:\/\/(maps|places)\.googleapis\.com\//, (route) => route.abort());
  return state;
}
