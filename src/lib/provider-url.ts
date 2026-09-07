const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 4500;

const EXACT_HOSTS = new Set([
  "goo.gl",
  "maps.app.goo.gl",
  "tabelog.com",
]);

function isGoogleHost(hostname: string) {
  return (
    hostname === "google.com" ||
    hostname.endsWith(".google.com") ||
    /^([a-z0-9-]+\.)?google\.(?:[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i.test(
      hostname,
    )
  );
}

export function parseSupportedProviderUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid provider URL.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const isTabelog = hostname === "tabelog.com" || hostname.endsWith(".tabelog.com");

  if (url.protocol !== "https:") {
    throw new Error("Provider URLs must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Provider URLs cannot contain credentials.");
  }
  if (url.port) {
    throw new Error("Provider URLs cannot use a custom port.");
  }
  if (!EXACT_HOSTS.has(hostname) && !isTabelog && !isGoogleHost(hostname)) {
    throw new Error("Only Google Maps and Tabelog URLs are supported.");
  }

  return url;
}

export function isSupportedTabelogUrl(value: string) {
  try {
    const hostname = parseSupportedProviderUrl(value).hostname.toLowerCase();
    return hostname === "tabelog.com" || hostname.endsWith(".tabelog.com");
  } catch {
    return false;
  }
}

export async function fetchSupportedProviderUrl(
  value: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
) {
  let url = parseSupportedProviderUrl(value);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetcher(url, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }

      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Provider redirect did not include a destination.");
      }
      if (redirects === MAX_REDIRECTS) {
        throw new Error(`Provider URL exceeded ${MAX_REDIRECTS} redirects.`);
      }

      url = parseSupportedProviderUrl(new URL(location, url).toString());
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Provider URL could not be resolved.");
}
