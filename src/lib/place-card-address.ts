import type { Place } from "@/lib/place";

// Display only: remove exact repeated context, never infer or reorder address parts.
// The original address and Maps handoff remain untouched.
export function compactPlaceAddress(place: Pick<Place, "address" | "city" | "district">) {
  const fold = (value: string) => value.trim().toLocaleLowerCase();
  const context = new Set([place.city, place.district].filter(Boolean).map(fold));
  const parts = place.address.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
  const japaneseAddress = parts.some((part) => /^Japan$/i.test(part)) || place.address.includes("〒");
  const compact = parts.flatMap((part) => {
    if (/^(Japan|Taiwan|Vietnam|Viet Nam)$/i.test(part)) return [];
    // Japanese postcodes can share a component with the city name.
    const withoutPostcode = japaneseAddress ? part.replace(/^〒?\s*\d{3}-\d{4}\s*/, "").trim() : part;
    if (!withoutPostcode || context.has(fold(withoutPostcode))) return [];
    const cityWithPostcode = japaneseAddress ? withoutPostcode.replace(/\s+\d{3}-\d{4}$/, "") : withoutPostcode;
    if (context.has(fold(cityWithPostcode))) return [];
    return [part.replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))];
  }).join(", ");
  return compact || place.address.trim();
}
