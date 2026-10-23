import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Opt in separately: MEASURE_PUBLIC_MAP=1 pnpm test:browser performance.spec.ts.
// This loads the ordinary public Google map. No admin request can reach a server.
test("measure public startup and filtering under mobile emulation", async ({ browser }) => {
  test.skip(process.env.MEASURE_PUBLIC_MAP !== "1", "Run separately to measure the real public provider.");
  test.setTimeout(180_000);
  const runs: Record<string, unknown>[] = [];
  for (let run = 0; run < 3; run++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.route("**/api/admin/**", (route) => route.abort());
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const hosts = new Map<string, string>();
    let appBytes = 0, providerBytes = 0;
    cdp.on("Network.requestWillBeSent", ({ requestId, request }) => hosts.set(requestId, new URL(request.url).hostname));
    cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => { if (hosts.get(requestId) === "localhost") appBytes += encodedDataLength; else providerBytes += encodedDataLength; });
    const start = Date.now();
    await page.goto(`${process.env.BROWSER_TEST_URL ?? "http://localhost:3000"}/?city=Kyoto`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("combobox", { name: "Current city" })).toBeVisible();
    const shellMs = Date.now() - start;
    await page.locator('.gm-style').first().waitFor({ state: "visible", timeout: 90_000 });
    await page.getByRole("button", { name: "Zoom in", exact: true }).waitFor({ state: "attached", timeout: 30_000 });
    const mapControlsMs = Date.now() - start;
    // Let two rendering frames finish before measuring a direct category action.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const bytesAtReady = { appBytes, providerBytes, totalBytes: appBytes + providerBytes };
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.evaluate(() => {
      const timing = { start: 0, duration: 0 };
      (window as unknown as { filterTiming: typeof timing }).filterTiming = timing;
      document.addEventListener("click", (event) => {
        if ((event.target as Element).closest("button")?.textContent?.startsWith("Bakery")) timing.start = performance.now();
      }, { capture: true });
      const observer = new MutationObserver(() => {
        if (timing.start && !timing.duration && document.querySelector('[aria-label="Clear Bakery category filter"]')) {
          requestAnimationFrame(() => requestAnimationFrame(() => { timing.duration = performance.now() - timing.start; }));
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    const filterStart = Date.now();
    await page.getByRole("button", { name: /^Bakery ·/ }).click();
    await expect(page.getByRole("button", { name: /^Filters/ })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Clear Bakery category filter" })).toBeVisible();
    const filterResponseMs = Date.now() - filterStart;
    await expect.poll(() => page.evaluate(() => (window as unknown as { filterTiming: { duration: number } }).filterTiming.duration)).toBeGreaterThan(0);
    const filterEventToFrameMs = await page.evaluate(() => (window as unknown as { filterTiming: { duration: number } }).filterTiming.duration);
    runs.push({ run: run + 1, shellMs, mapControlsMs, filterResponseMs, filterEventToFrameMs, ...bytesAtReady });
    await context.close();
  }
  const output = path.resolve("docs/audits/2026-10-23-implementation");
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, "performance.json"), JSON.stringify({ measuredAt: new Date().toISOString(), conditions: { viewport: "390x844", downloadMbps: 1.6, uploadMbps: 0.75, latencyMs: 150, cpuSlowdown: 4, cache: "disabled; fresh browser context for each run", server: "local production; localhost origin", startupDefinition: "Google Maps renderer visible and Zoom in control attached; not a tile-completion or field-device metric", transferDefinition: "CDP encodedDataLength for completed network requests at startup; failed/pending requests excluded" }, runs }, null, 2) + "\n");
});
