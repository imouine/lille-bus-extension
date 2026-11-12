export const STORAGE_KEYS = Object.freeze({
  selection: "selection",
  lineColorsCache: "lineColorsCache",
  prefs: "prefs",
  paused: "paused",
  watchers: "watchers",
  watcherResults: "watcherResults",
  refreshMeta: "refreshMeta",
});

export const REFRESH_STEPS_MIN = Object.freeze([0.5, 1, 2, 5]);
export const REFRESH_STEPS_LABEL = Object.freeze(["30 s", "1 min", "2 min", "5 min"]);
export const DEFAULT_REFRESH_IDX = 0;
export const MAX_WATCHERS = 12;

export function normalizePrefs(stored, systemPrefersDark = false) {
  const source = stored && typeof stored === "object" ? stored : {};
  return {
    theme: source.theme === "dark" || source.theme === "light"
      ? source.theme
      : (systemPrefersDark ? "dark" : "light"),
    lang: source.lang === "en" ? "en" : "fr",
    refreshIdx: Number.isInteger(source.refreshIdx)
      && source.refreshIdx >= 0
      && source.refreshIdx < REFRESH_STEPS_MIN.length
      ? source.refreshIdx
      : DEFAULT_REFRESH_IDX,
  };
}

export function refreshPeriodMinutes(prefs) {
  const idx = prefs?.refreshIdx;
  return Number.isInteger(idx) && idx >= 0 && idx < REFRESH_STEPS_MIN.length
    ? REFRESH_STEPS_MIN[idx]
    : REFRESH_STEPS_MIN[DEFAULT_REFRESH_IDX];
}

export function watcherId(watcher) {
  const raw = [watcher?.stopId || watcher?.stopName, watcher?.lineCode, watcher?.direction]
    .map((value) => String(value ?? "").trim().toUpperCase())
    .join("|");
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `w-${(hash >>> 0).toString(36)}`;
}

export function normalizeWatcher(watcher) {
  const normalized = {
    id: watcher?.id || watcherId(watcher),
    stopId: String(watcher?.stopId ?? "").trim(),
    stopName: String(watcher?.stopName ?? "").trim(),
    stopLabel: String(watcher?.stopLabel ?? watcher?.stopName ?? "").trim(),
    lineCode: String(watcher?.lineCode ?? "").trim(),
    direction: String(watcher?.direction ?? "").trim(),
    stopIds: Array.isArray(watcher?.stopIds)
      ? [...new Set(watcher.stopIds.map((id) => String(id).trim()).filter(Boolean))]
      : [],
  };
  return normalized;
}

function normalizedName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function stationEntry(station, watcher) {
  return station?.lines?.[watcher.lineCode]?.[watcher.direction] ?? null;
}

/** Resolve old name-based watchers to the unambiguous v2 GTFS station model. */
export function resolveWatcherStation(scheduleData, sourceWatcher) {
  const watcher = normalizeWatcher(sourceWatcher);
  const stations = scheduleData?.stops ?? {};
  let match = null;

  if (watcher.stopId && stationEntry(stations[watcher.stopId], watcher)) {
    match = [watcher.stopId, stations[watcher.stopId]];
  }

  const candidates = Object.entries(stations).filter(([, station]) => stationEntry(station, watcher));
  if (!match && watcher.stopIds.length > 0) {
    const knownIds = new Set(watcher.stopIds);
    const byPhysicalId = candidates.filter(([, station]) => (
      stationEntry(station, watcher)?._stopIds?.some((id) => knownIds.has(String(id)))
    ));
    if (byPhysicalId.length === 1) match = byPhysicalId[0];
  }

  if (!match && watcher.stopName) {
    const targetName = normalizedName(watcher.stopName);
    const byName = candidates.filter(([, station]) => normalizedName(station.name) === targetName);
    if (byName.length === 1) match = byName[0];
  }

  if (!match) return watcher;
  const [stopId, station] = match;
  const entry = stationEntry(station, watcher);
  return normalizeWatcher({
    ...watcher,
    id: watcher.id,
    stopId,
    stopName: station.name,
    stopLabel: station.label || station.name,
    stopIds: entry?._stopIds ?? watcher.stopIds,
  });
}
