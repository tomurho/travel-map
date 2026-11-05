import { test, expect, type Page } from "@playwright/test";
import { seedCatalogueEntry, getPublicCatalogue } from "../../src/lib/catalogue";
import { actOnCatalogueEntry } from "../../src/lib/catalogue-service";
import type { CatalogueStore } from "../../src/lib/catalogue-store";
import type { Place } from "../../src/lib/place";

test.use({ screenshot: "on" });

const place: Place = {
  id: "review-fixture", name: "Existing Cafe", city: "Kaohsiung",
  category: "Café", district: "Lingya", status: "been", loved: true,
  address: "1 Fixture Street", latitude: 22.6, longitude: 120.3,
  googleMapsUrl: "https://maps.google.com/?query_place_id=fixture",
  googlePlaceId: "fixture", notes: ["Keep my note"], tabelog: "", subway: "", verifiedStatus: "Yes",
};

// Every Admin request is intercepted. Even publication affects only this array.
// This fixture never opens a database, writes a file, or calls an external API.
async function fixture(page: Page) {
  const entries = [
    seedCatalogueEntry(place),
    seedCatalogueEntry({ ...place, id: "nearby", googlePlaceId: "fixture-nearby", name: "Nearby Cafe", district: "Yancheng", loved: null }),
    seedCatalogueEntry({ ...place, id: "taipei", googlePlaceId: "fixture-taipei", name: "Taipei Cafe", city: "Taipei", district: "Da’an", loved: null }),
  ];
  const calls: Array<{ action: string; confirmMatch?: boolean }> = [];
  const store: CatalogueStore = {
    kind: "local",
    async list() { return structuredClone(entries); },
    async get(id) { return structuredClone(entries.find((entry) => entry.id === id) ?? null); },
    async create() { throw new Error("Unexpected fixture creation"); },
    async replace(entry, version) {
      const index = entries.findIndex((e) => e.id === entry.id && e.version === version);
      if (index < 0) return false;
      entries[index] = structuredClone(entry);
      return true;
    },
  };
  await page.route("**/maps.google.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>Fixture map</p>" }));
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    const respond = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/admin/catalogue" && request.method() === "GET")
      return respond({ configured: true, storage: "local", entries, categories: ["Café"] });
    if (!url.pathname.startsWith("/api/admin/catalogue/") || request.method() !== "POST")
      throw new Error(`Unexpected fixture request ${request.method()} ${url.pathname}`);
    const input = request.postDataJSON();
    calls.push(input);
    const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
    if (input.action === "verify") {
      const entry = await store.get(id);
      return respond({ confirmed: true, mode: "local", version: entry?.publicVersion, checkedAt: new Date().toISOString(), publicUrl: "http://localhost:3000" });
    }
    return respond({ entry: await actOnCatalogueEntry(store, id, input) });
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Live 3", exact: true }).click();
  await page.getByRole("button", { name: "Existing Cafe Kaohsiung", exact: true }).click();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  return {
    calls,
    entry: () => entries.find((entry) => entry.id === place.id)!,
    publicPlaces: () => getPublicCatalogue(entries).places,
    review: page.getByRole("form", { name: "Review place", exact: true }),
  };
}

test("mocked review combines all four statuses and saves each choice without changing the public place", async ({ page }) => {
  const f = await fixture(page);
  const status = f.review.getByLabel("My status", { exact: true });
  await expect(status).toHaveValue("loved");
  await expect(status.locator("option")).toHaveText(["Saved", "Want to go", "Been", "Loved it"]);
  await expect(f.review.getByLabel("My rating", { exact: true })).toHaveCount(0);
  await expect(f.review.getByRole("checkbox")).toHaveCount(0);
  for (const [option, storedStatus, loved] of [
    ["location", "location", null], ["want_to_go", "want_to_go", null],
    ["been", "been", null], ["loved", "been", true],
  ] as const) {
    await status.selectOption(option);
    await f.review.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(() => f.entry().draft?.status).toBe(storedStatus);
    await expect.poll(() => f.entry().draft?.loved).toBe(loved);
    await expect(status).toHaveValue(option);
    expect(f.calls.at(-1)).toMatchObject({ action: "save", confirmMatch: false });
    expect(f.publicPlaces().find((entry) => entry.id === place.id)).toMatchObject({ status: "been", loved: true, notes: ["Keep my note"] });
  }
  await expect(f.review.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
  await status.scrollIntoViewIfNeeded();
});

test("mocked review suggests areas from the current city and accepts a new area", async ({ page }) => {
  const f = await fixture(page);
  const area = f.review.getByLabel("District or area", { exact: true });
  await expect(area).toHaveAttribute("list", "catalogue-districts");
  const options = f.review.locator("#catalogue-districts option");
  await expect.poll(() => options.evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value))).toEqual(["Lingya", "Yancheng"]);
  await area.fill("Yancheng");
  await f.review.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(area).toHaveValue("Yancheng");
  await area.fill("New neighbourhood");
  await area.press("Enter");
  await expect.poll(() => f.entry().draft?.district).toBe("New neighbourhood");
  expect(f.calls.some((call) => call.action === "publish")).toBe(false);
  expect(f.entry().live?.district).toBe("Lingya");
  await f.review.getByText("Correct the name, city, address, or pin", { exact: true }).click();
  await f.review.getByLabel("City", { exact: true }).fill("Taipei City");
  await expect.poll(() => options.evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value))).toEqual(["Da’an"]);
});

test("mocked review confirms the match through Publish without a checkbox", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const f = await fixture(page);
  await f.review.getByLabel("My status", { exact: true }).selectOption("want_to_go");
  await f.review.getByLabel("My status", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("review-controls.png") });
  await f.review.getByRole("button", { name: "Publish to live map", exact: true }).click();
  await expect.poll(() => f.entry().live?.status).toBe("want_to_go");
  expect(f.entry().live?.loved).toBe(null);
  expect(f.entry().draft).toBe(null);
  expect(f.calls.filter((call) => call.action === "save").at(-1)?.confirmMatch).toBe(true);
  expect(f.calls.map((call) => call.action)).toEqual(["edit", "save", "publish", "verify"]);
  await expect(page.getByText("Local preview confirmed. This does not confirm the public website.", { exact: true })).toBeVisible();
});

test("mocked review keeps a rejected match blocked without the checkbox", async ({ page }) => {
  const f = await fixture(page);
  await f.review.getByRole("button", { name: "Wrong place or pin", exact: true }).click();
  await expect(f.review.getByRole("button", { name: "Publish to live map", exact: true })).toBeDisabled();
  await f.review.getByLabel("My status", { exact: true }).selectOption("location");
  await expect(f.review.getByRole("button", { name: "Publish to live map", exact: true })).toBeDisabled();
  expect(f.calls.some((call) => call.action === "publish")).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
