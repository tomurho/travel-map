import { NextRequest, NextResponse } from "next/server";

import { enrichReadyRows } from "@/lib/place-sheet-pipeline";
import { getGoogleSheetsErrorMessage, getGoogleSheetsErrorStatus } from "@/lib/google-sheets-errors";
import { invalidatePlacePipelineSnapshot } from "@/lib/place-pipeline-snapshot-cache";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const input = (await request.json()) as {
    confirmLiveApi?: boolean;
    maxApiCalls?: number;
    sheetId?: string;
  };
  const maxApiCalls = input.maxApiCalls;

  if (input.confirmLiveApi !== true) {
    return NextResponse.json(
      { error: "Process Ready Rows requires explicit live API confirmation." },
      { status: 400 },
    );
  }

  if (
    maxApiCalls === undefined ||
    !Number.isInteger(maxApiCalls) ||
    maxApiCalls <= 0 ||
    maxApiCalls > 10
  ) {
    return NextResponse.json(
      { error: "maxApiCalls must be an integer from 1 to 10." },
      { status: 400 },
    );
  }

  try {
    const result = await enrichReadyRows({
      confirmLiveApi: true,
      maxApiCalls,
      sheetId: input.sheetId ?? "",
    });

    if ("wrote" in result ? result.wrote : true) invalidatePlacePipelineSnapshot(input.sheetId ?? "");
    return NextResponse.json(result);
  } catch (error) {
    invalidatePlacePipelineSnapshot(input.sheetId ?? "");
    return NextResponse.json(
      { error: getGoogleSheetsErrorMessage(error, "Could not review new places.") },
      { status: getGoogleSheetsErrorStatus(error) },
    );
  }
}
