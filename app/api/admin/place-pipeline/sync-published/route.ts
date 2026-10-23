import { NextRequest, NextResponse } from "next/server";

import { syncPublishedToApp } from "@/lib/place-sheet-pipeline";
import { PipelineError } from "@/lib/pipeline-preview";
import { getGoogleSheetsErrorMessage, getGoogleSheetsErrorStatus } from "@/lib/google-sheets-errors";
import { invalidatePlacePipelineSnapshot } from "@/lib/place-pipeline-snapshot-cache";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const input = (await request.json()) as {
    allowPartial?: boolean;
    confirmPartial?: boolean;
    confirmWrite?: boolean;
    expectedPreviewHash?: string;
    sheetId?: string;
    write?: boolean;
  };
  const write = input.write === true;

  if (write && input.confirmWrite !== true) {
    return NextResponse.json(
      { error: "Write mode requires explicit confirmation." },
      { status: 400 },
    );
  }

  if (input.allowPartial === true && input.confirmPartial !== true) {
    return NextResponse.json(
      { error: "Partial sync requires explicit confirmation." },
      { status: 400 },
    );
  }

  try {
    const result = await syncPublishedToApp({
      allowPartial: input.allowPartial === true,
      dryRun: !write,
      expectedPreviewHash: input.expectedPreviewHash,
      sheetId: input.sheetId ?? "",
      write,
    });

    if ("wrote" in result ? result.wrote : true) invalidatePlacePipelineSnapshot(input.sheetId ?? "");
    return NextResponse.json(result);
  } catch (error) {
    if (write) invalidatePlacePipelineSnapshot(input.sheetId ?? "");
    if (error instanceof PipelineError) {
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    }
    return NextResponse.json(
      { error: getGoogleSheetsErrorMessage(error, "Could not sync Published rows.") },
      { status: getGoogleSheetsErrorStatus(error) },
    );
  }
}
