import type { Metadata } from "next";
import { Suspense } from "react";
import { toPublicPlace } from "@/components/field-guide/field-guide-page";
import { KyotoPreviewApp } from "@/components/field-guide/kyoto-preview-app";
import { isPublicPlace } from "@/lib/filtering";
import { normalizePlaceCity } from "@/lib/place-city";
import { readPlacesJsonSnapshot } from "@/lib/places-json-store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Kyoto preview · Travel Field Guide",
  robots: { index: false, follow: false },
};

export default function KyotoPreviewPage() {
  const places = readPlacesJsonSnapshot().places
    .filter((place) => isPublicPlace(place) && normalizePlaceCity(place.city) === "Kyoto")
    .map(toPublicPlace);
  return <Suspense fallback={<p>Loading Kyoto preview…</p>}><KyotoPreviewApp places={places} /></Suspense>;
}
