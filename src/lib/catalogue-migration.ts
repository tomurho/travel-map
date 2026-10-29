import aliases from "@/data/place-id-aliases.json";
import type { Place } from "@/lib/place";
import { validatePlacesDataset } from "@/lib/places-json-store";
import {
  createCatalogueEntry,
  seedCatalogueEntry,
  selectCatalogueCandidate,
  catalogueKey,
  type CatalogueEntry,
  type CatalogueCandidate,
} from "@/lib/catalogue";

type SheetData = { Capture?: string[][]; Review?: string[][] };
export function buildCatalogueMigration(
  places: Place[],
  sheets: SheetData = {},
) {
  validatePlacesDataset(places);
  const entries = places.map(seedCatalogueEntry);
  const ids = new Set(entries.map((e) => e.id)),
    googleIds = new Set(places.map((p) => p.googlePlaceId).filter(Boolean));
  const names = new Set(places.map((p) => catalogueKey(p.name, p.city)));
  const intakeKeys = new Set<string>();
  for (const [tab, values] of Object.entries(sheets).sort(([a], [b]) =>
    a === "Review" ? -1 : b === "Review" ? 1 : 0,
  )) {
    const headers = values[0] ?? [];
    for (const [index, row] of values.slice(1).entries()) {
      const fields = Object.fromEntries(
        headers.map((header, i) => [header, String(row[i] ?? "").trim()]),
      );
      const name = fields.rawName || fields.candidateName,
        city = fields.cityHint || fields.city;
      if (!name || !city) continue;
      if (
        tab === "Capture" &&
        !["new", "ready"].includes((fields.intakeStatus ?? "").toLowerCase())
      )
        continue;
      if (
        tab === "Review" &&
        !["candidate", "verified"].includes(
          (fields.reviewStatus ?? "").toLowerCase(),
        )
      )
        continue;
      const id = (aliases as Record<string, string>)[fields.id] || fields.id;
      if (
        ids.has(id) ||
        googleIds.has(fields.candidateGooglePlaceId) ||
        names.has(catalogueKey(name, city))
      )
        continue;
      if (fields.intakeKey && intakeKeys.has(fields.intakeKey)) continue;
      const newId = id || `capture-${tab.toLowerCase()}-${index + 2}`;
      if (ids.has(newId)) continue;
      let entry = createCatalogueEntry(
        {
          name,
          city,
          source: `Imported from ${tab}, row ${index + 2}\n${JSON.stringify(fields)}`,
        },
        newId,
      );
      const candidate: CatalogueCandidate = {
        name: fields.candidateName,
        address: fields.candidateAddress,
        latitude: Number(fields.candidateLatitude),
        longitude: Number(fields.candidateLongitude),
        googleMapsUrl: fields.candidateGoogleMapsUrl,
        googlePlaceId: fields.candidateGooglePlaceId,
        category: fields.category || "Shop",
        district: fields.area || "",
      };
      if (
        tab === "Review" &&
        candidate.name &&
        candidate.address &&
        candidate.googleMapsUrl &&
        candidate.googlePlaceId &&
        fields.candidateLatitude &&
        fields.candidateLongitude &&
        Number.isFinite(candidate.latitude) &&
        Number.isFinite(candidate.longitude)
      ) {
        entry = selectCatalogueCandidate(
          { ...entry, candidates: [candidate] },
          candidate,
        );
        entry.categoryEdited = true;
        entry.draft!.notes = fields.notes
          ? fields.notes.split(/\n|\s+\|\s+/)
          : [];
        const status = (fields.status ?? "").toLowerCase();
        entry.draft!.status = ["been", "visited"].includes(status)
          ? "been"
          : ["want to go", "want_to_go"].includes(status)
            ? "want_to_go"
            : "location";
        entry.draft!.loved = fields.loved
          ? fields.loved.toLowerCase() === "true"
          : null;
      }
      entries.push(entry);
      ids.add(newId);
      names.add(catalogueKey(name, city));
      if (fields.intakeKey) intakeKeys.add(fields.intakeKey);
    }
  }
  // Existing live records must retain every stored field, including null ratings and evidence.
  for (const place of places) {
    const entry = entries.find((e) => e.id === place.id);
    if (JSON.stringify(entry?.live) !== JSON.stringify(place))
      throw new Error(`Migration changed ${place.id}`);
  }
  return entries;
}
