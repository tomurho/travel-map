import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

import { OAuth2Client, type Credentials } from "google-auth-library";

export const GOOGLE_PROVIDER_TIMEOUT_MS = 20_000;
export const GOOGLE_SHEETS_REPAIR_INSTRUCTIONS = "Run pnpm setup:google-sheets in the project terminal. Open the printed Google link, grant access, and paste the code there. Then retry in Admin.";

export class GoogleSheetsConnectionError extends Error {
  constructor(reason: string) {
    super(`${reason} ${GOOGLE_SHEETS_REPAIR_INSTRUCTIONS}`);
    this.name = "GoogleSheetsConnectionError";
  }
}

async function withProviderTimeout<T>(request: Promise<T>, timeoutMs = GOOGLE_PROVIDER_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Google connection timed out. Your drafts are still available. Retry the action.")), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const OAUTH_CLIENT_PATH = path.resolve(
  process.cwd(),
  "credentials/google-oauth-client.json",
);
const OAUTH_TOKEN_PATH = path.resolve(
  process.cwd(),
  "credentials/google-sheets-token.json",
);

export type SheetMetadata = {
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
    };
  }>;
};

export type ValuesResponse = {
  values?: string[][];
};

export type BatchValuesResponse = {
  valueRanges?: Array<{
    range?: string;
    values?: string[][];
  }>;
};

