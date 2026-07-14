import { NextRequest, NextResponse } from "next/server";

import { enrichReadyRows } from "@/lib/place-sheet-pipeline";
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

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not review new places.",
      },
      { status: 500 },
    );
  }
}
