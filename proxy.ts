import { NextRequest, NextResponse } from "next/server";
import { isAdminEnabled } from "@/lib/admin-auth";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const adminPath = /^\/(?:admin|api\/admin)(?:\/|$)/.test(path);
  if (!adminPath) return NextResponse.next();
  if (
    !isAdminEnabled() ||
    !["localhost", "127.0.0.1", "[::1]"].includes(request.nextUrl.hostname)
  ) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (path === "/admin" || path.startsWith("/admin/"))
    return NextResponse.next();
  if (process.env.CATALOGUE_ENABLED !== "true") return NextResponse.next();
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
export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
