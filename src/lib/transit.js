const ABBREVIATIONS = [
  [/\bJP\b/g, "JEAN PAUL"],
  [/\bJB\b/g, "JEAN BAPTISTE"],
  [/\bCTRE\b/g, "CENTRE"],
  [/\bCH\b/g, "CENTRE HOSPITALIER"],
  [/\bST\b/g, "SAINT"],
  [/\bSTE\b/g, "SAINTE"],
  [/\bGEN\b/g, "GENERAL"],
  [/\bAV\b/g, "AVENUE"],
  [/\bBD\b/g, "BOULEVARD"],
  [/\bPL\b/g, "PLACE"],
];

const DIRECTION_ALIASES = new Map([
  ["GARE LILLE EUROPE", "LILLE EUROPE"],
  ["LILLE LILLE EUROPE", "LILLE EUROPE"],
  ["LEERS CENTRE COMMERCIAL", "LYS LEZ LANNOY CENTRE COMMERCIAL"],
]);

export function noAccents(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0152/g, "OE")
    .replace(/\u0153/g, "oe")
    .replace(/\u00c6/g, "AE")
    .replace(/\u00e6/g, "ae");
}

export function cqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizedDirection(value) {
  let result = noAccents(value)
    .replace(/['’.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  result = DIRECTION_ALIASES.get(result) ?? result;
  for (const [pattern, expansion] of ABBREVIATIONS) {
    result = result.replace(pattern, expansion);
  }
  return result.replace(/\s+/g, " ").trim();
}

function directionWords(value) {
  return [...new Set(normalizedDirection(value).split(" ").filter((word) => word.length >= 3))];
}

function wordMatches(word, candidates) {
  return candidates.some((candidate) => (
    candidate === word
    || (word.length >= 4 && candidate.length >= 4
      && (candidate.startsWith(word) || word.startsWith(candidate)))
  ));
}

export function directionMatches(apiDirection, savedDirection) {
  if (!apiDirection || !savedDirection) return false;
  const apiNormalized = normalizedDirection(apiDirection);
  const savedNormalized = normalizedDirection(savedDirection);
  if (apiNormalized === savedNormalized) return true;

  const apiWords = directionWords(apiNormalized);
  const savedWords = directionWords(savedNormalized);
  if (apiWords.length === 0 || savedWords.length === 0) return false;

  const apiCoverage = apiWords.filter((word) => wordMatches(word, savedWords)).length / apiWords.length;
  const savedCoverage = savedWords.filter((word) => wordMatches(word, apiWords)).length / savedWords.length;
  const shared = apiWords.filter((word) => wordMatches(word, savedWords)).length;
  if (shared === 1 && Math.min(apiWords.length, savedWords.length) === 1) {
    const singleWord = apiWords.length === 1 ? apiWords[0] : savedWords[0];
    if (singleWord.length >= 6) return true;
  }
  return shared >= 2 && (apiCoverage >= 0.66 || savedCoverage >= 0.66);
}

function getTimeZoneOffsetMinutes(timeZone, date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return (asUtc - date.getTime()) / 60000;
}

function parisWallClockToUtcMs(year, month, day, hour, minute, second = 0) {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = getTimeZoneOffsetMinutes("Europe/Paris", new Date(localAsUtc));
  let utc = localAsUtc - offset * 60000;
  const refinedOffset = getTimeZoneOffsetMinutes("Europe/Paris", new Date(utc));
  if (refinedOffset !== offset) utc = localAsUtc - refinedOffset * 60000;
  return utc;
}

function parseParisWallClock(value) {
  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?$/
  );
  if (!match) return null;
  return parisWallClockToUtcMs(+match[1], +match[2], +match[3], +match[4], +match[5], +match[6]);
}

export function departureTimestampMs(record) {
  if (!record) return null;
  if (typeof record.cle_tri === "string") {
    const value = record.cle_tri.slice(record.cle_tri.lastIndexOf("/") + 1);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof record.heure_estimee_depart !== "string") return null;
  const value = record.heure_estimee_depart.trim();
  const parsed = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? Date.parse(value)
    : parseParisWallClock(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function minutesUntil(timestampMs, nowMs = Date.now()) {
  if (!Number.isFinite(timestampMs)) return null;
  return Math.max(0, Math.ceil((timestampMs - nowMs) / 60000));
}

export function departureUrgencyClass(minutes, source) {
  if (source !== "live") return "theoretical";
  if (minutes <= 1) return "now";
  if (minutes <= 5) return "soon";
  return null;
}

export function mergeDepartureTimestamps(
  liveTimestamps,
  theoreticalTimestamps,
  { limit = 3, toleranceMs = 5 * 60 * 1000 } = {}
) {
  const normalize = (values) => [...new Set(
    (Array.isArray(values) ? values : []).filter(Number.isFinite)
  )].sort((a, b) => a - b);
  const live = normalize(liveTimestamps);
  const theoretical = normalize(theoreticalTimestamps);
  const matchedTheoretical = new Set();

  for (const liveTimestamp of live) {
    let closestIndex = -1;
    let closestDistance = toleranceMs + 1;
    theoretical.forEach((timestamp, index) => {
      if (matchedTheoretical.has(index)) return;
      const distance = Math.abs(timestamp - liveTimestamp);
      if (distance <= toleranceMs && distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    });
    if (closestIndex >= 0) matchedTheoretical.add(closestIndex);
  }

  return [
    ...live.map((departureAt) => ({ departureAt, source: "live", isLive: true })),
    ...theoretical
      .filter((_, index) => !matchedTheoretical.has(index))
      .map((departureAt) => ({ departureAt, source: "theoretical", isLive: false })),
  ]
    .sort((a, b) => a.departureAt - b.departureAt || (a.isLive ? -1 : 1))
    .slice(0, Math.max(0, limit));
}

function localDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { year: +map.year, month: +map.month, day: +map.day };
}

function serviceDate(baseParts, offsetDays) {
  const date = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day + offsetDays, 12));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

function dateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function profileForServiceDate(parts) {
  if (parts.weekday === 6) return "SATURDAY";
  if (parts.weekday === 0) return "SUNDAY";
  return "WEEKDAY";
}

function scheduleCovers(meta, parts) {
  const key = dateKey(parts);
  return Boolean(meta?.gtfs_from && meta?.gtfs_until && key >= meta.gtfs_from && key <= meta.gtfs_until);
}

export function nextTheoreticalDepartures(scheduleData, watcher, nowMs = Date.now(), count = 3) {
  const stations = scheduleData?.stops ?? {};
  let station = watcher?.stopId ? stations[watcher.stopId] : null;
  if (!station && watcher?.stopName) {
    const target = noAccents(watcher.stopName).trim().toUpperCase();
    const matches = Object.values(stations).filter((candidate) => (
      noAccents(candidate?.name).trim().toUpperCase() === target
      && candidate?.lines?.[watcher?.lineCode]?.[watcher?.direction]
    ));
    if (matches.length === 1) [station] = matches;
  }
  const entry = scheduleData?.meta?.format === 2
    ? station?.lines?.[watcher?.lineCode]?.[watcher?.direction]
    : stations?.[watcher?.stopName]?.[watcher?.lineCode]?.[watcher?.direction];
  if (!entry) return { departures: [], reason: "missing" };
  const baseDate = localDateParts(new Date(nowMs));
  const departures = [];
  let hasCoveredDate = false;

  for (const dayOffset of [-1, 0, 1, 2]) {
    const serviceDay = serviceDate(baseDate, dayOffset);
    if (!scheduleCovers(scheduleData?.meta, serviceDay)) continue;
    hasCoveredDate = true;
    const serviceDateKey = dateKey(serviceDay);
    const profileIds = scheduleData?.meta?.format === 2
      ? (scheduleData?.meta?.calendar?.[serviceDateKey] ?? [])
      : [profileForServiceDate(serviceDay)];
    const times = profileIds.flatMap((profileId) => (
      scheduleData?.meta?.format === 2
        ? (entry?.times?.[profileId] ?? [])
        : (entry?.[profileId] ?? [])
    ));
    for (const rawMinutes of times) {
      if (!Number.isFinite(rawMinutes)) continue;
      const extraDays = Math.floor(rawMinutes / 1440);
      const minuteOfDay = ((rawMinutes % 1440) + 1440) % 1440;
      const departureDay = serviceDate(serviceDay, extraDays);
      const timestamp = parisWallClockToUtcMs(
        departureDay.year,
        departureDay.month,
        departureDay.day,
        Math.floor(minuteOfDay / 60),
        minuteOfDay % 60
      );
      if (timestamp >= nowMs - 30000) departures.push(timestamp);
    }
  }

  const unique = [...new Set(departures)].sort((a, b) => a - b).slice(0, count);
  return { departures: unique, reason: hasCoveredDate ? "ok" : "expired" };
}
