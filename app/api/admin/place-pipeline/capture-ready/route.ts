import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { getGoogleSheetsErrorMessage, getGoogleSheetsErrorStatus } from "@/lib/google-sheets-errors";
import { invalidatePlacePipelineSnapshot } from "@/lib/place-pipeline-snapshot-cache";
import { markCapturesReady } from "@/lib/place-sheet-pipeline";
import { PipelineError } from "@/lib/pipeline-preview";

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Send valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Send a JSON object." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (input.confirmWrite !== true || typeof input.sheetId !== "string" || !Array.isArray(input.captures)) {
    return NextResponse.json({ error: "Confirm Mark ready and provide the Sheet and selected captures." }, { status: 400 });
  }
  try {
    const result = await markCapturesReady({ sheetId: input.sheetId, captures: input.captures });
    invalidatePlacePipelineSnapshot(input.sheetId);
    return NextResponse.json(result);
  } catch (error) {
    invalidatePlacePipelineSnapshot(input.sheetId);
    if (error instanceof PipelineError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: getGoogleSheetsErrorMessage(error, "Could not mark the captures Ready.") }, { status: getGoogleSheetsErrorStatus(error) });
  }
}
