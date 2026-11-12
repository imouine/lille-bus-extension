/**
 * Bus Lille Ilévia — background coordinator
 *
 * One refresh cycle performs at most one MEL request for the whole watchlist,
 * normalizes results, stores a timestamped snapshot, and updates the badge.
 */

import {
  STORAGE_KEYS,
  normalizePrefs,
  normalizeWatcher,
  resolveWatcherStation,
  refreshPeriodMinutes,
} from "../lib/config.js";
import { fetchWfsRecords } from "../lib/mel-api.js";
import {
  mergeDepartureTimestamps,
  minutesUntil,
  nextTheoreticalDepartures,
} from "../lib/transit.js";
import {
  bestCurrentDeparture,
  buildWatchlistFilter,
  liveDeparturesForWatcher,
  refreshIsDue,
} from "../lib/background-logic.js";

const ALARM_NAME = "refresh-badge";
const MAX_DEPARTURES = 3;
const API_COUNT_LIMIT = 5000;

let schedulesCache = null;
let refreshPromise = null;
let lastRefreshStartedAt = 0;

const BADGE_TEXT = {
  fr: {
    none: "Bus Lille Ilévia · aucun passage disponible",
    paused: "Bus Lille Ilévia · actualisation en pause",
    add: "Bus Lille Ilévia · ajoutez un trajet",
    theoretical: " (théorique)",
  },
  en: {
    none: "Bus Lille Ilévia · no departure available",
    paused: "Bus Lille Ilévia · refresh paused",
    add: "Bus Lille Ilévia · add a trip",
    theoretical: " (scheduled)",
  },
};

function badgeText(lang, key) {
  return BADGE_TEXT[lang]?.[key] ?? BADGE_TEXT.fr[key];
}

function badgeColor(minutes) {
  if (minutes <= 1) return "#C62828";
  if (minutes <= 5) return "#E65100";
  return "#1976D2";
}

async function setBadge({ text = "", color = "#64748B", title = "Bus Lille Ilévia" } = {}) {
  await Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setBadgeTextColor({ color: "#FFFFFF" }),
    chrome.action.setTitle({ title }),
  ]);
}

async function getPrefs() {
  const { [STORAGE_KEYS.prefs]: stored } = await chrome.storage.local.get([STORAGE_KEYS.prefs]);
  return normalizePrefs(stored);
}

async function setStateBadge(key, { text = "", color = "#64748B" } = {}) {
  const prefs = await getPrefs();
  return setBadge({ text, color, title: badgeText(prefs.lang, key) });
}

async function ensureAlarm() {
  const periodInMinutes = 0.5;
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing || existing.periodInMinutes !== periodInMinutes) {
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes });
  }
}

async function loadSchedules() {
  if (schedulesCache) return schedulesCache;
  try {
    const response = await fetch(chrome.runtime.getURL("data/schedules.json"));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    schedulesCache = await response.json();
  } catch (error) {
    console.warn("Unable to load theoretical schedules", error);
    schedulesCache = null;
  }
  return schedulesCache;
}

async function loadWatchers() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.watchers, STORAGE_KEYS.selection]);
  let watchers = Array.isArray(stored[STORAGE_KEYS.watchers])
    ? stored[STORAGE_KEYS.watchers]
    : [];
  if (watchers.length === 0 && stored[STORAGE_KEYS.selection]?.stopName) {
    watchers = [stored[STORAGE_KEYS.selection]];
  }
  const normalized = watchers
    .map(normalizeWatcher)
    .filter((watcher) => watcher.stopName && watcher.lineCode && watcher.direction);
  const schedules = await loadSchedules();
  const resolved = schedules
    ? normalized.map((watcher) => resolveWatcherStation(schedules, watcher))
    : normalized;
  if (JSON.stringify(resolved) !== JSON.stringify(watchers)) {
    await chrome.storage.local.set({ [STORAGE_KEYS.watchers]: resolved });
  }
  return resolved;
}

function toDepartureItems(departures, nowMs) {
  return departures.map((departure) => ({
    ...departure,
    minutes: minutesUntil(departure.departureAt, nowMs),
  }));
}

async function resultForWatcher(watcher, records, apiAvailable, nowMs) {
  const liveTimestamps = apiAvailable ? liveDeparturesForWatcher(records, watcher, nowMs) : [];
  let theoretical = { departures: [], reason: "missing" };
  if (liveTimestamps.length < MAX_DEPARTURES) {
    const schedules = await loadSchedules();
    theoretical = nextTheoreticalDepartures(schedules, watcher, nowMs, MAX_DEPARTURES * 2);
  }

  if (liveTimestamps.length > 0) {
    const departures = toDepartureItems(mergeDepartureTimestamps(
      liveTimestamps,
      theoretical.departures,
      { limit: MAX_DEPARTURES }
    ), nowMs);
    const hasTheoretical = departures.some((departure) => !departure.isLive);
    return {
      watcherId: watcher.id,
      source: hasTheoretical ? "mixed" : "live",
      status: "live",
      fetchedAt: nowMs,
      minutes: departures[0].minutes,
      isLive: departures[0].isLive,
      departures,
    };
  }

  const departures = toDepartureItems(mergeDepartureTimestamps(
    [],
    theoretical.departures,
    { limit: MAX_DEPARTURES }
  ), nowMs);
  let status = "no_departure";
  if (departures.length > 0) status = apiAvailable ? "theoretical" : "api_unavailable";
  else if (theoretical.reason === "expired") status = "schedule_expired";

  return {
    watcherId: watcher.id,
    source: departures.length > 0 ? "theoretical" : "none",
    status,
    fetchedAt: nowMs,
    minutes: departures[0]?.minutes ?? null,
    isLive: false,
    departures,
  };
}

