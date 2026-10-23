import { expect, test } from "@playwright/test";
import path from "node:path";

const mapFixture = path.resolve("tests/browser/google-maps-mock.js");
test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: mapFixture });
  // Provider scripts and live mutations must not run in this suite.
  await page.route(/https:\/\/(maps|places)\.googleapis\.com\//, (route) => route.abort());
  await page.route("**/api/admin/**", (route) => route.abort());
});

test("The list Map action reveals street context above the card; ordinary switches preserve manual view", async ({ page }) => {
  await page.goto("/?city=Kyoto&view=list");
  await page.getByRole("button", { name: "Show details for 120gバインミー京都", exact: true }).click();
  await page.getByRole("article", { name: "120gバインミー京都, Loved", exact: true }).getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator('[data-mock-map="true"]')).toBeVisible();
  await expect.poll(() => page.evaluate("window.__mapsMock.map.zoom")).toBeGreaterThanOrEqual(17);
  await expect.poll(() => page.evaluate("window.__mapsMock.map.offset")).toBeGreaterThan(0);
  const marker = page.getByRole("button", { name: /^120gバインミー京都,/ });
  await expect(marker).toBeVisible();
  const markerBounds = await marker.boundingBox();
  const cardBounds = await page.getByRole("complementary", { name: "Selected place: 120gバインミー京都" }).boundingBox();
  expect(markerBounds && cardBounds && markerBounds.y + markerBounds.height < cardBounds.y).toBeTruthy();
  await page.evaluate("window.__mapsMock.map.setCenter({lat:35.02,lng:135.77}); window.__mapsMock.map.setZoom(14); window.__mapsMock.calls=[]");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("article", { name: "120gバインミー京都, Loved", exact: true }).getByRole("button", { name: "Map", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Browse places" }).getByRole("button", { name: "Map", exact: true }).click();
  await expect.poll(() => page.evaluate("window.__mapsMock.map.zoom")).toBe(14);
  expect(await page.evaluate("window.__mapsMock.calls.filter(call=>['fit','center','zoom'].includes(call.action))")).toEqual([]);
  await expect(page.getByRole("complementary", { name: "Selected place: 120gバインミー京都" })).toBeVisible();
});

test("category selection closes filters, Escape restores focus, and Back restores the prior view", async ({ page }) => {
  await page.goto("/?city=Kyoto");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("button", { name: /^Bakery ·/ }).click();
  await expect(page.getByRole("button", { name: /^Filters/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("region", { name: "Map of Kyoto" })).toBeFocused();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("button", { name: "List", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear Bakery category filter" })).toBeVisible();
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Filters/ })).toBeFocused();
});

test("map failure keeps List details available", async ({ page }) => {
  await page.goto("/?city=Kyoto");
  await page.evaluate("window.gm_authFailure?.()");
  await expect(page.getByText("The map could not load.")).toBeVisible();
  await page.getByRole("button", { name: "View list", exact: true }).click();
  await page.getByRole("button", { name: "Show details for 120gバインミー京都", exact: true }).click();
  await expect(page.getByRole("article", { name: "120gバインミー京都, Loved", exact: true }).getByRole("button", { name: "Map", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Maps/ }).first()).toBeVisible();
});

test("distant Nearby keeps city pins and explains the result", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.3, longitude: 103.8 });
  await page.goto("/?city=Kyoto");
  await expect(page.locator('[data-mock-map="true"]')).toBeVisible();
  await page.evaluate("window.__mapsMock.calls=[]");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("button", { name: "Nearby", exact: true }).click();
  await expect(page.getByText("No saved city is near you. The current city stays on the map.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Current city" })).toHaveValue("Kyoto");
  expect(await page.evaluate("window.__mapsMock.calls.filter(call=>['fit','center','zoom'].includes(call.action))")).toEqual([]);
});

test("mobile hides editing and Area without choices", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/?city=Matsue&view=list");
  await expect(page.getByRole("button", { name: "Edit list", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("combobox", { name: "Area", exact: true })).toHaveCount(0);
});


test("co-located venues remain separate keyboard choices", async ({ page }) => {
  await page.goto("/?city=Kyoto");
  await expect(page.locator('[data-mock-map="true"]')).toBeVisible();
  await page.evaluate("const marker=window.__mapsMock.markers.find(item=>item.button.title.startsWith('大極殿本舗 六角店,')); window.__mapsMock.map.setCenter(marker.position); window.__mapsMock.map.setZoom(17)");
  const marker = page.getByRole("button", { name: /^栖園 （せいえん\),/ });
  await expect(marker).toBeVisible();
  await marker.click();
  const chooser = page.getByRole("dialog", { name: "Places at this location" });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole("button", { name: /大極殿本舗 六角店/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /栖園/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chooser).toHaveCount(0);
  await expect(marker).toBeFocused();
  await marker.press("Enter");
  await chooser.getByRole("button", { name: /栖園/ }).press("Enter");
  await expect(page.getByRole("complementary", { name: /Selected place: 栖園/ })).toBeVisible();
});

test("Taipei keeps its city streets and offers every saved place", async ({ page }) => {
  await page.goto("/?city=Taipei");
  await expect(page.getByText("1 saved place is outside this city view.")).toBeVisible();
  const before = await page.evaluate("window.__mapsMock.calls.filter(call=>call.action==='fit').at(-1).count");
  await page.getByRole("button", { name: "Show all places", exact: true }).click();
  await expect(page.getByText("1 saved place is outside this city view.")).toHaveCount(0);
  await expect.poll(() => page.evaluate("window.__mapsMock.calls.filter(call=>call.action==='fit').at(-1).count")).toBe(Number(before) + 1);
});


test("desktop detail actions are readable and the public guide reflows with enlarged text", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?city=Kyoto&view=list");
  await page.getByRole("button", { name: "Show details for 120gバインミー京都", exact: true }).click();
  const showMap = page.getByRole("article", { name: "120gバインミー京都, Loved", exact: true }).getByRole("button", { name: "Map", exact: true });
  const colors = await showMap.evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
  expect(colors.color).not.toBe(colors.background);
  await page.screenshot({ path: "docs/audits/2026-10-23-implementation/desktop-public-fixture.png", fullPage: false });
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(size);
    await page.evaluate(() => {
      // Scale actual text, including fixed-pixel text; root font changes alone miss it.
      const elements = [...document.querySelectorAll<HTMLElement>("main button, main input, main select, main h1, main h2, main p, main small, main span")];
      const sizes = elements.map((el) => parseFloat(getComputedStyle(el).fontSize));
      elements.forEach((el, index) => { if (!el.dataset.textScaled) { el.style.fontSize = `${sizes[index] * 2}px`; el.dataset.textScaled = "true"; } });
    });
    await expect(showMap).toBeVisible();
    const bounds = await showMap.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
    const title = await page.getByRole("article", { name: "120gバインミー京都, Loved", exact: true }).getByRole("link", { name: "Open 120gバインミー京都 in Google Maps (new tab)", exact: true }).boundingBox();
    const overlaps = title && bounds && title.x < bounds.x + bounds.width && title.x + title.width > bounds.x && title.y < bounds.y + bounds.height && title.y + title.height > bounds.y;
    expect(overlaps).toBe(false);
    await page.screenshot({ path: `docs/audits/2026-10-23-implementation/public-${size.width}-enlarged-text.png`, fullPage: false });
  }
});


