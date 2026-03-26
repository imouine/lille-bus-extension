/**
 * Lille Bus Extension — Service Worker
 *
 * Responsibilities:
 *   - Periodically fetch live departure times from the MEL API
 *   - Update the Chrome action badge (text, color, breathing animation)
 *   - Persist per-watcher results so the popup can read them without extra API calls
 *   - Fall back to static GTFS timetables when live data is unavailable
 *
 * Architecture:
 *   - An alarm ("refresh-badge") triggers refreshBadge() at a configurable interval
 *   - When the popup is open, it connects via a port and takes over refresh scheduling;
 *     the alarm still fires but is ignored to avoid duplicate API calls
 *   - The popup communicates via chrome.runtime messages (badge:refresh, badge:pause, etc.)
 *
 * @author imouine
 * @license GPL-3.0
 * @see https://github.com/imouine/lille-bus-extension
 */

// ── Lifecycle ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  chrome.action.setBadgeText({ text: "…" });
  chrome.action.setBadgeBackgroundColor({ color: "#1976d2" });
  const period = await getRefreshPeriod();
  chrome.alarms.create("refresh-badge", { periodInMinutes: period });
});

chrome.runtime.onStartup.addListener(async () => {
  const period = await getRefreshPeriod();
  chrome.alarms.create("refresh-badge", { periodInMinutes: period });
});

// ── Constants ──────────────────────────────────────────────────────────────────

const API_URL =
  "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Aprochains_passages/items?f=json";

const STORAGE_KEYS = {
  selection:      "selection",
  prefs:          "prefs",
  paused:         "paused",
  watchers:       "watchers",
  watcherResults: "watcherResults",
};

/** Refresh slider steps in minutes — mirrors options.js */
const REFRESH_STEPS_MIN   = [1/12, 1/6, 1/4, 0.5, 1]; // 5s, 10s, 15s, 30s, 60s
const DEFAULT_REFRESH_IDX = 4; // 60 s

// ── Pause state ────────────────────────────────────────────────────────────────

/** Cached in-memory to avoid a storage.get on every breathe tick. */
let _isPaused = false;

async function loadPausedState() {
  const { [STORAGE_KEYS.paused]: val } = await chrome.storage.local.get([STORAGE_KEYS.paused]);
  _isPaused = val === true;
}

/** Show a static grey "II" badge when paused. */
function applyPausedBadge() {
  _isLive = false;
  _lastLiveMinutes = null;
  chrome.action.setBadgeBackgroundColor({ color: "#616161" });
  chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
  chrome.action.setBadgeText({ text: "II" });
}

// ── Alarm helpers ──────────────────────────────────────────────────────────────

async function getRefreshPeriod() {
  const { [STORAGE_KEYS.prefs]: prefs } = await chrome.storage.local.get([STORAGE_KEYS.prefs]);
  const idx = prefs?.refreshIdx;
  if (Number.isInteger(idx) && idx >= 0 && idx < REFRESH_STEPS_MIN.length) {
    return REFRESH_STEPS_MIN[idx];
  }
  return REFRESH_STEPS_MIN[DEFAULT_REFRESH_IDX];
}

async function resetAlarm(periodInMinutes) {
  await chrome.alarms.clear("refresh-badge");
  chrome.alarms.create("refresh-badge", { periodInMinutes });
}

// ── Static timetables (schedules.json) ─────────────────────────────────────────

/** In-memory cache — loaded once per service worker session. */
let _schedulesCache = null;

/** Returns the schedule profile for today: "WEEKDAY" | "SATURDAY" | "SUNDAY". */
function todayProfile() {
  const wd = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
  }).format(new Date());
  if (wd === "samedi") return "SATURDAY";
  if (wd === "dimanche") return "SUNDAY";
  return "WEEKDAY";
}

/** Loads schedules.json once per session. Returns the parsed object or null. */
async function loadSchedules() {
  if (_schedulesCache !== null) return _schedulesCache;
  try {
    const url = chrome.runtime.getURL("data/schedules.json");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _schedulesCache = await res.json();
  } catch (e) {
    console.warn("loadSchedules failed:", e);
    _schedulesCache = null;
  }
  return _schedulesCache;
}

/**
 * Returns the minutes until the next scheduled departure for a given
 * (stop, line, direction) based on static GTFS timetables.
 * Returns null if no data is available.
 */
