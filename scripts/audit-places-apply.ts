import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";

import { applyAuditUpdates } from "@/lib/place-sheet-pipeline";

dotenv.config({ path: ".env.local", quiet: true });

type CliOptions = {
  dryRun: boolean;
  help: boolean;
  sheetId: string | null;
  write: boolean;
};

function parseArgs(rawArgv: string[]): CliOptions {
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  const options: CliOptions = {
    dryRun: false,
    help: false,
    sheetId: null,
    write: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--sheet-id") {
      options.sheetId = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--write") {
      options.write = true;
    }
  }

  if (!options.dryRun && !options.write) {
    options.dryRun = true;
  }

  return options;
}

function printHelp() {
  console.log(`Apply Audit rows to src/data/places.json.

Usage:
  pnpm audit:places:apply -- --sheet-id <SHEET_ID> --dry-run
  pnpm audit:places:apply -- --sheet-id <SHEET_ID> --write

Behavior:
  Reads Audit rows where auditStatus is Update or Delete. Update writes only
  address, latitude, longitude, googleMapsUrl, googlePlaceId, verifiedStatus,
  and lastChecked in src/data/places.json. Delete removes the matching JSON
  place. Write mode writes only src/data/places.json and marks processed Audit
  rows as Applied. Dry-run is the default. Does not modify Published.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  await applyAuditUpdates({
    dryRun: options.dryRun,
    sheetId: options.sheetId ?? "",
    write: options.write,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
