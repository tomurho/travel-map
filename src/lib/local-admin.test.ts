import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { isAdminAuthorized, isAdminEnabled } from "@/lib/admin-auth";
import { proxy } from "../../proxy";

test("local Admin opens without a password in development and local production", () => {
  for (const nodeEnv of ["development", "production"]) {
    for (const adminPassword of [undefined, "old-owner-password"]) {
      const environment = { nodeEnv, enableAdmin: "true", adminPassword };
      for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
        const request = new NextRequest(`http://${host}:3000/api/admin/catalogue`);
        assert.equal(isAdminAuthorized(request, environment), true);
        assert.equal(isAdminAuthorized(request, { ...environment, vercel: "1" }), false);
        assert.equal(isAdminAuthorized(request, { ...environment, enableAdmin: "false" }), false);
      }
    }
  }
});

test("local password-free access rejects cross-site requests and lookalike hosts", () => {
  const environment = { nodeEnv: "production", enableAdmin: "true", adminPassword: "secret" };
  const url = "http://localhost:3000/api/admin/catalogue";
  assert.equal(isAdminAuthorized(new NextRequest(url, { headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" } }), environment), true);
  assert.equal(isAdminAuthorized(new NextRequest(url, { headers: { origin: "https://example.com" } }), environment), false);
  assert.equal(isAdminAuthorized(new NextRequest(url, { headers: { "sec-fetch-site": "cross-site" } }), environment), false);
  for (const host of ["192.168.1.20", "travel.tomurho.com", "localhost.example.com"]) {
    const request = new NextRequest(`http://${host}:3000/api/admin/catalogue`, { headers: { "x-forwarded-host": "localhost" } });
    assert.equal(isAdminAuthorized(request, environment), false);
  }
});

test("Vercel cannot enable Admin with a correct password or an enabled flag", () => {
  const environment = {
    nodeEnv: "production", enableAdmin: "true", vercel: "1", adminPassword: "secret",
  };
  assert.equal(isAdminEnabled(environment), false);
  assert.equal(isAdminAuthorized({ headers: new Headers({ "x-admin-password": "secret" }) }, environment), false);
  assert.equal(isAdminEnabled({ nodeEnv: "development", enableAdmin: "false" }), false);
});

test("Admin routes require a loopback host and never accept a hosted localhost spoof", () => {
  const keys = ["VERCEL", "ENABLE_ADMIN", "CATALOGUE_ENABLED"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    delete process.env.VERCEL;
    process.env.ENABLE_ADMIN = "true";
    process.env.CATALOGUE_ENABLED = "true";
    const paths = ["/admin", "/admin/", "/api/admin/session", "/api/admin/catalogue", "/api/admin/catalogue/export", "/api/admin/screenshot-intake/extract"];
    for (const path of paths) {
      assert.equal(proxy(new NextRequest(`http://localhost:3000${path}`)).headers.get("x-middleware-next"), "1");
      assert.equal(proxy(new NextRequest(`http://127.0.0.1:3000${path}`)).headers.get("x-middleware-next"), "1");
      assert.equal(proxy(new NextRequest(`http://192.168.1.20:3000${path}`)).status, 404);
      assert.equal(proxy(new NextRequest(`https://travel.tomurho.com${path}`)).status, 404);
    }
    process.env.VERCEL = "1";
    for (const path of paths) {
      assert.equal(proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { "x-admin-password": "secret" } })).status, 404);
    }
    for (const path of ["/", "/api/catalogue", "/field-guide", "/original"]) {
      assert.equal(proxy(new NextRequest(`https://travel.tomurho.com${path}`)).headers.get("x-middleware-next"), "1");
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
