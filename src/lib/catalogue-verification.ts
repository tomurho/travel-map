import { CatalogueError, type CatalogueEntry } from "@/lib/catalogue";

export async function verifyCataloguePublication(
  entry: CatalogueEntry,
  requestOrigin: string,
  shared: boolean,
  fetcher: typeof fetch = fetch,
) {
  const configured = process.env.PUBLIC_SITE_URL?.trim();
  if (process.env.NODE_ENV === "production" && !configured)
    throw new CatalogueError(
      "Saved; live check pending. Configure the public site address before confirming delivery.",
      503,
    );
  const origin = new URL(configured || requestOrigin).origin;
  if (configured && !origin.startsWith("https://"))
    throw new CatalogueError("The public site address must use HTTPS.", 503);
  const response = await fetcher(`${origin}/api/catalogue`, {
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new CatalogueError(
      "Saved; live check pending. The public catalogue could not be read. Retry the check.",
      503,
    );
  const data = (await response.json()) as {
    versions?: Record<string, string>;
    places?: Array<{ id: string }>;
  };
  const shouldExist = Boolean(
    entry.live &&
    !entry.archived &&
    entry.live.verifiedStatus !== "Closed/Moved",
  );
  const confirmed = shouldExist
    ? data.versions?.[entry.id] === entry.publicVersion &&
      data.places?.some((p) => p.id === entry.id) === true
    : Array.isArray(data.places) &&
      !data.places.some((p) => p.id === entry.id) &&
      !data.versions?.[entry.id];
  return {
    confirmed,
    mode: shared && Boolean(configured) ? "live" : "local",
    checkedAt: new Date().toISOString(),
    version: entry.publicVersion,
    publicUrl: `${origin}/?city=${encodeURIComponent(entry.live?.city ?? entry.input.city)}&group=all`,
  };
}
