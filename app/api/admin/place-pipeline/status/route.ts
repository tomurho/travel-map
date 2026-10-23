import { NextRequest, NextResponse } from "next/server";

import { isAdminAuthorized } from "@/lib/admin-auth";
import { getGoogleSheetsErrorMessage, getGoogleSheetsErrorStatus } from "@/lib/google-sheets-errors";
import { getPlacePipelineStatus } from "@/lib/place-sheet-pipeline";

export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const sheetId = request.nextUrl.searchParams.get("sheetId") ?? "";

  try {
    return NextResponse.json(await getPlacePipelineStatus({ sheetId }));
  } catch (error) {
    return NextResponse.json(
      { error: getGoogleSheetsErrorMessage(error, "Could not read the Google Sheets pipeline status.") },
      { status: getGoogleSheetsErrorStatus(error) },
    );
  }
}
