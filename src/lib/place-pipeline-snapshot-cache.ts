import {
  getPlacePipelineSnapshot,
  type PlacePipelineStatus,
  type ReviewCandidate,
} from "@/lib/place-sheet-pipeline";

const SNAPSHOT_CACHE_TTL_MS = 15_000;

export type PlacePipelineSnapshot = {
  candidates: ReviewCandidate[];
  status: PlacePipelineStatus;
};

type CacheEntry = {
  expiresAt: number;
  snapshot: PlacePipelineSnapshot;
};

const snapshotCache = new Map<string, CacheEntry>();
const snapshotRequests = new Map<string, Promise<PlacePipelineSnapshot>>();

export function invalidatePlacePipelineSnapshot(sheetId: string) {
  snapshotCache.delete(sheetId.trim());
}

export async function getCachedPlacePipelineSnapshot(input: {
  force?: boolean;
  sheetId: string;
}) {
  const sheetId = input.sheetId.trim();

  if (!sheetId) {
    throw new Error("A Google Sheet ID is required.");
  }

  const now = Date.now();
  const cached = snapshotCache.get(sheetId);

  if (!input.force && cached && cached.expiresAt > now) {
    return { cached: true, snapshot: cached.snapshot };
  }

  const existingRequest = snapshotRequests.get(sheetId);

  if (existingRequest) {
    return { cached: false, snapshot: await existingRequest };
  }

  const request = getPlacePipelineSnapshot({ sheetId });
  snapshotRequests.set(sheetId, request);

  try {
    const snapshot = await request;
    snapshotCache.set(sheetId, {
      expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS,
      snapshot,
    });

    return { cached: false, snapshot };
  } finally {
    if (snapshotRequests.get(sheetId) === request) {
      snapshotRequests.delete(sheetId);
    }
  }
}
