import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { resolvePublishedConflict } from "@/lib/place-sheet-pipeline";
import { PipelineError } from "@/lib/pipeline-preview";

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }
  let input;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON request is required." }, { status: 400 });
  }
  if (!input || typeof input.sheetId !== "string" || !input.sheetId.trim()) {
    return NextResponse.json({ error: "A Google Sheet ID is required." }, { status: 400 });
  }
  try {
    return NextResponse.json(await resolvePublishedConflict({
      sheetId: input.sheetId,
      id: input.id,
      rowNumber: input.rowNumber,
      expectedPreviewHash: input.expectedPreviewHash,
      confirmVerified: input.confirmVerified,
      verificationNote: input.verificationNote,
    }));
  } catch (error) {
    if (error instanceof PipelineError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not read the correction. Preview again before retrying." }, { status: 502 });
  }
}
