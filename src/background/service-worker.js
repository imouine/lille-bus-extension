/*
 * Lille Bus Extension
 * Author: imouine
 * Copyright (c) 2026
 * License: GPL-3.0
 * https://github.com/imouine/lille-bus-extension
 */

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

const API_URL =
  "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Aprochains_passages/items?f=json";

const STORAGE_KEYS = {
  selection:      "selection",
  prefs:          "prefs",
  paused:         "paused",
  watchers:       "watchers",
  watcherResults: "watcherResults", // résultats par watcher, lus par la popup
};

/** État de pause — mis en cache pour éviter un storage.get à chaque tick */
let _isPaused = false;

async function loadPausedState() {
  const { [STORAGE_KEYS.paused]: val } = await chrome.storage.local.get([STORAGE_KEYS.paused]);
  _isPaused = val === true;
}

// ---------- Animation badge en pause ----------

/**
 * En pause, le badge affiche une animation douce :
 * - Texte qui alterne entre "II" et "·· " toutes les 2 s
 * - Couleur qui respire entre deux gris (foncé → clair) en sinusoïde ~3 s
 * Effet : subtil, immédiatement reconnaissable comme "en attente".
 */
function startPauseAnimation() {
  chrome.action.setBadgeBackgroundColor({ color: "#616161" });
  chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
  chrome.action.setBadgeText({ text: "II" });
}

function stopPauseAnimation() {
  // rien à stopper, l'état est statique
}

async function applyPausedBadge() {
  // Arrête le glow live
  _isLive = false;
  _lastLiveMinutes = null;
  startPauseAnimation();
}

// Crans de fréquence (miroir de options.js)
const REFRESH_STEPS_MIN  = [1/12, 1/6, 1/4, 0.5, 1];
const DEFAULT_REFRESH_IDX = 4; // 60s

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

// ---------- Horaires théoriques (schedules.json) ----------

/** Cache en mémoire — chargé une fois par session du service worker */
let _schedulesCache = null;

/**
 * Retourne le profil du jour courant : "WEEKDAY" | "SATURDAY" | "SUNDAY"
 * Utilise l'heure locale Paris.
 */
function todayProfile() {
  const wd = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
  }).format(new Date());
  if (wd === "samedi") return "SATURDAY";
  if (wd === "dimanche") return "SUNDAY";
  return "WEEKDAY";
}

/**
 * Charge schedules.json (une fois par session), retourne l'objet ou null.
 */
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
 * Retourne les minutes jusqu'au prochain départ théorique pour
 * (stopNorm, lineCode, direction) à partir de maintenant.
 * Retourne null si aucune donnée.
 */
async function nextTheoreticalMinutes(stopNorm, lineCode, direction) {
  const data = await loadSchedules();
  if (!data || !data.stops) return null;

  const stopEntry = data.stops[stopNorm];
  if (!stopEntry) return null;
  const lineEntry = stopEntry[lineCode];
  if (!lineEntry) return null;
  const dirEntry = lineEntry[direction];
  if (!dirEntry) return null;

  const profile = todayProfile();
  const times = dirEntry[profile];
  if (!Array.isArray(times) || times.length === 0) return null;

  // Heure actuelle en minutes depuis minuit (Paris)
  const nowStr = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const [hh, mm] = nowStr.split(":").map(Number);
  const nowMins = hh * 60 + mm;

  // times[] est trié, contient des entiers (minutes depuis minuit)
  // Trouver le premier temps >= nowMins
  let next = times.find((t) => t >= nowMins);
  if (next === undefined) next = times[0]; // premier bus du lendemain

  return next >= nowMins ? next - nowMins : (next + 1440) - nowMins;
}

// ----------------------------------------------------------

function cqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Supprime les diacritiques pour les filtres CQL : l'API MEL rejette les accents */
function noAccents(str) {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0152/g, "OE")
    .replace(/\u0153/g, "oe")
    .replace(/\u00c6/g, "AE")
    .replace(/\u00e6/g, "ae");
}

