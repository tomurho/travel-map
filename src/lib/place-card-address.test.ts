import assert from "node:assert/strict";
import test from "node:test";
import { compactPlaceAddress } from "@/lib/place-card-address";

test("compact addresses remove repeated context while retaining buildings and units", () => {
  assert.equal(compactPlaceAddress({
    city: "Kyoto", district: "Nakagyo Ward",
    address: "Japan, 〒604-0985 Kyoto, Nakagyo Ward, Funayachō, ４２４ ふや町ビル １０１",
  }), "Funayachō, 424 ふや町ビル 101");
  assert.equal(compactPlaceAddress({
    city: "Kyoto", district: "Nakagyo Ward",
    address: "400-1 Funayachō, Nakagyo Ward, Kyoto, 604-0836, Japan",
  }), "400-1 Funayachō");
  assert.equal(compactPlaceAddress({
    city: "Taipei", district: "Da’an", address: "2F, No. 101, Lane 4, Taipei Road, Da’an, Taipei, Taiwan",
  }), "2F, No. 101, Lane 4, Taipei Road");
});

test("ambiguous, empty and context-only addresses remain usable without guessed shortening", () => {
  const place = { city: "Tokyo", district: "", address: "東京都新宿区西新宿1丁目2番3号 101号室" };
  assert.equal(compactPlaceAddress(place), place.address);
  assert.equal(compactPlaceAddress({ ...place, address: "101, Tokyo" }), "101");
  assert.equal(compactPlaceAddress({ city: "Taipei", district: "", address: "123-4567, Taipei, Taiwan" }), "123-4567");
  assert.equal(compactPlaceAddress({ ...place, address: "Tokyo, Japan" }), "Tokyo, Japan");
  assert.equal(compactPlaceAddress({ ...place, address: "" }), "");
});
