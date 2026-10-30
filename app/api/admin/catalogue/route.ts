import { NextRequest } from "next/server";
import {
  catalogueAuthorization,
  catalogueFailure,
  catalogueResponse,
} from "@/lib/catalogue-http";
import {
  catalogueConfigured,
  getCatalogueStore,
  sharedCatalogueEnabled,
} from "@/lib/catalogue-store";
import { addCataloguePlace } from "@/lib/catalogue-service";
import { CatalogueError } from "@/lib/catalogue";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const denied = catalogueAuthorization(request);
  if (denied) return denied;
  try {
    if (!catalogueConfigured() || !sharedCatalogueEnabled())
      return catalogueResponse({
        configured: false,
        entries: [],
        categories: [],
        error:
          "The shared catalogue is not connected yet. Existing public places are unchanged.",
      });
    const store = getCatalogueStore(),
      entries = await store.list();
    return catalogueResponse({
      configured: true,
      storage: store.kind,
      entries,
      categories: [
        ...new Set(
          entries
            .flatMap((e) => [e.live?.category, e.draft?.category])
            .filter((v): v is string => Boolean(v)),
        ),
      ].sort(),
    });
  } catch (error) {
    return catalogueFailure(error);
  }
}
export async function POST(request: NextRequest) {
  const denied = catalogueAuthorization(request);
  if (denied) return denied;
  try {
    if (!sharedCatalogueEnabled())
      throw new CatalogueError(
        "Connect the shared catalogue before adding places.",
        503,
      );
    const input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new CatalogueError("Enter a place name and city.");
    if (
      typeof input.name !== "string" ||
      typeof input.city !== "string" ||
      typeof input.requestId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(input.requestId)
    )
      throw new CatalogueError("Enter a place name and city.");
    return catalogueResponse(
      await addCataloguePlace(
        getCatalogueStore(),
        {
          name: input.name,
          city: input.city,
          source:
            typeof input.source === "string"
              ? input.source.slice(0, 5000)
              : undefined,
        },
        input.requestId,
      ),
    );
  } catch (error) {
    return catalogueFailure(error);
  }
}
