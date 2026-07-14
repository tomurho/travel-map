import { NextRequest, NextResponse } from "next/server";

import { syncPublishedToApp } from "@/lib/place-sheet-pipeline";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const input = (await request.json()) as {
    allowPartial?: boolean;
    confirmPartial?: boolean;
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
      sheetId: input.sheetId ?? "",
      write,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not sync Published rows." },
      { status: 400 },
    );
  }
}
