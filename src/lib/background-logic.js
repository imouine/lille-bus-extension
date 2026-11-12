import {
  cqlQuote,
  departureTimestampMs,
  directionMatches,
  minutesUntil,
  noAccents,
} from "./transit.js";

export function fullStopId(stopId) {
  return `ILEVIA:StopPoint:BP:${stopId}:LOC`;
}

export function buildWatchlistFilter(watchers) {
  const stopIds = [...new Set(watchers.flatMap((watcher) => watcher.stopIds.map(fullStopId)))];
  const stationNames = [...new Set(
    watchers
      .filter((watcher) => watcher.stopIds.length === 0)
      .map((watcher) => noAccents(watcher.stopName).toUpperCase())
  )];
  const clauses = [];
  if (stopIds.length > 0) {
    clauses.push(`identifiant_station IN (${stopIds.map(cqlQuote).join(",")})`);
  }
  for (const stationName of stationNames) {
    clauses.push(`nom_station LIKE ${cqlQuote(`%${stationName}%`)}`);
  }
  return clauses.length > 0 ? `(${clauses.join(" OR ")})` : null;
}

export function recordMatchesWatcherStop(record, watcher) {
  if (watcher.stopIds.length > 0) {
    const accepted = new Set(watcher.stopIds.map(fullStopId));
    return accepted.has(String(record?.identifiant_station ?? ""));
  }
  const recordName = noAccents(record?.nom_station).toUpperCase();
  const watcherName = noAccents(watcher.stopName).toUpperCase();
  return recordName === watcherName || recordName.includes(watcherName) || watcherName.includes(recordName);
}

export function liveDeparturesForWatcher(records, watcher, nowMs, limit = 3) {
  const departures = records
    .filter((record) => (
      String(record?.code_ligne ?? "") === watcher.lineCode
      && recordMatchesWatcherStop(record, watcher)
      && directionMatches(record?.sens_ligne, watcher.direction)
    ))
    .map(departureTimestampMs)
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= nowMs - 30000);
  return [...new Set(departures)].sort((a, b) => a - b).slice(0, limit);
}

export function refreshIsDue(refreshMeta, periodMinutes, nowMs = Date.now()) {
  const last = Number(refreshMeta?.completedAt);
  return !Number.isFinite(last) || nowMs - last >= periodMinutes * 60000;
}

export function bestCurrentDeparture(watchers, results, nowMs = Date.now()) {
  let best = null;
  for (const watcher of watchers) {
    const result = results?.[watcher.id];
    const departure = result?.departures
      ?.filter((item) => Number.isFinite(item?.departureAt) && item.departureAt >= nowMs - 30000)
      .sort((left, right) => left.departureAt - right.departureAt)[0];
    if (!departure) continue;
    const current = { ...departure, minutes: minutesUntil(departure.departureAt, nowMs) };
    if (!best || current.departureAt < best.departure.departureAt) {
      best = { watcher, result, departure: current };
    }
  }
  return best;
}