test("city markers update in one cluster batch when a category changes", async ({ page }) => {
  await page.goto("/?city=Kyoto");
  await expect(page.locator('[data-mock-map="true"]')).toBeVisible();
  await page.getByRole("button", { name: /^Filters/ }).click();
  const before = Number(await page.evaluate("window.__mapsMock.markers.filter(marker=>marker.button.title.includes('places. Zoom in')).length"));
  // This fixture includes derived cluster markers. Per-marker redraws create
  // thousands of those markers for a city with fewer than 200 saved places.
  expect(before).toBeLessThan(100);
  await page.getByRole("button", { name: /^Bakery ·/ }).click();
  await expect(page.getByRole("button", { name: "Clear Bakery category filter" })).toBeVisible();
  const after = Number(await page.evaluate("window.__mapsMock.markers.filter(marker=>marker.button.title.includes('places. Zoom in')).length"));
  expect(after - before).toBeLessThan(20);
});

test("the approved Taipei day trip has a public explanation", async ({ page }) => {
  await page.goto("/?city=Taipei&view=list&q=%E9%AE%A8%E5%AE%89");
  await page.getByRole("button", { name: "Show details for 鮨安", exact: true }).click();
  const article = page.getByRole("article", { name: "鮨安, Saved", exact: true });
  await article.locator("summary").click();
  await expect(article.locator("details[open]").getByText("Day trip from Taipei: Zhubei, Hsinchu.", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Current city" })).toHaveValue("Taipei");
});


test("one venue name opens Google Maps; the row toggles and its Map button reveals the web map", async ({ page, context }) => {
  await context.route("https://maps.google.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>External Maps fixture</title>" }));
  await page.goto("/?city=Taipei&view=list&q=LANDED");
  const row = page.getByRole("article", { name: "LANDED, Want to go", exact: true });
  const toggle = row.getByRole("button", { name: "Show details for LANDED", exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(row.getByRole("button", { name: "Hide details for LANDED", exact: true })).toBeFocused();
  await expect(row.getByText("LANDED", { exact: true })).toHaveCount(1);
  await expect(row.getByText("Want to go", { exact: true })).toHaveCount(1);
  await expect(row.getByText("Wine bar · Songshan", { exact: true })).toHaveCount(1);
  await expect(row.getByRole("button", { name: "Map", exact: true })).toHaveCount(1);
  await expect(row.getByRole("button", { name: "Show on map", exact: true })).toHaveCount(0);
  const link = row.getByRole("link", { name: "Open LANDED in Google Maps (new tab)", exact: true });
  const mapsUrl = await link.getAttribute("href");
  const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  await popup.waitForLoadState("domcontentloaded");
  expect(popup.url()).toBe(mapsUrl);
  await popup.close();
  await expect(row.getByRole("button", { name: "Hide details for LANDED", exact: true })).toHaveAttribute("aria-expanded", "true");
  // The address and row margin both participate in the row's toggle action.
  await row.getByRole("complementary").locator("p").first().click();
  await expect(row.getByRole("button", { name: "Show details for LANDED", exact: true })).toHaveAttribute("aria-expanded", "false");
  await row.click({ position: { x: 2, y: 2 } });
  await expect(row.getByRole("button", { name: "Map", exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Hide details for LANDED", exact: true }).press("Space");
  await expect(row.getByRole("button", { name: "Show details for LANDED", exact: true })).toHaveAttribute("aria-expanded", "false");
  await row.getByRole("button", { name: "Show details for LANDED", exact: true }).press("Enter");
  await page.screenshot({ path: "docs/audits/2026-10-23-implementation/list-row-landed-mobile.png", fullPage: false });
  await row.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByRole("region", { name: "Map of Taipei" })).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Selected place: LANDED", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate("window.__mapsMock.map.zoom")).toBeGreaterThanOrEqual(17);
});
