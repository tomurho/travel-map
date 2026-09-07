import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import decisions from "../src/data/place-type-decisions.json";
import { normalizeApprovedPlaceType } from "../src/lib/place-types";
import { readPlacesJsonSnapshot, writePlacesJsonAtomic } from "../src/lib/places-json-store";

// A fixed, reviewed migration. Preview by default; --apply writes this snapshot only.
const apply = process.argv.includes("--apply");
assert.ok(process.argv.slice(2).every((arg) => arg === "--apply"), "Only --apply is supported.");
const source = readPlacesJsonSnapshot();
const changes: { id: string; name: string; city: string; before: string; after: string }[] = [];
const next = source.places.map((place) => {
  const category = normalizeApprovedPlaceType(place.category);
  if (category === place.category) return place;
  changes.push({ id: place.id, name: place.name, city: place.city, before: place.category, after: category });
  return { ...place, category };
});
assert.deepEqual(next.map(({ category: _, ...place }) => place), source.places.map(({ category: _, ...place }) => place));
const report = {
  sourceHash: source.fileHash,
  decisionRule: decisions.decisionRule,
  places: source.places.length,
  typesBefore: new Set(source.places.map((place) => place.category)).size,
  typesAfter: new Set(next.map((place) => place.category)).size,
  approvedTypeDecisions: decisions.types.filter((type) => type.decision === "approved").length,
  deferredTypes: decisions.types.filter((type) => type.decision === "deferred").map((type) => type.sourceType),
  changedPlaces: changes.length,
  changes,
};
if (apply && changes.length) {
  assert.equal(source.fileHash, decisions.sourceSha256, "Dataset differs from the reviewed snapshot. Reconcile it before applying this migration.");
  const output = path.resolve("outputs/type-reconciliation-2026-09-07/applied");
  mkdirSync(output, { recursive: true });
  // Save the exact planned changes before writing, even if the subsequent write fails.
  writeFileSync(path.join(output, "planned-changes.json"), `${JSON.stringify(report, null, 2)}\n`);
  const result = writePlacesJsonAtomic(next, { expectedFileHash: source.fileHash });
  writeFileSync(path.join(output, "applied-changes.json"), `${JSON.stringify({ ...report, ...result, appliedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(JSON.stringify({ applied: true, changedPlaces: changes.length, backupPath: result.backupPath, report: path.join(output, "applied-changes.json") }, null, 2));
} else {
  console.log(JSON.stringify({ ...report, changes: undefined, applied: false }, null, 2));
}
