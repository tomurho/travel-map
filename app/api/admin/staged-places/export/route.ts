import { NextRequest, NextResponse } from "next/server";

import {
  readStagedPlaces,
  stagedPlacesToWorkbookBuffer,
} from "@/lib/admin-staging";

function isAuthorized(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";

  if (!adminPassword) {
    return process.env.NODE_ENV !== "production";
  }

  const headerPassword = request.headers.get("x-admin-password");
  const queryPassword = request.nextUrl.searchParams.get("adminPassword");

  return headerPassword === adminPassword || queryPassword === adminPassword;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const workbook = stagedPlacesToWorkbookBuffer(readStagedPlaces());
  const body = new Uint8Array(workbook);

  return new NextResponse(body, {
    headers: {
      "Content-Disposition": 'attachment; filename="travel-map-staged-places.xlsx"',
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
