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

// Couleurs (sert de “logo”/badge pour les lignes)
const LINE_COLORS_API_URL =
  "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Acouleurs_lignes/items?f=json";

const STORAGE_KEYS = {
  selection: "selection",
  stopsCache: "stopsCache",
  directionCache: "directionCache",
  regularBusStopsCache: "regularBusStopsCache",
  lineColorsCache: "lineColorsCache",
  prefs: "prefs",
};

// Incrémenter cette valeur quand la logique de filtrage des lignes/arrêts change,
// pour forcer un recalcul des deux caches dépendants.
const REGULAR_BUS_VERSION = 4;

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
  openOptionsBtn: document.getElementById("openOptionsBtn"),
};

/** @type {{theme: "light"|"dark", lang: "fr"|"en"}} */
let prefs = { theme: "light", lang: "fr" };

/** @type {{status: null | {type: "key", key: string, vars?: any} | {type: "text", text: string}, stopHint: null | {type: "key", key: string, vars?: any} | {type: "text", text: string}}} */
let lastDynamic = { status: null, stopHint: null };

const I18N = {
  fr: {
    label_stop: "Arrêt",
    placeholder_stop: "Tape le nom de l’arrêt",
    title_line: "Ligne",
    title_direction: "Sens",
    btn_validate: "Valider",
    btn_settings: "Préférences",

    hint_min_letters: "Tape au moins 2 lettres.",
    hint_no_suggestion: "Aucune suggestion (essaye un autre nom).",
    status_loading_stops: "Chargement des arrêts (bus)…",
    status_loading_lines: "Chargement des lignes…",
    status_no_lines: "Aucune ligne trouvée pour cet arrêt.",
    status_lines_network_error: "Erreur réseau pendant le chargement des lignes.",
    status_no_directions: "Pas de sens disponible maintenant (ligne hors service). Réessaie plus tard.",
    status_saving: "Enregistrement…",
    hint_selection_loaded: "Sélection actuelle chargée.",
    hint_stops_load_failed: "Impossible de charger la liste d’arrêts (réseau/permission).",
    summary_template: "Arrêt: {stop} — Ligne: {line} — Sens: {direction}",
  },
  en: {
    label_stop: "Stop",
    placeholder_stop: "Type the stop name",
    title_line: "Line",
    title_direction: "Direction",
    btn_validate: "Save",
    btn_settings: "Preferences",

    hint_min_letters: "Type at least 2 letters.",
    hint_no_suggestion: "No suggestions (try another name).",
    status_loading_stops: "Loading stops (bus)…",
    status_loading_lines: "Loading lines…",
    status_no_lines: "No line found for this stop.",
    status_lines_network_error: "Network error while loading lines.",
    status_no_directions: "No direction available right now (line not running). Try later.",
    status_saving: "Saving…",
    hint_selection_loaded: "Current selection loaded.",
    hint_stops_load_failed: "Unable to load stops list (network/permission).",
    summary_template: "Stop: {stop} — Line: {line} — Direction: {direction}",
  },
};

function t(key, vars) {
  const lang = prefs.lang in I18N ? prefs.lang : "fr";
  let s = (I18N[lang] && I18N[lang][key]) || I18N.fr[key] || key;
  if (vars && typeof vars === "object") {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
}

function applyLanguage() {
  document.documentElement.lang = prefs.lang;

  // textContent
  for (const node of document.querySelectorAll("[data-i18n]")) {
    const k = node.getAttribute("data-i18n");
    if (!k) continue;
    node.textContent = t(k);
  }

  // placeholders
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    const k = node.getAttribute("data-i18n-placeholder");
    if (!k) continue;
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      node.placeholder = t(k);
    }
  }

  // Recalcul des textes dynamiques
  updateValidateSection();
  refreshDynamicTexts();
}

function refreshDynamicTexts() {
  if (lastDynamic.stopHint) {
    if (lastDynamic.stopHint.type === "key") {
      el.stopHint.textContent = t(lastDynamic.stopHint.key, lastDynamic.stopHint.vars);
    } else {
      el.stopHint.textContent = lastDynamic.stopHint.text;
    }
  }

  if (lastDynamic.status) {
    if (lastDynamic.status.type === "key") {
      el.status.textContent = t(lastDynamic.status.key, lastDynamic.status.vars);
    } else {
      el.status.textContent = lastDynamic.status.text;
    }
  }
}

