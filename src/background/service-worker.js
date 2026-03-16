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
    const filter = `nom_station=${cqlQuote(selection.stopName)}`;
    const url = buildUrl({ limit: 200, filter });
    const json = await fetchJson(url);
    const records = Array.isArray(json.records) ? json.records : [];

    const matches = records.filter(
      (r) =>
        r &&
        r.code_ligne === selection.lineCode &&
        r.sens_ligne === selection.direction &&
        typeof r.heure_estimee_depart === "string"
    );

    let best = null;
    for (const r of matches) {
      const m = minutesUntil(r.heure_estimee_depart);
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