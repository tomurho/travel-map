import { NextRequest, NextResponse } from "next/server";

import { FreeGeocodingAccess } from "@/lib/free-geocoding";
import { resolveGoogleMapsUrlForProductionPlace } from "@/lib/google-place-admin-resolver";
import { GooglePlacesAccess } from "@/lib/google-places-access";
import type { Place } from "@/lib/place";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { parseSupportedProviderUrl } from "@/lib/provider-url";
import { PlacesJsonWriteConflictError } from "@/lib/places-json-store";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? "";
  const googleLiveEnabled = process.env.GOOGLE_PLACES_LIVE_ENABLED === "true";
  const freeLiveEnabled = process.env.FREE_GEOCODING_LIVE_ENABLED === "true";

  if (googleLiveEnabled && !apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY is required." },
      { status: 500 },
    );
  }

  let input: {
    googleMapsUrl?: string;
    place?: Partial<Pick<Place, "address" | "canonicalAddress" | "latitude" | "longitude">>;
  };
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Enter a Maps link and valid location fields.");
    }
    const fields = body as Record<string, unknown>;
    if (typeof fields.googleMapsUrl !== "string") {
      throw new Error("Google Maps URL must be text.");
    }
    if (fields.googleMapsUrl.trim()) {
      const url = parseSupportedProviderUrl(fields.googleMapsUrl.trim());
      if (/(^|\.)tabelog\.com$/i.test(url.hostname)) {
        throw new Error("Enter a Google Maps URL.");
      }
    }
    if (fields.place !== undefined && (!fields.place || typeof fields.place !== "object" || Array.isArray(fields.place))) {
      throw new Error("Location fields must be an object.");
    }
    const location = fields.place as Record<string, unknown> | undefined;
    for (const field of ["address", "canonicalAddress"] as const) {
      if (location?.[field] !== undefined && typeof location[field] !== "string") {
        throw new Error(`${field} must be text.`);
      }
    }
    for (const [field, limit] of [["latitude", 90], ["longitude", 180]] as const) {
      const value = location?.[field];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit)) {
        throw new Error(`${field} must be a number between -${limit} and ${limit}.`);
      }
    }
    input = { googleMapsUrl: fields.googleMapsUrl, place: location as typeof input.place };
  } catch (error) {
    const message = error instanceof SyntaxError ? "Enter valid JSON."
      : error instanceof Error ? error.message : "Invalid location fields.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { id } = await context.params;
  try {
    const result = await resolveGoogleMapsUrlForProductionPlace(
      id,
      input.googleMapsUrl ?? "",
      apiKey,
      {
        access: new GooglePlacesAccess({
          cacheOnly: !googleLiveEnabled,
          confirmLiveApi: googleLiveEnabled,
          liveEnabled: googleLiveEnabled,
          maxApiCalls: 5,
        }),
        freeAccess: new FreeGeocodingAccess({
          liveEnabled: freeLiveEnabled,
          maxLiveCalls: 3,
        }),
        placeOverrides: input.place,
      },
    );

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const conflict = error instanceof PlacesJsonWriteConflictError;
    const message = conflict ? "This place changed. Refresh before resolving it again."
      : "Could not confirm the save. Reload the place before trying again.";
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 500 });
  }
}
