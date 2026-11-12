import { fetchLineColors, fetchWfsRecords } from "../src/lib/mel-api.js";
import { directionMatches } from "../src/lib/transit.js";
import { readFile } from "node:fs/promises";

const departures = await fetchWfsRecords("prochains_passages", {
  count: 200,
  cqlFilter: "identifiant_station IS NOT NULL",
});
if (departures.length === 0 || !departures[0].code_ligne || !departures[0].heure_estimee_depart) {
  throw new Error("Unexpected live departures response");
}

const colors = await fetchLineColors();
if (Object.keys(colors).length === 0) {
  throw new Error("Unexpected line colors response");
}

const schedules = JSON.parse(await readFile(new URL("../src/data/schedules.json", import.meta.url), "utf8"));
const combinationsByStopId = new Map();
for (const [stationId, station] of Object.entries(schedules.stops ?? {})) {
  for (const [lineCode, directions] of Object.entries(station.lines ?? {})) {
    for (const [direction, entry] of Object.entries(directions)) {
      for (const stopId of entry._stopIds ?? []) {
        if (!combinationsByStopId.has(stopId)) combinationsByStopId.set(stopId, []);
        combinationsByStopId.get(stopId).push({ stationId, stopName: station.name, lineCode, direction });
      }
    }
  }
}

let compatible = 0;
let eligible = 0;
const mismatches = new Map();
for (const departure of departures) {
  const candidates = combinationsByStopId.get(String(departure.code_arret_physique ?? "")) ?? [];
  const sameLine = candidates.filter((candidate) => candidate.lineCode === departure.code_ligne);
  if (sameLine.length > 0) eligible += 1;
  if (sameLine.some((candidate) => (
    candidate.lineCode === departure.code_ligne
    && directionMatches(departure.sens_ligne, candidate.direction)
  ))) {
    compatible += 1;
  } else if (sameLine.length > 0) {
    const key = `${departure.code_ligne}|${departure.sens_ligne}`;
    mismatches.set(key, [...new Set(sameLine.map((candidate) => candidate.direction))]);
  }
}
if (compatible === 0) {
  throw new Error("Live departures could not be matched with embedded GTFS data");
}
if (eligible > 0 && compatible / eligible < 0.8) {
  console.error("Direction mismatches:", Object.fromEntries([...mismatches].slice(0, 20)));
  throw new Error(`Only ${compatible}/${eligible} eligible live departures match GTFS directions`);
}
if (mismatches.size > 0) {
  console.warn("Remaining direction aliases:", Object.fromEntries([...mismatches].slice(0, 10)));
}

console.log(
  `MEL smoke test passed: ${departures.length} departures, ${compatible}/${eligible} eligible GTFS matches, `
  + `${Object.keys(colors).length} line colors.`
);
