import { expect, test } from "@playwright/test";
import path from "node:path";

const screenshots = "outputs/ui-ux-implementation-2026-11-06";
test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: path.resolve("tests/browser/google-maps-mock.js") });
  await page.route(/https:\/\/(maps|places)\.googleapis\.com\//, (route) => route.abort());
  await page.route("**/api/admin/**", (route) => route.abort());
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test.describe(`${viewport.width}px browsing`, () => {
    test.use({ viewport });
    test("one searchable category chooser and Show places preserve the current view", async ({ page }) => {
      await page.goto("/?city=Kyoto&view=list");
      if (viewport.width < 901) await page.getByRole("button", { name: /^Filters/ }).click();
      const opener = page.getByRole("button", { name: /^Choose category:/ });
      await opener.click();
      const dialog = page.getByRole("dialog", { name: "Choose a category" });
      await dialog.getByRole("searchbox", { name: "Find a category" }).fill("coffee");
      await expect(dialog.getByRole("button", { name: /^Tea house/ })).toHaveCount(0);
      await dialog.getByRole("button", { name: /^Coffee\s+17$/ }).click();
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      if (viewport.width < 901) await page.getByRole("button", { name: "Show 17 places", exact: true }).click();
      await expect(page).toHaveURL(/view=list/);
      await expect(page.getByRole("button", { name: "Clear Coffee category filter" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Kyoto places", exact: true })).toBeVisible();
      await page.screenshot({ path: `${screenshots}/category-selected-${viewport.width}.png` });
    });

    test("empty results relax only the area and keep the category", async ({ page }) => {
      await page.goto("/?city=Kyoto&view=list&group=all&specialty=Tea%20house&area=Sakyo%20Ward");
      const results = page.getByRole("region", { name: "Kyoto places", exact: true });
      await expect(results.getByRole("heading", { level: 2 })).toContainText("Sakyo Ward");
      await results.getByRole("button", { name: "Show all areas · 7 places", exact: true }).click();
      await expect(results.getByRole("article")).toHaveCount(7);
      await expect(page.getByRole("button", { name: "Clear Tea house category filter" })).toBeVisible();
      expect(new URL(page.url()).searchParams.get("area")).toBeNull();
      expect(new URL(page.url()).searchParams.get("view")).toBe("list");
    });

    test("active filters wrap, expose every choice, and Clear all keeps city and view", async ({ page }) => {
      await page.goto("/?city=Kyoto&view=list&group=all&specialty=Tea%20house&area=Higashiyama%20Ward&loved=1&q=tea");
      const chips = page.getByRole("group", { name: "Active filters" });
      await expect(chips.getByRole("button", { name: "Clear Higashiyama Ward area filter" })).toBeVisible();
      await chips.getByRole("button", { name: "+1 more", exact: true }).click();
      await expect(chips.getByRole("button", { name: "Clear search: tea", exact: true })).toBeVisible();
      for (const button of await chips.getByRole("button").all()) {
        const bounds = await button.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      }
      await page.getByRole("button", { name: "Clear all", exact: true }).click();
      const query = new URL(page.url()).searchParams;
      expect(query.get("city")).toBe("Kyoto");
      expect(query.get("view")).toBe("list");
      expect(query.get("group")).toBe("all");
      for (const name of ["specialty", "area", "loved", "status", "q"]) expect(query.has(name)).toBe(false);
      await expect(chips).toHaveCount(0);
      expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    });
  });
}

test("word order does not change natural search results", async ({ page }) => {
  await page.goto("/?city=Kyoto&view=list&q=Higashiyama%20tea%20house");
  const rows = page.getByRole("region", { name: "Kyoto places", exact: true }).getByRole("article");
  await expect(rows).toHaveCount(2);
  const first = await rows.evaluateAll((elements) => elements.map((el) => el.getAttribute("data-place-id")));
  await page.getByRole("button", { name: "Search places", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search places, food, or areas" }).fill("tea house Higashiyama");
  await page.getByRole("button", { name: "Show 2 places", exact: true }).click();
  expect(await rows.evaluateAll((elements) => elements.map((el) => el.getAttribute("data-place-id")))).toEqual(first);
});

test("mobile Nearby is available without opening Filters and can be cancelled", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition() {} }, configurable: true });
  });
  await page.goto("/?city=Kyoto&view=list");
  await page.getByRole("button", { name: "Nearby", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Filters/ })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Cancel Nearby location request", exact: true }).click();
  await expect(page.getByRole("button", { name: "Nearby", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("Nearby shows the nearest-first order and Clear all cancels it", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 35.01, longitude: 135.76 });
  await page.goto("/?city=Kyoto&view=list");
  await page.getByRole("button", { name: "Nearby", exact: true }).click();
  await expect(page.getByText("Nearest first", { exact: true })).toBeVisible();
  await expect(page.getByRole("article").first()).toContainText("away");
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(page.getByRole("button", { name: "Nearby", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Nearest first", { exact: true })).toHaveCount(0);
});

test("refresh failure retains places and Retry recovers without losing filters", async ({ page }) => {
  test.skip(!process.env.CATALOGUE_TEST_URL, "Requires a local server with a copied shared catalogue.");
  let requests = 0;
  let succeed = false;
  await page.route("**/api/catalogue", async (route) => {
    requests++;
    if (!succeed) return route.fulfill({ status: 503, json: { error: "Fixture refresh failure" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    return route.continue();
  });
  await page.goto(`${process.env.CATALOGUE_TEST_URL}/?city=Kyoto&view=list&group=all&specialty=Tea%20house`);
  const rows = page.getByRole("region", { name: "Kyoto places", exact: true }).getByRole("article");
  await expect(rows).toHaveCount(7);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Couldn’t refresh places.", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(7);
  await page.screenshot({ path: `${screenshots}/refresh-failed-mobile.png` });
  succeed = true;
  const before = requests;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retrying…", exact: true })).toBeDisabled();
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
  await expect(page.getByText("Couldn’t refresh places.", { exact: true })).toHaveCount(0);
  expect(requests - before).toBe(1);
  await expect(rows).toHaveCount(7);
  await expect(page.getByRole("button", { name: "Clear Tea house category filter" })).toBeVisible();
});

test("a category change keeps the area even when that combination has no results", async ({ page }) => {
  await page.goto("/?city=Kyoto&view=list&area=Kita%20Ward");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("button", { name: /^Choose category:/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^All bars\s+0$/ }).click();
  await expect(page.getByRole("combobox", { name: "Area", exact: true })).toHaveValue("Kita Ward");
  await page.getByRole("button", { name: "Show 0 places", exact: true }).click();
  await expect(page.getByRole("button", { name: "Clear Kita Ward area filter" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Kyoto places", exact: true }).getByRole("article")).toHaveCount(0);
});

test("category recovery restores focus when the empty-state trigger disappears", async ({ page }) => {
  await page.goto("/?city=Kyoto&view=list&group=all&specialty=Tea%20house&area=Sakyo%20Ward");
  const results = page.getByRole("region", { name: "Kyoto places", exact: true });
  await results.getByRole("button", { name: "Choose another category" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a category" });
  await dialog.getByRole("searchbox", { name: "Find a category" }).fill("coffee");
  await dialog.getByRole("button", { name: /^Coffee\s+\d+$/ }).click();
  await expect(results.getByRole("article").first()).toBeVisible();
  await expect(results).toBeFocused();
});

test("clicking the already-selected map pin reveals its offscreen list row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?city=Kyoto&view=list");
  await expect(page.locator('[data-mock-map="true"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const row = page.getByRole("article", { name: "120gバインミー京都, Loved", exact: true });
  await row.getByRole("button", { name: "Show details for 120gバインミー京都", exact: true }).click();
  await row.getByRole("button", { name: "Show on this map", exact: true }).click();
  await row.evaluate((element) => { element.parentElement!.scrollTop = 500; });
  await page.getByRole("button", { name: /^120gバインミー京都,/ }).click();
  await expect.poll(() => row.evaluate((element) => element.getBoundingClientRect().top - element.parentElement!.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await expect(row).toBeInViewport();
});
