import places from "@/data/places.json";
import { AdminWorkflow } from "@/components/admin-workflow";
import type { Place } from "@/lib/place";
import { notFound } from "next/navigation";

export default function AdminPage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_ADMIN !== "true") {
    notFound();
  }

  const cityOptions = Array.from(
    new Set((places as Place[]).map((place) => place.city)),
  ).sort();

  return <AdminWorkflow cityOptions={cityOptions} />;
}
