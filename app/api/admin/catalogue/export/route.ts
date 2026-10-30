import { NextRequest } from "next/server";
import {
  catalogueAuthorization,
  catalogueFailure,
  catalogueResponse,
} from "@/lib/catalogue-http";
import { getCatalogueStore } from "@/lib/catalogue-store";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const denied = catalogueAuthorization(request);
  if (denied) return denied;
  try {
    const response = catalogueResponse({
      format: "travel-catalogue-v1",
      exportedAt: new Date().toISOString(),
      entries: await getCatalogueStore().list(),
    });
    response.headers.set(
      "Content-Disposition",
      `attachment; filename="travel-catalogue-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    return response;
  } catch (error) {
    return catalogueFailure(error);
  }
}
