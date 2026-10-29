import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { CatalogueError } from "@/lib/catalogue";

export function catalogueAuthorization(request: NextRequest) {
  if (!isAdminAuthorized(request))
    return NextResponse.json(
      { error: "Sign in to manage your places." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  if (
    request.method !== "GET" &&
    request.headers.get("origin") &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return NextResponse.json(
      { error: "Use Admin on this website to save changes." },
      { status: 403 },
    );
  return null;
}
export function catalogueResponse(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
    },
  });
}
export function catalogueFailure(error: unknown) {
  if (error instanceof CatalogueError)
    return catalogueResponse({ error: error.message }, error.status);
  console.error(
    "[catalogue] request failed",
    error instanceof Error ? error.name : "Unknown error",
  );
  return catalogueResponse(
    {
      error:
        "Could not complete this request. Refresh to check the saved state before retrying.",
    },
    503,
  );
}
