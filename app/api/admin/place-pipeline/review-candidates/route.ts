import { NextRequest, NextResponse } from "next/server";

import { isAdminAuthorized } from "@/lib/admin-auth";
import {
  getGoogleSheetsErrorMessage,
  getGoogleSheetsErrorStatus,
} from "@/lib/google-sheets-errors";
import { invalidatePlacePipelineSnapshot } from "@/lib/place-pipeline-snapshot-cache";
import {
  decideReviewCandidate,
  getReviewCandidates,
  type ReviewCandidateEdits,
  type ReviewCandidateDecision,
} from "@/lib/place-sheet-pipeline";

function errorResponse(error: unknown, fallback: string) {
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

  const input = (await request.json()) as {
    confirmWrite?: boolean;
    decision?: ReviewCandidateDecision;
    edits?: ReviewCandidateEdits;
    id?: string;
    rowNumber?: number;
    sheetId?: string;
  };

  if (input.confirmWrite !== true) {
    return NextResponse.json(
      { error: "Updating Review requires explicit confirmation." },
      { status: 400 },
    );
  }

  try {
    const result = await decideReviewCandidate({
      edits: input.edits,
      decision: input.decision as ReviewCandidateDecision,
      id: input.id ?? "",
      rowNumber: input.rowNumber ?? 0,
      sheetId: input.sheetId ?? "",
    });
    invalidatePlacePipelineSnapshot(input.sheetId ?? "");

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Could not update the Review candidate.");
  }
}
