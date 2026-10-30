import { createHash, randomUUID } from "node:crypto";
import type { Place } from "@/lib/place";
import { getPlaceFieldErrors } from "@/lib/place-validation";
import { normalizePlaceCity } from "@/lib/place-city";
import { isPublicPlace } from "@/lib/filtering";
import { toPublicPlace } from "@/lib/public-place";

export type CatalogueCandidate = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  googleMapsUrl: string;
  googlePlaceId: string;
  category: string;
  district: string;
  businessStatus?: string;
};
export type CatalogueInput = {
  name: string;
  city: string;
  source?: string;
  mapsUrl?: string;
};
export type Publication = {
  id: string;
  at: string;
  action: "publish" | "remove" | "undo";
  before: Place | null;
  beforeArchived: boolean;
  after: Place | null;
};
export type CatalogueEntry = {
  id: string;
  version: string;
  input: CatalogueInput;
  draft: Place | null;
  live: Place | null;
  archived: boolean;
  candidates: CatalogueCandidate[];
  confirmedMatch: string | null;
  lookupError: string | null;
  lookupCompleted: boolean;
  updatedAt: string;
  publicVersion: string | null;
  publicChangedAt: string | null;
  history: Publication[];
  lastOperationId?: string;
  rejectedMatches?: string[];
  categoryEdited?: boolean;
  matchRejected?: boolean;
};
export type PublicCatalogue = {
  revision: string;
  places: Place[];
  versions: Record<string, string>;
};
export class CatalogueError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function catalogueKey(name: string, city: string) {
  return `${name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase()}\0${normalizePlaceCity(city).toLocaleLowerCase()}`;
}
export function matchFingerprint(place: Place) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        place.name,
        place.city,
        place.address,
        place.latitude,
        place.longitude,
        place.googleMapsUrl ?? "",
        place.googlePlaceId ?? "",
      ]),
    )
    .digest("hex");
}
export function createCatalogueEntry(
  input: CatalogueInput,
  id: string = randomUUID(),
): CatalogueEntry {
  const name = input.name.trim(),
    city = normalizePlaceCity(input.city);
  if (!name || !city || name.length > 300 || city.length > 150)
    throw new CatalogueError("Enter a place name and city.");
  return {
    id,
    version: randomUUID(),
    input: { ...input, name, city },
    draft: null,
    live: null,
    archived: false,
    candidates: [],
    confirmedMatch: null,
    lookupError: null,
    lookupCompleted: false,
    updatedAt: new Date().toISOString(),
    publicVersion: null,
    publicChangedAt: null,
    history: [],
  };
}
export function seedCatalogueEntry(place: Place): CatalogueEntry {
  const entry = createCatalogueEntry(
    { name: place.name, city: place.city },
    place.id,
  );
  return {
    ...entry,
    live: structuredClone(place),
    archived: !isPublicPlace(place),
    publicVersion: `seed-${matchFingerprint(place)}`,
    publicChangedAt: place.lastChecked || entry.updatedAt,
    lookupCompleted: true,
  };
}
export function beginCatalogueEdit(entry: CatalogueEntry): CatalogueEntry {
  if (!entry.live)
    throw new CatalogueError("This place has no published version.");
  if (entry.draft) return entry;
  return {
    ...entry,
    draft: structuredClone(entry.live),
    confirmedMatch:
      entry.live.verifiedStatus === "Yes" ? matchFingerprint(entry.live) : null,
  };
}
export function selectCatalogueCandidate(
  entry: CatalogueEntry,
  candidate: CatalogueCandidate,
): CatalogueEntry {
  const editorial = entry.draft ?? entry.live;
  const draft: Place = {
    ...editorial,
    id: entry.id,
    name: candidate.name,
    city: entry.input.city,
    category:
      (entry.live || entry.categoryEdited
        ? editorial?.category
        : candidate.category) ||
      candidate.category ||
      "Shop",
    district:
      candidate.district ||
      (editorial?.googlePlaceId === candidate.googlePlaceId
        ? editorial?.district
        : "") ||
      "",
    address: candidate.address,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    googleMapsUrl: candidate.googleMapsUrl,
    googlePlaceId: candidate.googlePlaceId,
    status: editorial?.status ?? "location",
    loved: editorial?.loved ?? null,
    tabelog: editorial?.tabelog ?? "",
    subway: editorial?.subway ?? "",
    notes: editorial?.notes ?? [],
  };
  // Old scores and evidence describe the previous venue, not this candidate.
  for (const field of [
    "canonicalName",
    "canonicalAddress",
    "verifiedLatitude",
    "verifiedLongitude",
    "verificationDecision",
    "verificationSource",
    "verificationNotes",
    "samePlaceDecision",
    "samePlaceReason",
    "matchConfidence",
    "nameScore",
    "addressScore",
    "cityScore",
    "districtScore",
    "countryScore",
    "ambiguityScore",
    "distanceDeltaMeters",
  ] as const)
    delete draft[field];
  draft.verifiedStatus = "Review";
  draft.businessStatus = candidate.businessStatus;
  return {
    ...entry,
    draft,
    matchRejected:
      entry.rejectedMatches?.includes(matchFingerprint(draft)) ?? false,
    confirmedMatch: null,
    lookupError: null,
    lookupCompleted: true,
  };
}
export function saveCatalogueDraft(
  entry: CatalogueEntry,
  patch: Record<string, unknown>,
  confirmMatch: boolean,
): CatalogueEntry {
  if (!entry.draft)
    throw new CatalogueError("Choose a Maps result before editing the draft.");
  const allowed = [
    "name",
    "city",
    "category",
    "district",
    "address",
    "latitude",
    "longitude",
    "googleMapsUrl",
    "googlePlaceId",
    "status",
    "loved",
    "notes",
  ];
  if (Object.keys(patch).some((key) => !allowed.includes(key)))
    throw new CatalogueError("This draft contains an unsupported field.");
  const draft = { ...entry.draft, ...patch } as Place;
  const errors = getPlaceFieldErrors(draft);
  if (errors.length) throw new CatalogueError(errors.join(" "));
  draft.city = normalizePlaceCity(draft.city);
  const fingerprint = matchFingerprint(draft);
  return {
    ...entry,
    draft,
    categoryEdited:
      entry.categoryEdited ||
      ("category" in patch && patch.category !== entry.draft.category),
    matchRejected: entry.rejectedMatches?.includes(fingerprint) ?? false,
    confirmedMatch: confirmMatch
      ? fingerprint
      : entry.confirmedMatch === fingerprint
        ? fingerprint
        : null,
  };
}
export function publishCatalogueEntry(
  entry: CatalogueEntry,
  operationId: string,
): CatalogueEntry {
  if (!entry.draft) throw new CatalogueError("There is no draft to publish.");
  const errors = getPlaceFieldErrors(entry.draft);
  if (errors.length) throw new CatalogueError(errors.join(" "));
  if (
    !entry.draft.address.trim() ||
    !entry.draft.googleMapsUrl ||
    !entry.draft.googlePlaceId
  )
    throw new CatalogueError(
      "Choose a complete Google Maps result before publishing.",
    );
  if (entry.confirmedMatch !== matchFingerprint(entry.draft))
    throw new CatalogueError(
      "Check the place and map pin, then confirm the match before publishing.",
    );
  if (entry.rejectedMatches?.includes(matchFingerprint(entry.draft)))
    throw new CatalogueError(
      "You marked this match wrong. Choose another result or correct the venue and pin before publishing.",
    );
  if (entry.draft.businessStatus === "CLOSED_PERMANENTLY")
    throw new CatalogueError(
      "Google marks this place permanently closed. Choose another result before publishing.",
    );
  const at = new Date().toISOString(),
    version = randomUUID();
  const live: Place = {
    ...entry.draft,
    verifiedStatus: "Yes",
    verificationSource: "manual",
    verificationDecision: "manually_verified",
    lastChecked: at,
  };
  return {
    ...entry,
    live,
    draft: null,
    archived: false,
    confirmedMatch: null,
    publicVersion: version,
    publicChangedAt: at,
    lastOperationId: operationId,
    history: [
      ...entry.history,
      {
        id: version,
        at,
        action: "publish",
        before: entry.live,
        beforeArchived: entry.archived,
        after: live,
      },
    ],
  };
}
export function removeCatalogueEntry(
  entry: CatalogueEntry,
  operationId: string,
): CatalogueEntry {
  if (!entry.live || entry.archived)
    throw new CatalogueError("This place is not live.");
  const at = new Date().toISOString(),
    version = randomUUID();
  return {
    ...entry,
    archived: true,
    publicVersion: version,
    publicChangedAt: at,
    lastOperationId: operationId,
    history: [
      ...entry.history,
      {
        id: version,
        at,
        action: "remove",
        before: entry.live,
        beforeArchived: false,
        after: null,
      },
    ],
  };
}
export function undoCataloguePublication(
  entry: CatalogueEntry,
  publicationId: string,
  operationId: string,
): CatalogueEntry {
  const previous = entry.history.at(-1);
  if (!previous || previous.id !== publicationId || previous.action === "undo")
    throw new CatalogueError(
      "This publication changed. Refresh before undoing it.",
      409,
    );
  const at = new Date().toISOString(),
    version = randomUUID();
  return {
    ...entry,
    live: previous.before,
    archived: previous.beforeArchived,
    publicVersion: version,
    publicChangedAt: at,
    lastOperationId: operationId,
    history: [
      ...entry.history,
      {
        id: version,
        at,
        action: "undo",
        before: entry.live,
        beforeArchived: entry.archived,
        after: previous.before,
      },
    ],
  };
}
export function getPublicCatalogue(entries: CatalogueEntry[]): PublicCatalogue {
  const live = entries
    .filter((e) => e.live && !e.archived && isPublicPlace(e.live))
    .sort((a, b) => a.id.localeCompare(b.id));
  const versions = Object.fromEntries(
    live.map((e) => [e.id, e.publicVersion ?? e.version]),
  );
  return {
    revision: createHash("sha256")
      .update(JSON.stringify(versions))
      .digest("hex"),
    places: live.map((e) => ({
      ...toPublicPlace(e.live!),
      city: normalizePlaceCity(e.live!.city),
    })),
    versions,
  };
}
