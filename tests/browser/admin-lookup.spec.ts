import { test, expect, type Page } from "@playwright/test";
import { createCatalogueEntry, selectCatalogueCandidate, saveCatalogueDraft, type CatalogueCandidate } from "../../src/lib/catalogue";
import { addCataloguePlace, lookupCatalogueEntry } from "../../src/lib/catalogue-service";
import type { CatalogueStore } from "../../src/lib/catalogue-store";

test.use({ screenshot: "on" });

const mapsUrl = "https://maps.app.goo.gl/owner-supplied-link";
const candidate: CatalogueCandidate = {
  name: "Linked Cafe", address: "1 Linked Street, Kyoto",
  latitude: 35, longitude: 135, googleMapsUrl: "https://maps.google.com/?query_place_id=ChILinkedCafe",
  googlePlaceId: "ChILinkedCafe", category: "Café", district: "Nakagyo Ward",
};

// Every Admin request stops here. All changes affect this in-memory fixture only.
async function fixture(page: Page) {
  let entries = [
    saveCatalogueDraft(selectCatalogueCandidate(createCatalogueEntry({ name: "Source Cafe", city: "Kyoto", mapsUrl }, "first"), { ...candidate, name: "Wrong Cafe", googlePlaceId: "ChIWrongCafe", district: "" }), { notes: ["My saved note"] }, false),
    selectCatalogueCandidate(createCatalogueEntry({ name: "Other Cafe", city: "Osaka" }, "other"), { ...candidate, name: "Other Cafe", googlePlaceId: "ChIOtherCafe" }),
  ];
  const lookups: Array<{ name: string; city: string; query?: string; mapsUrl?: string }> = [];
  const store: CatalogueStore = {
    kind: "local",
    async list() { return structuredClone(entries); },
    async get(id) { return structuredClone(entries.find((e) => e.id === id) ?? null); },
    async create(entry) { entries.push(structuredClone(entry)); return true; },
    async replace(entry, version) {
      const index = entries.findIndex((e) => e.id === entry.id && e.version === version);
      if (index < 0) return false;
      entries[index] = structuredClone(entry);
      return true;
    },
  };
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    const respond = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/admin/catalogue") {
      if (request.method() === "GET") return respond({ configured: true, storage: "local", entries, categories: ["Café"] });
      const input = request.postDataJSON();
      return respond(await addCataloguePlace(store, input, input.requestId));
    }
    const input = request.postDataJSON();
    if (input.action !== "lookup") throw new Error(`Unexpected fixture action ${input.action}`);
    const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
    const entry = await lookupCatalogueEntry(store, id, input.expectedVersion, input, async (lookupInput, options) => {
      lookups.push({ name: lookupInput.name, city: lookupInput.city, query: options?.query, mapsUrl: options?.mapsUrl });
      return [candidate];
    });
    return respond({ entry });
  });
  return { lookups };
}

test("mocked Maps lookup keeps the supplied link, replaces the wrong draft, and supports name plus city after clearing it", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Review 2", exact: true }).click();
  await page.getByRole("button", { name: "Wrong Cafe Kyoto", exact: true }).click();
  await page.getByText("Search again or choose another match", { exact: true }).click();
  const search = page.getByRole("form", { name: "Find Maps match", exact: true });
  await expect(search.getByLabel("Google Maps link (optional)")).toHaveValue(mapsUrl);
  await expect(search.getByLabel("Search name", { exact: true })).toHaveValue("Wrong Cafe");
  await expect(page.getByRole("form", { name: "Review place", exact: true }).getByLabel("District or area", { exact: true })).toHaveValue("");
  await search.getByRole("button", { name: "Use Maps link", exact: true }).click();
  const review = page.getByRole("form", { name: "Review place", exact: true });
  await expect(review.getByLabel("Place name", { exact: true })).toHaveValue("Linked Cafe");
  await expect(review.getByLabel("Notes", { exact: true })).toHaveValue("My saved note");
  await expect(review.getByLabel("District or area", { exact: true })).toHaveValue("Nakagyo Ward");
  await expect(review.getByRole("checkbox")).toHaveCount(0);
  expect(f.lookups[0].mapsUrl).toBe(mapsUrl);
  await page.getByRole("button", { name: "Other Cafe Osaka", exact: true }).click();
  await page.getByRole("button", { name: "Linked Cafe Kyoto", exact: true }).click();
  if (!(await search.isVisible())) await page.getByText("Search again or choose another match", { exact: true }).click();
  await expect(search.getByLabel("Google Maps link (optional)")).toHaveValue(mapsUrl);
  await search.getByLabel("Google Maps link (optional)").fill("");
  await search.getByLabel("Search name", { exact: true }).fill("Other branch");
  await search.getByLabel("City", { exact: true }).fill("Osaka");
  await search.getByRole("button", { name: "Search name and city", exact: true }).click();
  await expect.poll(() => f.lookups.length).toBe(2);
  expect(f.lookups[1]).toMatchObject({ mapsUrl: "", query: "Other branch", city: "Osaka" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("mocked initial lookup uses the Maps link supplied with the place name and city", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const f = await fixture(page);
  await page.goto("/admin");
  const intake = page.getByRole("form", { name: "Add place", exact: true });
  await intake.getByLabel("Place name", { exact: true }).fill("User Cafe");
  await intake.getByLabel("City", { exact: true }).fill("Kyoto");
  await intake.getByLabel("Google Maps link (optional)").fill(mapsUrl);
  await intake.getByRole("button", { name: "Add and find match", exact: true }).click();
  await expect(page.getByRole("form", { name: "Review place", exact: true }).getByLabel("Place name", { exact: true })).toHaveValue("Linked Cafe");
  expect(f.lookups).toEqual([{ name: "User Cafe", city: "Kyoto", query: "User Cafe", mapsUrl }]);
});