async function nextTheoreticalMinutes(stopNorm, lineCode, direction) {
  const data = await loadSchedules();
  if (!data?.stops) return null;

  const dirEntry = data.stops[stopNorm]?.[lineCode]?.[direction];
  if (!dirEntry) return null;

  const times = dirEntry[todayProfile()];
  if (!Array.isArray(times) || times.length === 0) return null;

  // Current time in minutes since midnight (Europe/Paris)
  const nowStr = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const [hh, mm] = nowStr.split(":").map(Number);
  const nowMins = hh * 60 + mm;

  // times[] is sorted; find the first departure >= now, or wrap to tomorrow
  const next = times.find((t) => t >= nowMins) ?? times[0];
  return next >= nowMins ? next - nowMins : (next + 1440) - nowMins;
}

// ── API helpers ────────────────────────────────────────────────────────────────

/** Wraps a value for CQL filter strings, escaping single quotes. */
function cqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Strips diacritics — the MEL CQL engine rejects accented characters. */
function noAccents(str) {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0152/g, "OE")
    .replace(/\u0153/g, "oe")
    .replace(/\u00c6/g, "AE")
    .replace(/\u00e6/g, "ae");
}

/** Builds a full API URL with the given query parameters. */
function buildUrl(params) {
  const url = new URL(API_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Fetches JSON with an abort timeout. */
async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

// ── Timestamp parsing ──────────────────────────────────────────────────────────

/**
 * Returns the UTC offset (in minutes) for a given timezone at a specific date.
 * Used to convert wall-clock timestamps into UTC.
 */
function getTimeZoneOffsetMinutes(timeZone, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map = Object.create(null);
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

/**
 * Parses an ISO-like timestamp and interprets it as Europe/Paris wall-clock time,
 * ignoring any TZ suffix (the MEL API sometimes provides inconsistent offsets).
 * Returns epoch ms or null.
 */
function parseIsoAsParisTime(isoLike) {
  const m = String(isoLike).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|[+-]\d{2}:\d{2})?$/
  );
  if (!m) return null;

  const localAsUTC = Date.UTC(
    +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6],
    m[7] ? +m[7].padEnd(3, "0") : 0
  );

  // First guess at the offset, then refine once (handles DST transitions)
  let offset = getTimeZoneOffsetMinutes("Europe/Paris", new Date(localAsUTC));
  let utc = localAsUTC - offset * 60000;
  const offset2 = getTimeZoneOffsetMinutes("Europe/Paris", new Date(utc));
  if (offset2 !== offset) utc = localAsUTC - offset2 * 60000;
  return utc;
}

/**
 * Extracts a timestamp (epoch ms) from the API's `cle_tri` field.
 * Format: ".../{ISO8601 datetime}" — the most reliable time source.
 */
function extractCleTriTimestampMs(cleTri) {
  if (typeof cleTri !== "string") return null;
  const idx = cleTri.lastIndexOf("/");
  if (idx === -1) return null;
  const t = Date.parse(cleTri.slice(idx + 1));
  return Number.isFinite(t) ? t : null;
}

/**
 * Computes the minutes remaining until departure from a single API record.
 * Tries cle_tri first, then heure_estimee_depart. Returns null on failure.
 */
function minutesUntilFromRecord(record) {
  if (!record) return null;

  // cle_tri contains a reliable timestamp with +01/+02 (Paris)
  const cleTriMs = extractCleTriTimestampMs(record.cle_tri);
  if (cleTriMs !== null) {
    return Math.max(0, Math.ceil((cleTriMs - Date.now()) / 60000));
  }

  if (typeof record.heure_estimee_depart === "string") {
    const tzMs = parseIsoAsParisTime(record.heure_estimee_depart);
    if (tzMs !== null) {
      return Math.max(0, Math.ceil((tzMs - Date.now()) / 60000));
    }
    // Last resort: try native Date.parse
    const t = Date.parse(record.heure_estimee_depart);
    if (Number.isFinite(t)) return Math.max(0, Math.ceil((t - Date.now()) / 60000));
  }

  return null;
}

// ── Badge visuals (color + breathing animation) ────────────────────────────────

/**
 * Badge color palette based on minutes remaining (live data only):
 *   > 5 min  → blue   (#1976d2)
 *   2–5 min  → orange (#e65100)
 *   0–1 min  → red    (#c62828)
 */
