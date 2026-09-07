import { AdminWorkflow } from "@/components/admin-workflow";
import type { Place } from "@/lib/place";
import { notFound } from "next/navigation";
import { readPlacesJsonSnapshot } from "@/lib/places-json-store";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_ADMIN !== "true") {
    notFound();
  }

  const places = readPlacesJsonSnapshot().places;
  const cityOptions = Array.from(
    new Set((places as Place[]).map((place) => place.city)),
  ).sort();
  const categoryOptions = Array.from(
    new Set((places as Place[]).map((place) => place.category).filter(Boolean)),
  ).sort();

  return (
    <AdminWorkflow
      categoryOptions={categoryOptions}
      cityOptions={cityOptions}
      productionPlaces={places as Place[]}
    />
  );
}
