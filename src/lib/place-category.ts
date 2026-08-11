export function findCanonicalCategory(
  value: string,
  categoryOptions: string[],
) {
  const normalizedValue = value.trim().toLocaleLowerCase();

  if (!normalizedValue) {
    return null;
  }

  return (
    categoryOptions.find(
      (option) => option.trim().toLocaleLowerCase() === normalizedValue,
    ) ?? null
  );
}
