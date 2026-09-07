import { normalizeApprovedPlaceType } from "@/lib/place-types";

export function findCanonicalCategory(
  value: string,
  categoryOptions: string[],
) {
  const trimmed = value.trim();
  if (categoryOptions.includes(trimmed)) return trimmed;
  const normalizedValue = normalizeApprovedPlaceType(trimmed).toLocaleLowerCase();

  if (!normalizedValue) {
    return null;
  }

  return (
    categoryOptions.find(
      (option) => option.trim().toLocaleLowerCase() === normalizedValue,
    ) ?? null
  );
}
