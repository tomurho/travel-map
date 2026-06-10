import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

import { OAuth2Client, type Credentials } from "google-auth-library";

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
      title?: string;
    };
  }>;
};

export type ValuesResponse = {
  values?: string[][];
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

async function writeTokenFile(tokens: Credentials) {
  await fs.mkdir(path.dirname(OAUTH_TOKEN_PATH), { recursive: true });
  await fs.writeFile(OAUTH_TOKEN_PATH, `${JSON.stringify(tokens, null, 2)}\n`);
}

export async function createGoogleSheetsAuthClient() {
  let rawConfig: GoogleOAuthClientConfig;

  try {
    rawConfig = await readJsonFile<GoogleOAuthClientConfig>(OAUTH_CLIENT_PATH);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read OAuth client credentials from ${OAUTH_CLIENT_PATH}: ${message}`,
    );
  }

  const config = rawConfig.installed ?? rawConfig.web;
  const clientId = config?.client_id;
  const clientSecret = config?.client_secret;
  const redirectUri = config?.redirect_uris?.[0] ?? "http://localhost";

  if (!clientId || !clientSecret) {
    throw new Error(
      `OAuth client credentials in ${OAUTH_CLIENT_PATH} must include client_id and client_secret.`,
    );
  }

  const client = new OAuth2Client(clientId, clientSecret, redirectUri);

  client.on("tokens", async (tokens) => {
    if (Object.keys(tokens).length === 0) {
      return;
    }

    try {
      const existingTokens = await readJsonFile<Credentials>(OAUTH_TOKEN_PATH).catch(
        () => ({}),
      );
      await writeTokenFile({ ...existingTokens, ...tokens });
    } catch (error) {
      console.warn(
        `Google Sheets token refresh succeeded but saving ${OAUTH_TOKEN_PATH} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  try {
    const tokens = await readJsonFile<Credentials>(OAUTH_TOKEN_PATH);
    client.setCredentials(tokens);
    return client;
  } catch {
    // First run continues into the local desktop OAuth flow.
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

    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    await writeTokenFile(tokens);
    console.log(`Saved Google Sheets OAuth tokens to ${OAUTH_TOKEN_PATH}.`);
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
    searchParams?: Record<string, string>;
  } = {},
) {
  const url = new URL(`https://sheets.googleapis.com/v4/${sheetPath}`);

  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const accessToken = await authClient.getAccessToken();
  const token = accessToken.token;

  if (!token) {
    throw new Error("Unable to get a Google Sheets OAuth access token.");
  }

  const response = await fetch(url, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: options.method ?? "GET",
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
    searchParams: { fields: "sheets.properties(title)" },
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
