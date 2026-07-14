import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

import {
  productionPlacesToWorkbookBuffer,
  readProductionPlaces,
} from "@/lib/admin-staging";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const workbook = productionPlacesToWorkbookBuffer(readProductionPlaces());
  const exportDirectory = join(process.cwd(), "public", "exports");
  const fileName = "travel-map-approved-places.xlsx";
  const filePath = join(exportDirectory, fileName);

  mkdirSync(exportDirectory, { recursive: true });
  writeFileSync(filePath, workbook);

  return NextResponse.json({
    downloadUrl: `/exports/${fileName}`,
    filePath,
  });
}
