import { NextRequest, NextResponse } from "next/server";

import {
  deleteProductionPlace,
  type AdminFloatingPlaceEditInput,
  type AdminProductionPlaceVerificationInput,
  updateProductionPlaceFloatingEdit,
  updateProductionPlaceVerification,
} from "@/lib/admin-staging";
import { isAdminAuthorized } from "@/lib/admin-auth";

function isLocalhostRequest(request: NextRequest) {
  return ["localhost", "127.0.0.1", "::1"].includes(request.nextUrl.hostname);
}

function isFloatingPlaceEditInput(
  input: unknown,
): input is AdminFloatingPlaceEditInput {
  return (
    typeof input === "object" &&
    input !== null &&
    "editMode" in input &&
    (input.editMode === "floating-inspector" ||
      input.editMode === "field-guide-inline")
  );
}

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const { id } = await context.params;
  const input = (await request.json()) as
    | AdminFloatingPlaceEditInput
    | AdminProductionPlaceVerificationInput;

  if (isFloatingPlaceEditInput(input)) {
    if (!isLocalhostRequest(request)) {
      return NextResponse.json(
        { error: "Inline place edits are only available on localhost." },
        { status: 403 },
      );
    }

    const result = updateProductionPlaceFloatingEdit(decodeURIComponent(id), input);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  }

  const result = updateProductionPlaceVerification(decodeURIComponent(id), input);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const { id } = await context.params;
  const result = deleteProductionPlace(decodeURIComponent(id));

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
