import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";

import { publishApprovedRows } from "@/lib/place-sheet-pipeline";

dotenv.config({ path: ".env.local", quiet: true });

type CliOptions = {
  help: boolean;
  sheetId: string | null;
};

function parseArgs(rawArgv: string[]): CliOptions {
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  const options: CliOptions = {
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
    }
  }

  return options;
}

function printHelp() {
  console.log(`Publish verified Review rows into Published.

Usage:
  pnpm publish:places -- --sheet-id <SHEET_ID>

Behavior:
  Reads Review rows where reviewStatus = Verified,
  appends non-duplicate ids to Published, and does not call Google Places or modify
  Capture/Review.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  await publishApprovedRows({
    sheetId: options.sheetId ?? "",
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
