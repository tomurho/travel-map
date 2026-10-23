import { NextRequest, NextResponse } from "next/server";

import {
  deleteProductionPlace,
  type AdminFloatingPlaceEditInput,
  type AdminProductionPlaceVerificationInput,
  updateProductionPlaceFloatingEdit,
  updateProductionPlaceVerification,
  getProductionPlaceVerificationInputErrors,
} from "@/lib/admin-staging";
import { PlacesJsonWriteConflictError } from "@/lib/places-json-store";
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
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON object." }, { status: 400 });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: "Send a JSON object containing the place fields." }, { status: 400 });
  }

  if (isFloatingPlaceEditInput(input)) {
    if (!isLocalhostRequest(request)) {
      return NextResponse.json(
        { error: "Inline place edits are only available on localhost." },
        { status: 403 },
      );
    }

    let result;
    try {
      result = updateProductionPlaceFloatingEdit(id, input);
    } catch {
      return NextResponse.json({ error: "Could not confirm the save. Reload the page before trying again." }, { status: 500 });
    }

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  }

  const errors = getProductionPlaceVerificationInputErrors(input);
  if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  let result;
  try {
    result = updateProductionPlaceVerification(id, input as AdminProductionPlaceVerificationInput);
  } catch (error) {
    return NextResponse.json({ error: error instanceof PlacesJsonWriteConflictError ? error.message : "Could not confirm the save. Reload before retrying." }, { status: error instanceof PlacesJsonWriteConflictError ? 409 : 500 });
  }

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const { id } = await context.params;
  let result;
  try {
    result = deleteProductionPlace(id, request.headers.get("x-record-version") ?? "");
  } catch (error) {
    return NextResponse.json({ error: error instanceof PlacesJsonWriteConflictError ? error.message : "Could not confirm deletion. Reload before retrying." }, { status: error instanceof PlacesJsonWriteConflictError ? 409 : 500 });
  }

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.json(result);
}
