import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testIgnore: process.env.MEASURE_PUBLIC_MAP === "1" ? [] : ["**/performance.spec.ts"],
  fullyParallel: false,
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.BROWSER_TEST_URL ?? "http://localhost:3000",
    channel: "chrome",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  // Start the loopback server separately: pnpm dev. Never mutate live Sheets here.
});