function buildUrl(params) {
  const url = new URL(API_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

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

function minutesUntil(isoDateString) {
  const t = Date.parse(isoDateString);
  if (!Number.isFinite(t)) return null;
  const diffMin = (t - Date.now()) / 60000;
  return Math.max(0, Math.ceil(diffMin));
}

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

function parseIsoLikeAsTimeZone(isoLike, timeZone) {
  // isoLike: "YYYY-MM-DDTHH:mm:ss(.SSS)(Z|+hh:mm)" -> on ignore le suffixe TZ
  const m = String(isoLike).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|[+-]\d{2}:\d{2})?$/
  );
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const ms = m[7] ? Number(m[7].padEnd(3, "0")) : 0;

  // On convertit "wall-clock" Europe/Paris -> UTC en estimant l’offset DST.
  const localAsUTC = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let guess = new Date(localAsUTC);
  let offset = getTimeZoneOffsetMinutes(timeZone, guess);
  let utc = localAsUTC - offset * 60000;

  // Recalcule une fois (utile aux dates de bascule DST)
  guess = new Date(utc);
  const offset2 = getTimeZoneOffsetMinutes(timeZone, guess);
  if (offset2 !== offset) {
    utc = localAsUTC - offset2 * 60000;
  }

  return utc;
}

function extractCleTriTimestampMs(cleTri) {
  if (typeof cleTri !== "string") return null;
  const idx = cleTri.lastIndexOf("/");
  if (idx === -1) return null;
  const tail = cleTri.slice(idx + 1);
  const t = Date.parse(tail);
  return Number.isFinite(t) ? t : null;
}

function minutesUntilFromRecord(record) {
  if (!record) return null;

  // `cle_tri` contient souvent un timestamp avec +01/+02 (Paris) -> le plus fiable.
  const cleTriMs = extractCleTriTimestampMs(record.cle_tri);
  if (cleTriMs !== null) {
    const diffMin = (cleTriMs - Date.now()) / 60000;
    return Math.max(0, Math.ceil(diffMin));
  }

  if (typeof record.heure_estimee_depart === "string") {
    // L’API a parfois un suffixe TZ incohérent; on force Europe/Paris.
    const tzMs = parseIsoLikeAsTimeZone(record.heure_estimee_depart, "Europe/Paris");
    if (tzMs !== null) {
      const diffMin = (tzMs - Date.now()) / 60000;
      return Math.max(0, Math.ceil(diffMin));
    }

    return minutesUntil(record.heure_estimee_depart);
  }

  return null;
}

// ---------- Badge visuel (couleur + respiration live) ----------

/**
 * Palette de couleurs selon les minutes restantes (données live uniquement).
 *   > 5 min  -> bleu   (#1976d2) — normal
 *   2-5 min  -> orange (#e65100) — vigilance
 *   0-1 min  -> rouge  (#c62828) — imminent
 */
function badgeColor(minutes) {
  if (minutes <= 1) return { r: 198, g: 40,  b: 40  };
  if (minutes <= 5) return { r: 230, g: 81,  b: 0   };
  return                   { r: 25,  g: 118, b: 210 };
}

