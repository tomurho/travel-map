import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import xlsx from "xlsx";
import { normalizePlaces } from "@/lib/import";

function readRowsFromStructuredSheet(worksheet: xlsx.WorkSheet) {
  const matrix = xlsx.utils.sheet_to_json<(string | number)[]>(worksheet, {
    header: 1,
    defval: "",
  });
  const headerRow = matrix[0] ?? [];

  const looksLikeStructuredSheet =
    String(headerRow[1] ?? "").trim() === "Verified Category" &&
    String(headerRow[2] ?? "").trim() === "Status" &&
    String(headerRow[7] ?? "").trim() === "Latitude" &&
    String(headerRow[8] ?? "").trim() === "Longitude";

  if (!looksLikeStructuredSheet) {
    return null;
  }

  return matrix.slice(1).map((row) => ({
    "Location Name": row[0] ?? "",
    "Verified Category": row[1] ?? "",
    Status: row[2] ?? "",
    "Loved it": row[3] ?? "",
    Area: row[5] ?? "",
    Address: row[6] ?? "",
    Latitude: row[7] ?? "",
    Longitude: row[8] ?? "",
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const positionalArgs: string[] = [];
  let sheetName: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--sheet") {
      sheetName = args[index + 1];
      index += 1;
      continue;
    }

    positionalArgs.push(argument);
  }

  const inputPath = positionalArgs[0];
  const outputPath =
    positionalArgs[1] ?? path.resolve(process.cwd(), "src/data/places.json");

  if (!inputPath) {
    console.error(
      "Usage: pnpm import:places <input.xlsx|input.csv> [output.json] [--sheet SHEET_NAME]",
    );
    process.exitCode = 1;
    return;
  }

  const workbook = xlsx.readFile(path.resolve(process.cwd(), inputPath));
  const selectedSheetName = sheetName ?? workbook.SheetNames[0];

  if (!selectedSheetName) {
    console.error("No worksheet found in the spreadsheet.");
    process.exitCode = 1;
    return;
  }

  const worksheet = workbook.Sheets[selectedSheetName];
  if (!worksheet) {
    console.error(`Worksheet "${selectedSheetName}" was not found.`);
    process.exitCode = 1;
    return;
  }

  const structuredRows = readRowsFromStructuredSheet(worksheet);
  const rows =
    structuredRows ??
    xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: "",
    });

  const result = normalizePlaces(rows);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(`${outputPath}`, `${JSON.stringify(result.places, null, 2)}\n`);

  console.log(
    `Imported ${result.places.length} places from "${selectedSheetName}" into ${outputPath}.`,
  );

  if (result.errors.length > 0) {
    console.log("\nSkipped rows:");
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
}

void main();
