import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import type { Place } from "@/lib/place";
import { getPlaceFieldErrors } from "@/lib/place-validation";

export const DEFAULT_PLACES_JSON_PATH = path.resolve(
  process.cwd(),
  "src/data/places.json",
);

export type PlacesJsonSnapshot = {
  fileHash: string;
  filePath: string;
  places: Place[];
  raw: string;
};

type ReadPlacesJsonOptions = {
  allowMissing?: boolean;
};

type WritePlacesJsonOptions = {
  backupDirectory?: string;
  createBackup?: boolean;
  expectedFileHash?: string;
  filePath?: string;
};

export class PlacesJsonWriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlacesJsonWriteConflictError";
  }
}

function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function validatePlace(place: unknown, index: number) {
  const errors = getPlaceFieldErrors(place);
  if (errors.length) throw new Error(`Invalid place at row ${index + 1}: ${errors.join(" ")}`);
}

export function validatePlacesDataset(places: unknown): asserts places is Place[] {
  if (!Array.isArray(places)) {
    throw new Error("Places dataset must be an array.");
  }

  const ids = new Set<string>();

  places.forEach((place, index) => {
    validatePlace(place, index);

    if (ids.has(place.id)) {
      throw new Error(`Duplicate place id: ${place.id}.`);
    }

    ids.add(place.id);
  });
}

export function readPlacesJsonSnapshot(
  filePath = DEFAULT_PLACES_JSON_PATH,
  options: ReadPlacesJsonOptions = {},
): PlacesJsonSnapshot {
  const resolvedPath = path.resolve(filePath);

  if (!existsSync(resolvedPath)) {
    if (!options.allowMissing) {
      throw new Error(`Places dataset was not found at ${resolvedPath}.`);
    }

    const raw = "[]\n";
    return {
      fileHash: hashContent(raw),
      filePath: resolvedPath,
      places: [],
      raw,
    };
  }

  const raw = readFileSync(resolvedPath, "utf8");
  const places = JSON.parse(raw) as Place[];
  validatePlacesDataset(places);

  return {
    fileHash: hashContent(raw),
    filePath: resolvedPath,
    places,
    raw,
  };
}

export function writePlacesJsonAtomic(
  places: Place[],
  options: WritePlacesJsonOptions = {},
) {
  validatePlacesDataset(places);

  const filePath = path.resolve(options.filePath ?? DEFAULT_PLACES_JSON_PATH);
  const directory = path.dirname(filePath);
  const lockPath = `${filePath}.lock`;
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const nextRaw = `${JSON.stringify(places, null, 2)}\n`;
  let lockDescriptor: number | null = null;
  let backupPath: string | null = null;

  mkdirSync(directory, { recursive: true });

  try {
    try {
      lockDescriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(
        lockDescriptor,
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        throw new PlacesJsonWriteConflictError(
          `Another places.json write is in progress (${lockPath}). Remove the lock only after confirming no writer is running.`,
        );
      }
      throw error;
    }

    const currentRaw = existsSync(filePath) ? readFileSync(filePath, "utf8") : "[]\n";
    const currentHash = hashContent(currentRaw);

    if (
      options.expectedFileHash &&
      currentHash !== options.expectedFileHash
    ) {
      throw new PlacesJsonWriteConflictError(
        "places.json changed after it was read. Reload the data and retry instead of overwriting newer changes.",
      );
    }

    if ((options.createBackup ?? true) && existsSync(filePath)) {
      const backupDirectory = path.resolve(
        options.backupDirectory ??
          path.join(process.cwd(), ".cache", "places-backups"),
      );
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = path.join(
        backupDirectory,
        `${path.basename(filePath, path.extname(filePath))}-${timestamp}.json`,
      );
      mkdirSync(backupDirectory, { recursive: true });
      copyFileSync(filePath, backupPath);
    }

    writeFileSync(tempPath, nextRaw, { encoding: "utf8", mode: 0o600 });
    const tempDescriptor = openSync(tempPath, "r");
    try {
      fsyncSync(tempDescriptor);
    } finally {
      closeSync(tempDescriptor);
    }
    renameSync(tempPath, filePath);

    return {
      backupPath,
      fileHash: hashContent(nextRaw),
      filePath,
    };
  } finally {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    if (lockDescriptor !== null) {
      closeSync(lockDescriptor);
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    }
  }
}
