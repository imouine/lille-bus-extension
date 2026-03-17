/*
 * Lille Bus Extension
 * Author: imouine
 * Copyright (c) 2026
 * License: GPL-3.0
 * https://github.com/imouine/lille-bus-extension
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: "…" });
  chrome.action.setBadgeBackgroundColor({ color: "#1976d2" });

  chrome.alarms.create("refresh-badge", { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("refresh-badge", { periodInMinutes: 1 });
});

const API_URL =
  "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Aprochains_passages/items?f=json";

const STORAGE_KEYS = {
  selection: "selection",
};

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

async function setBadge(text) {
  await chrome.action.setBadgeText({ text });
}

async function refreshBadge() {
  const { [STORAGE_KEYS.selection]: selection } = await chrome.storage.local.get(
    [STORAGE_KEYS.selection]
  );

  if (!selection || !selection.stopName || !selection.lineCode || !selection.direction) {
    await setBadge("…");
    return;
  }

  try {
    const filter = `nom_station=${cqlQuote(noAccents(selection.stopName).toUpperCase())}`;
    const url = buildUrl({ limit: 200, filter });
    const json = await fetchJson(url);
    const records = Array.isArray(json.records) ? json.records : [];

    const matches = records.filter(
      (r) =>
        r &&
        r.code_ligne === selection.lineCode &&
        r.sens_ligne === selection.direction &&
        (typeof r.heure_estimee_depart === "string" || typeof r.cle_tri === "string")
    );

    let best = null;
    for (const r of matches) {
      const m = minutesUntilFromRecord(r);
      if (m === null) continue;
      if (best === null || m < best) best = m;
    }

    if (best === null) {
      await setBadge("--");
      return;
    }

    const badge = best > 99 ? "99+" : String(best);
    await setBadge(badge);
  } catch (e) {
    console.error("refreshBadge failed", e);
    await setBadge("!");
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === "refresh-badge") {
    refreshBadge();
  }
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
});

// Premier rafraîchissement au chargement du service worker
refreshBadge();