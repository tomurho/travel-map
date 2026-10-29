import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import {
  createCatalogueEntry,
  seedCatalogueEntry,
  selectCatalogueCandidate,
  saveCatalogueDraft,
  publishCatalogueEntry,
  beginCatalogueEdit,
  removeCatalogueEntry,
  undoCataloguePublication,
  getPublicCatalogue,
  type CatalogueCandidate,
} from "@/lib/catalogue";
import { createLocalCatalogueStore } from "@/lib/catalogue-store";
import {
  actOnCatalogueEntry,
  addCataloguePlace,
  lookupCatalogueEntry,
} from "@/lib/catalogue-service";
import { buildCatalogueMigration } from "@/lib/catalogue-migration";
import { verifyCataloguePublication } from "@/lib/catalogue-verification";
import type { Place } from "@/lib/place";
import data from "@/data/places.json";

const candidate: CatalogueCandidate = {
  name: "FUHI Coffee Roasters",
  address: "15-1 Fuxinger Road, Kaohsiung",
  latitude: 22.6218001,
  longitude: 120.3090193,
  googleMapsUrl: "https://maps.google.com/?cid=6596762438481356096",
  googlePlaceId: "ChIFuhi",
  category: "Café",
  district: "Lingya",
};
function place(): Place {
  return {
    id: "existing",
    name: "Original cafe",
    city: "Kaohsiung",
    category: "Bakery",
    status: "been",
    loved: true,
    district: "Lingya",
    address: "1 Original Street",
    latitude: 22,
    longitude: 120,
    tabelog: "3.7",
    subway: "Station",
    notes: ["Keep my note"],
    googleMapsUrl: "https://maps.google.com/?q=original",
    googlePlaceId: "ChIOriginal",
    verifiedStatus: "Yes",
    verificationNotes: "Existing evidence",
  };
}
function ready() {
  let e = selectCatalogueCandidate(
    createCatalogueEntry({ name: "FUHI", city: "Kaohsiung" }),
    candidate,
  );
  e = saveCatalogueDraft(e, {}, true);
  return e;
}
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "catalogue-test-"));
  return {
    store: createLocalCatalogueStore(path.join(dir, "catalogue.json")),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
test("the complete migration preserves all existing records, ratings, notes and evidence exactly", () => {
  const entries = buildCatalogueMigration(data as Place[]);
  assert.equal(entries.length, data.length);
  for (const p of data)
    assert.deepEqual(entries.find((e) => e.id === p.id)?.live, p);
  const publicIds = getPublicCatalogue(entries)
    .places.map((p) => p.id)
    .sort();
  assert.deepEqual(
    publicIds,
    data
      .filter((p) => p.verifiedStatus !== "Closed/Moved")
      .map((p) => p.id)
      .sort(),
  );
});
test("migrated Sheet candidates stay private and merged IDs do not recreate retired records", () => {
  const p = place();
  p.id = "place_matsue_saeki";
  const entries = buildCatalogueMigration([p], {
    Review: [
      [
        "id",
        "rawName",
        "city",
        "reviewStatus",
        "candidateName",
        "candidateAddress",
        "candidateLatitude",
        "candidateLongitude",
        "candidateGoogleMapsUrl",
        "candidateGooglePlaceId",
      ],
      ["place_matsue_unknown_place", "Saeki", "Matsue", "Verified"],
      [
        "new",
        "FUHI",
        "Kaohsiung",
        "Verified",
        candidate.name,
        candidate.address,
        String(candidate.latitude),
        String(candidate.longitude),
        candidate.googleMapsUrl,
        candidate.googlePlaceId,
      ],
    ],
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[1].live, null);
  assert.ok(entries[1].draft);
  assert.equal(entries[1].confirmedMatch, null);
});
test("a Maps suggestion cannot publish without a human confirmation", () => {
  const e = selectCatalogueCandidate(
    createCatalogueEntry({ name: "FUHI", city: "Kaohsiung" }),
    candidate,
  );
  assert.throws(() => publishCatalogueEntry(e, "op"), /confirm the match/);
  const published = publishCatalogueEntry(
    saveCatalogueDraft(
      e,
      { status: "want_to_go", loved: null, category: "Bakery" },
      true,
    ),
    "op",
  );
  assert.equal(published.live?.category, "Bakery");
  assert.equal(published.live?.status, "want_to_go");
  assert.equal(published.live?.loved, null);
  assert.equal(published.draft, null);
});
test("venue and pin changes invalidate confirmation, while personal changes preserve it", () => {
  const e = ready();
  for (const patch of [
    { name: "Different" },
    { city: "Taipei" },
    { address: "Different address" },
    { latitude: 23 },
    { longitude: 121 },
    { googleMapsUrl: "https://maps.google.com/?q=different" },
    { googlePlaceId: "OtherId" },
  ])
    assert.equal(saveCatalogueDraft(e, patch, false).confirmedMatch, null);
  assert.ok(
    saveCatalogueDraft(
      e,
      { loved: true, status: "been", category: "Bakery", notes: ["New note"] },
      false,
    ).confirmedMatch,
  );
  assert.throws(() => saveCatalogueDraft(e, { loved: "yes" }, false), /loved/);
});
test("draft edits never change the public version and a publish retains editorial fields", () => {
  const seeded = seedCatalogueEntry(place());
  const edited = saveCatalogueDraft(
    beginCatalogueEdit(seeded),
    { notes: ["New note"], category: "Restaurant" },
    false,
  );
  assert.equal(getPublicCatalogue([edited]).places[0].category, "Bakery");
  assert.deepEqual(getPublicCatalogue([edited]).places[0].notes, [
    "Keep my note",
  ]);
  const published = publishCatalogueEntry(edited, "op");
  assert.equal(published.live?.loved, true);
  assert.equal(published.live?.status, "been");
  assert.equal(published.live?.tabelog, "3.7");
  assert.equal(published.live?.subway, "Station");
});
test("lookup keeps unpublished changes private and does not erase notes or ratings", async () => {
  const f = fixture();
  try {
    const e = seedCatalogueEntry(place());
    await f.store.create(e);
    const looked = await lookupCatalogueEntry(
      f.store,
      e.id,
      e.version,
      {},
      async () => [candidate],
    );
    assert.deepEqual(looked.live, e.live);
    assert.equal(looked.draft, null);
    const edited = await actOnCatalogueEntry(f.store, e.id, {
      action: "edit",
      expectedVersion: looked.version,
      operationId: "edit",
    });
    const selected = await actOnCatalogueEntry(f.store, e.id, {
      action: "select",
      candidateId: candidate.googlePlaceId,
      expectedVersion: edited.version,
      operationId: "select",
    });
    assert.equal(selected.draft?.loved, true);
    assert.equal(selected.draft?.status, "been");
    assert.deepEqual(selected.draft?.notes, ["Keep my note"]);
    assert.equal(selected.confirmedMatch, null);
  } finally {
    f.cleanup();
  }
});
test("a wrong match cannot be published by checking the confirmation again", async () => {
  const f = fixture();
  try {
    const e = ready();
    await f.store.create(e);
    const wrong = await actOnCatalogueEntry(f.store, e.id, {
      action: "wrong",
      expectedVersion: e.version,
      operationId: "wrong",
    });
    const saved = await actOnCatalogueEntry(f.store, e.id, {
      action: "save",
      expectedVersion: wrong.version,
      operationId: "save",
      confirmMatch: true,
    });
    await assert.rejects(
      actOnCatalogueEntry(f.store, e.id, {
        action: "publish",
        expectedVersion: saved.version,
        operationId: "publish",
      }),
      /marked this match wrong/,
    );
  } finally {
    f.cleanup();
  }
});
test("removal reaches public data and undo restores the full prior place", () => {
  const e = seedCatalogueEntry(place()),
    removed = removeCatalogueEntry(e, "remove");
  assert.equal(getPublicCatalogue([removed]).places.length, 0);
  const undo = undoCataloguePublication(
    removed,
    removed.history.at(-1)!.id,
    "undo",
  );
  assert.deepEqual(undo.live, e.live);
  assert.equal(getPublicCatalogue([undo]).places.length, 1);
  assert.notEqual(undo.publicVersion, e.publicVersion);
});
test("stale saves are rejected and retrying a successful publish never publishes twice", async () => {
  const f = fixture();
  try {
    const e = ready();
    await f.store.create(e);
    const input = {
      action: "publish" as const,
      expectedVersion: e.version,
      operationId: "same-operation",
    };
    const first = await actOnCatalogueEntry(f.store, e.id, input);
    const second = await actOnCatalogueEntry(f.store, e.id, input);
    assert.deepEqual(first, second);
    assert.equal(second.history.length, 1);
    await assert.rejects(
      actOnCatalogueEntry(f.store, e.id, {
        action: "remove",
        expectedVersion: e.version,
        operationId: "stale",
      }),
      /changed/,
    );
  } finally {
    f.cleanup();
  }
});
test("duplicate intake opens the existing place and duplicate live venues are blocked", async () => {
  const f = fixture();
  try {
    const first = publishCatalogueEntry(ready(), "first");
    await f.store.create(first);
    const duplicate = await addCataloguePlace(
      f.store,
      { name: first.input.name, city: first.input.city },
      "different",
    );
    assert.equal(duplicate.entry.id, first.id);
    assert.equal(duplicate.duplicate, true);
    const second = ready();
    await f.store.create(second);
    await assert.rejects(
      actOnCatalogueEntry(f.store, second.id, {
        action: "publish",
        operationId: "op",
        expectedVersion: second.version,
      }),
      /already live/,
    );
  } finally {
    f.cleanup();
  }
});
test("public delivery verification checks an unauthenticated version, not just a successful save", async () => {
  const e = publishCatalogueEntry(ready(), "op");
  const original = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = "https://travel.example.com";
  try {
    let calls = 0;
    const checked = await verifyCataloguePublication(
      e,
      "http://localhost:3000",
      true,
      async (url, init) => {
        calls++;
        assert.equal(String(url), "https://travel.example.com/api/catalogue");
        assert.equal(init?.credentials, "omit");
        assert.equal(init?.cache, "no-store");
        return Response.json(getPublicCatalogue([e]));
      },
    );
    assert.equal(checked.confirmed, true);
    assert.equal(checked.mode, "live");
    assert.equal(calls, 1);
    const stale = await verifyCataloguePublication(
      e,
      "http://localhost",
      true,
      async () =>
        Response.json({ places: [e.live], versions: { [e.id]: "old" } }),
    );
    assert.equal(stale.confirmed, false);
    await assert.rejects(
      verifyCataloguePublication(e, "http://localhost", true, async () => {
        throw new Error("offline");
      }),
      /offline/,
    );
    const removed = removeCatalogueEntry(e, "remove");
    assert.equal(
      (
        await verifyCataloguePublication(
          removed,
          "http://localhost",
          true,
          async () => Response.json(getPublicCatalogue([removed])),
        )
      ).confirmed,
      true,
    );
  } finally {
    if (original === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = original;
  }
});
test("private candidate and verification evidence never reaches public catalogue responses", () => {
  const e = seedCatalogueEntry(place());
  e.input.source = "private screenshot";
  e.lookupError = "private error";
  const payload = JSON.stringify(getPublicCatalogue([e]));
  assert.ok(!payload.includes("private screenshot"));
  assert.ok(!payload.includes("Existing evidence"));
  assert.ok(!payload.includes("private error"));
  assert.ok(payload.includes("Keep my note"));
});
test("signed owner sessions reject forgery and expiration", () => {
  const environment = {
    nodeEnv: "production",
    enableAdmin: "true",
    adminPassword: "test-secret",
  };
  const expiry = String(Date.now() + 60000),
    signature = createHmac("sha256", environment.adminPassword)
      .update(`catalogue-session:${expiry}`)
      .digest("hex");
  assert.equal(
    isAdminAuthorized(
      new NextRequest("https://example.com", {
        headers: { cookie: `travel_admin=${expiry}.${signature}` },
      }),
      environment,
    ),
    true,
  );
  assert.equal(
    isAdminAuthorized(
      new NextRequest("https://example.com", {
        headers: { cookie: `travel_admin=${expiry}.${"0".repeat(64)}` },
      }),
      environment,
    ),
    false,
  );
  assert.equal(
    isAdminAuthorized(
      new NextRequest("https://example.com", {
        headers: { cookie: `travel_admin=1.${signature}` },
      }),
      environment,
    ),
    false,
  );
});
