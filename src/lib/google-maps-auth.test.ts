import assert from "node:assert/strict";
import test from "node:test";
import { subscribeToGoogleMapsAuthFailure } from "@/lib/google-maps-auth";

test("runtime Maps authentication failure reaches every mounted map and preserves the existing handler", () => {
  const calls: string[] = [];
  const previous = () => { calls.push("previous"); };
  const target = { gm_authFailure: previous };
  const removeFirst = subscribeToGoogleMapsAuthFailure(target, () => calls.push("first map"));
  const removeSecond = subscribeToGoogleMapsAuthFailure(target, () => calls.push("second map"));
  target.gm_authFailure();
  assert.deepEqual(calls, ["previous", "first map", "second map"]);
  removeFirst();
  calls.length = 0;
  target.gm_authFailure();
  assert.deepEqual(calls, ["previous", "second map"]);
  removeSecond();
  assert.equal(target.gm_authFailure, previous);
});

test("a map mounted after authentication failed receives the existing failure", () => {
  const target: { gm_authFailure?: () => void } = {};
  const remove = subscribeToGoogleMapsAuthFailure(target, () => {});
  target.gm_authFailure!();
  remove();
  assert.equal(Object.hasOwn(target, "gm_authFailure"), false);
  let failed = false;
  const removeRemounted = subscribeToGoogleMapsAuthFailure(target, () => { failed = true; });
  assert.equal(failed, true);
  removeRemounted();
});

test("cleanup preserves a callback installed later by another consumer", () => {
  const target: { gm_authFailure?: () => void } = {};
  const remove = subscribeToGoogleMapsAuthFailure(target, () => {});
  const replacement = () => {};
  target.gm_authFailure = replacement;
  remove();
  assert.equal(target.gm_authFailure, replacement);
});

test("the app still receives failure if an existing handler throws", () => {
  const previous = () => { throw new Error("previous consumer failed"); };
  const target = { gm_authFailure: previous };
  let failed = false;
  const remove = subscribeToGoogleMapsAuthFailure(target, () => { failed = true; });
  assert.throws(() => target.gm_authFailure(), /previous consumer failed/);
  assert.equal(failed, true);
  remove();
  assert.equal(target.gm_authFailure, previous);
});
