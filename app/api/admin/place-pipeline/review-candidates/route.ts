import { NextRequest, NextResponse } from "next/server";

import { isAdminAuthorized } from "@/lib/admin-auth";
import {
  getGoogleSheetsErrorMessage,
  getGoogleSheetsErrorStatus,
} from "@/lib/google-sheets-errors";
import { invalidatePlacePipelineSnapshot } from "@/lib/place-pipeline-snapshot-cache";
import { PipelineError } from "@/lib/pipeline-preview";
import {
  decideReviewCandidate,
  getReviewCandidates,
  type ReviewCandidateEdits,
} from "@/lib/place-sheet-pipeline";

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof PipelineError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return NextResponse.json(
    {
      error: getGoogleSheetsErrorMessage(error, fallback),
    },
    { status: getGoogleSheetsErrorStatus(error) },
  );
}

export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  try {
    return NextResponse.json(
      await getReviewCandidates({
        sheetId: request.nextUrl.searchParams.get("sheetId") ?? "",
      }),
    );
  } catch (error) {
    return errorResponse(error, "Could not read Review candidates.");
  }
}

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Send a JSON object containing the review decision." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;

  if (input.confirmWrite !== true) {
    return NextResponse.json(
      { error: "Updating Review requires explicit confirmation." },
      { status: 400 },
    );
  }

  if (typeof input.sheetId !== "string" || !input.sheetId.trim() ||
      typeof input.id !== "string" || !input.id.trim() ||
      typeof input.rowNumber !== "number" || !Number.isInteger(input.rowNumber) || input.rowNumber < 2 ||
      (input.decision !== "verify" && input.decision !== "reject")) {
    return NextResponse.json({ error: "Provide a Sheet ID, place ID, valid row number, and Verify or Reject decision." }, { status: 400 });
  }
  if (input.expectedReviewStamp !== undefined && typeof input.expectedReviewStamp !== "string") {
    return NextResponse.json({ error: "The reviewed candidate stamp must be text. Refresh data before trying again." }, { status: 400 });
  }
  const edits = input.edits;
  if (input.decision === "verify" || edits !== undefined) {
    if (!edits || typeof edits !== "object" || Array.isArray(edits) ||
        typeof (edits as Record<string, unknown>).category !== "string" ||
        !(edits as { category: string }).category.trim() ||
        typeof (edits as Record<string, unknown>).status !== "string" ||
        !["location", "want_to_go", "been", "loved"].includes((edits as { status: string }).status)) {
      return NextResponse.json({ error: "Choose a category and valid status before verifying." }, { status: 400 });
    }
  }

  try {
    const result = await decideReviewCandidate({
      edits: edits as ReviewCandidateEdits | undefined,
      decision: input.decision,
      id: input.id,
      rowNumber: input.rowNumber,
      expectedReviewStamp: input.expectedReviewStamp,
      sheetId: input.sheetId,
    });
    invalidatePlacePipelineSnapshot(input.sheetId ?? "");

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PipelineError && error.code === "PREVIEW_STALE") {
      invalidatePlacePipelineSnapshot(input.sheetId ?? "");
    }
    return errorResponse(error, "Could not update the Review candidate.");
  }
}
