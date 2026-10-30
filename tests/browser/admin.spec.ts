import { test, expect, type Page } from "@playwright/test";
import {
  getPublicCatalogue,
  seedCatalogueEntry,
  type CatalogueCandidate,
  type CatalogueEntry,
} from "../../src/lib/catalogue";
import {
  actOnCatalogueEntry,
  addCataloguePlace,
  lookupCatalogueEntry,
} from "../../src/lib/catalogue-service";
import type { CatalogueStore } from "../../src/lib/catalogue-store";
import type { Place } from "../../src/lib/place";

const candidate: CatalogueCandidate = {
  name: "Fixture Cafe",
  address: "15-1 Fixture Street, Kaohsiung",
  latitude: 22.62,
  longitude: 120.31,
  googleMapsUrl: "https://maps.google.com/?q=fixture",
  googlePlaceId: "fixture-google",
  category: "Café",
  district: "Lingya",
};
const place: Place = {
  id: "live-fixture",
  name: "Existing Cafe",
  city: "Kaohsiung",
  category: "Bakery",
  status: "been",
  loved: true,
  district: "Lingya",
  address: "1 Existing Street",
  latitude: 22.6,
  longitude: 120.3,
  tabelog: "",
  subway: "",
  googleMapsUrl: "https://maps.google.com/?q=existing",
  googlePlaceId: "existing-google",
  notes: ["Keep my note"],
  verifiedStatus: "Yes",
};
async function fixture(page: Page) {
  let entries: CatalogueEntry[] = [seedCatalogueEntry(place)];
  const state = { stale: false, offline: false, calls: [] as string[] };
  const store: CatalogueStore = {
    kind: "shared",
    async list() {
      return structuredClone(entries);
    },
    async get(id) {
      return structuredClone(entries.find((e) => e.id === id) ?? null);
    },
    async create(entry) {
      if (entries.some((e) => e.id === entry.id)) return false;
      entries.push(structuredClone(entry));
      return true;
    },
    async replace(entry, version) {
      const i = entries.findIndex(
        (e) => e.id === entry.id && e.version === version,
      );
      if (i < 0) return false;
      entries[i] = structuredClone(entry);
      return true;
    },
  };
  await page.route("**/maps.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<p>Map preview fixture</p>",
    }),
  );
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    state.calls.push(url.pathname);
    const respond = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/api/admin/session")
      return respond({ signedIn: true });
    if (url.pathname === "/api/admin/catalogue" && request.method() === "GET")
      return respond({
        configured: true,
        storage: "shared",
        entries,
        categories: ["Café", "Bakery", "Restaurant"],
      });
    if (
      url.pathname === "/api/admin/catalogue" &&
      request.method() === "POST"
    ) {
      const input = request.postDataJSON();
      return respond(await addCataloguePlace(store, input, input.requestId));
    }
    if (url.pathname.startsWith("/api/admin/catalogue/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!),
        input = request.postDataJSON();
      if (input.action === "verify") {
        if (state.offline)
          return respond({ error: "public check offline" }, 503);
        const e = await store.get(id);
        return respond({
          confirmed: !state.stale,
          mode: "live",
          version: e?.publicVersion,
          checkedAt: new Date().toISOString(),
          publicUrl: "https://example.com/?city=Kaohsiung",
        });
      }
      try {
        const entry =
          input.action === "lookup"
            ? await lookupCatalogueEntry(
                store,
                id,
                input.expectedVersion,
                {},
                async () => [candidate],
              )
            : await actOnCatalogueEntry(store, id, input);
        return respond({ entry });
      } catch (error) {
        return respond(
          { error: (error as Error).message },
          (error as { status?: number }).status ?? 400,
        );
      }
    }
    throw new Error(`Unexpected admin request ${url.pathname}`);
  });
  return { state, store, publicData: () => getPublicCatalogue(entries) };
}
async function add(page: Page) {
  const form = page.getByRole("form", { name: "Add place", exact: true });
  await form.getByLabel("Place name", { exact: true }).fill("Fixture Cafe");
  await form.getByLabel("City", { exact: true }).fill("Kaohsiung");
  await form
    .getByRole("button", { name: "Add and find match", exact: true })
    .click();
  await expect(page.getByRole("form", { name: "Review place" })).toBeVisible();
}

