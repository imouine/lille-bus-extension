/*
 * Lille Bus Extension
 * Author: imouine
 * Copyright (c) 2026
 * License: GPL-3.0
 * https://github.com/imouine/lille-bus-extension
 */

const API_URL =
  "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Aprochains_passages/items?f=json";

const STORAGE_KEYS = {
  selection: "selection",
  stopsCache: "stopsCache",
};

const el = {
  stopSearch: document.getElementById("stopSearch"),
  stopHint: document.getElementById("stopHint"),
  stopResults: document.getElementById("stopResults"),
  lineSection: document.getElementById("lineSection"),
  lineResults: document.getElementById("lineResults"),
  directionSection: document.getElementById("directionSection"),
  directionResults: document.getElementById("directionResults"),
  validateSection: document.getElementById("validateSection"),
  summary: document.getElementById("summary"),
  validateBtn: document.getElementById("validateBtn"),
  status: document.getElementById("status"),
};

/** @type {{stopName: string|null, lineCode: string|null, direction: string|null}} */
let draft = {
  stopName: null,
  lineCode: null,
  direction: null,
};

/** @type {{stopName: string, lineCode: string, direction: string}|null} */
let currentSelection = null;

/** @type {Array<string>} */
let cachedStopNames = [];

/** @type {Array<any>} */
let stopLiveRecords = [];

function setStatus(message) {
  el.status.textContent = message || "";
}

function show(element, shouldShow) {
  element.classList.toggle("hidden", !shouldShow);
}

function clearList(listEl) {
  listEl.innerHTML = "";
}

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
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

async function getFromStorage(keys) {
  return await chrome.storage.local.get(keys);
}

async function setInStorage(obj) {
  await chrome.storage.local.set(obj);
}

function normalizeForSearch(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function renderStopSuggestions(stopNames, query) {
  clearList(el.stopResults);

  if (!query || query.trim().length < 2) {
    el.stopHint.textContent = "Tape au moins 2 lettres.";
    return;
  }

  el.stopHint.textContent = stopNames.length
    ? ""
    : "Aucune suggestion (essaye un autre nom).";

  for (const name of stopNames.slice(0, 12)) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = name;
    btn.addEventListener("click", () => onPickStop(name));
    li.appendChild(btn);
    el.stopResults.appendChild(li);
  }
}

function renderLineChoices(lines) {
  clearList(el.lineResults);
  for (const line of lines) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = line;
    btn.addEventListener("click", () => onPickLine(line));
    li.appendChild(btn);
    el.lineResults.appendChild(li);
  }
}

function renderDirectionChoices(directions) {
  clearList(el.directionResults);
  for (const direction of directions) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = direction;
    btn.addEventListener("click", () => onPickDirection(direction));
    li.appendChild(btn);
    el.directionResults.appendChild(li);
  }
}

function updateValidateSection() {
  const ready = !!(draft.stopName && draft.lineCode && draft.direction);
  show(el.validateSection, ready);
  if (!ready) return;

  el.summary.textContent = `Arrêt: ${draft.stopName} — Ligne: ${draft.lineCode} — Sens: ${draft.direction}`;
}

function resetAfterStopPick() {
  draft.lineCode = null;
  draft.direction = null;
  stopLiveRecords = [];
  show(el.lineSection, false);
  show(el.directionSection, false);
  show(el.validateSection, false);
  clearList(el.lineResults);
  clearList(el.directionResults);
}

async function ensureStopsCacheLoaded() {
  // Cache 12h (prochains_passages bouge, mais les noms d’arrêts sont stables)
  const TTL_MS = 12 * 60 * 60 * 1000;
  const { [STORAGE_KEYS.stopsCache]: stopsCache } = await getFromStorage([
    STORAGE_KEYS.stopsCache,
  ]);

  if (
    stopsCache &&
    Array.isArray(stopsCache.stopNames) &&
    typeof stopsCache.updatedAt === "number" &&
    Date.now() - stopsCache.updatedAt < TTL_MS
  ) {
    cachedStopNames = stopsCache.stopNames;
    return;
  }

  setStatus("Chargement des arrêts…");

  // Pagination simple par offset (si tout tient en une page, ça s’arrête direct)
  const limit = 1000;
  let offset = 0;
  /** @type {Set<string>} */
  const names = new Set();
  let numberMatched = null;

  while (true) {
    const url = buildUrl({ limit, offset });
    const json = await fetchJson(url);
    const records = Array.isArray(json.records) ? json.records : [];

    if (typeof json.numberMatched === "number" && numberMatched === null) {
      numberMatched = json.numberMatched;
    }

    for (const r of records) {
      if (r && typeof r.nom_station === "string" && r.nom_station.trim()) {
        names.add(r.nom_station.trim());
      }
    }

    offset += records.length;
    if (!records.length) break;
    if (numberMatched !== null && offset >= numberMatched) break;
    if (offset > 20000) break; // garde-fou
  }

  cachedStopNames = Array.from(names).sort((a, b) => a.localeCompare(b, "fr"));
  await setInStorage({
    [STORAGE_KEYS.stopsCache]: {
      updatedAt: Date.now(),
      stopNames: cachedStopNames,
    },
  });

  setStatus("");
}

