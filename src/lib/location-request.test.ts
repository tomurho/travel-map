import assert from "node:assert/strict";
import test from "node:test";
import { createLocationRequestGate } from "@/lib/location-request";

test("reset and manual city changes ignore late location success and failure", () => {
  for (const latestChoice of ["reset", "manual city"]) {
    const gate = createLocationRequestGate();
    const isCurrent = gate.begin();
    let result = latestChoice;
    const success = () => { if (isCurrent()) result = "nearby city"; };
    const failure = () => { if (isCurrent()) result = "location error"; };
    gate.cancel();
    success();
    failure();
    assert.equal(result, latestChoice);
  }
});

test("a replacement request accepts only its own location result", () => {
  const gate = createLocationRequestGate();
  const previous = gate.begin();
  gate.cancel();
  const latest = gate.begin();
  assert.equal(previous(), false);
  assert.equal(latest(), true);
  gate.cancel();
  assert.equal(latest(), false);
});