async function loadPrefs() {
  const { [STORAGE_KEYS.prefs]: stored } = await getFromStorage([STORAGE_KEYS.prefs]);
  const theme = stored && (stored.theme === "dark" || stored.theme === "light") ? stored.theme : null;
  const lang = stored && (stored.lang === "en" || stored.lang === "fr") ? stored.lang : null;

  if (theme) prefs.theme = theme;
  else prefs.theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

  if (lang) prefs.lang = lang;
  else prefs.lang = "fr";
}

async function savePrefs() {
  await setInStorage({ [STORAGE_KEYS.prefs]: prefs });
}

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
/** Index inverse: chaque token (>=4 lettres, sans accents) de chaque canonical du set */
let regularBusStopTokens = new Set();

/** @type {Array<any>} */
let stopLiveRecords = [];

/** @type {Record<string, {bg: string, fg: string}>} */
let lineColorsByCode = {};

function setStatusText(message) {
  const text = message || "";
  el.status.textContent = text;
  lastDynamic.status = text ? { type: "text", text } : null;
}

function setStatusKey(key, vars) {
  el.status.textContent = t(key, vars);
  lastDynamic.status = { type: "key", key, vars };
}

function setStopHintText(message) {
  const text = message || "";
  el.stopHint.textContent = text;
  lastDynamic.stopHint = text ? { type: "text", text } : null;
}

function setStopHintKey(key, vars) {
  el.stopHint.textContent = t(key, vars);
  lastDynamic.stopHint = { type: "key", key, vars };
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

/** Supprime les diacritiques : 'EURASANTÉ' → 'EURASANTE', 'Œil' → 'OEil' */
function noAccents(str) {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Œ/g, "OE")
    .replace(/œ/g, "oe")
    .replace(/Æ/g, "AE")
    .replace(/æ/g, "ae");
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
    setStopHintKey("hint_min_letters");
    return;
  }

  if (stopItems.length) setStopHintText("");
  else setStopHintKey("hint_no_suggestion");

  for (const item of stopItems.slice(0, 12)) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = item.label;
    if (draft.stopName && item.canonical === draft.stopName) btn.classList.add("selected");
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
    btn.classList.add("lineOption");
    btn.setAttribute("aria-label", `Ligne ${line}`);
    if (draft.lineCode === line) btn.classList.add("selected");

    const pill = document.createElement("span");
    pill.className = "linePill";
    pill.textContent = line;

    const colors = lineColorsByCode[String(line).toUpperCase()];
    if (colors && colors.bg) pill.style.backgroundColor = colors.bg;
    if (colors && colors.fg) pill.style.color = colors.fg;

    btn.appendChild(pill);
    btn.addEventListener("click", () => onPickLine(line));
    li.appendChild(btn);
    el.lineResults.appendChild(li);
  }
}

function normalizeHexColor(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
  return `#${v.toUpperCase()}`;
}

async function ensureLineColorsLoaded() {
  // Cache 30j
  const TTL_MS = 30 * 24 * 60 * 60 * 1000;

  const { [STORAGE_KEYS.lineColorsCache]: cache } = await getFromStorage([
    STORAGE_KEYS.lineColorsCache,
  ]);

  if (
    cache &&
    typeof cache.updatedAt === "number" &&
    cache.colorsByCode &&
    typeof cache.colorsByCode === "object" &&
    Date.now() - cache.updatedAt < TTL_MS
  ) {
    lineColorsByCode = cache.colorsByCode;
    return;
  }

  const json = await fetchJson(buildUrlFrom(LINE_COLORS_API_URL, { limit: 3000 }));
  const records = Array.isArray(json.records) ? json.records : [];

  /** @type {Record<string, {bg: string, fg: string}>} */
  const next = {};
  for (const r of records) {
    if (!r) continue;

    const mode = typeof r.mode_transport === "string" ? r.mode_transport.toUpperCase() : "";
    if (mode && mode !== "BUS") continue;

    const bg = normalizeHexColor(r.couleur_fond_hexadecimal);
    const fg = normalizeHexColor(r.couleur_texte_hexadecimal);
    if (!bg && !fg) continue;

    const codes = [r.code_ligne_public, r.code_ligne]
      .map((v) => (v === undefined || v === null ? "" : String(v).trim()))
      .filter(Boolean);

    for (const c of codes) {
      next[c.toUpperCase()] = { bg: bg || "", fg: fg || "" };
    }
  }

  lineColorsByCode = next;
  await setInStorage({
    [STORAGE_KEYS.lineColorsCache]: {
      updatedAt: Date.now(),
      colorsByCode: next,
    },
  });
}

