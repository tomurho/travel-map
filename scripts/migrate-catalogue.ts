import fs from "node:fs";
import dotenv from "dotenv";
import { isDeepStrictEqual } from "node:util";
import { buildCatalogueMigration } from "../src/lib/catalogue-migration";
import {
  initializePostgresCatalogue,
  createPostgresCatalogueStore,
  createLocalCatalogueStore,
} from "../src/lib/catalogue-store";
import { readPlacesJsonSnapshot } from "../src/lib/places-json-store";

dotenv.config({ path: ".env.local", quiet: true });
async function main() {
  const args = process.argv.slice(2),
    apply = args.includes("--apply");
  if (args.includes("--database-stdin")) {
    process.env.DATABASE_URL = await new Promise<string>((resolve) => {
      process.stdin.once("data", (chunk) => {
        process.stdin.pause();
        resolve(String(chunk).trim());
      });
      process.stdin.resume();
    });
  }
  const sheetIndex = args.indexOf("--sheets"),
    sheets =
      sheetIndex >= 0
        ? JSON.parse(fs.readFileSync(args[sheetIndex + 1], "utf8"))
        : {};
  const entries = buildCatalogueMigration(
    readPlacesJsonSnapshot().places,
    sheets,
  );
  if (!apply) {
    console.log(
      JSON.stringify({
        mode: "preview",
        existingPlaces: entries.filter((e) => e.live).length,
        inbox: entries.filter((e) => !e.live && !e.draft).length,
        review: entries.filter((e) => e.draft).length,
      }),
    );
    return;
  }
  const store = process.env.DATABASE_URL
    ? createPostgresCatalogueStore(process.env.DATABASE_URL)
    : process.env.CATALOGUE_LOCAL_PATH
      ? createLocalCatalogueStore(process.env.CATALOGUE_LOCAL_PATH)
      : null;
  if (!store)
    throw new Error(
      "Set DATABASE_URL, or CATALOGUE_LOCAL_PATH for local development.",
    );
  fs.mkdirSync(".cache/catalogue-migration", { recursive: true });
  const backup = `.cache/catalogue-migration/source-${Date.now()}.json`;
  fs.writeFileSync(backup, JSON.stringify(entries, null, 2), { mode: 0o600 });
  if (process.env.DATABASE_URL)
    await initializePostgresCatalogue(process.env.DATABASE_URL, entries);
  else if (!(await store.list()).length)
    for (const entry of entries) await store.create(entry);
  const stored = await store.list();
  for (const entry of entries) {
    const actual = stored.find((e) => e.id === entry.id);
    if (!actual) throw new Error(`Missing ${entry.id}`);
    if (entry.live && !isDeepStrictEqual(actual.live, entry.live))
      throw new Error(
        `Stored record differs: ${entry.id}. Migration did not overwrite it.`,
      );
  }
  console.log(
    JSON.stringify({
      mode: "applied",
      storage: store.kind,
      entries: stored.length,
      preservedPlaces: entries.filter((e) => e.live).length,
      backup,
    }),
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
});
