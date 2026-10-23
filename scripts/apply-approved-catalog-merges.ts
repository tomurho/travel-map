import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPlaceRecordVersion } from "../src/lib/place-record-version";
import { readPlacesJsonSnapshot, writePlacesJsonAtomic } from "../src/lib/places-json-store";
import type { Place } from "../src/lib/place";

const directory = resolve("docs/audits/2026-10-23-implementation");
const proposals = JSON.parse(readFileSync(resolve(directory, "catalog-proposals.json"), "utf8")) as {
  duplicates: Array<{ googlePlaceId: string; before: Place[]; proposedAfter: Place[]; proposedIdMapping: Record<string, string> }>;
};
const snapshot = readPlacesJsonSnapshot();
const approved = proposals.duplicates.filter((group) => Object.keys(group.proposedIdMapping).length);
const mappings = Object.assign({}, ...approved.map((group) => group.proposedIdMapping)) as Record<string, string>;
const byId = new Map(snapshot.places.map((place) => [place.id, place]));
const alreadyApplied = Object.entries(mappings).every(([oldId, retainedId]) => !byId.has(oldId) && byId.has(retainedId));
if (alreadyApplied) {
  console.log("The seven approved merges are already applied. No records changed.");
} else {
  for (const group of approved) {
    for (const before of group.before) {
      const current = byId.get(before.id);
      if (!current || getPlaceRecordVersion(current) !== getPlaceRecordVersion(before)) throw new Error(`${before.id} changed after the proposal. Review it before applying.`);
    }
    for (const oldId of Object.keys(group.proposedIdMapping)) byId.delete(oldId);
    for (const after of group.proposedAfter) byId.set(after.id, after);
  }
  const dayTrip = byId.get("place_taipei_anan_sushi");
  if (!dayTrip || dayTrip.city !== "Taipei") throw new Error("The approved Taipei day-trip record changed. Review it before applying.");
  const note = "Day trip from Taipei: Zhubei, Hsinchu.";
  const notes = Array.isArray(dayTrip.notes) ? dayTrip.notes : dayTrip.notes ? [dayTrip.notes] : [];
  byId.set(dayTrip.id, { ...dayTrip, notes: notes.includes(note) ? notes : [...notes, note] });
  const places = snapshot.places.filter((place) => !mappings[place.id]).map((place) => byId.get(place.id)!);
  if (process.argv.includes("--apply")) {
    const saved = writePlacesJsonAtomic(places, { expectedFileHash: snapshot.fileHash });
    writeFileSync(resolve("src/data/place-id-aliases.json"), JSON.stringify(mappings, null, 2) + "\n");
    writeFileSync(resolve(directory, "approved-merges.json"), JSON.stringify({ approvedAt: "2026-10-23", authorization: "Apply seven merges; keep 鮨安 as a Taipei day trip", beforeHash: snapshot.fileHash, ...saved, recordsBefore: snapshot.places.length, recordsAfter: places.length, idMappings: mappings, merges: approved, dayTrip: { before: dayTrip, after: byId.get(dayTrip.id) } }, null, 2) + "\n");
    console.log(`Merged seven pairs: ${snapshot.places.length} → ${places.length} records. Backup: ${saved.backupPath}`);
  } else console.log(JSON.stringify({ preview: true, merges: approved.length, idMappings: mappings, recordsAfter: places.length, dayTrip: byId.get(dayTrip.id) }, null, 2));
}
