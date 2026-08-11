const CITY_ALIASES = new Map([
  ["ho chi minh", "Ho Chi Minh"],
  ["ho chi minh city", "Ho Chi Minh"],
  ["hcmc", "Ho Chi Minh"],
  ["taipei", "Taipei"],
  ["taipei city", "Taipei"],
]);

function normalizeCityKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePlaceCity(value: string) {
  const trimmed = value.trim();

  return CITY_ALIASES.get(normalizeCityKey(trimmed)) ?? trimmed;
}
