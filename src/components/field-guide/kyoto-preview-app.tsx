"use client";
import type { Place } from "@/lib/place";
import { FieldGuideApp } from "./field-guide-app";

export function KyotoPreviewApp({ places }: { places: Place[] }) {
  return <FieldGuideApp places={places} previewCity="Kyoto" />;
}
