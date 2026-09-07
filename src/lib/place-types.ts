import decisions from "@/data/place-type-decisions.json";

const approved = decisions.types.filter((type) => type.decision === "approved");
const labels = new Map(approved.map((type) => [type.sourceType, type.label]));

// Exact aliases only: deferred distinctions such as Tea Shop / Tea shop survive.
export function normalizeApprovedPlaceType(value: string) {
  const trimmed = value.trim();
  return labels.get(trimmed) ?? trimmed;
}

export function getPlaceTypeGroup(value: string) {
  const label = normalizeApprovedPlaceType(value);
  return approved.find((type) => type.label === label)?.group ?? null;
}

export function getPlaceTypeAliases(value: string) {
  const label = normalizeApprovedPlaceType(value);
  return approved.filter((type) => type.label === label).map((type) => type.sourceType);
}

export function normalizePlaceSearch(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

export function resolvePlaceTypeOption(value: string, options: readonly string[]) {
  if (options.includes(value)) return value;
  const canonical = normalizeApprovedPlaceType(value);
  return options.includes(canonical) ? canonical : value;
}
