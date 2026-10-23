import { GOOGLE_SHEETS_REPAIR_INSTRUCTIONS } from "@/lib/google-sheets-oauth";

export function getGoogleSheetsErrorMessage(
  error: unknown,
  fallback: string,
) {
  const message = error instanceof Error ? error.message : "";

  if (/invalid_grant/i.test(message)) {
    return `Google Sheets access has expired. ${GOOGLE_SHEETS_REPAIR_INSTRUCTIONS}`;
  }

  if (/Google Sheets API 429|RATE_LIMIT_EXCEEDED|RESOURCE_EXHAUSTED/i.test(message)) {
    return "Google Sheets is temporarily rate-limited. Your existing Admin data is still available; try refreshing again in about 60 seconds.";
  }

  if (error instanceof Error && (/timeout|timed out/i.test(message) || error.name === "TimeoutError" || error.name === "AbortError")) {
    return "Google did not reply in time. Your drafts are still available. Retry the action.";
  }
  return message || fallback;
}

export function getGoogleSheetsErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  return /Google Sheets API 429|RATE_LIMIT_EXCEEDED|RESOURCE_EXHAUSTED/i.test(
    message,
  )
    ? 429
    : 400;
}
