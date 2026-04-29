import places from "@/data/places.json";
import { AdminWorkflow } from "@/components/admin-workflow";
import type { Place } from "@/lib/place";

export default function AdminPage() {
  const cityOptions = Array.from(
    new Set((places as Place[]).map((place) => place.city)),
  ).sort();

  return <AdminWorkflow cityOptions={cityOptions} />;
}
