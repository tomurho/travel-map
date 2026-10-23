import { NextRequest, NextResponse } from "next/server";

import { publishStagedPlaces } from "@/lib/admin-staging";
import { PlacesJsonWriteConflictError } from "@/lib/places-json-store";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const allowDuplicates =
    request.nextUrl.searchParams.get("allowDuplicates") === "true";
  let result;
  try {
    result = publishStagedPlaces({ allowDuplicates, expectedStagingVersion: request.headers.get("x-record-version") ?? "" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not confirm publication. Reload before retrying." }, { status: error instanceof PlacesJsonWriteConflictError ? 409 : 500 });
  }

  if ("validationError" in result) {
    return NextResponse.json({ error: result.validationError }, { status: 400 });
  }

  return NextResponse.json(result, { status: "stagingCleanupPending" in result ? 409 : 200 });
}
