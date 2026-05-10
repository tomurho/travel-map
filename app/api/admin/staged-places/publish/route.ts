import { NextRequest, NextResponse } from "next/server";

import { publishStagedPlaces } from "@/lib/admin-staging";

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

  const allowDuplicates =
    request.nextUrl.searchParams.get("allowDuplicates") === "true";
  const result = publishStagedPlaces({ allowDuplicates });

  if ("validationError" in result) {
    return NextResponse.json({ error: result.validationError }, { status: 400 });
  }

  return NextResponse.json(result);
}
