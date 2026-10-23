import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readPlacesJsonSnapshot, writePlacesJsonAtomic } from "../src/lib/places-json-store";

// Use only district names written explicitly in the saved address.
// Do not infer districts from a pin or change existing editorial labels.
const snapshot = readPlacesJsonSnapshot();
const changes: { id: string; name: string; field: "district"; before: string; after: string; evidence: string }[] = [];
const updated = snapshot.places.map((place) => {
  if (place.district || !["Tainan", "Kaohsiung"].includes(place.city)) return place;
  const match = place.address.match(/\b(West Central|Anping|East|North|South|Rende|Yongkang|Annan|Zuoying|Gushan|Lingya|Qianjin|Xinxing|Sanmin|Yancheng|Fengshan|Nanzi|Qianzhen|Xiaogang) District\b/);
  if (!match) return place;
  changes.push({ id: place.id, name: place.name, field: "district", before: place.district, after: match[1], evidence: place.address });
  return { ...place, district: match[1] };
});
const reportDirectory = resolve("docs/audits/2026-10-23-implementation");
mkdirSync(reportDirectory, { recursive: true });
if (process.argv.includes("--apply") && changes.length) {
  const saved = writePlacesJsonAtomic(updated, { expectedFileHash: snapshot.fileHash });
  writeFileSync(resolve(reportDirectory, "district-changes.json"), JSON.stringify({ originalHash: snapshot.fileHash, ...saved, changes }, null, 2) + "\n");
  console.log(`Filled ${changes.length} districts. Backup: ${saved.backupPath}`);
} else console.log(JSON.stringify({ preview: true, changes }, null, 2));
