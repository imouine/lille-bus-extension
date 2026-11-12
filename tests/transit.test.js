import test from "node:test";
import assert from "node:assert/strict";

import { normalizePrefs, resolveWatcherStation, watcherId } from "../src/lib/config.js";
import {
  departureUrgencyClass,
  departureTimestampMs,
  directionMatches,
  mergeDepartureTimestamps,
  minutesUntil,
  nextTheoreticalDepartures,
} from "../src/lib/transit.js";

test("departure urgency never returns an empty DOM token", () => {
  assert.equal(departureUrgencyClass(0, "live"), "now");
  assert.equal(departureUrgencyClass(4, "live"), "soon");
  assert.equal(departureUrgencyClass(12, "live"), null);
  assert.equal(departureUrgencyClass(12, "theoretical"), "theoretical");
});

test("live departures are completed with non-duplicate theoretical times", () => {
  const minute = 60 * 1000;
  const merged = mergeDepartureTimestamps(
    [7 * minute, 27 * minute],
    [10 * minute, 30 * minute, 50 * minute],
    { limit: 3, toleranceMs: 5 * minute }
  );
  assert.deepEqual(merged, [
    { departureAt: 7 * minute, source: "live", isLive: true },
    { departureAt: 27 * minute, source: "live", isLive: true },
    { departureAt: 50 * minute, source: "theoretical", isLive: false },
  ]);
});

test("one live departure only replaces one nearby scheduled departure", () => {
  const minute = 60 * 1000;
  const merged = mergeDepartureTimestamps(
    [7 * minute],
    [5 * minute, 9 * minute, 15 * minute],
    { limit: 3, toleranceMs: 5 * minute }
  );
  assert.deepEqual(merged.map(({ departureAt, source }) => [departureAt, source]), [
    [7 * minute, "live"],
    [9 * minute, "theoretical"],
    [15 * minute, "theoretical"],
  ]);
});

test("direction matching handles known MEL and GTFS differences", () => {
  assert.equal(directionMatches("FACHES CENTRE COMMERCIAL", "FACHES THUMESNIL CTRE COMMERCIAL"), true);
  assert.equal(directionMatches("GARE LILLE EUROPE", "LILLE LILLE EUROPE"), true);
  assert.equal(directionMatches("LEERS CENTRE COMMERCIAL", "LYS LEZ LANNOY CENTRE COMMERCIAL"), true);
  assert.equal(directionMatches("BLANCHISSERIE", "HEM BLANCHISSERIE"), true);
  assert.equal(directionMatches("CHATEAU", "WAMBRECHIES CHATEAU"), true);
  assert.equal(directionMatches("LILLE PORTE DES POSTES", "PORTE DES POSTES"), true);
  assert.equal(directionMatches("SECLIN CENTRE HOSPITALIER", "CENTRE HOSPITALIER"), true);
  assert.equal(directionMatches("HAUBOURDIN LE PARC", "MARCQ EN BAROEUL FERME AUX OIES"), false);
});

test("API timestamps preserve explicit UTC offsets", () => {
  const utc = departureTimestampMs({ heure_estimee_depart: "2026-11-12T22:30:37Z" });
  assert.equal(utc, Date.parse("2026-11-12T22:30:37Z"));
  const cleTri = departureTimestampMs({ cle_tri: "DIR/STOP/2026-11-12T22:30:37+01:00" });
  assert.equal(cleTri, Date.parse("2026-11-12T22:30:37+01:00"));
});

test("minutes are rounded up and never negative", () => {
  const now = Date.parse("2026-11-12T20:00:00Z");
  assert.equal(minutesUntil(now + 61000, now), 2);
  assert.equal(minutesUntil(now - 1000, now), 0);
});

test("theoretical schedules retain after-midnight GTFS service", () => {
  const data = {
    meta: { gtfs_from: "2026-11-01", gtfs_until: "2026-12-31" },
    stops: {
      TEST: {
        L1: {
          NORTH: {
            WEEKDAY: [1430, 1510],
            SATURDAY: [60],
            SUNDAY: [90],
          },
        },
      },
    },
  };
  const watcher = { stopName: "TEST", lineCode: "L1", direction: "NORTH" };
  const now = Date.parse("2026-11-12T22:00:00Z");
  const result = nextTheoreticalDepartures(data, watcher, now, 3);
  assert.equal(result.reason, "ok");
  assert.equal(result.departures.length >= 2, true);
  assert.equal(result.departures[1] > result.departures[0], true);
});

test("expired theoretical schedules are rejected", () => {
  const data = {
    meta: { gtfs_from: "2026-01-01", gtfs_until: "2026-01-31" },
    stops: { TEST: { L1: { NORTH: { WEEKDAY: [600] } } } },
  };
  const result = nextTheoreticalDepartures(
    data,
    { stopName: "TEST", lineCode: "L1", direction: "NORTH" },
    Date.parse("2026-11-12T09:00:00Z")
  );
  assert.deepEqual(result, { departures: [], reason: "expired" });
});

test("v2 schedules use the exact service profile for the requested date", () => {
  const data = {
    meta: {
      format: 2,
      gtfs_from: "2026-11-13",
      gtfs_until: "2026-11-14",
      calendar: { "2026-11-13": ["holiday"], "2026-11-14": ["saturday"] },
    },
    stops: {
      "920": {
        name: "TEST",
        lines: { L1: { NORTH: { times: { normal: [600], holiday: [720], saturday: [800] } } } },
      },
    },
  };
  const result = nextTheoreticalDepartures(
    data,
    { stopId: "920", stopName: "TEST", lineCode: "L1", direction: "NORTH" },
    Date.parse("2026-11-13T08:00:00Z"),
    1
  );
  assert.equal(result.departures[0], Date.parse("2026-11-13T11:00:00Z"));
});

test("legacy watchers migrate by physical stop ID without merging homonyms", () => {
  const schedules = {
    stops: {
      "1": { name: "MAIRIE", label: "MAIRIE — LILLE", lines: { L1: { NORTH: { _stopIds: ["AAA"] } } } },
      "2": { name: "MAIRIE", label: "MAIRIE — HEM", lines: { L1: { NORTH: { _stopIds: ["BBB"] } } } },
    },
  };
  const migrated = resolveWatcherStation(schedules, {
    id: "old-id", stopName: "MAIRIE", lineCode: "L1", direction: "NORTH", stopIds: ["BBB"],
  });
  assert.equal(migrated.id, "old-id");
  assert.equal(migrated.stopId, "2");
  assert.equal(migrated.stopLabel, "MAIRIE — HEM");
});

test("preferences are normalized and watcher IDs are stable", () => {
  assert.deepEqual(normalizePrefs({ theme: "invalid", lang: "de", refreshIdx: 99 }, true), {
    theme: "dark",
    lang: "fr",
    refreshIdx: 0,
  });
  const watcher = { stopName: "REPUBLIQUE", lineCode: "L1", direction: "FACHES" };
  assert.equal(watcherId(watcher), watcherId({ ...watcher }));
});
