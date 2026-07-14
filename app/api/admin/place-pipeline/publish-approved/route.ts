import { NextRequest, NextResponse } from "next/server";

import { publishApprovedRows } from "@/lib/place-sheet-pipeline";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const input = (await request.json()) as {
    confirmWrite?: boolean;
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
      sheetId: input.sheetId ?? "",
      write,
    });

    return NextResponse.json(result);
  } catch (error) {
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
