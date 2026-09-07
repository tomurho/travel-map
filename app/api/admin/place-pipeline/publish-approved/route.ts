import { NextRequest, NextResponse } from "next/server";

import { publishApprovedRows } from "@/lib/place-sheet-pipeline";
import { PipelineError } from "@/lib/pipeline-preview";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const input = (await request.json()) as {
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

  try {
    const result = await publishApprovedRows({
      dryRun: !write,
      expectedPreviewHash: input.expectedPreviewHash,
      sheetId: input.sheetId ?? "",
      write,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PipelineError) {
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not publish approved places.",
      },
      { status: 500 },
    );
  }
}