async function fetchStopRecords(stopName) {
  const filter = `nom_station=${cqlQuote(stopName)}`;
  const url = buildUrl({ limit: 200, filter });
  const json = await fetchJson(url);
  return Array.isArray(json.records) ? json.records : [];
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) =>
    String(a).localeCompare(String(b), "fr")
  );
}

async function onPickStop(stopName) {
  draft.stopName = stopName;
  resetAfterStopPick();
  setStatus("Chargement des lignes…");

  try {
    stopLiveRecords = await fetchStopRecords(stopName);
  } catch (e) {
    console.error(e);
    setStatus("Erreur réseau pendant le chargement des lignes.");
    return;
  }

  const lines = uniqueSorted(
    stopLiveRecords
      .map((r) => r && r.code_ligne)
      .filter((v) => typeof v === "string" && v.trim())
  );

  show(el.lineSection, true);
  renderLineChoices(lines);
  setStatus(lines.length ? "" : "Aucune ligne trouvée pour cet arrêt." );
}

function onPickLine(lineCode) {
  draft.lineCode = lineCode;
  draft.direction = null;

  const directions = uniqueSorted(
    stopLiveRecords
      .filter((r) => r && r.code_ligne === lineCode)
      .map((r) => r && r.sens_ligne)
      .filter((v) => typeof v === "string" && v.trim())
  );

  show(el.directionSection, true);
  renderDirectionChoices(directions);
  updateValidateSection();
  setStatus(directions.length ? "" : "Aucun sens trouvé pour cette ligne." );
}

function onPickDirection(direction) {
  draft.direction = direction;
  updateValidateSection();
}

async function validateSelection() {
  if (!draft.stopName || !draft.lineCode || !draft.direction) return;

  const selection = {
    stopName: draft.stopName,
    lineCode: draft.lineCode,
    direction: draft.direction,
  };

  setStatus("Enregistrement…");

  await setInStorage({ [STORAGE_KEYS.selection]: selection });
  await chrome.runtime.sendMessage({ type: "selection:set", selection });

  currentSelection = selection;
  setStatus("OK. Le badge va se mettre à jour.");
}

function applyExistingSelection(selection) {
  currentSelection = selection;
  if (!selection) return;

  el.stopSearch.value = selection.stopName;
  draft = { ...selection };
  el.stopHint.textContent = "Sélection actuelle chargée.";
  updateValidateSection();
}

function onStopInput() {
  const query = el.stopSearch.value;
  draft.stopName = null;
  resetAfterStopPick();
  updateValidateSection();

  const q = normalizeForSearch(query.trim());
  if (q.length < 2) {
    renderStopSuggestions([], query);
    return;
  }

  const matches = [];
  for (const name of cachedStopNames) {
    if (normalizeForSearch(name).includes(q)) {
      matches.push(name);
      if (matches.length >= 20) break;
    }
  }
  renderStopSuggestions(matches, query);
}

async function init() {
  setStatus("");

  const { [STORAGE_KEYS.selection]: selection } = await getFromStorage([
    STORAGE_KEYS.selection,
  ]);
  if (selection && selection.stopName && selection.lineCode && selection.direction) {
    applyExistingSelection(selection);
  }

  try {
    await ensureStopsCacheLoaded();
  } catch (e) {
    console.error(e);
    el.stopHint.textContent =
      "Impossible de charger la liste d’arrêts (réseau/permission).";
  }

  el.stopSearch.addEventListener("input", onStopInput);
  el.validateBtn.addEventListener("click", validateSelection);
}

init();
