import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/admin/screenshot-intake/extract/route";
import { retainScreenshotDrafts, type ScreenshotDraft, type ScreenshotImageOutcome } from "./screenshot-intake";

function request(images: Array<{ id: string; name?: string; type?: string }>) {
  const form = new FormData();
  images.forEach((image) => {
    form.append("images", new File(["safe fixture image bytes"], image.name ?? "same-name.png", { type: image.type ?? "image/png" }));
    form.append("imageIds", image.id);
  });
  return new NextRequest("http://localhost/api/admin/screenshot-intake/extract", { method: "POST", headers: { "x-admin-password": "fixture-password" }, body: form });
}
function configure(t: TestContext) {
  const priorKey = process.env.OPENAI_API_KEY;
  const priorPassword = process.env.ADMIN_PASSWORD;
  process.env.OPENAI_API_KEY = "fixture-api-key-never-sent";
  process.env.ADMIN_PASSWORD = "fixture-password";
  t.after(() => {
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    if (priorPassword === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = priorPassword;
  });
}

test("one failed screenshot retains successful rows with independent same-name image identities", async (t) => {
  configure(t);
  let calls = 0;
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    assert.ok(init.signal instanceof AbortSignal, "provider wait is bounded");
    calls++;
    return calls === 1 ? Response.json({ output_text: JSON.stringify({ places: [{ rawName: "Fixture Cafe", cityHint: "Kyoto", rawText: "Visible source" }] }) }) : Response.json({ error: { code: "fixture_failure" } }, { status: 502 });
  });
  const response = await POST(request([{ id: "first-image" }, { id: "second-image" }]));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.results.length, 2);
  assert.equal(payload.results[0].imageId, "first-image");
  assert.equal(payload.results[0].status, "success");
  assert.equal(payload.rows[0].rawName, "Fixture Cafe");
  assert.equal(payload.results[1].imageId, "second-image");
  assert.equal(payload.results[1].status, "error");
  assert.equal(payload.results[1].code, "fixture_failure");
});

test("an invalid image does not prevent a different image from extracting", async (t) => {
  configure(t);
  t.mock.method(console, "error", () => {});
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ output_text: '{"places":[]}' }); });
  const response = await POST(request([{ id: "unsupported", type: "text/plain" }, { id: "valid" }]));
  const payload = await response.json();
  assert.equal(calls, 1);
  assert.equal(payload.results[0].status, "error");
  assert.equal(payload.results[0].stage, "validation");
  assert.equal(payload.results[1].status, "success");
  assert.deepEqual(payload.results[1].rows, []);
});

test("a provider timeout is a retryable per-image failure", async (t) => {
  configure(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("Fixture timeout", "TimeoutError"); });
  const response = await POST(request([{ id: "timed-out" }]));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.results[0].code, "provider_timeout");
  assert.match(payload.results[0].error, /Retry this image/);
});

test("retry appends successful failed-image results without losing corrected or ignored drafts", () => {
  const corrected: ScreenshotDraft = { id: "draft-1", imageId: "first-image", fileName: "same-name.png", rawName: "Manually corrected name", cityHint: "Corrected city", countryHint: "Japan", rawText: "Corrected source", ignored: true };
  const outcomes: ScreenshotImageOutcome[] = [
    { imageId: "first-image", fileName: "same-name.png", status: "success", rows: [{ ...corrected, rawName: "Old extracted name" }] },
    { imageId: "second-image", fileName: "same-name.png", status: "success", rows: [{ fileName: "same-name.png", rawName: "Second venue", rawText: "Evidence", cityHint: "Osaka", countryHint: "Japan" }] },
  ];
  const result = retainScreenshotDrafts([corrected], outcomes, () => "draft-2");
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], corrected);
  assert.equal(result[1].imageId, "second-image");
  assert.equal(result[1].rawName, "Second venue");
  assert.equal(result[1].ignored, false);
});
