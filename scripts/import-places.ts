import path from "node:path";
import process from "node:process";
import xlsx from "xlsx";
import { normalizePlaces } from "@/lib/import";
import { assessImportSafety } from "@/lib/import-safety";
import type { Place } from "@/lib/place";
import {
  readPlacesJsonSnapshot,
  writePlacesJsonAtomic,
} from "@/lib/places-json-store";

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
    (headerIndexes.has("verified category") || headerIndexes.has("category")) &&
    headerIndexes.has("status") &&
    headerIndexes.has("area") &&
    headerIndexes.has("address") &&
    headerIndexes.has("latitude") &&
    headerIndexes.has("longitude");

  if (!looksLikeStructuredSheet) {
    return null;
  }

  return matrix
    .slice(1)
    .filter((row) =>
      [
        "Location Name",
        "Location",
        "Address",
        "Latitude",
        "Longitude",
      ].some((headerName) => String(readCell(row, [headerName])).trim()),
    )
    .map((row) => ({
      "Location Name": readCell(row, ["Location Name", "Location"]),
      City: sheetName,
      "Verified Category": readCell(row, ["Verified Category", "Category"]),
      Status: readCell(row, ["Status"]),
      "Loved it": readCell(row, ["Loved it"]),
      Area: readCell(row, ["Area"]),
      Address: readCell(row, ["Address"]),
      Latitude: readCell(row, ["Latitude"]),
      Longitude: readCell(row, ["Longitude"]),
      "Tabelog Score": readCell(row, ["Tabelog Score", "Tabelog"]),
      "Nearest Subway": readCell(row, ["Nearest Subway", "Subway"]),
      "Google Maps URL": readCell(row, ["Google Maps URL"]),
      "Google Place ID": readCell(row, ["Google Place ID"]),
      "Canonical Name": readCell(row, ["Canonical Name"]),
      "Canonical Address": readCell(row, ["Canonical Address"]),
      "Verified Latitude": readCell(row, ["Verified Latitude"]),
      "Verified Longitude": readCell(row, ["Verified Longitude"]),
      "Distance Delta Meters": readCell(row, ["Distance Delta Meters"]),
      "Business Status": readCell(row, ["Business Status"]),
      "Match Confidence": readCell(row, ["Match Confidence"]),
      "Same Place Decision": readCell(row, ["Same Place Decision"]),
      "Same Place Reason": readCell(row, ["Same Place Reason"]),
      "Verification Decision": readCell(row, ["Verification Decision"]),
      "Name Score": readCell(row, ["Name Score"]),
      "Address Score": readCell(row, ["Address Score"]),
      "City Score": readCell(row, ["City Score"]),
      "District Score": readCell(row, ["District Score"]),
      "Country Score": readCell(row, ["Country Score"]),
      "Ambiguity Score": readCell(row, ["Ambiguity Score"]),
      "Verified?": readCell(row, ["Verified?"]),
      "Last Checked": readCell(row, ["Last Checked"]),
      "Verification Notes": readCell(row, ["Verification Notes"]),
    }));
}

async function main() {
  const args = process.argv.slice(2);
  const positionalArgs: string[] = [];
  let sheetName: string | undefined;
  let importAllSheets = false;
  let allowAmbiguousIds = false;
  let allowLargeDrop = false;
  let allowSkippedRows = false;
  let write = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--all-sheets") {
      importAllSheets = true;
      continue;
    }

    if (argument === "--allow-ambiguous-ids") {
      allowAmbiguousIds = true;
      continue;
    }

    if (argument === "--allow-large-drop") {
      allowLargeDrop = true;
      continue;
    }

    if (argument === "--allow-skipped-rows") {
      allowSkippedRows = true;
      continue;
    }

    if (argument === "--write") {
      write = true;
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
      "Usage: pnpm import:places <input.xlsx|input.csv> [output.json] [--sheet SHEET_NAME|--all-sheets] [--write] [--allow-skipped-rows] [--allow-ambiguous-ids] [--allow-large-drop]",
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

    if (structuredRows) {
      return structuredRows;
    }

    if (importAllSheets) {
      return [];
    }

    const fallbackRows = xlsx.utils
      .sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: "",
      });
    const hasFallbackPlaceHeader = fallbackRows.some((row) =>
      [
        "Location Name",
        "location name",
        "Location",
        "location",
        "name",
      ].some((headerName) => row[headerName]),
    );

    if (!hasFallbackPlaceHeader) {
      return [];
    }

    return (
      fallbackRows.map((row) => ({
        ...row,
        City: row.City ?? row.city ?? selectedSheetName,
      }))
    );
  });

  if (process.exitCode) {
    return;
  }

  const productionPlacesPath = path.resolve(process.cwd(), "src/data/places.json");
  let existingPlaces: Place[] = [];

  try {
    existingPlaces = readPlacesJsonSnapshot(productionPlacesPath).places;
  } catch {
    existingPlaces = [];
  }

  const result = normalizePlaces(rows, { existingPlaces });
  const outputSnapshot = readPlacesJsonSnapshot(outputPath, {
    allowMissing: true,
  });
  const safety = assessImportSafety({
    allowAmbiguousIds,
    allowLargeDrop,
    allowSkippedRows,
    ambiguousIdMatches: result.migrationReport.ambiguousIdMatches.length,
    currentCount: outputSnapshot.places.length,
    nextCount: result.places.length,
    skippedRows: result.errors.length,
  });

  if (write && safety.issues.length > 0) {
    throw new Error(`Import write blocked:\n- ${safety.issues.join("\n- ")}`);
  }

  let writeResult: ReturnType<typeof writePlacesJsonAtomic> | null = null;
  if (write) {
    writeResult = writePlacesJsonAtomic(result.places, {
      expectedFileHash: outputSnapshot.fileHash,
      filePath: outputPath,
    });
  }

  console.log(
    `${write ? "Imported" : "Would import"} ${result.places.length} places from ${selectedSheetNames
      .map((selectedSheetName) => `"${selectedSheetName}"`)
      .join(", ")} into ${outputPath}.`,
  );

  if (!write) {
    console.log("Preview only: pass --write to update the output file.");
  } else if (writeResult?.backupPath) {
    console.log(`Backup created at ${writeResult.backupPath}.`);
  }

  if (safety.issues.length > 0) {
    console.log("\nWrite safety issues:");
    for (const issue of safety.issues) {
      console.log(`- ${issue}`);
    }
  }

  console.log("\nID migration:");
  console.log(`- IDs preserved: ${result.migrationReport.idsPreserved}`);
  console.log(`- New IDs generated: ${result.migrationReport.newIdsGenerated}`);
  console.log(`- ID changes avoided: ${result.migrationReport.idChangesAvoided}`);
  console.log(
    `- Ambiguous ID matches: ${result.migrationReport.ambiguousIdMatches.length}`,
  );

  if (result.migrationReport.ambiguousIdMatches.length > 0) {
    console.log("\nAmbiguous ID matches:");
    for (const match of result.migrationReport.ambiguousIdMatches) {
      console.log(
        `- ${match.city} / ${match.locationName} (${match.matchStrategy}): ${match.possibleIds.join(", ")}`,
      );
    }
  }

  if (result.errors.length > 0) {
    console.log("\nSkipped rows:");
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