test("name and city lead to Review; Publish updates shared public data and verifies delivery", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/admin");
  await add(page);
  const review = page.getByRole("form", { name: "Review place" });
  const publish = review.getByRole("button", {
    name: "Publish to live map",
    exact: true,
  });
  await expect(publish).toBeDisabled();
  await review.getByLabel("Category", { exact: true }).fill("Bakery");
  await review
    .getByLabel("My status", { exact: true })
    .selectOption("want_to_go");
  await review.getByLabel("Notes", { exact: true }).fill("A new note");
  await review
    .getByRole("checkbox", {
      name: "I checked this is the correct place and map pin.",
      exact: true,
    })
    .check();
  await publish.click();
  await expect(
    page.getByText("Live confirmed. The public map serves this version.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    f.publicData().places.find((p) => p.name === "Fixture Cafe"),
  ).toMatchObject({
    category: "Bakery",
    status: "want_to_go",
    loved: null,
    notes: ["A new note"],
  });
  expect(f.state.calls.some((p) => p.includes("place-pipeline"))).toBe(false);
});
test("editing a live place keeps its public notes and rating until publication", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Live 1", exact: true }).click();
  await page
    .getByRole("button", { name: "Existing Cafe Kaohsiung", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  const review = page.getByRole("form", { name: "Review place" });
  await expect(review.getByLabel("My rating", { exact: true })).toHaveValue(
    "loved",
  );
  await review.getByLabel("Notes", { exact: true }).fill("Draft-only note");
  await review.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved. Your live listing is unchanged.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(f.publicData().places[0].notes).toEqual(["Keep my note"]);
  expect(f.publicData().places[0].loved).toBe(true);
});
test("a failed live check is pending, not reported as live, and can be retried", async ({
  page,
}) => {
  const f = await fixture(page);
  f.state.offline = true;
  await page.goto("/admin");
  await add(page);
  await page
    .getByRole("checkbox", {
      name: "I checked this is the correct place and map pin.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Publish to live map", exact: true })
    .click();
  await expect(
    page.getByText(
      "Saved; live check pending. Your change is saved. Retry the check shortly.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(f.publicData().places.length).toBe(2);
  await expect(page.getByText("Live confirmed", { exact: true })).toHaveCount(
    0,
  );
  f.state.offline = false;
  await page
    .getByRole("button", { name: "Check public map", exact: true })
    .click();
  await expect(
    page.getByText("Live confirmed. The public map serves this version.", {
      exact: true,
    }),
  ).toBeVisible();
});
test("removal updates public data and Undo restores the complete record", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Live 1", exact: true }).click();
  await page
    .getByRole("button", { name: "Existing Cafe Kaohsiung", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove from live map", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm removal", exact: true })
    .click();
  await expect(page.getByText("Removed", { exact: true })).toBeVisible();
  expect(f.publicData().places).toHaveLength(0);
  await page
    .getByRole("button", { name: "Undo last publication", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove from live map", exact: true }),
  ).toBeVisible();
  expect(f.publicData().places[0]).toMatchObject({
    id: place.id,
    status: "been",
    loved: true,
    notes: ["Keep my note"],
  });
});
test("the narrow-screen review fits the viewport and keeps its confirmation gate", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/admin");
  await add(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const publish = page.getByRole("button", {
    name: "Publish to live map",
    exact: true,
  });
  await expect(publish).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I checked this is the correct place and map pin.",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Space");
  await expect(publish).toBeEnabled();
});
