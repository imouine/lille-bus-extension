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
  selection: "selection",
  prefs:     "prefs",
};

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

// ---------- Badge visuel (couleur + effet de respiration) ----------

/**
 * Palette de couleurs selon les minutes restantes (données live uniquement).
 *   > 5 min  → bleu   (#1976d2) — normal
 *   2–5 min  → orange (#e65100) — vigilance
 *   0–1 min  → rouge  (#c62828) — imminent
 */
function badgeColor(minutes) {
  if (minutes <= 1) return { r: 198, g: 40,  b: 40  }; // rouge
  if (minutes <= 5) return { r: 230, g: 81,  b: 0   }; // orange
  return                   { r: 25,  g: 118, b: 210 }; // bleu
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

/** État de l'animation */
let _isLive          = false;
let _lastLiveMinutes = null;
let _beatTimer       = null;
let _beatPhase       = 0; // 0..2π, avance à chaque tick

/**
 * Respiration sinusoïdale douce :
 * - Tick toutes les 80 ms
 * - Période complète ~4 s (15 "respirations" par minute)
 * - Courbe : (1 - cos(phase)) / 2  → montée et descente parfaitement symétriques
 *   La valeur reste proche de 0 la plupart du temps et monte doucement au pic.
 */
const BREATHE_INTERVAL_MS = 80;
const BREATHE_PERIOD_MS   = 4000;
const BREATHE_STEP        = (2 * Math.PI * BREATHE_INTERVAL_MS) / BREATHE_PERIOD_MS;

/**
 * Amplitude du flash selon l'urgence :
 *   > 5 min → très subtil (12 % vers blanc) — à peine perceptible
 *   2–5 min → léger (28 %)
 *   ≤ 1 min → visible (50 %)
 */
function breatheAmplitude(minutes) {
  if (minutes <= 1) return 0.50;
  if (minutes <= 5) return 0.28;
  return 0.12;
}

async function glowEnabled() {
  const { [STORAGE_KEYS.prefs]: prefs } = await chrome.storage.local.get([STORAGE_KEYS.prefs]);
  // Par défaut activé si la préférence n'existe pas encore
  return prefs?.glowEnabled !== false;
}

function startBeatLoop() {
  if (_beatTimer !== null) return;
  _beatPhase = 0;
  _beatTimer = setInterval(async () => {
    if (!_isLive || _lastLiveMinutes === null) return;
    if (!(await glowEnabled())) return;

    _beatPhase += BREATHE_STEP;
    // intensité ∈ [0, 1], courbe sinusoïdale douce
    const intensity = (1 - Math.cos(_beatPhase)) / 2;
    const amplitude = breatheAmplitude(_lastLiveMinutes);

    const base  = badgeColor(_lastLiveMinutes);
    const mixed = lerpColor(base, WHITE, intensity * amplitude);
    chrome.action.setBadgeBackgroundColor({ color: colorToHex(mixed) });
  }, BREATHE_INTERVAL_MS);
}

function stopBeatLoop() {
  if (_beatTimer !== null) {
    clearInterval(_beatTimer);
    _beatTimer = null;
  }
}

// Démarre l'animation dès le chargement du service worker
startBeatLoop();

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

async function refreshBadge() {
  const { [STORAGE_KEYS.selection]: selection } = await chrome.storage.local.get(
    [STORAGE_KEYS.selection]
  );

  if (!selection || !selection.stopName || !selection.lineCode || !selection.direction) {
    _isLive = false;
    _lastLiveMinutes = null;
    await setBadge("…");
    return;
  }

  try {
    const nameNorm = noAccents(selection.stopName).toUpperCase();
    const filter = `nom_station LIKE ${cqlQuote("%" + nameNorm)}`;
    const url = buildUrl({ limit: 200, filter });
    const json = await fetchJson(url);
    const records = Array.isArray(json.records) ? json.records : [];

    const matches = records.filter(
      (r) =>
        r &&
        r.code_ligne === selection.lineCode &&
        directionMatches(r.sens_ligne, selection.direction) &&
        (typeof r.heure_estimee_depart === "string" || typeof r.cle_tri === "string")
    );

    let best = null;
    for (const r of matches) {
      const m = minutesUntilFromRecord(r);
      if (m === null) continue;
      if (best === null || m < best) best = m;
    }

    if (best === null) {
      // Fallback théorique — pas d'animation
      _isLive = false;
      _lastLiveMinutes = null;
      const theoretical = await nextTheoreticalMinutes(
        selection.stopName,
        selection.lineCode,
        selection.direction
      );
      if (theoretical !== null) {
        await chrome.action.setBadgeBackgroundColor({ color: "#757575" });
        await setBadge(theoretical > 99 ? "99+" : String(theoretical));
      } else {
        await chrome.action.setBadgeBackgroundColor({ color: "#757575" });
        await setBadge("--");
      }
      return;
    }

    // Données live — active/met à jour le battement
    _lastLiveMinutes = best;
    _isLive = true;
    _beatPhase = 0; // repart du début du cycle à chaque refresh

    // Couleur de base immédiate (le beat loop prend ensuite le relais)
    await chrome.action.setBadgeBackgroundColor({ color: colorToHex(badgeColor(best)) });
    await setBadge(best > 99 ? "99+" : String(best));
  } catch (e) {
    console.error("refreshBadge failed", e);
    _isLive = false;
    _lastLiveMinutes = null;
    await setBadge("!");
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === "refresh-badge") refreshBadge();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

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

  if (message.type === "prefs:refreshInterval" && typeof message.periodInMinutes === "number") {
    resetAlarm(message.periodInMinutes)
      .then(() => refreshBadge())
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

// Premier rafraîchissement au chargement du service worker
refreshBadge();
