/*
 * Lille Bus Extension
 * Author: imouine
 * Copyright (c) 2026
 * License: GPL-3.0
 * https://github.com/imouine/lille-bus-extension
 */

const LIVE_API_URL =
  "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Aprochains_passages/items?f=json";

// Référentiel complet des arrêts (GTFS)
const STOPS_LIST_API_URL =
  "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Aarret_point/items?f=json";

// Mapping arrêt -> lignes (utile même hors service)
const STOPS_LINES_API_URL =
  "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Aphysical_stop/items?f=json";

const STORAGE_KEYS = {
  selection: "selection",
  stopsCache: "stopsCache",
  directionCache: "directionCache",
  regularBusStopsCache: "regularBusStopsCache",
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

/** @type {{stopName: string|null, stopLabel: string|null, lineCode: string|null, direction: string|null}} */
let draft = {
  stopName: null,
  stopLabel: null,
  lineCode: null,
  direction: null,
};

/** @type {{stopName: string, stopLabel?: string, lineCode: string, direction: string}|null} */
let currentSelection = null;

/** @type {Array<{label: string, canonical: string, norm: string}>} */
let cachedStops = [];

/** @type {Set<string>} */
let regularBusStopCanonicals = new Set();

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
  const url = new URL(LIVE_API_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function buildUrlFrom(baseUrl, params) {
  const url = new URL(baseUrl);
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
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function renderStopSuggestions(stopItems, query) {
  clearList(el.stopResults);

  if (!query || query.trim().length < 2) {
    el.stopHint.textContent = "Tape au moins 2 lettres.";
    return;
  }

  el.stopHint.textContent = stopItems.length
    ? ""
    : "Aucune suggestion (essaye un autre nom).";

  for (const item of stopItems.slice(0, 12)) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = item.label;
    btn.addEventListener("click", () => onPickStop(item));
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

  el.summary.textContent = `Arrêt: ${draft.stopLabel || draft.stopName} — Ligne: ${draft.lineCode} — Sens: ${draft.direction}`;
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
  // Cache 7j (référentiel très stable)
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;

  // Charge la liste des arrêts bus réguliers (pour filtrer tram + arrêts spéciaux)
  try {
    await ensureRegularBusStopsLoaded();
  } catch (e) {
    console.error(e);
    regularBusStopCanonicals = new Set();
  }

  const { [STORAGE_KEYS.stopsCache]: stopsCache } = await getFromStorage([
    STORAGE_KEYS.stopsCache,
  ]);

  if (stopsCache && typeof stopsCache.updatedAt === "number") {
    const fresh = Date.now() - stopsCache.updatedAt < TTL_MS;

    // Nouveau format: stopEntries [{label, canonical}]
    if (fresh && Array.isArray(stopsCache.stopEntries)) {
      cachedStops = stopsCache.stopEntries
        .filter((x) => x && typeof x.label === "string" && typeof x.canonical === "string")
        .filter(
          (x) =>
            regularBusStopCanonicals.size === 0 ||
            regularBusStopCanonicals.has(String(x.canonical).toUpperCase())
        )
        .map((x) => ({
          label: x.label,
          canonical: x.canonical,
          norm: normalizeForSearch(x.label),
        }));
      return;
    }

    // Ancien format: stopNames ["..."] -> on ignore pour migrer vers arret_point
  }

  setStatus("Chargement des arrêts (bus)…");

  // Pagination simple par offset
  const limit = 2000;
  let offset = 0;
  /** @type {Map<string, {label: string, canonical: string}>} */
  const byCanonical = new Map();
  let numberMatched = null;

  while (true) {
    const url = buildUrlFrom(STOPS_LIST_API_URL, { limit, offset });
    const json = await fetchJson(url);
    const records = Array.isArray(json.records) ? json.records : [];

    if (typeof json.numberMatched === "number" && numberMatched === null) {
      numberMatched = json.numberMatched;
    }

    for (const r of records) {
      // arret_point -> stop_name (casse “humaine”)
      if (r && typeof r.stop_name === "string") {
        const label = r.stop_name.trim();
        if (!label) continue;
        const canonical = label.toUpperCase();
        if (!byCanonical.has(canonical)) {
          byCanonical.set(canonical, { label, canonical });
        }
      }
    }

    offset += records.length;
    if (!records.length) break;
    if (numberMatched !== null && offset >= numberMatched) break;
    if (offset > 200000) break; // garde-fou
  }

  cachedStops = Array.from(byCanonical.values())
    .sort((a, b) => a.label.localeCompare(b.label, "fr"))
    .filter((x) => regularBusStopCanonicals.size === 0 || regularBusStopCanonicals.has(x.canonical))
    .map((x) => ({ ...x, norm: normalizeForSearch(x.label) }));

  await setInStorage({
    [STORAGE_KEYS.stopsCache]: {
      updatedAt: Date.now(),
      stopEntries: cachedStops.map(({ label, canonical }) => ({ label, canonical })),
    },
  });

  setStatus("");
}

async function fetchLiveStopRecords(stopName) {
  const filter = `nom_station=${cqlQuote(stopName)}`;
  const url = buildUrlFrom(LIVE_API_URL, { limit: 200, filter });
  const json = await fetchJson(url);
  return Array.isArray(json.records) ? json.records : [];
}

function splitLineCodes(value) {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function isRegularBusLineCode(code) {
  if (typeof code !== "string") return false;
  const c = code.trim().toUpperCase();
  if (!c) return false;

  // Exclusions
  if (c === "TRAM" || c === "METRO") return false;
  if (c.startsWith("N")) return false; // ex: N1 (spécial / remplacement)

  // Lignes "habituelles"
  return /^L\d+$/.test(c) || /^\d+$/.test(c) || /^CO\d+$/.test(c);
}

async function ensureRegularBusStopsLoaded() {
  // Cache 7j
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const { [STORAGE_KEYS.regularBusStopsCache]: cache } = await getFromStorage([
    STORAGE_KEYS.regularBusStopsCache,
  ]);

  if (
    cache &&
    typeof cache.updatedAt === "number" &&
    Array.isArray(cache.stopCanonicals) &&
    Date.now() - cache.updatedAt < TTL_MS
  ) {
    regularBusStopCanonicals = new Set(cache.stopCanonicals);
    return;
  }

  const limit = 2000;
  let offset = 0;
  let numberMatched = null;
  /** @type {Set<string>} */
  const canonicals = new Set();

  let supportsApiFilter = true;
  const apiFilter = `code_mode_de_transport=${cqlQuote("B")}`;

  while (true) {
    let json;
    try {
      const url = supportsApiFilter
        ? buildUrlFrom(STOPS_LINES_API_URL, { limit, offset, filter: apiFilter })
        : buildUrlFrom(STOPS_LINES_API_URL, { limit, offset });
      json = await fetchJson(url);
    } catch (e) {
      if (supportsApiFilter) {
        supportsApiFilter = false;
        continue;
      }
      throw e;
    }

    const records = Array.isArray(json.records) ? json.records : [];

    if (typeof json.numberMatched === "number" && numberMatched === null) {
      numberMatched = json.numberMatched;
    }

    for (const r of records) {
      if (!r) continue;
      if (
        typeof r.code_mode_de_transport === "string" &&
        r.code_mode_de_transport.toUpperCase() !== "B"
      ) {
        continue;
      }

      const stop =
        typeof r.nom_commercial_arret === "string" ? r.nom_commercial_arret.trim() : "";
      if (!stop) continue;

      const lineCodes = splitLineCodes(r.code_ligne_public || r.code_ligne);
      if (!lineCodes.some(isRegularBusLineCode)) continue;

      canonicals.add(stop.toUpperCase());
    }

    offset += records.length;
    if (!records.length) break;
    if (numberMatched !== null && offset >= numberMatched) break;
    if (offset > 200000) break;
  }

  regularBusStopCanonicals = canonicals;
  await setInStorage({
    [STORAGE_KEYS.regularBusStopsCache]: {
      updatedAt: Date.now(),
      stopCanonicals: Array.from(canonicals),
    },
  });
}

async function fetchStopLineCodes(stopName) {
  const candidates = [
    { field: "nom_commercial_arret", value: stopName },
    { field: "nom_court", value: stopName },
  ];

  for (const c of candidates) {
    try {
      const filter = `${c.field}=${cqlQuote(c.value)}`;
      const url = buildUrlFrom(STOPS_LINES_API_URL, { limit: 200, filter });
      const json = await fetchJson(url);
      const records = Array.isArray(json.records) ? json.records : [];

      const codes = [];
      for (const r of records) {
        const v = r && (r.code_ligne_public || r.code_ligne);
        codes.push(...splitLineCodes(v));
      }

      const lines = uniqueSorted(codes).filter(isRegularBusLineCode);
      if (lines.length) return lines;
    } catch (e) {
      console.error(e);
    }
  }

  return [];
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) =>
    String(a).localeCompare(String(b), "fr")
  );
}

async function onPickStop(stopItem) {
  const label = typeof stopItem === "string" ? stopItem : stopItem.label;
  const canonical =
    typeof stopItem === "string" ? stopItem.toUpperCase() : stopItem.canonical;

  draft.stopLabel = label;
  draft.stopName = canonical;
  el.stopSearch.value = label;

  resetAfterStopPick();
  setStatus("Chargement des lignes…");

  let lines = [];
  try {
    // Référentiel (toujours dispo, même hors service)
    lines = await fetchStopLineCodes(canonical);
  } catch (e) {
    console.error(e);
  }

  if (!lines.length) {
    // Fallback live (au cas où)
    try {
      stopLiveRecords = await fetchLiveStopRecords(canonical);
      lines = uniqueSorted(
        stopLiveRecords
          .map((r) => r && r.code_ligne)
          .filter((v) => typeof v === "string" && v.trim())
      ).filter(isRegularBusLineCode);
    } catch (e) {
      console.error(e);
      setStatus("Erreur réseau pendant le chargement des lignes.");
      return;
    }
  }

  show(el.lineSection, true);
  renderLineChoices(lines);
  setStatus(lines.length ? "" : "Aucune ligne trouvée pour cet arrêt.");
}

async function onPickLine(lineCode) {
  draft.lineCode = lineCode;
  draft.direction = null;

  const cacheKey = `${draft.stopName}||${lineCode}`;
  const { [STORAGE_KEYS.directionCache]: directionCache } = await getFromStorage([
    STORAGE_KEYS.directionCache,
  ]);

  let directions = [];

  try {
    // Live: récupère les sens réellement utilisés
    stopLiveRecords = await fetchLiveStopRecords(draft.stopName);
    directions = uniqueSorted(
      stopLiveRecords
        .filter((r) => r && r.code_ligne === lineCode)
        .map((r) => r && r.sens_ligne)
        .filter((v) => typeof v === "string" && v.trim())
    );
  } catch (e) {
    console.error(e);
  }

  // Si pas de service maintenant, fallback sur un cache de sens déjà vus.
  if (!directions.length && directionCache && Array.isArray(directionCache[cacheKey])) {
    directions = uniqueSorted(directionCache[cacheKey]);
  }

  // Si on a des sens live, on les met en cache.
  if (directions.length) {
    const next = { ...(directionCache || {}) };
    next[cacheKey] = directions;
    await setInStorage({ [STORAGE_KEYS.directionCache]: next });
  }

  if (!directions.length) {
    show(el.directionSection, false);
    clearList(el.directionResults);
    updateValidateSection();
    setStatus(
      "Pas de sens disponible maintenant (ligne hors service). Réessaie plus tard."
    );
    return;
  }

  show(el.directionSection, true);
  renderDirectionChoices(directions);
  updateValidateSection();
  setStatus("");
}

function onPickDirection(direction) {
  draft.direction = direction;
  updateValidateSection();
}

async function validateSelection() {
  if (!draft.stopName || !draft.lineCode || !draft.direction) return;

  const selection = {
    stopName: draft.stopName,
    stopLabel: draft.stopLabel || undefined,
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

  el.stopSearch.value = selection.stopLabel || selection.stopName;
  draft = {
    stopName: selection.stopName,
    stopLabel: selection.stopLabel || selection.stopName,
    lineCode: selection.lineCode,
    direction: selection.direction,
  };
  el.stopHint.textContent = "Sélection actuelle chargée.";
  updateValidateSection();
}

function onStopInput() {
  const query = el.stopSearch.value;
  draft.stopName = null;
  draft.stopLabel = null;
  resetAfterStopPick();
  updateValidateSection();

  const q = normalizeForSearch(query.trim());
  if (q.length < 2) {
    renderStopSuggestions([], query);
    return;
  }

  /** @type {Array<{label: string, canonical: string, norm: string}>} */
  const prefix = [];
  /** @type {Array<{label: string, canonical: string, norm: string}>} */
  const contains = [];

  for (const item of cachedStops) {
    if (!item.norm.includes(q)) continue;
    if (item.norm.startsWith(q)) prefix.push(item);
    else contains.push(item);
    if (prefix.length + contains.length >= 60) break;
  }

  renderStopSuggestions(prefix.concat(contains), query);
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
