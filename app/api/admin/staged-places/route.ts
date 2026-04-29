import { NextRequest, NextResponse } from "next/server";

import {
  clearStagedPlaces,
  deleteStagedPlace,
  readStagedPlaces,
  stagePlace,
  type AdminStagedPlaceInput,
} from "@/lib/admin-staging";

function isAuthorized(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";

  if (!adminPassword) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("x-admin-password") === adminPassword;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  return NextResponse.json({ places: readStagedPlaces() });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const input = (await request.json()) as AdminStagedPlaceInput;

  if (!input.name?.trim()) {
    return NextResponse.json({ error: "Place name is required." }, { status: 400 });
  }

  if (input.latitude === null || input.longitude === null) {
    return NextResponse.json(
      { error: "Latitude and longitude are required before staging." },
      { status: 400 },
    );
  }

  const place = stagePlace(input);

  return NextResponse.json({ place, places: readStagedPlaces() });
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    clearStagedPlaces();
    return NextResponse.json({ places: [] });
  }

  return NextResponse.json({ places: deleteStagedPlace(id) });
}
