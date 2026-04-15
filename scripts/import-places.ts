import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import xlsx from "xlsx";
import { normalizePlaces } from "@/lib/import";

function readRowsFromStructuredSheet(
  worksheet: xlsx.WorkSheet,
  sheetName: string,
) {
  const matrix = xlsx.utils.sheet_to_json<(string | number)[]>(worksheet, {
    header: 1,
    defval: "",
  });
  const headerRow = matrix[0] ?? [];
  const headerIndexes = new Map<string, number>();

  headerRow.forEach((header, index) => {
    const normalizedHeader = String(header ?? "").trim().toLowerCase();
    if (normalizedHeader && !headerIndexes.has(normalizedHeader)) {
      headerIndexes.set(normalizedHeader, index);
    }
  });

  function readCell(row: (string | number)[], headerNames: string[]) {
    for (const headerName of headerNames) {
      const index = headerIndexes.get(headerName.toLowerCase());
      if (index !== undefined) {
        return row[index] ?? "";
      }
    }

    return "";
  }

  const looksLikeStructuredSheet =
    (headerIndexes.has("location") || headerIndexes.has("location name")) &&
    headerIndexes.has("verified category") &&
    headerIndexes.has("status") &&
    headerIndexes.has("area") &&
    headerIndexes.has("address") &&
    headerIndexes.has("latitude") &&
    headerIndexes.has("longitude");

  if (!looksLikeStructuredSheet) {
    return null;
  }

  return matrix.slice(1).map((row) => ({
    "Location Name": readCell(row, ["Location Name", "Location"]),
    City: sheetName,
    "Verified Category": readCell(row, ["Verified Category", "Category"]),
    Status: readCell(row, ["Status"]),
    "Loved it": readCell(row, ["Loved it"]),
    Area: readCell(row, ["Area"]),
    Address: readCell(row, ["Address"]),
    Latitude: readCell(row, ["Latitude"]),
    Longitude: readCell(row, ["Longitude"]),
    Tabelog: readCell(row, ["Tabelog"]),
    Subway: readCell(row, ["Subway"]),
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const positionalArgs: string[] = [];
  let sheetName: string | undefined;
  let importAllSheets = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--all-sheets") {
      importAllSheets = true;
      continue;
    }

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
      "Usage: pnpm import:places <input.xlsx|input.csv> [output.json] [--sheet SHEET_NAME|--all-sheets]",
    );
    process.exitCode = 1;
    return;
  }

  const workbook = xlsx.readFile(path.resolve(process.cwd(), inputPath));
  const selectedSheetNames = importAllSheets
    ? workbook.SheetNames
    : [sheetName ?? workbook.SheetNames[0]].filter(Boolean);

  if (selectedSheetNames.length === 0) {
    console.error("No worksheet found in the spreadsheet.");
    process.exitCode = 1;
    return;
  }

  const rows = selectedSheetNames.flatMap((selectedSheetName) => {
    const worksheet = workbook.Sheets[selectedSheetName];
    if (!worksheet) {
      console.error(`Worksheet "${selectedSheetName}" was not found.`);
      process.exitCode = 1;
      return [];
    }

    const structuredRows = readRowsFromStructuredSheet(
      worksheet,
      selectedSheetName,
    );

    return (
      structuredRows ??
      xlsx.utils
        .sheet_to_json<Record<string, unknown>>(worksheet, {
          defval: "",
        })
        .map((row) => ({
          ...row,
          City: row.City ?? row.city ?? selectedSheetName,
        }))
    );
  });

  if (process.exitCode) {
    return;
  }

  const result = normalizePlaces(rows);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(`${outputPath}`, `${JSON.stringify(result.places, null, 2)}\n`);

  console.log(
    `Imported ${result.places.length} places from ${selectedSheetNames
      .map((selectedSheetName) => `"${selectedSheetName}"`)
      .join(", ")} into ${outputPath}.`,
  );

  if (result.errors.length > 0) {
    console.log("\nSkipped rows:");
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
}

void main();
