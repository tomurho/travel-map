import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";

import { exportPlacesToAudit } from "@/lib/place-sheet-pipeline";

dotenv.config({ path: ".env.local", quiet: true });

type CliOptions = {
  city: string | null;
  help: boolean;
  sheetId: string | null;
};

function parseArgs(rawArgv: string[]): CliOptions {
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  const options: CliOptions = {
    city: null,
    help: false,
    sheetId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--sheet-id") {
      options.sheetId = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--city") {
      options.city = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return options;
}

function printHelp() {
  console.log(`Export existing app places to the Audit Google Sheet tab.

Usage:
  pnpm audit:places:export -- --sheet-id <SHEET_ID> --city Matsue

Behavior:
  Reads src/data/places.json, filters by city, appends missing rows to Audit
  with auditStatus = Queued, and skips duplicate Audit ids. Does not call Google
  Places, modify Published, or modify src/data/places.json.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  await exportPlacesToAudit({
    city: options.city ?? "",
    sheetId: options.sheetId ?? "",
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
