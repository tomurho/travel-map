import { NextRequest, NextResponse } from "next/server";

import { syncPublishedToApp } from "@/lib/place-sheet-pipeline";

function isAuthorized(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";

  if (!adminPassword) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("x-admin-password") === adminPassword;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
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

  const result = await syncPublishedToApp({
    dryRun: !write,
    sheetId: input.sheetId ?? "",
    write,
  });

  return NextResponse.json(result);
}