function renderDirectionChoices(directions) {
  clearList(el.directionResults);
  for (const direction of directions) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = direction;
    if (draft.direction === direction) btn.classList.add("selected");
    btn.addEventListener("click", () => onPickDirection(direction));
    li.appendChild(btn);
    el.directionResults.appendChild(li);
  }
}

function updateValidateSection() {
  const ready = !!(draft.stopName && draft.lineCode && draft.direction);
  show(el.validateSection, ready);
  if (!ready) return;

  el.summary.textContent = t("summary_template", {
    stop: draft.stopLabel || draft.stopName,
    line: draft.lineCode,
    direction: draft.direction,
  });
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

/**
 * Vérifie si un canonical d'arret_point est couvert par regularBusStopCanonicals.
 * Essaie 3 stratégies pour compenser les désalignements de noms entre les deux datasets :
 *  1. Match exact (ex: "CHU EURASANTE" === "CHU EURASANTE")
 *  2. Match sans accents (ex: "CHU EURASANTÉ" -> "CHU EURASANTE")
 *  3. Match par token: un mot du canonical figure dans le set (ex: "LILLE EUROPE" -> "EUROPE")
 */
function isStopInRegularSet(canonical) {
  if (regularBusStopCanonicals.size === 0) return true; // set vide = pas de filtre

  const upper = String(canonical).toUpperCase();

  // 1. Exact (avec accents)
  if (regularBusStopCanonicals.has(upper)) return true;

  // 2. Sans accents (ex: 'CHU EURASANTÉ' -> 'CHU EURASANTE')
  const stripped = upper.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (regularBusStopCanonicals.has(stripped)) return true;

  // 3. Token : au moins 2 tokens significatifs (>=4 lettres) présents dans l'index,
  //    OU exactement 1 token long (>=6 lettres) présent dans l'index.
  //    Évite les faux positifs sur des mots communs courts comme "GARE", "PONT", etc.
  const tokens = stripped.split(/[\s\-,']+/).filter((t) => t.length >= 4);
  const matchingTokens = tokens.filter((tok) => regularBusStopTokens.has(tok));
  if (matchingTokens.length >= 2) return true;
  if (matchingTokens.length === 1 && matchingTokens[0].length >= 6) return true;

  return false;
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
        .filter((x) => isStopInRegularSet(x.canonical))
        .map((x) => ({
          label: x.label,
          canonical: x.canonical,
          norm: normalizeForSearch(x.label),
        }));
      return;
    }

    // Ancien format: stopNames ["..."] -> on ignore pour migrer vers arret_point
  }

  setStatusKey("status_loading_stops");

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
    .filter((x) => isStopInRegularSet(x.canonical))
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
  // L'API MEL rejette les accents dans les filtres CQL → on les supprime
  const filter = `nom_station=${cqlQuote(noAccents(stopName).toUpperCase())}`;
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

  // Exclusions explicites uniquement
  if (c === "TRAM" || c === "METRO") return false;
  if (/^N\d/.test(c)) return false; // ex: N1, N2 (lignes de nuit spéciales)

  // Tout le reste = ligne de bus régulière ou commerciale
  return true;
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
    cache.version === REGULAR_BUS_VERSION &&
    Date.now() - cache.updatedAt < TTL_MS
  ) {
    regularBusStopCanonicals = new Set(cache.stopCanonicals);
    // Reconstruire l'index de tokens depuis le cache
    const tokens = new Set();
    for (const name of cache.stopCanonicals) {
      for (const tok of name.split(/[\s\-,']+/)) {
        if (tok.length >= 4) tokens.add(tok);
      }
    }
    regularBusStopTokens = tokens;
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

      const upperStop = stop.toUpperCase();
      canonicals.add(upperStop);
      // Ajouter aussi la version sans accents pour couvrir les désalignements
      // entre physical_stop ('EURASANTE') et arret_point ('Chu Eurasanté' -> 'CHU EURASANTÉ')
      const upperNoAccents = upperStop
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
      if (upperNoAccents !== upperStop) canonicals.add(upperNoAccents);
    }

    offset += records.length;
    if (!records.length) break;
    if (numberMatched !== null && offset >= numberMatched) break;
    if (offset > 200000) break;
  }

  // Construire l'index de tokens : chaque mot >=4 lettres de chaque canonical
  const tokens = new Set();
  for (const name of canonicals) {
    for (const tok of name.split(/[\s\-,']+/)) {
      if (tok.length >= 4) tokens.add(tok);
    }
  }
  regularBusStopTokens = tokens;

  regularBusStopCanonicals = canonicals;
  await setInStorage({
    [STORAGE_KEYS.regularBusStopsCache]: {
      updatedAt: Date.now(),
      version: REGULAR_BUS_VERSION,
      stopCanonicals: Array.from(canonicals),
    },
    // Invalider stopsCache pour forcer un recalcul avec la nouvelle logique de filtrage
    [STORAGE_KEYS.stopsCache]: null,
  });
}

async function fetchStopLineCodes(stopName) {
  // Variante sans accents (physical_stop stocke parfois sans accents ex: EURASANTE vs EURASANTÉ)
  const stopNameNoAccents = String(stopName)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  const candidates = [
    { field: "nom_commercial_arret", value: stopName },
    { field: "nom_court", value: stopName },
  ];

  // Ajouter le candidat sans accents seulement s'il diffère
  if (stopNameNoAccents !== stopName) {
    candidates.push({ field: "nom_commercial_arret", value: stopNameNoAccents });
    candidates.push({ field: "nom_court", value: stopNameNoAccents });
  }

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
  // Marquer visuellement l'arrêt sélectionné
  el.stopResults.querySelectorAll("button").forEach((b) => b.classList.remove("selected"));
  // Le bouton cliqué est retrouvé via le label
  for (const btn of el.stopResults.querySelectorAll("button")) {
    if (btn.textContent === stopItem.label) { btn.classList.add("selected"); break; }
  }
  const label = typeof stopItem === "string" ? stopItem : stopItem.label;
  const canonical =
    typeof stopItem === "string" ? stopItem.toUpperCase() : stopItem.canonical;

  draft.stopLabel = label;
  draft.stopName = canonical;
  el.stopSearch.value = label;

  resetAfterStopPick();
  setStatusKey("status_loading_lines");

  let lines = [];

  // Priorité 1 : live (toujours complet et à jour)
  try {
    stopLiveRecords = await fetchLiveStopRecords(canonical);
    lines = uniqueSorted(
      stopLiveRecords
        .map((r) => r && r.code_ligne)
        .filter((v) => typeof v === "string" && v.trim())
    ).filter(isRegularBusLineCode);
  } catch (e) {
    console.error(e);
  }

  // Priorité 2 : référentiel physical_stop (si hors service → live vide)
  if (!lines.length) {
    try {
      lines = await fetchStopLineCodes(canonical);
    } catch (e) {
      console.error(e);
      setStatusKey("status_lines_network_error");
      return;
    }
    // On vide stopLiveRecords pour forcer un rafraîchissement dans onPickLine
    stopLiveRecords = [];
  }

  show(el.lineSection, true);
  renderLineChoices(lines);
  if (lines.length) setStatusText("");
  else setStatusKey("status_no_lines");
}

async function onPickLine(lineCode) {
  // Marquer visuellement la ligne sélectionnée
  el.lineResults.querySelectorAll("button").forEach((b) => b.classList.remove("selected"));
  for (const btn of el.lineResults.querySelectorAll("button")) {
    if (btn.getAttribute("aria-label") === `Ligne ${lineCode}`) { btn.classList.add("selected"); break; }
  }

  draft.lineCode = lineCode;
  draft.direction = null;

  const cacheKey = `${draft.stopName}||${lineCode}`;
  console.log("[onPickLine] stopName=", draft.stopName, "lineCode=", lineCode, "cacheKey=", cacheKey);

  const { [STORAGE_KEYS.directionCache]: directionCache } = await getFromStorage([
    STORAGE_KEYS.directionCache,
  ]);
  console.log("[onPickLine] directionCache entry=", directionCache?.[cacheKey]);

  let directions = [];

  try {
    console.log("[onPickLine] stopLiveRecords.length before=", stopLiveRecords.length);
    if (!stopLiveRecords.length) {
      console.log("[onPickLine] fetching live records for", draft.stopName);
      stopLiveRecords = await fetchLiveStopRecords(draft.stopName);
    }
    console.log("[onPickLine] stopLiveRecords.length after=", stopLiveRecords.length);
    console.log("[onPickLine] all code_ligne values=", stopLiveRecords.map(r => r?.code_ligne));

    directions = uniqueSorted(
      stopLiveRecords
        .filter((r) => r && r.code_ligne === lineCode)
        .map((r) => r && r.sens_ligne)
        .filter((v) => typeof v === "string" && v.trim())
    );
    console.log("[onPickLine] directions from live=", directions);
  } catch (e) {
    console.error("[onPickLine] live fetch error:", e);
  }

  if (
    !directions.length &&
    directionCache &&
    Array.isArray(directionCache[cacheKey]) &&
    directionCache[cacheKey].length > 0
  ) {
    directions = uniqueSorted(directionCache[cacheKey]);
    console.log("[onPickLine] directions from cache=", directions);
  }

  if (directions.length) {
    const next = { ...(directionCache || {}) };
    next[cacheKey] = directions;
    await setInStorage({ [STORAGE_KEYS.directionCache]: next });
  }

  if (!directions.length) {
    console.warn("[onPickLine] NO directions found — showing 'hors service'");
    show(el.directionSection, false);
    clearList(el.directionResults);
    updateValidateSection();
    setStatusKey("status_no_directions");
    return;
  }

  show(el.directionSection, true);
  renderDirectionChoices(directions);
  updateValidateSection();
  setStatusText("");
}

function onPickDirection(direction) {
  // Marquer visuellement le sens sélectionné
  el.directionResults.querySelectorAll("button").forEach((b) => b.classList.remove("selected"));
  for (const btn of el.directionResults.querySelectorAll("button")) {
    if (btn.textContent === direction) { btn.classList.add("selected"); break; }
  }

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

  setStatusKey("status_saving");

  await setInStorage({ [STORAGE_KEYS.selection]: selection });
  await chrome.runtime.sendMessage({ type: "selection:set", selection });

  currentSelection = selection;
  // Ferme le popup après validation
  window.close();
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
  setStopHintKey("hint_selection_loaded");
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

async function purgeBadDirectionCache() {
  // Supprime les entrées vides du directionCache (bug corrigé: on ne sauvegardait pas vide,
  // mais des sessions précédentes ont pu sauvegarder [] et bloquer le fallback live).
  try {
    const { [STORAGE_KEYS.directionCache]: dc } = await getFromStorage([STORAGE_KEYS.directionCache]);
    if (!dc || typeof dc !== "object") return;
    const cleaned = Object.fromEntries(
      Object.entries(dc).filter(([, v]) => Array.isArray(v) && v.length > 0)
    );
    if (Object.keys(cleaned).length !== Object.keys(dc).length) {
      await setInStorage({ [STORAGE_KEYS.directionCache]: cleaned });
    }
  } catch (e) {
    console.error(e);
  }
}

async function init() {
  setStatusText("");

  await loadPrefs();
  applyTheme();
  applyLanguage();

  // Purge les entrées vides du cache direction (bug corrigé dans cette version)
  await purgeBadDirectionCache();

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
    setStopHintKey("hint_stops_load_failed");
  }

  // Optionnel: sert juste à afficher des badges colorés pour les lignes.
  try {
    await ensureLineColorsLoaded();
  } catch (e) {
    console.error(e);
    lineColorsByCode = {};
  }

  if (el.openOptionsBtn) {
    el.openOptionsBtn.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
  }

  el.stopSearch.addEventListener("input", onStopInput);
  el.validateBtn.addEventListener("click", validateSelection);
}

init();
