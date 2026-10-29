import { NextRequest } from "next/server";
import {
  catalogueAuthorization,
  catalogueFailure,
  catalogueResponse,
} from "@/lib/catalogue-http";
import {
  getCatalogueStore,
  sharedCatalogueEnabled,
} from "@/lib/catalogue-store";
import {
  actOnCatalogueEntry,
  lookupCatalogueEntry,
  requireEntry,
  type CatalogueAction,
} from "@/lib/catalogue-service";
import { verifyCataloguePublication } from "@/lib/catalogue-verification";
import { CatalogueError } from "@/lib/catalogue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = catalogueAuthorization(request);
  if (denied) return denied;
  try {
    if (!sharedCatalogueEnabled())
      throw new CatalogueError(
        "Connect the shared catalogue before saving changes.",
        503,
      );
    const { id } = await context.params,
      input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new CatalogueError("Invalid catalogue request.");
    if (
      typeof input.expectedVersion !== "string" ||
      typeof input.operationId !== "string" ||
      input.operationId.length > 100
    )
      throw new CatalogueError(
        "Refresh this place before saving changes.",
        409,
      );
    const store = getCatalogueStore();
    if (input.action === "verify")
      return catalogueResponse(
        await verifyCataloguePublication(
          await requireEntry(store, id, input.expectedVersion),
          new URL(request.url).origin,
          store.kind === "shared",
        ),
      );
    const entry =
      input.action === "lookup"
        ? await lookupCatalogueEntry(store, id, input.expectedVersion, {
            query:
              typeof input.query === "string"
                ? input.query.slice(0, 500)
                : undefined,
            mapsUrl:
              typeof input.mapsUrl === "string"
                ? input.mapsUrl.slice(0, 3000)
                : undefined,
            city:
              typeof input.city === "string"
                ? input.city.slice(0, 150)
                : undefined,
          })
        : await actOnCatalogueEntry(store, id, input as CatalogueAction);
    return catalogueResponse({ entry, storage: store.kind });
  } catch (error) {
    return catalogueFailure(error);
  }
}
