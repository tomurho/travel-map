import type { Metadata } from "next";
import { Suspense } from "react";
import { toPublicPlace } from "@/components/field-guide/field-guide-page";
import { KyotoPreviewApp } from "@/components/field-guide/kyoto-preview-app";
import { isPublicPlace } from "@/lib/filtering";
import { normalizePlaceCity } from "@/lib/place-city";
import { readPublicPlaces } from "@/lib/public-catalogue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Kyoto preview · Travel Field Guide",
  robots: { index: false, follow: false },
};

export default async function KyotoPreviewPage() {
  const places = (await readPublicPlaces())
    .filter(
      (place) =>
        isPublicPlace(place) && normalizePlaceCity(place.city) === "Kyoto",
    )
    .map(toPublicPlace);
  return (
    <Suspense fallback={<p>Loading Kyoto preview…</p>}>
      <KyotoPreviewApp places={places} />
    </Suspense>
  );
}
