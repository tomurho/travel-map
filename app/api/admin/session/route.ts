import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { catalogueResponse } from "@/lib/catalogue-http";

export async function POST(request: NextRequest) {
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return catalogueResponse({ error: "Sign in on this website." }, 403);
  if (!isAdminAuthorized(request))
    return catalogueResponse(
      { error: "Enter the correct admin password." },
      401,
    );
  const response = catalogueResponse({ signedIn: true });
  if (process.env.ADMIN_PASSWORD) {
    const expiry = String(Date.now() + 8 * 60 * 60 * 1000);
    const signature = createHmac("sha256", process.env.ADMIN_PASSWORD)
      .update(`catalogue-session:${expiry}`)
      .digest("hex");
    response.cookies.set("travel_admin", `${expiry}.${signature}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
  }
  return response;
}
export async function DELETE() {
  const response = catalogueResponse({ signedIn: false });
  response.cookies.set("travel_admin", "", { path: "/", maxAge: 0 });
  return response;
}