async function computeSnapshot(watchers) {
  const nowMs = Date.now();
  const filter = buildWatchlistFilter(watchers);
  let records = [];
  let apiError = null;
  if (filter) {
    try {
      records = await fetchWfsRecords("prochains_passages", {
        count: API_COUNT_LIMIT,
        cqlFilter: filter,
      });
    } catch (error) {
      apiError = error;
      console.warn("Live departures unavailable", error);
    }
  }

  const results = {};
  for (const watcher of watchers) {
    results[watcher.id] = await resultForWatcher(watcher, records, !apiError, nowMs);
  }
  return {
    results,
    meta: {
      attemptedAt: nowMs,
      completedAt: Date.now(),
      status: apiError ? "degraded" : "ok",
      error: apiError ? String(apiError.message || apiError) : null,
    },
  };
}

async function applySnapshotBadge(watchers, results, prefs, nowMs = Date.now()) {
  const best = bestCurrentDeparture(watchers, results, nowMs);
  if (!best) {
    await setBadge({ text: "--", title: badgeText(prefs.lang, "none") });
    return;
  }
  const minutes = best.departure.minutes;
  const isLive = best.departure.source
    ? best.departure.source === "live"
    : (best.departure.isLive ?? best.result.source === "live");
  await setBadge({
    text: minutes > 99 ? "99+" : String(minutes),
    color: isLive ? badgeColor(minutes) : "#64748B",
    title: `${best.watcher.lineCode} · ${best.watcher.stopLabel || best.watcher.stopName} · ${minutes} min${isLive ? "" : badgeText(prefs.lang, "theoretical")}`,
  });
}

async function performRefresh({ force = false } = {}) {
  const { [STORAGE_KEYS.paused]: paused } = await chrome.storage.local.get([STORAGE_KEYS.paused]);
  const prefs = await getPrefs();
  if (paused === true) {
    await setBadge({ text: "II", color: "#64748B", title: badgeText(prefs.lang, "paused") });
    return;
  }

  const dedupeWindow = Math.min(refreshPeriodMinutes(prefs) * 60000 * 0.6, 20000);
  if (!force && Date.now() - lastRefreshStartedAt < dedupeWindow) return;
  lastRefreshStartedAt = Date.now();

  const watchers = await loadWatchers();
  if (watchers.length === 0) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.watcherResults]: {},
      [STORAGE_KEYS.refreshMeta]: { attemptedAt: Date.now(), completedAt: Date.now(), status: "idle", error: null },
    });
    await setBadge({ text: "", title: badgeText(prefs.lang, "add") });
    return;
  }

  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.watcherResults,
    STORAGE_KEYS.refreshMeta,
  ]);
  let results = stored[STORAGE_KEYS.watcherResults] ?? {};
  const due = force || refreshIsDue(
    stored[STORAGE_KEYS.refreshMeta],
    refreshPeriodMinutes(prefs)
  );
  if (due) {
    const snapshot = await computeSnapshot(watchers);
    results = snapshot.results;
    await chrome.storage.local.set({
      [STORAGE_KEYS.watcherResults]: results,
      [STORAGE_KEYS.refreshMeta]: snapshot.meta,
    });
  }
  await applySnapshotBadge(watchers, results, prefs);
}

function refreshBadge(options = {}) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = performRefresh(options).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function initialize() {
  await ensureAlarm();
  await refreshBadge({ force: true });
}

chrome.runtime.onInstalled.addListener(() => {
  initialize().catch((error) => console.error("Installation initialization failed", error));
});

chrome.runtime.onStartup.addListener(() => {
  initialize().catch((error) => console.error("Startup initialization failed", error));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    refreshBadge().catch((error) => console.error("Alarm refresh failed", error));
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return undefined;

  if (message.type === "badge:refresh") {
    refreshBadge({ force: message.force === true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "watchers:changed") {
    refreshBadge({ force: true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "watchers:clear") {
    chrome.storage.local
      .set({ [STORAGE_KEYS.watchers]: [], [STORAGE_KEYS.watcherResults]: {} })
      .then(() => setStateBadge("add"))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "badge:pause") {
    const paused = message.paused === true;
    chrome.storage.local
      .set({ [STORAGE_KEYS.paused]: paused })
      .then(() => paused
        ? setStateBadge("paused", { text: "II" })
        : refreshBadge({ force: true }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "prefs:refreshInterval") {
    ensureAlarm()
      .then(() => refreshBadge({ force: true }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return undefined;
});

initialize().catch((error) => console.error("Background initialization failed", error));