function badgeColor(minutes) {
  if (minutes <= 1) return { r: 198, g: 40,  b: 40  };
  if (minutes <= 5) return { r: 230, g: 81,  b: 0   };
  return                   { r: 25,  g: 118, b: 210 };
}

function colorToHex({ r, g, b }) {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

function lerpColor(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

const WHITE     = { r: 255, g: 255, b: 255 };
const DARK_TEXT = { r: 30,  g: 30,  b: 50  };

// Animation state
let _isLive          = false;
let _lastLiveMinutes = null;
let _breatheTimer    = null;
let _breathePhase    = 0;
let _boostAmount     = 0;

/**
 * Continuous breathing animation:
 *   - 3 s sinusoidal cycle — smooth, pleasant rhythm
 *   - 50 ms ticks — fluid without being CPU-heavy
 *   - Base amplitude depends on urgency (subtle)
 *   - Temporary boost (+0.25) on each successful refresh, fading over ~2 s
 *   - Both background and text color breathe in sync (text darkens as bg lightens)
 */
const BREATHE_TICK_MS   = 50;
const BREATHE_PERIOD_MS = 3000;
const BREATHE_STEP      = (2 * Math.PI * BREATHE_TICK_MS) / BREATHE_PERIOD_MS;
const BOOST_DECAY       = 0.012;

/** Base breathing amplitude by urgency. */
function breatheAmplitude(minutes) {
  if (minutes <= 1) return 0.30;
  if (minutes <= 5) return 0.18;
  return 0.10;
}

/** Checks if the user has enabled the glow effect in preferences. */
async function glowEnabled() {
  const { [STORAGE_KEYS.prefs]: prefs } = await chrome.storage.local.get([STORAGE_KEYS.prefs]);
  return prefs?.glowEnabled !== false;
}

/** Starts the continuous breathing loop (idempotent). */
function startBreatheLoop() {
  if (_breatheTimer !== null) return;
  _breathePhase = 0;

  _breatheTimer = setInterval(async () => {
    if (!_isLive || _lastLiveMinutes === null) return;
    if (!(await glowEnabled())) return;

    _breathePhase += BREATHE_STEP;
    if (_breathePhase > 2 * Math.PI) _breathePhase -= 2 * Math.PI;

    if (_boostAmount > 0) _boostAmount = Math.max(0, _boostAmount - BOOST_DECAY);

    const wave      = (1 - Math.cos(_breathePhase)) / 2;
    const amplitude = breatheAmplitude(_lastLiveMinutes) + _boostAmount;
    const base      = badgeColor(_lastLiveMinutes);
    const bgColor   = lerpColor(base, WHITE, wave * amplitude);
    const txtColor  = lerpColor(WHITE, DARK_TEXT, wave * amplitude);

    try {
      chrome.action.setBadgeBackgroundColor({ color: colorToHex(bgColor) });
      chrome.action.setBadgeTextColor({ color: colorToHex(txtColor) });
    } catch (_) {
      // Service worker is being terminated — stop gracefully
      clearInterval(_breatheTimer);
      _breatheTimer = null;
    }
  }, BREATHE_TICK_MS);
}

/** Stops the breathing loop. */
function stopBreatheLoop() {
  if (_breatheTimer !== null) {
    clearInterval(_breatheTimer);
    _breatheTimer = null;
  }
}

/** Called after each successful live refresh — gives a temporary brightness boost. */
function triggerRefreshFlash() {
  _boostAmount = 0.25;
}

startBreatheLoop();

async function setBadge(text) {
  await chrome.action.setBadgeText({ text });
}

// ── Direction matching ─────────────────────────────────────────────────────────

/**
 * Fuzzy-matches the API's `sens_ligne` against the GTFS trip headsign.
 *
 * The MEL API often abbreviates or reformats direction names compared to GTFS:
 *   "MARCQ FERME AUX OIES"     vs "MARCQ EN BAROEUL FERME AUX OIES"
 *   "FACHES CENTRE COMMERCIAL"  vs "FACHES THUMESNIL CTRE COMMERCIAL"
 *   "VILLENEUVE D'ASCQ ..."    vs "VILLENEUVE D ASCQ ..."
 *   "WASQUEHAL JEAN PAUL SARTRE" vs "WASQUEHAL JP SARTRE"
 *
 * Strategy:
 *   1. Expand known abbreviations (JP→JEAN PAUL, CTRE→CENTRE, ST→SAINT, etc.)
 *   2. Normalize both strings (strip accents, apostrophes)
 *   3. Check that every significant word (≥ 4 chars) from the API value exists
 *      in the GTFS headsign (with prefix tolerance for remaining abbreviations)
 */

/** Multi-word abbreviation expansions (applied before word splitting). */
const ABBREVIATION_MAP = [
  [/\bJP\b/g,     "JEAN PAUL"],
  [/\bJB\b/g,     "JEAN BAPTISTE"],
  [/\bCTRE\b/g,   "CENTRE"],
  [/\bCH\b/g,     "CENTRE HOSPITALIER"],
  [/\bST\b/g,     "SAINT"],
  [/\bSTE\b/g,    "SAINTE"],
  [/\bGEN\b/g,    "GENERAL"],
  [/\bAV\b/g,     "AVENUE"],
  [/\bBD\b/g,     "BOULEVARD"],
  [/\bPL\b/g,     "PLACE"],
];

function directionMatches(sens, gtfsDir) {
  if (!sens || !gtfsDir) return false;
  if (sens === gtfsDir) return true;

  const norm = (s) => {
    let r = noAccents(s)
      .replace(/['''-]/g, " ")
      .replace(/\./g, "")
      .toUpperCase();
    // Expand all abbreviations so both sides use the same long forms
    for (const [pattern, expansion] of ABBREVIATION_MAP) {
      r = r.replace(pattern, expansion);
    }
    return r.split(/\s+/).filter(Boolean);
  };

  const sensWords = norm(sens);
  const gtfsWords = new Set(norm(gtfsDir));
  const significant = sensWords.filter((w) => w.length >= 4);
  if (significant.length === 0) return false;

  return significant.every((w) =>
    gtfsWords.has(w) || [...gtfsWords].some((g) => g.startsWith(w) || w.startsWith(g))
  );
}

// ── Core fetch logic ───────────────────────────────────────────────────────────

/**
 * Fetches the best (minimum) minutes until departure for a list of watchers.
 *
 * For each watcher:
 *   1. If GTFS stop IDs are available, uses `identifiant_station` for reliable matching
 *   2. Otherwise, falls back to fuzzy nom_station + sens_ligne matching
 *   3. If the live API fails, returns the next scheduled departure from schedules.json
 *
 * @returns {{ best: number|null, isLive: boolean, perWatcher: Array }}
 */
async function fetchBestMinutes(watcherList) {
  if (!watcherList || watcherList.length === 0) {
    return { best: null, isLive: false, perWatcher: [] };
  }

  const perWatcher = await Promise.all(watcherList.map(async (w) => {
    try {
      const stopIds = Array.isArray(w.stopIds) && w.stopIds.length > 0 ? w.stopIds : null;
      let filter;

      if (stopIds) {
        // Reliable matching via GTFS stop_id → API identifiant_station
        const fullIds = stopIds.map((id) => `ILEVIA:StopPoint:BP:${id}:LOC`);
        filter = `identifiant_station IN (${fullIds.map(cqlQuote).join(",")})`;
      } else {
        // Legacy fallback: fuzzy match on station name
        filter = `nom_station LIKE ${cqlQuote("%" + noAccents(w.stopName).toUpperCase())}`;
      }

      const json    = await fetchJson(buildUrl({ limit: 200, filter }));
      const records = Array.isArray(json.records) ? json.records : [];

      const matches = records.filter((r) => {
        if (!r || r.code_ligne !== w.lineCode) return false;
        if (typeof r.heure_estimee_depart !== "string" && typeof r.cle_tri !== "string") return false;
        // Always filter by direction — a single stopId can serve multiple directions
        // for the same line (e.g. LMQ002 serves L1→CHATEAU and L1→WAMBRECHIES AGRIPPIN)
        return directionMatches(r.sens_ligne, w.direction);
      });

      let best = null;
      for (const r of matches) {
        const m = minutesUntilFromRecord(r);
        if (m !== null && (best === null || m < best)) best = m;
      }
      if (best !== null) return { minutes: best, isLive: true };
    } catch (_) {
      // Network unavailable — fall through to theoretical
    }

    const theo = await nextTheoreticalMinutes(w.stopName, w.lineCode, w.direction).catch(() => null);
    return { minutes: theo, isLive: false };
  }));

  // Pick the global best across all watchers (prefer live over theoretical)
  let bestLive = null;
  let bestTheo = null;
  for (const r of perWatcher) {
    if (r.minutes === null) continue;
    if (r.isLive && (bestLive === null || r.minutes < bestLive)) bestLive = r.minutes;
    if (!r.isLive && (bestTheo === null || r.minutes < bestTheo)) bestTheo = r.minutes;
  }
  if (bestLive !== null) return { best: bestLive, isLive: true, perWatcher };
  return { best: bestTheo, isLive: false, perWatcher };
}

// ── Badge refresh ──────────────────────────────────────────────────────────────

/**
 * Main refresh cycle. Fetches live data for all watchers, updates the badge,
 * and persists per-watcher results for the popup to read.
 */
async function refreshBadge() {
  if (_isPaused) {
    applyPausedBadge();
    return;
  }

  const stored = await chrome.storage.local.get([STORAGE_KEYS.watchers, STORAGE_KEYS.selection]);
  let watcherList = Array.isArray(stored[STORAGE_KEYS.watchers]) ? stored[STORAGE_KEYS.watchers] : null;

  // Migration: if the new "watchers" key doesn't exist yet, try the legacy "selection" key
  if (watcherList === null) {
    const sel = stored[STORAGE_KEYS.selection];
    if (sel?.stopName && sel?.lineCode && sel?.direction) {
      watcherList = [{ stopName: sel.stopName, lineCode: sel.lineCode, direction: sel.direction }];
    } else {
      watcherList = [];
    }
  }

  if (watcherList.length === 0) {
    _isLive = false;
    _lastLiveMinutes = null;
    await chrome.storage.local.set({ [STORAGE_KEYS.watcherResults]: [] });
    await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
    await setBadge("…");
    return;
  }

  try {
    const { best, isLive, perWatcher } = await fetchBestMinutes(watcherList);
    await chrome.storage.local.set({ [STORAGE_KEYS.watcherResults]: perWatcher });

    if (!isLive || best === null) {
      _isLive = false;
      _lastLiveMinutes = null;
      await chrome.action.setBadgeBackgroundColor({ color: "#757575" });
      await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
      await setBadge(best !== null ? (best > 99 ? "99+" : String(best)) : "--");
      return;
    }

    _lastLiveMinutes = best;
    _isLive = true;
    await chrome.action.setBadgeBackgroundColor({ color: colorToHex(badgeColor(best)) });
    await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
    await setBadge(best > 99 ? "99+" : String(best));
    triggerRefreshFlash();
  } catch (e) {
    console.error("refreshBadge failed:", e);
    _isLive = false;
    _lastLiveMinutes = null;
    await setBadge("!");
  }
}

// ── Popup connection tracking ──────────────────────────────────────────────────

/**
 * The popup opens a persistent port ("popup") on init. While connected, the alarm
 * skips its ticks (the popup drives refresh via "badge:refresh" messages).
 * When the popup closes, the port disconnects automatically and the alarm resumes.
 */
let _popupConnected = false;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") return;
  _popupConnected = true;
  port.onDisconnect.addListener(() => { _popupConnected = false; });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === "refresh-badge" && !_popupConnected) refreshBadge();
});

// ── Message handlers ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "watchers:clear") {
    _isLive = false;
    _lastLiveMinutes = null;
    chrome.storage.local
      .set({ [STORAGE_KEYS.watchers]: [], [STORAGE_KEYS.watcherResults]: [] })
      .then(() => chrome.action.setBadgeBackgroundColor({ color: "#757575" }))
      .then(() => chrome.action.setBadgeTextColor({ color: "#FFFFFF" }))
      .then(() => chrome.action.setBadgeText({ text: "…" }))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (message.type === "badge:refresh") {
    refreshBadge()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (message.type === "badge:pause") {
    const paused = message.paused === true;
    _isPaused = paused;
    chrome.storage.local.set({ [STORAGE_KEYS.paused]: paused })
      .then(() => paused ? applyPausedBadge() : refreshBadge())
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (message.type === "prefs:refreshInterval" && typeof message.periodInMinutes === "number") {
    resetAlarm(message.periodInMinutes)
      .then(() => refreshBadge())
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

// ── Bootstrap ──────────────────────────────────────────────────────────────────

loadPausedState().then(() => _isPaused ? applyPausedBadge() : refreshBadge());
