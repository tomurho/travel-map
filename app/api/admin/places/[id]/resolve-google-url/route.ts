import { NextRequest, NextResponse } from "next/server";

import { FreeGeocodingAccess } from "@/lib/free-geocoding";
import { resolveGoogleMapsUrlForProductionPlace } from "@/lib/google-place-admin-resolver";
import { GooglePlacesAccess } from "@/lib/google-places-access";
import type { Place } from "@/lib/place";
import { isAdminAuthorized } from "@/lib/admin-auth";

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

  const { id } = await context.params;
  const input = (await request.json()) as {
    googleMapsUrl?: string;
    place?: Partial<Pick<Place, "address" | "canonicalAddress" | "latitude" | "longitude">>;
  };
  const result = await resolveGoogleMapsUrlForProductionPlace(
    decodeURIComponent(id),
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
}
