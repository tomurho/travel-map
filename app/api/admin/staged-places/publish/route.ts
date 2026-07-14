import { NextRequest, NextResponse } from "next/server";

import { publishStagedPlaces } from "@/lib/admin-staging";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const allowDuplicates =
    request.nextUrl.searchParams.get("allowDuplicates") === "true";
  const result = publishStagedPlaces({ allowDuplicates });

  if ("validationError" in result) {
    return NextResponse.json({ error: result.validationError }, { status: 400 });
  }

  return NextResponse.json(result);
}
