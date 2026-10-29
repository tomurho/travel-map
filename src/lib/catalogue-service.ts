import { randomUUID } from "node:crypto";
import {
  beginCatalogueEdit,
  matchFingerprint,
  catalogueKey,
  CatalogueError,
  createCatalogueEntry,
  publishCatalogueEntry,
  removeCatalogueEntry,
  saveCatalogueDraft,
  selectCatalogueCandidate,
  undoCataloguePublication,
  type CatalogueEntry,
  type CatalogueInput,
} from "@/lib/catalogue";
import type { CatalogueStore } from "@/lib/catalogue-store";
import { lookupCataloguePlaces } from "@/lib/catalogue-lookup";

export async function addCataloguePlace(
  store: CatalogueStore,
  input: CatalogueInput,
  requestId: string,
) {
  const entries = await store.list();
  const existing = entries.find(
    (e) =>
      e.id === requestId ||
      catalogueKey(e.input.name, e.input.city) ===
        catalogueKey(input.name, input.city) ||
      (e.live &&
        catalogueKey(e.live.name, e.live.city) ===
          catalogueKey(input.name, input.city)),
  );
  if (existing) return { entry: existing, duplicate: true };
  const entry = createCatalogueEntry(input, requestId);
  if (!(await store.create(entry)))
    return { entry: (await store.get(entry.id))!, duplicate: true };
  return { entry, duplicate: false };
}
export async function lookupCatalogueEntry(
  store: CatalogueStore,
  id: string,
  expectedVersion: string,
  options: { query?: string; mapsUrl?: string; city?: string } = {},
  lookup = lookupCataloguePlaces,
) {
  const entry = await requireEntry(store, id, expectedVersion);
  const lookupInput = {
    ...entry.input,
    city: options.city?.trim() || entry.draft?.city || entry.input.city,
  };
  let next: CatalogueEntry;
  try {
    const candidates = await lookup(lookupInput, options);
    next = {
      ...entry,
      input: lookupInput,
      candidates,
      lookupError: null,
      lookupCompleted: true,
    };
    // A suggestion is never a verified match. Existing editorial settings survive a new lookup.
    if (!entry.draft && !entry.live) {
      const first = candidates.find(
        (c) => c.businessStatus !== "CLOSED_PERMANENTLY",
      );
      if (first) next = selectCatalogueCandidate(next, first);
      else
        next.lookupError =
          "All results are marked permanently closed. Search again for the intended place.";
    }
  } catch (error) {
    next = {
      ...entry,
      lookupError:
        error instanceof Error
          ? error.message
          : "Lookup failed. Retry shortly.",
    };
  }
  return commitEntry(store, entry, next);
}
export async function requireEntry(
  store: CatalogueStore,
  id: string,
  version: string,
) {
  const entry = await store.get(id);
  if (!entry) throw new CatalogueError("This place no longer exists.", 404);
  if (entry.version !== version)
    throw new CatalogueError(
      "This place changed after you opened it. Refresh and review the latest version.",
      409,
    );
  return entry;
}
async function commitEntry(
  store: CatalogueStore,
  before: CatalogueEntry,
  next: CatalogueEntry,
) {
  const result = {
    ...next,
    version: randomUUID(),
    updatedAt: new Date().toISOString(),
  };
  if (!(await store.replace(result, before.version)))
    throw new CatalogueError(
      "This place changed while saving. Refresh and review the latest version.",
      409,
    );
  return result;
}
export type CatalogueAction = {
  action:
    | "edit"
    | "discard"
    | "select"
    | "save"
    | "wrong"
    | "publish"
    | "remove"
    | "undo";
  expectedVersion: string;
  operationId: string;
  candidateId?: string;
  patch?: Record<string, unknown>;
  confirmMatch?: boolean;
  publicationId?: string;
};
export async function actOnCatalogueEntry(
  store: CatalogueStore,
  id: string,
  input: CatalogueAction,
) {
  // Replaying a successful publication acknowledges the same result; it never writes twice.
  const current = await store.get(id);
  if (
    current?.lastOperationId === input.operationId &&
    ["publish", "remove", "undo"].includes(input.action)
  )
    return current;
  const entry = await requireEntry(store, id, input.expectedVersion);
  let next: CatalogueEntry;
  switch (input.action) {
    case "edit":
      next = beginCatalogueEdit(entry);
      break;
    case "discard":
      next = { ...entry, draft: null, confirmedMatch: null, lookupError: null };
      break;
    case "wrong": {
      const saved = input.patch
        ? saveCatalogueDraft(entry, input.patch, false)
        : entry;
      next = {
        ...saved,
        confirmedMatch: null,
        matchRejected: true,
        rejectedMatches: [
          ...(entry.rejectedMatches ?? []),
          ...(saved.draft ? [matchFingerprint(saved.draft)] : []),
        ],
        lookupError:
          "Choose another result, search again, or paste the correct Maps link.",
      };
      break;
    }
    case "select": {
      const candidate = entry.candidates.find(
        (c) => c.googlePlaceId === input.candidateId,
      );
      if (!candidate)
        throw new CatalogueError(
          "That result is no longer available. Search again.",
        );
      if (candidate.businessStatus === "CLOSED_PERMANENTLY")
        throw new CatalogueError(
          "Google marks this place permanently closed. Choose another result.",
        );
      next = selectCatalogueCandidate(entry, candidate);
      break;
    }
    case "save":
      next = saveCatalogueDraft(
        entry,
        input.patch ?? {},
        input.confirmMatch === true,
      );
      break;
    case "publish": {
      const duplicate = (await store.list()).find(
        (other) =>
          other.id !== id &&
          !other.archived &&
          other.live &&
          other.live.googlePlaceId &&
          other.live.googlePlaceId === entry.draft?.googlePlaceId,
      );
      if (duplicate)
        throw new CatalogueError(
          `This Maps venue is already live as ${duplicate.live!.name}. Edit that existing place instead.`,
          409,
        );
      next = publishCatalogueEntry(entry, input.operationId);
      break;
    }
    case "remove":
      next = removeCatalogueEntry(entry, input.operationId);
      break;
    case "undo":
      next = undoCataloguePublication(
        entry,
        input.publicationId ?? "",
        input.operationId,
      );
      break;
    default:
      throw new CatalogueError("Unknown catalogue action.");
  }
  return commitEntry(store, entry, next);
}
