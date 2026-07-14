import { NextRequest, NextResponse } from "next/server";

import {
  readStagedPlaces,
  stagedPlacesToWorkbookBuffer,
} from "@/lib/admin-staging";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
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
