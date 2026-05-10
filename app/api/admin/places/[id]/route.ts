import { NextRequest, NextResponse } from "next/server";

import {
  type AdminProductionPlaceVerificationInput,
  updateProductionPlaceVerification,
} from "@/lib/admin-staging";

function isAuthorized(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";

  if (!adminPassword) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("x-admin-password") === adminPassword;
}

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const { id } = await context.params;
  const input = (await request.json()) as AdminProductionPlaceVerificationInput;
  const result = updateProductionPlaceVerification(decodeURIComponent(id), input);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
