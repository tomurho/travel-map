import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";

import { publishApprovedRows } from "@/lib/place-sheet-pipeline";

dotenv.config({ path: ".env.local", quiet: true });

type CliOptions = {
  help: boolean;
  write: boolean;
  expectedPreviewHash?: string;
  sheetId: string | null;
};

export function parseArgs(rawArgv: string[]): CliOptions {
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  const options: CliOptions = {
    help: false,
    write: false,
    sheetId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--sheet-id") {
      options.sheetId = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--dry-run") {
      // Preview is the default; reject contradictory flags below.
      if (argv.includes("--write")) throw new Error("Choose preview or --write, not both.");
    } else if (arg === "--expected-preview-hash") {
      options.expectedPreviewHash = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Publish verified Review rows into Published.

Usage:
  pnpm publish:places -- --sheet-id <SHEET_ID>
  pnpm publish:places -- --sheet-id <SHEET_ID> --write --expected-preview-hash <HASH>

Behavior:
  Defaults to preview. Apply requires the hash returned by that preview.
  Reads Review rows where reviewStatus = Verified,
  appends new ids, updates corrected existing ids in Published, rejects ambiguous
  duplicate ids, and does not call Google Places or modify Capture/Review.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const result = await publishApprovedRows({
    write: options.write,
    dryRun: !options.write,
    expectedPreviewHash: options.expectedPreviewHash,
    sheetId: options.sheetId ?? "",
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