type GoogleOAuthClientConfig = {
  installed?: {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
  web?: {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
};

async function readJsonFile<TValue>(filePath: string) {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as TValue;
}

async function writeTokenFile(tokens: Credentials, tokenPath: string) {
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
}

type GoogleSheetsAuthPaths = { clientPath?: string; tokenPath?: string };

export function createGoogleSheetsAuthClient(paths: GoogleSheetsAuthPaths = {}) {
  return loadGoogleSheetsAuthClient(false, paths);
}

/** Explicit local setup only. HTTP handlers always use the noninteractive function above. */
export function setupGoogleSheetsAuthClient(paths: GoogleSheetsAuthPaths = {}) {
  return loadGoogleSheetsAuthClient(true, paths);
}

async function loadGoogleSheetsAuthClient(interactive: boolean, paths: GoogleSheetsAuthPaths) {
  const clientPath = paths.clientPath ?? OAUTH_CLIENT_PATH;
  const tokenPath = paths.tokenPath ?? OAUTH_TOKEN_PATH;
  let rawConfig: GoogleOAuthClientConfig;

  try {
    rawConfig = await readJsonFile<GoogleOAuthClientConfig>(clientPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GoogleSheetsConnectionError(
      `Unable to read OAuth client credentials from ${clientPath}: ${message}`,
    );
  }

  const config = rawConfig.installed ?? rawConfig.web;
  const clientId = config?.client_id;
  const clientSecret = config?.client_secret;
  const redirectUri = config?.redirect_uris?.[0] ?? "http://localhost";

  if (!clientId || !clientSecret) {
    throw new GoogleSheetsConnectionError(
      `OAuth client credentials in ${clientPath} must include client_id and client_secret.`,
    );
  }

  const client = new OAuth2Client({ clientId, clientSecret, redirectUri, transporterOptions: { timeout: GOOGLE_PROVIDER_TIMEOUT_MS, retry: false } });

  client.transporter.interceptors.request.add({
    resolved: async (options) => ({ ...options, retry: false, timeout: GOOGLE_PROVIDER_TIMEOUT_MS, signal: AbortSignal.timeout(GOOGLE_PROVIDER_TIMEOUT_MS) }),
  });

  client.on("tokens", async (tokens) => {
    if (Object.keys(tokens).length === 0) {
      return;
    }

    try {
      const existingTokens = await readJsonFile<Credentials>(tokenPath).catch(
        () => ({}),
      );
      await writeTokenFile({ ...existingTokens, ...tokens }, tokenPath);
    } catch (error) {
      console.warn(
        `Google Sheets token refresh succeeded but saving ${tokenPath} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  if (!interactive) {
    try {
      const tokens = await readJsonFile<Credentials>(tokenPath);
      if (!tokens.refresh_token && !tokens.access_token) throw new Error("The token file has no access token or refresh token.");
      client.setCredentials(tokens);
      return client;
    } catch {
      throw new GoogleSheetsConnectionError("Google Sheets is not connected, or its token file cannot be read.");
    }
  }


  const authorizationUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GOOGLE_SHEETS_SCOPE],
  });

  console.log("Authorize Google Sheets access by opening this URL:");
  console.log(authorizationUrl);

  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const code = (await terminal.question("Paste the authorization code: ")).trim();

    if (!code) {
      throw new Error("Authorization code is required.");
    }

    const { tokens } = await withProviderTimeout(client.getToken(code));
    client.setCredentials(tokens);
    await writeTokenFile(tokens, tokenPath);
    console.log(`Saved Google Sheets OAuth tokens to ${tokenPath}.`);
    return client;
  } finally {
    terminal.close();
  }
}

export function columnName(index: number) {
  let value = index + 1;
  let name = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name;
}

export function quoteSheetName(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

export function normalizeSheetHeader(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function mapSheetRowToObject(headers: string[], row: string[]) {
  return Object.fromEntries(
    headers.map((header, index) => [
      String(header ?? ""),
      String(row[index] ?? ""),
    ]),
  );
}

export function readMappedSheetField(
  record: Record<string, string>,
  names: string[],
) {
  const normalizedKeys = new Map<string, string>();

  for (const key of Object.keys(record)) {
    const normalizedKey = normalizeSheetHeader(key);

    if (normalizedKey && !normalizedKeys.has(normalizedKey)) {
      normalizedKeys.set(normalizedKey, key);
    }
  }

  for (const name of names) {
    const key = normalizedKeys.get(normalizeSheetHeader(name));

    if (key !== undefined) {
      return String(record[key] ?? "").trim();
    }
  }

  return "";
}

export async function sheetsFetch<TResponse>(
  authClient: OAuth2Client,
  sheetPath: string,
  options: {
    body?: unknown;
    method?: "GET" | "POST" | "PUT";
    searchParams?: Record<string, string | string[]>;
    timeoutMs?: number;
  } = {},
) {
  const url = new URL(`https://sheets.googleapis.com/v4/${sheetPath}`);

  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
    } else {
      url.searchParams.set(key, value);
    }
  }

  let accessToken;
  try { accessToken = await withProviderTimeout(authClient.getAccessToken(), options.timeoutMs); }
  catch (error) {
    if (/invalid_grant|invalid_client|unauthorized_client/i.test(error instanceof Error ? error.message : "")) {
      throw new GoogleSheetsConnectionError("Google Sheets access has expired.");
    }
    throw error;
  }
  const token = accessToken.token;

  if (!token) {
    throw new GoogleSheetsConnectionError("Unable to get a Google Sheets OAuth access token.");
  }

  const response = await fetch(url, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: options.method ?? "GET",
    signal: AbortSignal.timeout(options.timeoutMs ?? GOOGLE_PROVIDER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Google Sheets API ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as TResponse;
}

export async function getSpreadsheetMetadata(
  authClient: OAuth2Client,
  sheetId: string,
) {
  return sheetsFetch<SheetMetadata>(authClient, `spreadsheets/${sheetId}`, {
    searchParams: { fields: "sheets.properties(sheetId,title)" },
  });
}

export function findSheet(metadata: SheetMetadata, title: string) {
  return metadata.sheets?.find((sheet) => sheet.properties?.title === title);
}

export function assertSheetExists(metadata: SheetMetadata, title: string) {
  if (!findSheet(metadata, title)) {
    throw new Error(`Required tab "${title}" was not found.`);
  }
}

export async function addSheet(
  authClient: OAuth2Client,
  sheetId: string,
  title: string,
) {
  await sheetsFetch(authClient, `spreadsheets/${sheetId}:batchUpdate`, {
    body: {
      requests: [
        {
          addSheet: {
            properties: { title },
          },
        },
      ],
    },
    method: "POST",
  });
}

export async function ensureSheet(
  authClient: OAuth2Client,
  sheetId: string,
  metadata: SheetMetadata,
  title: string,
) {
  if (findSheet(metadata, title)) {
    return;
  }

  await addSheet(authClient, sheetId, title);
}

export async function readValues(
  authClient: OAuth2Client,
  sheetId: string,
  range: string,
) {
  const response = await sheetsFetch<ValuesResponse>(
    authClient,
    `spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
  );

  return response.values ?? [];
}

export async function batchReadValues(
  authClient: OAuth2Client,
  sheetId: string,
  ranges: string[],
) {
  if (ranges.length === 0) {
    return [];
  }

  const response = await sheetsFetch<BatchValuesResponse>(
    authClient,
    `spreadsheets/${sheetId}/values:batchGet`,
    {
      searchParams: {
        majorDimension: "ROWS",
        ranges,
      },
    },
  );

  return ranges.map(
    (_, index) => response.valueRanges?.[index]?.values ?? [],
  );
}

export async function appendValues(
  authClient: OAuth2Client,
  sheetId: string,
  range: string,
  values: string[][],
) {
  await sheetsFetch(
    authClient,
    `spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append`,
    {
      body: {
        majorDimension: "ROWS",
        values,
      },
      method: "POST",
      searchParams: {
        insertDataOption: "INSERT_ROWS",
        valueInputOption: "USER_ENTERED",
      },
    },
  );
}

export async function updateValues(
  authClient: OAuth2Client,
  sheetId: string,
  range: string,
  values: string[][],
) {
  await sheetsFetch(
    authClient,
    `spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
    {
      body: {
        majorDimension: "ROWS",
        values,
      },
      method: "PUT",
      searchParams: {
        valueInputOption: "USER_ENTERED",
      },
    },
  );
}

export async function batchUpdateValues(
  authClient: OAuth2Client,
  sheetId: string,
  data: Array<{
    range: string;
    values: string[][];
  }>,
) {
  if (data.length === 0) {
    return;
  }

  await sheetsFetch(
    authClient,
    `spreadsheets/${sheetId}/values:batchUpdate`,
    {
      body: {
        data,
        valueInputOption: "USER_ENTERED",
      },
      method: "POST",
    },
  );
}

export async function batchUpdateSpreadsheet(
  authClient: OAuth2Client,
  sheetId: string,
  requests: Array<Record<string, unknown>>,
) {
  if (requests.length === 0) {
    return;
  }

  await sheetsFetch(authClient, `spreadsheets/${sheetId}:batchUpdate`, {
    body: { requests },
    method: "POST",
  });
}
