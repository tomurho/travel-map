import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assessImportSafety } from "@/lib/import-safety";
import { isAdminAuthorized } from "@/lib/admin-auth";
import {
  assertPublishedSyncCanWrite,
  buildCaptureIntakeKey,
  buildPublishedSyncPlan,
  buildPublishedUpsertPlan,
  shouldReconcileCapture,
} from "@/lib/place-sheet-pipeline";
import type { Place } from "@/lib/place";
import {
  readPlacesJsonSnapshot,
  writePlacesJsonAtomic,
} from "@/lib/places-json-store";

function place(id: string, name = id): Place {
  return {
    address: "1 Test Street",
    category: "Cafe",
    city: "Test City",
    district: "Center",
    id,
    latitude: 1.3,
    loved: null,
    longitude: 103.8,
    name,
    status: "location",
    subway: "",
    tabelog: "",
  };
}

test("places store writes atomically, creates a backup, and rejects stale writers", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "travel-map-store-"));
  const filePath = path.join(directory, "places.json");
  const backupDirectory = path.join(directory, "backups");

  try {
    const emptySnapshot = readPlacesJsonSnapshot(filePath, { allowMissing: true });
    writePlacesJsonAtomic([place("one")], {
      backupDirectory,
      expectedFileHash: emptySnapshot.fileHash,
      filePath,
    });
    const firstSnapshot = readPlacesJsonSnapshot(filePath);
    const secondWrite = writePlacesJsonAtomic([place("one", "Updated")], {
      backupDirectory,
      expectedFileHash: firstSnapshot.fileHash,
      filePath,
    });

    assert.ok(secondWrite.backupPath);
    assert.deepEqual(
      JSON.parse(readFileSync(secondWrite.backupPath as string, "utf8")),
      [place("one")],
    );
    assert.throws(
      () =>
        writePlacesJsonAtomic([place("one", "Stale")], {
          backupDirectory,
          expectedFileHash: firstSnapshot.fileHash,
          filePath,
        }),
      /changed after it was read/,
    );
    assert.equal(readPlacesJsonSnapshot(filePath).places[0]?.name, "Updated");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("places store rejects duplicate ids before touching disk", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "travel-map-store-"));
  const filePath = path.join(directory, "places.json");

  try {
    assert.throws(
      () => writePlacesJsonAtomic([place("same"), place("same")], { filePath }),
      /Duplicate place id/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("places store never removes a lock owned by another writer", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "travel-map-store-"));
  const filePath = path.join(directory, "places.json");
  const lockPath = `${filePath}.lock`;

  try {
    writeFileSync(lockPath, "active writer\n");
    assert.throws(
      () => writePlacesJsonAtomic([place("one")], { filePath }),
      /Another places\.json write is in progress/,
    );
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("import safety blocks empty, partial, ambiguous, and large-drop writes", () => {
  const assessment = assessImportSafety({
    allowAmbiguousIds: false,
    allowLargeDrop: false,
    allowSkippedRows: false,
    ambiguousIdMatches: 2,
    currentCount: 100,
    nextCount: 0,
    skippedRows: 3,
  });

  assert.equal(assessment.issues.length, 4);
  assert.equal(assessment.dropRatio, 1);
});

test("capture intake keys are stable and distinguish different source evidence", () => {
  const fields = {
    cityHint: "Kyoto",
    countryHint: "Japan",
    rawName: "Example Cafe",
    rawText: "Example Cafe near Kyoto Station",
    sourceScreenshot: "capture.png",
  };
  const key = buildCaptureIntakeKey(fields);

  assert.equal(buildCaptureIntakeKey({ ...fields }), key);
  assert.notEqual(
    buildCaptureIntakeKey({ ...fields, rawText: "Different evidence" }),
    key,
  );
  assert.equal(shouldReconcileCapture(new Set([key]), fields), true);
  assert.equal(shouldReconcileCapture(new Set(), fields), false);
});

test("Published writes fail closed unless partial sync is explicit", () => {
  assert.throws(
    () => assertPublishedSyncCanWrite({ validationErrorCount: 1 }),
    /Refusing to write/,
  );
  assert.doesNotThrow(() =>
    assertPublishedSyncCanWrite({ allowPartial: true, validationErrorCount: 1 }),
  );
  assert.doesNotThrow(() =>
    assertPublishedSyncCanWrite({ validationErrorCount: 0 }),
  );
});

test("admin authorization uses the header and fails closed in production", () => {
  assert.equal(
    isAdminAuthorized(
      { headers: new Headers({ "x-admin-password": "secret" }) },
      { adminPassword: "secret", nodeEnv: "production" },
    ),
    true,
  );
  assert.equal(
    isAdminAuthorized(
      { headers: new Headers({ "x-admin-password": "wrong" }) },
      { adminPassword: "secret", nodeEnv: "production" },
    ),
    false,
  );
  assert.equal(
    isAdminAuthorized(
      { headers: new Headers() },
      { adminPassword: "", nodeEnv: "production" },
    ),
    false,
  );
});

test("Published planning appends new ids, updates corrections, and skips unchanged rows", () => {
  const headers = [
    "id",
    "name",
    "category",
    "area",
    "city",
    "address",
    "latitude",
    "longitude",
    "googleMapsUrl",
    "googlePlaceId",
    "status",
    "loved",
    "notes",
    "verifiedStatus",
    "lastChecked",
  ];
  const reviewRow = (id: string, name: string) => ({
    area: "Center",
    candidateAddress: "1 Test Street",
    candidateGoogleMapsUrl: "https://maps.example/place",
    candidateGooglePlaceId: `google-${id}`,
    candidateLatitude: "1.3",
    candidateLongitude: "103.8",
    candidateName: name,
    category: "Cafe",
    city: "Test City",
    id,
    loved: "FALSE",
    notes: "",
    reviewStatus: "Verified",
    status: "Location",
  });
  const existingValues = [
    headers,
    [
      "same",
      "Same",
      "Cafe",
      "Center",
      "Test City",
      "1 Test Street",
      "1.3",
      "103.8",
      "https://maps.example/place",
      "google-same",
      "Location",
      "FALSE",
      "",
      "Verified",
      "old-date",
    ],
    [
      "changed",
      "Old name",
      "Cafe",
      "Center",
      "Test City",
      "1 Test Street",
      "1.3",
      "103.8",
      "https://maps.example/place",
      "google-changed",
      "Location",
      "FALSE",
      "",
      "Verified",
      "old-date",
    ],
  ];

  const plan = buildPublishedUpsertPlan({
    approvedRows: [
      reviewRow("same", "Same"),
      reviewRow("changed", "Corrected name"),
      reviewRow("new", "New place"),
    ],
    lastChecked: "new-date",
    publishedHeaders: headers,
    publishedValues: existingValues,
  });

  assert.equal(plan.appendRows.length, 1);
  assert.equal(plan.updateRows.length, 1);
  assert.deepEqual(plan.unchangedIds, ["same"]);
  assert.equal(plan.updateRows[0]?.id, "changed");
});

test("Published planning rejects ambiguous duplicate ids", () => {
  const headers = ["id", "name", "lastChecked"];

  assert.throws(
    () =>
      buildPublishedUpsertPlan({
        approvedRows: [],
        lastChecked: "today",
        publishedHeaders: headers,
        publishedValues: [headers, ["duplicate", "One"], ["duplicate", "Two"]],
      }),
    /Published contains duplicate id/,
  );
});

test("Published sync planning counts only actionable app changes", () => {
  const headers = [
    "id",
    "name",
    "category",
    "area",
    "city",
    "address",
    "latitude",
    "longitude",
    "googleMapsUrl",
    "googlePlaceId",
    "status",
    "loved",
    "notes",
    "verifiedStatus",
    "lastChecked",
  ];
  const publishedRow = (id: string, name: string) => [
    id,
    name,
    "Cafe",
    "Center",
    "Test City",
    "1 Test Street",
    "1.3",
    "103.8",
    "https://maps.example/place",
    "",
    "Location",
    "",
    "",
    "Verified",
    "",
  ];
  const unchanged = {
    ...place("same", "Same"),
    googleMapsUrl: "https://maps.example/place",
    googlePlaceId: "",
    lastChecked: "",
    notes: [],
    verifiedStatus: "Yes" as const,
  };
  const plan = buildPublishedSyncPlan({
    currentPlaces: [unchanged, place("changed", "Old name")],
    publishedHeaders: headers,
    publishedValues: [
      headers,
      publishedRow("same", "Same"),
      publishedRow("changed", "Corrected name"),
      publishedRow("new", "New place"),
      [],
    ],
  });

  assert.equal(plan.rowsRead, 3);
  assert.equal(plan.inserted, 1);
  assert.equal(plan.updated, 1);
  assert.equal(plan.skipped, 1);
  assert.equal(plan.validationErrors.length, 0);
  assert.deepEqual(
    plan.changes.map((change) => [change.action, change.id]),
    [
      ["update", "changed"],
      ["insert", "new"],
    ],
  );
});

test("Published sync planning reports invalid rows without treating them as changes", () => {
  const headers = ["id", "name", "verifiedStatus"];
  const plan = buildPublishedSyncPlan({
    currentPlaces: [],
    publishedHeaders: headers,
    publishedValues: [headers, ["bad", "Incomplete", "Verified"]],
  });

  assert.equal(plan.inserted, 0);
  assert.equal(plan.updated, 0);
  assert.equal(plan.validationErrors.length, 1);
  assert.equal(plan.validationErrors[0]?.id, "bad");
});
