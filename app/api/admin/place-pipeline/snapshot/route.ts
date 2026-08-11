import { NextRequest, NextResponse } from "next/server";

import { isAdminAuthorized } from "@/lib/admin-auth";
import {
  getGoogleSheetsErrorMessage,
  getGoogleSheetsErrorStatus,
} from "@/lib/google-sheets-errors";
import { getCachedPlacePipelineSnapshot } from "@/lib/place-pipeline-snapshot-cache";

export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const sheetId = request.nextUrl.searchParams.get("sheetId") ?? "";
  const force = request.nextUrl.searchParams.get("force") === "1";

  try {
    const result = await getCachedPlacePipelineSnapshot({ force, sheetId });

    return NextResponse.json({
      cached: result.cached,
      ...result.snapshot,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getGoogleSheetsErrorMessage(
          error,
          "Could not read the Google Sheets pipeline snapshot.",
        ),
      },
      { status: getGoogleSheetsErrorStatus(error) },
    );
  }
}
