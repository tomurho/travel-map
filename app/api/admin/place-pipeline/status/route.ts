import { NextRequest, NextResponse } from "next/server";

import { isAdminAuthorized } from "@/lib/admin-auth";
import { getPlacePipelineStatus } from "@/lib/place-sheet-pipeline";

export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const sheetId = request.nextUrl.searchParams.get("sheetId") ?? "";

  try {
    return NextResponse.json(await getPlacePipelineStatus({ sheetId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    return NextResponse.json(
      {
        error: /invalid_grant/i.test(message)
          ? "Google Sheets access has expired. Reconnect Google Sheets, then refresh status."
          : message || "Could not read the Google Sheets pipeline status.",
      },
      { status: 400 },
    );
  }
}
