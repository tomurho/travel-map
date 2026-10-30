import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (process.env.CATALOGUE_ENABLED !== "true") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (
    path.startsWith("/api/admin/catalogue") ||
    path === "/api/admin/session" ||
    path === "/api/admin/screenshot-intake/extract"
  )
    return NextResponse.next();
  return NextResponse.json(
    {
      error:
        "The old publishing workflow is retired. Use Inbox → Review → Live in Admin.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
export const config = { matcher: "/api/admin/:path*" };
