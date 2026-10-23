import { NextRequest, NextResponse } from "next/server";

import { getPlaceRecordVersion } from "@/lib/place-record-version";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { readPlacesJsonSnapshot } from "@/lib/places-json-store";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isAdminAuthorized(request)) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 401, headers },
    );
  }

  return NextResponse.json({ places: readPlacesJsonSnapshot().places.map((place) => ({ ...place, recordVersion: getPlaceRecordVersion(place) })) }, { headers });
}
