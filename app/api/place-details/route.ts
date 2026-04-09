import { NextRequest, NextResponse } from "next/server";

type SearchTextResponse = {
  places?: Array<{
    id?: string;
    currentOpeningHours?: {
      weekdayDescriptions?: string[];
    };
    photos?: Array<{
      name?: string;
    }>;
  }>;
};

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";
  const address = request.nextUrl.searchParams.get("address")?.trim() ?? "";
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";

  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Places API key is not configured." },
      { status: 500 },
    );
  }

  if (!name && !address) {
    return NextResponse.json(
      { error: "A place name or address is required." },
      { status: 400 },
    );
  }

  const textQuery = [name, address].filter(Boolean).join(", ");

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.currentOpeningHours.weekdayDescriptions,places.photos.name",
    },
    body: JSON.stringify({
      textQuery,
      maxResultCount: 1,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "Google Places lookup failed." },
      { status: response.status },
    );
  }

  const data = (await response.json()) as SearchTextResponse;
  const match = data.places?.[0];

  if (!match) {
    return NextResponse.json({
      matched: false,
      openingHours: null,
      photoUrl: null,
    });
  }

  const photoName = match.photos?.[0]?.name;

  return NextResponse.json({
    matched: true,
    openingHours: match.currentOpeningHours?.weekdayDescriptions ?? null,
    photoUrls:
      match.photos
        ?.map((photo) => photo.name)
        .filter((name): name is string => Boolean(name))
        .slice(0, 12)
        .map(
          (name) =>
            `https://places.googleapis.com/v1/${name}/media?maxHeightPx=320&maxWidthPx=320&key=${apiKey}`,
        ) ?? [],
  });
}
