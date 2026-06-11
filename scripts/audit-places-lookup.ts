import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";

import { lookupAuditCandidates } from "@/lib/place-sheet-pipeline";

dotenv.config({ path: ".env.local", quiet: true });

type CliOptions = {
  confirmLiveApi: boolean;
  help: boolean;
  maxApiCalls: number | null;
  sheetId: string | null;
};

function parseArgs(rawArgv: string[]): CliOptions {
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  const options: CliOptions = {
    confirmLiveApi: false,
    help: false,
    maxApiCalls: null,
    sheetId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--confirm-live-api") {
      options.confirmLiveApi = true;
    } else if (arg === "--sheet-id") {
      options.sheetId = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--max-api-calls") {
      const maxApiCalls = Number(argv[index + 1]);
      options.maxApiCalls =
        Number.isInteger(maxApiCalls) && maxApiCalls >= 0 ? maxApiCalls : null;
      index += 1;
    }
  }

  return options;
}

function printHelp() {
  console.log(`Lookup Google Places candidates for queued Audit rows.

Usage:
  pnpm audit:places:lookup -- --sheet-id <SHEET_ID> --max-api-calls 3 --confirm-live-api

Required environment:
  GOOGLE_PLACES_API_KEY      Used for Google Places lookups.

Behavior:
  Reads Audit rows where auditStatus = Queued, uses currentGooglePlaceId when
  present or searches currentName + currentCity + currentCountry, writes only
  candidate fields plus auditStatus and lastAudited, and appends API Usage rows.
  Does not modify current fields, Published, or src/data/places.json.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  await lookupAuditCandidates({
    confirmLiveApi: options.confirmLiveApi,
    maxApiCalls: options.maxApiCalls,
    sheetId: options.sheetId ?? "",
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
