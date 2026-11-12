import test from "node:test";
import assert from "node:assert/strict";

import {
  bestCurrentDeparture,
  buildWatchlistFilter,
  liveDeparturesForWatcher,
  refreshIsDue,
} from "../src/lib/background-logic.js";

const watcher = {
  id: "w1", stopName: "MAIRIE", lineCode: "L1", direction: "LILLE CENTRE", stopIds: ["ABC001"],
};

test("watchlist filter prefers exact physical stop IDs", () => {
  const filter = buildWatchlistFilter([watcher]);
  assert.match(filter, /ILEVIA:StopPoint:BP:ABC001:LOC/);
  assert.doesNotMatch(filter, /nom_station/);
});

test("live records match stop, line and direction", () => {
  const now = Date.parse("2026-11-13T10:00:00Z");
  const expected = now + 5 * 60000;
  const records = [{
    identifiant_station: "ILEVIA:StopPoint:BP:ABC001:LOC",
    code_ligne: "L1",
    sens_ligne: "LILLE CENTRE",
    heure_estimee_depart: new Date(expected).toISOString(),
  }];
  assert.deepEqual(liveDeparturesForWatcher(records, watcher, now), [expected]);
});

test("badge selection recomputes minutes and skips departed buses", () => {
  const now = Date.parse("2026-11-13T10:00:00Z");
  const best = bestCurrentDeparture([watcher], {
    w1: { departures: [
      { departureAt: now - 60000, source: "live" },
      { departureAt: now + 61000, source: "theoretical" },
    ] },
  }, now);
  assert.equal(best.departure.minutes, 2);
  assert.equal(best.departure.source, "theoretical");
});

test("API refresh due time is independent from the 30-second badge tick", () => {
  const now = 1_000_000;
  assert.equal(refreshIsDue({ completedAt: now - 299999 }, 5, now), false);
  assert.equal(refreshIsDue({ completedAt: now - 300000 }, 5, now), true);
});
