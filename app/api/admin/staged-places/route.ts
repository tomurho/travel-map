import { NextRequest, NextResponse } from "next/server";

import {
  clearStagedPlaces,
  deleteStagedPlace,
  getStagedPlacesWithDuplicates,
  stagePlace,
  getStagingVersion,
  getStagedPlaceInputErrors,
  type AdminStagedPlaceInput,
} from "@/lib/admin-staging";
import { PlacesJsonWriteConflictError } from "@/lib/places-json-store";
import { isAdminAuthorized } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  return NextResponse.json({ places: getStagedPlacesWithDuplicates(), stagingVersion: getStagingVersion() });
}

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON object." }, { status: 400 });
  }
  const errors = getStagedPlaceInputErrors(input);
  if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  let place;
  try {
    place = stagePlace(input as AdminStagedPlaceInput);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not stage the place." }, { status: error instanceof PlacesJsonWriteConflictError ? 409 : 400 });
  }

  return NextResponse.json({ place, places: getStagedPlacesWithDuplicates() });
}

export async function DELETE(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  const version = request.headers.get("x-record-version") ?? "";
  try {
    if (!id) clearStagedPlaces(version);
    else deleteStagedPlace(id, version);
    return NextResponse.json({ places: getStagedPlacesWithDuplicates(), stagingVersion: getStagingVersion() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete staged places." }, { status: error instanceof PlacesJsonWriteConflictError ? 409 : 500 });
  }
}
