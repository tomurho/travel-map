import { setupGoogleSheetsAuthClient } from "../src/lib/google-sheets-oauth";

setupGoogleSheetsAuthClient().then(() => {
  console.log("Google Sheets is connected. Retry the action in Admin.");
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