function colorToHex({ r, g, b }) {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function lerpColor(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

const WHITE = { r: 255, g: 255, b: 255 };

/** Etat de l'animation */
let _isLive          = false;
let _lastLiveMinutes = null;
let _breatheTimer    = null;
let _breathePhase    = 0;
let _boostAmount     = 0; // amplitude bonus apres un refresh, s'estompe

/**
 * Respiration continue douce :
 * - Cycle de 3s (sinusoidal) — rythme agreable, ni trop rapide ni trop lent
 * - Tick toutes les 50ms — fluide sans etre gourmand
 * - Amplitude de base selon urgence (subtile)
 * - Boost temporaire au refresh (+0.25) qui s'estompe en ~2s
 */
const BREATHE_TICK_MS   = 50;
const BREATHE_PERIOD_MS = 3000;
const BREATHE_STEP      = (2 * Math.PI * BREATHE_TICK_MS) / BREATHE_PERIOD_MS;
const BOOST_DECAY        = 0.012; // perte de boost par tick (~2s pour revenir a 0)

function breatheAmplitude(minutes) {
  if (minutes <= 1) return 0.30;
  if (minutes <= 5) return 0.18;
  return 0.10;
}

async function glowEnabled() {
  const { [STORAGE_KEYS.prefs]: prefs } = await chrome.storage.local.get([STORAGE_KEYS.prefs]);
  return prefs?.glowEnabled !== false;
}

function startBreatheLoop() {
  if (_breatheTimer !== null) return;
  _breathePhase = 0;

  _breatheTimer = setInterval(async () => {
    if (!_isLive || _lastLiveMinutes === null) return;
    if (!(await glowEnabled())) return;

    _breathePhase += BREATHE_STEP;
    if (_breathePhase > 2 * Math.PI) _breathePhase -= 2 * Math.PI;

    // Estompe le boost progressivement
    if (_boostAmount > 0) _boostAmount = Math.max(0, _boostAmount - BOOST_DECAY);

    // Intensite sinusoidale douce [0, 1]
    const wave = (1 - Math.cos(_breathePhase)) / 2;
    const amplitude = breatheAmplitude(_lastLiveMinutes) + _boostAmount;

    const base  = badgeColor(_lastLiveMinutes);
    const mixed = lerpColor(base, WHITE, wave * amplitude);

    // Texte : quand le fond s'éclaircit, le texte s'assombrit pour garder le contraste
    // Au repos (wave=0) : blanc pur. Au pic (wave=1) : gris foncé proportionnel à l'amplitude
    const DARK_TEXT = { r: 30, g: 30, b: 50 };
    const textColor = lerpColor(WHITE, DARK_TEXT, wave * amplitude);

    try {
      chrome.action.setBadgeBackgroundColor({ color: colorToHex(mixed) });
      chrome.action.setBadgeTextColor({ color: colorToHex(textColor) });
    } catch (_) {
      clearInterval(_breatheTimer);
      _breatheTimer = null;
    }
  }, BREATHE_TICK_MS);
}

function stopBreatheLoop() {
  if (_breatheTimer !== null) {
    clearInterval(_breatheTimer);
    _breatheTimer = null;
  }
}

/** Appele apres chaque refresh live reussi — donne un boost temporaire */
function triggerRefreshFlash() {
  _boostAmount = 0.25;
}

// Demarre l'animation des le chargement du service worker
startBreatheLoop();

async function setBadge(text) {
  await chrome.action.setBadgeText({ text });
}

/**
 * L'API MEL renvoie sens_ligne souvent abrégé ou différent du headsign GTFS.
 * Exemples de mismatches connus :
 *   'MARCQ FERME AUX OIES'        -> 'MARCQ EN BAROEUL FERME AUX OIES'
 *   'FACHES CENTRE COMMERCIAL'    -> 'FACHES THUMESNIL CTRE COMMERCIAL'
 *   'MARQUETTE LES VOILES'        -> 'MARQUETTE LEZ LILLE LES VOILES'
 *   "VILLENEUVE D'ASCQ ..."       -> 'VILLENEUVE D ASCQ ...'
 *
 * Stratégie : normaliser (apostrophes, tirets -> espace) puis vérifier
 * que tous les mots significatifs (≥4 lettres) du sens_ligne API sont présents
 * dans la direction GTFS.
 */
function directionMatches(sens, gtfsDir) {
  if (!sens || !gtfsDir) return false;
  if (sens === gtfsDir) return true;

  const norm = (s) => noAccents(s)
    .replace(/[''\-]/g, " ")
    .replace(/\./g, "")
    .toUpperCase()
    .replace(/\bCENTRE\b/g, "CTRE")
    .replace(/\bSAINT\b/g, "ST")
    .replace(/\bSAINTE\b/g, "STE")
    .split(/\s+/)
    .filter(Boolean);

  const sensWords = norm(sens);
  const gtfsWords = new Set(norm(gtfsDir));

  const significant = sensWords.filter((w) => w.length >= 4);
  if (significant.length === 0) return false;

  return significant.every((w) =>
    gtfsWords.has(w) || [...gtfsWords].some((g) => g.startsWith(w) || w.startsWith(g))
  );
}

async function fetchBestMinutes(watcherList) {
  if (!watcherList || watcherList.length === 0) return { best: null, isLive: false, perWatcher: [] };

  const perWatcher = await Promise.all(watcherList.map(async (w) => {
    try {
      let filter;
      const stopIds = Array.isArray(w.stopIds) && w.stopIds.length > 0 ? w.stopIds : null;

      if (stopIds) {
        // Matching fiable par identifiant_station
        // Format API : ILEVIA:StopPoint:BP:{stop_id}:LOC
        const fullIds = stopIds.map((id) => `ILEVIA:StopPoint:BP:${id}:LOC`);
        const inList = fullIds.map(cqlQuote).join(",");
        filter = `identifiant_station IN (${inList})`;
      } else {
        // Fallback ancien matching par nom_station + fuzzy sens_ligne
        const nameNorm = noAccents(w.stopName).toUpperCase();
        filter = `nom_station LIKE ${cqlQuote("%" + nameNorm)}`;
      }

      const url      = buildUrl({ limit: 200, filter });
      const json     = await fetchJson(url);
      const records  = Array.isArray(json.records) ? json.records : [];

      let matches;
      if (stopIds) {
        // Avec stopIds, on sait que identifiant_station est déjà filtré —
        // on vérifie juste code_ligne par sécurité
        matches = records.filter(
          (r) => r &&
            r.code_ligne === w.lineCode &&
            (typeof r.heure_estimee_depart === "string" || typeof r.cle_tri === "string")
        );
      } else {
        // Ancien fallback : fuzzy match sur sens_ligne
        matches = records.filter(
          (r) => r &&
            r.code_ligne === w.lineCode &&
            directionMatches(r.sens_ligne, w.direction) &&
            (typeof r.heure_estimee_depart === "string" || typeof r.cle_tri === "string")
        );
      }

      let best = null;
      for (const r of matches) {
        const m = minutesUntilFromRecord(r);
        if (m !== null && (best === null || m < best)) best = m;
      }
      if (best !== null) return { minutes: best, isLive: true };
    } catch (_) { /* réseau indisponible */ }

    // Fallback théorique pour ce watcher
    const theo = await nextTheoreticalMinutes(w.stopName, w.lineCode, w.direction).catch(() => null);
    return { minutes: theo, isLive: false };
  }));

  // Meilleur live global
  let bestLive = null;
  for (const r of perWatcher) {
    if (r.isLive && r.minutes !== null && (bestLive === null || r.minutes < bestLive)) bestLive = r.minutes;
  }
  if (bestLive !== null) return { best: bestLive, isLive: true, perWatcher };

  // Meilleur théorique global
  let bestTheo = null;
  for (const r of perWatcher) {
    if (!r.isLive && r.minutes !== null && (bestTheo === null || r.minutes < bestTheo)) bestTheo = r.minutes;
  }
  return { best: bestTheo, isLive: false, perWatcher };
}

async function refreshBadge() {
  if (_isPaused) {
    await applyPausedBadge();
    return;
  }

  const stored = await chrome.storage.local.get([STORAGE_KEYS.watchers, STORAGE_KEYS.selection]);
  let watcherList = Array.isArray(stored[STORAGE_KEYS.watchers]) ? stored[STORAGE_KEYS.watchers] : null;

  // Migration / compatibilité : seulement si la clé watchers n'existe pas du tout
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

    // Persiste les résultats individuels pour la popup
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
    // Flash visuel pour indiquer que la donnée vient d'être actualisée
    triggerRefreshFlash();
  } catch (e) {
    console.error("refreshBadge failed", e);
    _isLive = false;
    _lastLiveMinutes = null;
    await setBadge("!");
  }
}

// ---------- Détection popup ouverte via port ----------
// La popup ouvre un port "popup" à l'init. Tant qu'il est connecté,
// l'alarme ignore ses ticks (la popup pilote les refresh via badge:refresh).
// Quand la popup se ferme, le port se déconnecte automatiquement → l'alarme reprend.
let _popupConnected = false;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") return;
  _popupConnected = true;
  port.onDisconnect.addListener(() => {
    _popupConnected = false;
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === "refresh-badge" && !_popupConnected) refreshBadge();
});

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

  if (message.type === "selection:set" && message.selection) {
    chrome.storage.local
      .set({ [STORAGE_KEYS.selection]: message.selection })
      .then(() => refreshBadge())
      .then(() => sendResponse({ ok: true }))
      .catch((e) => {
        console.error(e);
        sendResponse({ ok: false, error: String(e) });
      });
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
    if (!paused) stopPauseAnimation();
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

// Premier rafraîchissement au chargement du service worker
loadPausedState().then(() => _isPaused ? applyPausedBadge() : refreshBadge());
