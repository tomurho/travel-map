import { neon } from "@neondatabase/serverless";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CatalogueError, type CatalogueEntry } from "@/lib/catalogue";

export interface CatalogueStore {
  kind: "shared" | "local";
  list(): Promise<CatalogueEntry[]>;
  get(id: string): Promise<CatalogueEntry | null>;
  create(entry: CatalogueEntry): Promise<boolean>;
  replace(entry: CatalogueEntry, expectedVersion: string): Promise<boolean>;
}
export function sharedCatalogueEnabled() {
  return process.env.CATALOGUE_ENABLED === "true";
}
export function catalogueConfigured() {
  return Boolean(
    process.env.DATABASE_URL ||
    (process.env.NODE_ENV !== "production" && process.env.CATALOGUE_LOCAL_PATH),
  );
}

export function createPostgresCatalogueStore(url: string): CatalogueStore {
  const sql = neon(url, { fetchOptions: { cache: "no-store" } });
  return {
    kind: "shared",
    async list() {
      const rows = await sql`SELECT document FROM travel_catalogue ORDER BY id`;
      return rows.map((r) => r.document as CatalogueEntry);
    },
    async get(id) {
      const rows =
        await sql`SELECT document FROM travel_catalogue WHERE id = ${id}`;
      return (rows[0]?.document as CatalogueEntry) ?? null;
    },
    async create(entry) {
      const rows =
        await sql`INSERT INTO travel_catalogue (id, version, document) VALUES (${entry.id}, ${entry.version}, ${JSON.stringify(entry)}::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id`;
      return rows.length === 1;
    },
    async replace(entry, expected) {
      const venueKey =
        !entry.archived && entry.history.length
          ? (entry.live?.googlePlaceId ?? null)
          : null;
      try {
        const rows =
          await sql`UPDATE travel_catalogue SET version = ${entry.version}, document = ${JSON.stringify(entry)}::jsonb, venue_key = ${venueKey} WHERE id = ${entry.id} AND version = ${expected} RETURNING id`;
        return rows.length === 1;
      } catch (error) {
        if ((error as { code?: string }).code === "23505")
          throw new CatalogueError(
            "This Maps venue is already live. Refresh and edit its existing listing.",
            409,
          );
        throw error;
      }
    },
  };
}
export async function initializePostgresCatalogue(
  url: string,
  entries: CatalogueEntry[],
) {
  const sql = neon(url);
  await sql`CREATE TABLE IF NOT EXISTS travel_catalogue (id TEXT PRIMARY KEY, version TEXT NOT NULL, document JSONB NOT NULL, venue_key TEXT UNIQUE)`;
  // Seeding is atomic and only allowed into an empty catalogue. Reruns cannot overwrite live edits.
  const inserted =
    await sql`INSERT INTO travel_catalogue (id, version, document)
    SELECT value->>'id', value->>'version', value FROM jsonb_array_elements(${JSON.stringify(entries)}::jsonb)
    WHERE NOT EXISTS (SELECT 1 FROM travel_catalogue) ON CONFLICT (id) DO NOTHING RETURNING id`;
  return inserted.length;
}
export function createLocalCatalogueStore(filePath: string): CatalogueStore {
  function read(): CatalogueEntry[] {
    return existsSync(filePath)
      ? JSON.parse(readFileSync(filePath, "utf8"))
      : [];
  }
  function mutate(fn: (entries: CatalogueEntry[]) => boolean) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    let lock: number;
    try {
      lock = openSync(`${filePath}.lock`, "wx", 0o600);
    } catch {
      throw new CatalogueError(
        "Another save is in progress. Retry shortly.",
        409,
      );
    }
    try {
      const entries = read();
      if (!fn(entries)) return false;
      const temp = `${filePath}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temp, JSON.stringify(entries), { mode: 0o600 });
        renameSync(temp, filePath);
      } finally {
        if (existsSync(temp)) unlinkSync(temp);
      }
      return true;
    } finally {
      closeSync(lock);
      unlinkSync(`${filePath}.lock`);
    }
  }
  return {
    kind: "local",
    async list() {
      return read();
    },
    async get(id) {
      return read().find((e) => e.id === id) ?? null;
    },
    async create(entry) {
      return mutate((entries) => {
        if (entries.some((e) => e.id === entry.id)) return false;
        entries.push(entry);
        return true;
      });
    },
    async replace(entry, expected) {
      return mutate((entries) => {
        const i = entries.findIndex(
          (e) => e.id === entry.id && e.version === expected,
        );
        if (i < 0) return false;
        entries[i] = entry;
        return true;
      });
    },
  };
}
export function getCatalogueStore(): CatalogueStore {
  if (process.env.DATABASE_URL)
    return createPostgresCatalogueStore(process.env.DATABASE_URL);
  if (process.env.NODE_ENV !== "production" && process.env.CATALOGUE_LOCAL_PATH)
    return createLocalCatalogueStore(
      path.resolve(process.env.CATALOGUE_LOCAL_PATH),
    );
  throw new CatalogueError(
    "The shared catalogue is not connected yet. Existing public places are unchanged.",
    503,
  );
}
