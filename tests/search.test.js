import test from "node:test";
import assert from "node:assert/strict";

import { normalizeStopSearch, stopSearchRank } from "../src/lib/search.js";

test("stop search ignores accents, punctuation and letter case", () => {
  assert.equal(normalizeStopSearch("  Mairie — Marcq-en-Barœul  "), "mairie marcq en baroeul");
  assert.equal(stopSearchRank("MAIRIE — HEM", "mairie -- hem"), 0);
});

test("stop search matches the beginning of each query word", () => {
  assert.notEqual(stopSearchRank("MAIRIE — HEM", "mairie hem"), null);
  assert.notEqual(stopSearchRank("MAIRIE — HEM", "mai he"), null);
  assert.notEqual(stopSearchRank("MAIRIE — MARCQ EN BAROEUL", "bar mairie"), null);
  assert.equal(stopSearchRank("MAIRIE — HEM", "mairie lille"), null);
});

test("stop search keeps single-word contains matching", () => {
  assert.notEqual(stopSearchRank("PLACE DE LA RÉPUBLIQUE", "publique"), null);
});
