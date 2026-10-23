import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const evidenceDirectory = "docs/audits/2026-10-23-implementation";
test.beforeAll(async () => { await mkdir(evidenceDirectory, { recursive: true }); });
import { emptySnapshot, installAdminFixtures, fixturePlace, fixtureScreenshotPng as png } from "./admin-fixtures";


test("current work shows valid candidates beside invalid rows; Mark ready sends the reviewed version once", async ({ page }) => {
  const state = await installAdminFixtures(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Pipeline overview" })).toBeInViewport();
  await expect(page.locator(".admin-screenshot-intake-panel")).not.toHaveAttribute("open");
  await expect(page.getByRole("heading", { name: "New captures", exact: true })).toBeVisible();
  await expect(page.getByText("publish · Row 7: latitude must be a number.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify", exact: true })).toBeEnabled();
  await expect(page.getByText(/Google Place ID also belongs to Fixture Cafe/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Capture row 3 ↗" })).toHaveAttribute("href", /range=A3:K3/);
  await page.screenshot({ path: `${evidenceDirectory}/admin-populated-desktop.png`, fullPage: true });
  await page.getByRole("checkbox", { name: "Captured Fixture Cafe", exact: true }).check();
  await page.getByRole("button", { name: "Mark 1 ready", exact: true }).click();
  await expect(page.getByText(/Marked 1 captures Ready for lookup/)).toBeVisible();
  const calls = state.calls.filter((call) => call.path.endsWith("/capture-ready"));
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toMatchObject({ confirmWrite: true, captures: [{ rowNumber: 3, intakeId: "capture-fixture", captureVersion: "capture-version-fixture" }] });
  expect(state.unknownRequests).toEqual([]);
});

test("failed refresh labels retained data and Retry preserves candidate edits", async ({ page }) => {
  const state = await installAdminFixtures(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Fixture Match", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("been");
  state.failSnapshot = true;
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(page.getByText(/Refresh failed. Showing data checked at/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fixture Match", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("been");
  await expect(page.getByRole("button", { name: "Mark selected ready" })).toBeDisabled();
  await page.screenshot({ path: `${evidenceDirectory}/admin-stale-mobile.png`, fullPage: true });
  state.failSnapshot = false;
  await page.getByRole("button", { name: "Retry refresh", exact: true }).click();
  await expect(page.getByText(/Refresh failed. Showing data checked at/)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("been");
  expect(state.unknownRequests).toEqual([]);
});

test("loading, connection failure, Retry, and empty queues have readable states", async ({ page }) => {
  const state = await installAdminFixtures(page);
  let release!: () => void;
  state.snapshotGate = new Promise<void>((resolve) => { release = resolve; });
  state.failSnapshot = true;
  await page.goto("/admin");
  await expect(page.getByText("Checking the Google Sheet…", { exact: true })).toBeVisible();
  await expect(page.getByText("Checking New captures…", { exact: true })).toBeVisible();
  await expect(page.getByText(/No New captures are waiting/)).toHaveCount(0);
  const overviewTitle = await page.getByRole("heading", { name: "Pipeline overview", exact: true }).boundingBox();
  expect(overviewTitle?.width).toBeGreaterThan(200);
  await expect(page.getByRole("button", { name: "Checking…", exact: true })).toBeDisabled();
  await page.screenshot({ path: `${evidenceDirectory}/admin-loading-mobile.png`, fullPage: true });
  release();
  await expect(page.getByRole("button", { name: "Retry refresh", exact: true })).toBeVisible();
  await expect(page.getByText(/Run pnpm setup:google-sheets/).first()).toBeVisible();
  await expect(page.getByText("New captures are unavailable. Retry refresh above.", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidenceDirectory}/admin-connection-error-mobile.png`, fullPage: true });
  state.failSnapshot = false;
  state.snapshot = emptySnapshot();
  await page.getByRole("button", { name: "Retry refresh", exact: true }).click();
  await expect(page.getByText("No Candidate rows are waiting for review.")).toBeVisible();
  await expect(page.getByText(/No New captures are waiting/)).toBeVisible();
  await expect(page.getByText("Nothing is waiting. The Sheet and travel map are up to date.")).toBeVisible();
  await page.screenshot({ path: `${evidenceDirectory}/admin-empty-mobile.png`, fullPage: true });
  expect(state.unknownRequests).toEqual([]);
});

test("conflict correction requires a note and explicit verification, then invalidates Apply", async ({ page }) => {
  const state = await installAdminFixtures(page);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Preview Update", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resolve verification conflicts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply Update", exact: true })).toBeDisabled();
  await page.screenshot({ path: `${evidenceDirectory}/admin-conflict-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "Review correction for Fixture Cafe", exact: true }).click();
  const save = page.getByRole("button", { name: "Verify and save correction", exact: true });
  await expect(save).toBeDisabled();
  await page.getByRole("textbox", { name: "How did you verify Fixture Cafe?", exact: true }).fill("Checked the fixture source and map pin.");
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox", { name: /I checked the Published venue and map pin/ }).check();
  await save.click();
  await expect(page.getByText(/Verified Fixture Cafe. Select Preview again/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply Update", exact: true })).toBeDisabled();
  const correction = state.calls.find((call) => call.path.endsWith("/resolve-conflict"));
  expect(correction?.body).toMatchObject({ id: fixturePlace.id, rowNumber: 5, expectedPreviewHash: "fixture-conflict-preview", confirmVerified: true, verificationNote: "Checked the fixture source and map pin." });
  expect(state.unknownRequests).toEqual([]);
});

test("partial screenshot retry preserves corrections and supports keyboard original-image inspection", async ({ page }) => {
  const state = await installAdminFixtures(page);
  await page.goto("/admin");
  await page.getByText("Add screenshots", { exact: true }).click();
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles([{ name: "fixture-a.png", mimeType: "image/png", buffer: png }, { name: "fixture-b.png", mimeType: "image/png", buffer: png }]);
  let release!: () => void;
  state.extractGate = new Promise<void>((resolve) => { release = resolve; });
  await page.getByRole("button", { name: "Extract places", exact: true }).click();
  await expect(fileInput).toBeDisabled();
  release();
  const nameInputs = page.getByRole("textbox", { name: "Place name", exact: true });
  await expect(nameInputs).toHaveCount(1);
  await page.screenshot({ path: `${evidenceDirectory}/admin-screenshot-partial-mobile.png`, fullPage: true });
  await nameInputs.first().fill("Manually corrected Fixture Cafe");
  await page.getByRole("textbox", { name: "City", exact: true }).fill("Osaka");
  await page.getByRole("button", { name: "Retry 1 failed image", exact: true }).click();
  await expect(nameInputs).toHaveCount(2);
  await expect(nameInputs.first()).toHaveValue("Manually corrected Fixture Cafe");
  await expect(page.getByRole("textbox", { name: "City", exact: true }).first()).toHaveValue("Osaka");
  expect(state.extractRequests).toHaveLength(2);
  expect(state.extractRequests[1]).toEqual([state.extractRequests[0][1]]);
  const trigger = page.getByRole("button", { name: "View original screenshot fixture-a.png", exact: true }).first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "fixture-a.png", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close original screenshot", exact: true })).toBeFocused();
  await expect(dialog.getByRole("img")).toBeVisible();
  await expect.poll(() => dialog.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalHeight > image.naturalWidth)).toBe(true);
  await expect(trigger.locator("img")).toHaveCSS("object-fit", "contain");
  await page.screenshot({ path: `${evidenceDirectory}/admin-screenshot-original-mobile.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  state.failScreenshotSend = true;
  await page.getByRole("button", { name: "Send 2 rows to Capture", exact: true }).click();
  await expect(page.getByText(/Fixture Capture connection failed/)).toBeVisible();
  await expect(nameInputs.first()).toHaveValue("Manually corrected Fixture Cafe");
  state.failScreenshotSend = false;
  await page.getByRole("button", { name: "Send 2 rows to Capture", exact: true }).click();
  await expect(page.getByText(/Created 2 New Capture rows/)).toBeVisible();
  expect(state.calls.find((call) => call.path.endsWith("/send-to-capture"))?.body.rows).toEqual(expect.arrayContaining([expect.objectContaining({ rawName: "Manually corrected Fixture Cafe", cityHint: "Osaka" })]));
  expect(state.unknownRequests).toEqual([]);
});

test("cancelled paid lookup and Apply confirmations send no mutation requests", async ({ page }) => {
  const state = await installAdminFixtures(page);
  state.syncPreview = { wrote: false, previewHash: "fixture-sync-preview", canApply: true, validationErrors: [], changes: [{ id: "new-fixture", rowNumber: 8, name: "New Fixture Cafe", action: "insert", fields: [] }] };
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.goto("/admin");
  await page.getByRole("button", { name: "Process Ready Rows", exact: true }).click();
  expect(state.calls.filter((call) => call.path.endsWith("/review-new"))).toHaveLength(0);
  await page.getByRole("button", { name: "Preview Publish", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply Publish", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Apply Publish", exact: true }).click();
  await page.getByRole("button", { name: "Preview Update", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply Update", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Apply Update", exact: true }).click();
  expect(state.calls.filter((call) => call.path.endsWith("/publish-approved"))).toHaveLength(1);
  expect(state.calls.filter((call) => call.path.endsWith("/sync-published"))).toHaveLength(1);
  expect(state.calls.every((call) => call.body.write === false)).toBe(true);
  expect(state.unknownRequests).toEqual([]);
});


test("concurrent failures keep each error beside its own action and Retry", async ({ page }) => {
  const state = await installAdminFixtures(page);
  let release!: () => void;
  state.reviewGate = new Promise<void>((resolve) => { release = resolve; });
  state.failReview = true;
  state.failPublish = true;
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/admin");
  await page.getByRole("button", { name: "Process Ready Rows", exact: true }).click();
  await page.getByRole("button", { name: "Preview Publish", exact: true }).click();
  const lookup = page.locator(".admin-pipeline-step").filter({ has: page.getByRole("heading", { name: "Enrich Ready Captures", exact: true }) });
  const publish = page.locator(".admin-pipeline-step").filter({ has: page.getByRole("heading", { name: "Publish Verified Reviews", exact: true }) });
  await expect(publish.getByRole("alert")).toContainText("Fixture Publish failed.");
  release();
  await expect(lookup.getByRole("alert")).toContainText("Fixture lookup failed.");
  await expect(lookup.getByRole("button", { name: "Retry lookup", exact: true })).toBeVisible();
  await expect(publish.getByRole("alert")).toContainText("Fixture Publish failed.");
  await expect(publish.getByRole("button", { name: "Retry Publish preview", exact: true })).toBeVisible();
  await expect(publish.getByText("Fixture lookup failed.")).toHaveCount(0);
  expect(state.unknownRequests).toEqual([]);
});


test("admin reflows at 320 pixels with enlarged text", async ({ page }) => {
  const state = await installAdminFixtures(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Fixture Match", exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const overflow = await page.evaluate(() => ({ viewport: innerWidth, body: document.documentElement.scrollWidth }));
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
  const clippedPanels = await page.locator(".admin-pipeline-panel, .admin-pipeline-body, .admin-pipeline-guide, .admin-review-queue, .admin-review-candidate, .admin-review-candidate-actions, .admin-review-candidate-editors").evaluateAll((elements) => elements.filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1).map((element) => ({ className: element.className, width: element.clientWidth, content: element.scrollWidth })));
  expect(clippedPanels).toEqual([]);
  await page.screenshot({ path: `${evidenceDirectory}/admin-320-enlarged-text.png`, fullPage: true });
  expect(state.unknownRequests).toEqual([]);
});
