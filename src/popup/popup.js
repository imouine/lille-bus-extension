/*
 * Lille Bus Extension
 * Author: imouine
 * Copyright (c) 2026
 * License: GPL-3.0
 * https://github.com/imouine/lille-bus-extension
 *
 * Architecture :
 *   - schedules.json  -> source unique pour arrets / lignes / directions
 *   - API live        -> uniquement pour les minutes avant le prochain bus
 */

// --- Constantes ---------------------------------------------------------------

const LIVE_API_URL =
  "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Aprochains_passages/items?f=json";

const LINE_COLORS_API_URL =
  "https://data.lillemetropole.fr/data/ogcapi/collections/ilevia%3Acouleurs_lignes/items?f=json";

const STORAGE_KEYS = {
  selection:      "selection",
  lineColorsCache:"lineColorsCache",
  prefs:          "prefs",
  paused:         "paused",
};

// --- DOM ----------------------------------------------------------------------

const el = {
  stopSearch:       document.getElementById("stopSearch"),
  stopHint:         document.getElementById("stopHint"),
  stopResults:      document.getElementById("stopResults"),
  lineSection:      document.getElementById("lineSection"),
  lineResults:      document.getElementById("lineResults"),
  directionSection: document.getElementById("directionSection"),
  directionResults: document.getElementById("directionResults"),
  validateSection:  document.getElementById("validateSection"),
  summary:          document.getElementById("summary"),
  validateBtn:      document.getElementById("validateBtn"),
  status:           document.getElementById("status"),
  openOptionsBtn:   document.getElementById("openOptionsBtn"),
  pauseBtn:         document.getElementById("pauseBtn"),
  pauseBtnLabel:    document.getElementById("pauseBtnLabel"),
};

// --- i18n ---------------------------------------------------------------------

let prefs = { theme: "light", lang: "fr" };

const I18N = {
  fr: {
    label_stop:            "Arrêt",
    placeholder_stop:      "Tape le nom de l'arrêt",
    title_line:            "Ligne",
    title_direction:       "Sens",
    btn_validate:          "Valider",
    btn_settings:          "Préférences",
    btn_pause:             "Pause",
    btn_resume:            "Reprendre",
    hint_min_letters:      "Tape au moins 2 lettres.",
    hint_no_suggestion:    "Aucune suggestion.",
    hint_selection_loaded: "Sélection actuelle chargée.",
    status_saving:         "Enregistrement…",
    status_loading:        "Calcul en cours…",
    summary_template:      "Arrêt : {stop} — Ligne : {line} — Sens : {direction}",
    next_live:             "Prochain bus dans {min} min",
    next_theoretical:      "~{min} min (horaire théorique)",
    no_next:               "Aucun prochain passage trouvé.",
  },
  en: {
    label_stop:            "Stop",
    placeholder_stop:      "Type the stop name",
    title_line:            "Line",
    title_direction:       "Direction",
    btn_validate:          "Save",
    btn_settings:          "Preferences",
    btn_pause:             "Pause",
    btn_resume:            "Resume",
    hint_min_letters:      "Type at least 2 letters.",
    hint_no_suggestion:    "No suggestions.",
    hint_selection_loaded: "Current selection loaded.",
    status_saving:         "Saving…",
    status_loading:        "Calculating…",
    summary_template:      "Stop: {stop} — Line: {line} — Dir: {direction}",
    next_live:             "Next bus in {min} min",
    next_theoretical:      "~{min} min (scheduled)",
    no_next:               "No upcoming departure found.",
  },
};

function t(key, vars) {
  const lang = prefs.lang in I18N ? prefs.lang : "fr";
  let s = (I18N[lang] && I18N[lang][key]) || I18N.fr[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

// --- Prefs --------------------------------------------------------------------

async function loadPrefs() {
  const { [STORAGE_KEYS.prefs]: stored } = await chrome.storage.local.get([STORAGE_KEYS.prefs]);
  const theme = stored && (stored.theme === "dark" || stored.theme === "light") ? stored.theme : null;
  const lang  = stored && (stored.lang  === "en"   || stored.lang  === "fr")   ? stored.lang  : null;
  prefs.theme = theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  prefs.lang  = lang  || "fr";
}

function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
}

function applyLanguage() {
  document.documentElement.lang = prefs.lang;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.getAttribute("data-i18n"));
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    if (node instanceof HTMLInputElement) {
      node.placeholder = t(node.getAttribute("data-i18n-placeholder"));
    }
  }
}

// --- schedules.json -----------------------------------------------------------

/** @type {object|null} */
let _sched = null;

async function loadSchedules() {
  if (_sched !== null) return _sched;
  try {
    const res = await fetch(chrome.runtime.getURL("data/schedules.json"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _sched = await res.json();
  } catch (e) {
    console.error("loadSchedules:", e);
    _sched = null;
  }
  return _sched;
}

async function getStopNames() {
  const data = await loadSchedules();
  if (!data || !data.stops) return [];
  return Object.keys(data.stops).sort((a, b) => a.localeCompare(b, "fr"));
}

async function getLinesForStop(stopNorm) {
  const data = await loadSchedules();
  if (!data || !data.stops) return [];
  const entry = data.stops[stopNorm];
  if (!entry) return [];
  return Object.keys(entry).sort((a, b) => a.localeCompare(b, "fr"));
}

async function getDirections(stopNorm, lineCode) {
  const data = await loadSchedules();
  if (!data || !data.stops) return [];
  const lineEntry = data.stops[stopNorm]?.[lineCode];
  if (!lineEntry) return [];
  return Object.keys(lineEntry).sort((a, b) => a.localeCompare(b, "fr"));
}

async function nextTheoreticalMinutes(stopNorm, lineCode, direction) {
  const data = await loadSchedules();
  if (!data || !data.stops) return null;
  const dirEntry = data.stops[stopNorm]?.[lineCode]?.[direction];
  if (!dirEntry) return null;

  const wd = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", weekday: "long",
  }).format(new Date());
  const profile = wd === "samedi" ? "SATURDAY" : wd === "dimanche" ? "SUNDAY" : "WEEKDAY";
  const times = dirEntry[profile];
  if (!Array.isArray(times) || !times.length) return null;

  const nowStr = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
  const [hh, mm] = nowStr.split(":").map(Number);
  const nowMins = hh * 60 + mm;

  const next = times.find((tm) => tm >= nowMins) ?? times[0];
  return next >= nowMins ? next - nowMins : (next + 1440) - nowMins;
}

// --- API live -----------------------------------------------------------------

function noAccents(str) {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0152/g, "OE").replace(/\u0153/g, "oe")
    .replace(/\u00c6/g, "AE").replace(/\u00e6/g, "ae");
}

function cqlQuote(v) {
  return `'${String(v).replaceAll("'", "''")}'`;
}

async function fetchJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

function getTimeZoneOffsetMinutes(timeZone, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return (asUTC - date.getTime()) / 60000;
}

function parseIsoAsParisTime(isoLike) {
  const m = String(isoLike).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|[+-]\d{2}:\d{2})?$/
  );
  if (!m) return null;
  const localAsUTC = Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6],
    m[7] ? +m[7].padEnd(3, "0") : 0);
  let guess = new Date(localAsUTC);
  let offset = getTimeZoneOffsetMinutes("Europe/Paris", guess);
  let utc = localAsUTC - offset * 60000;
  const offset2 = getTimeZoneOffsetMinutes("Europe/Paris", new Date(utc));
  if (offset2 !== offset) utc = localAsUTC - offset2 * 60000;
  return utc;
}

function minutesFromRecord(record) {
  if (typeof record.cle_tri === "string") {
    const idx = record.cle_tri.lastIndexOf("/");
    if (idx !== -1) {
      const ts = Date.parse(record.cle_tri.slice(idx + 1));
      if (Number.isFinite(ts)) return Math.max(0, Math.ceil((ts - Date.now()) / 60000));
    }
  }
  if (typeof record.heure_estimee_depart === "string") {
    const tzMs = parseIsoAsParisTime(record.heure_estimee_depart);
    if (tzMs !== null) return Math.max(0, Math.ceil((tzMs - Date.now()) / 60000));
    const ts = Date.parse(record.heure_estimee_depart);
    if (Number.isFinite(ts)) return Math.max(0, Math.ceil((ts - Date.now()) / 60000));
  }
  return null;
}

/**
 * L'API MEL renvoie sens_ligne souvent abrégé ou différent du headsign GTFS.
 * Exemples de mismatches connus :
 *   'MARCQ FERME AUX OIES'        -> 'MARCQ EN BAROEUL FERME AUX OIES'
 *   'FACHES CENTRE COMMERCIAL'    -> 'FACHES THUMESNIL CTRE COMMERCIAL'
 *   'MARQUETTE LES VOILES'        -> 'MARQUETTE LEZ LILLE LES VOILES'
 *   "VILLENEUVE D'ASCQ ..."       -> 'VILLENEUVE D ASCQ ...'
 *
 * Stratégie : normaliser (accents, apostrophes, tirets -> espace) puis vérifier
 * que tous les mots significatifs (≥4 lettres) du sens_ligne API sont présents
 * dans la direction GTFS.
 */
function directionMatches(sens, gtfsDir) {
  if (!sens || !gtfsDir) return false;
  if (sens === gtfsDir) return true;

  // Normalise : accents, apostrophes/tirets -> espace, abréviations, puis split en mots
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

  // Mots significatifs = longueur >= 4 (ignore LE, LA, LES, DE, EN, DU…)
  const significant = sensWords.filter((w) => w.length >= 4);
  if (significant.length === 0) return false;

  // Tous les mots significatifs du sens_ligne doivent être dans la direction GTFS
  // (tolérance : début de mot pour les abréviations ex: CTRE ~ CENTRE)
  return significant.every((w) =>
    gtfsWords.has(w) || [...gtfsWords].some((g) => g.startsWith(w) || w.startsWith(g))
  );
}

async function fetchLiveMinutes(stopNorm, lineCode, direction) {
  // L'API MEL prefixe souvent les noms avec la ville ("LILLE PORTE DES POSTES"
  // au lieu de "PORTE DES POSTES"). On utilise LIKE '%NOM' pour couvrir les deux cas.
  const nameNorm = noAccents(stopNorm).toUpperCase();
  const filter = `nom_station LIKE ${cqlQuote("%" + nameNorm)}`;
  const url = new URL(LIVE_API_URL);
  url.searchParams.set("limit", "200");
  url.searchParams.set("filter", filter);
  const json = await fetchJson(url.toString());
  const records = Array.isArray(json.records) ? json.records : [];
  const matches = records.filter(
    (r) => r && r.code_ligne === lineCode && directionMatches(r.sens_ligne, direction)
  );
  let best = null;
  for (const r of matches) {
    const m = minutesFromRecord(r);
    if (m === null) continue;
    if (best === null || m < best) best = m;
  }
  return best;
}

// --- Couleurs de lignes -------------------------------------------------------

/** @type {Record<string, {bg: string, fg: string}>} */
let lineColors = {};

function normalizeHex(v) {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(s) ? `#${s.toUpperCase()}` : null;
}

async function loadLineColors() {
  const TTL = 30 * 24 * 60 * 60 * 1000;
  const { [STORAGE_KEYS.lineColorsCache]: cache } =
    await chrome.storage.local.get([STORAGE_KEYS.lineColorsCache]);
  if (cache && cache.colorsByCode && Date.now() - cache.updatedAt < TTL) {
    lineColors = cache.colorsByCode;
    return;
  }
  const url = new URL(LINE_COLORS_API_URL);
  url.searchParams.set("limit", "3000");
  const json = await fetchJson(url.toString());
  const records = Array.isArray(json.records) ? json.records : [];
  const next = {};
  for (const r of records) {
    if (!r) continue;
    const mode = (r.mode_transport || "").toUpperCase();
    if (mode && mode !== "BUS") continue;
    const bg = normalizeHex(r.couleur_fond_hexadecimal);
    const fg = normalizeHex(r.couleur_texte_hexadecimal);
    if (!bg && !fg) continue;
    for (const code of [r.code_ligne_public, r.code_ligne].filter(Boolean)) {
      next[String(code).trim().toUpperCase()] = { bg: bg || "", fg: fg || "" };
    }
  }
  lineColors = next;
  await chrome.storage.local.set({
    [STORAGE_KEYS.lineColorsCache]: { updatedAt: Date.now(), colorsByCode: next },
  });
}

// --- Etat ---------------------------------------------------------------------

let draft = { stopNorm: null, lineCode: null, direction: null };
/** @type {Array<{norm: string, searchNorm: string}>} */
let allStops = [];

// --- Helpers UI ---------------------------------------------------------------

function show(elem, v) { elem.classList.toggle("hidden", !v); }

function setStatus(text) { el.status.textContent = text || ""; }

function normalizeForSearch(s) {
  return String(s).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Convertit une clé UPPER (schedules.json) en affichage lisible.
 * "CHU EURASANTE" -> "Chu Eurasante"
 */
function toDisplayName(norm) {
  return norm.toLowerCase().replace(/(^|[\s-])(\S)/g, (_, sep, c) => sep + c.toUpperCase());
}

// --- Rendu --------------------------------------------------------------------

function renderStopSuggestions(items, query) {
  el.stopResults.innerHTML = "";
  if (!query || query.trim().length < 2) {
    el.stopHint.textContent = t("hint_min_letters");
    return;
  }
  el.stopHint.textContent = items.length ? "" : t("hint_no_suggestion");

  // Si un arrêt est déjà sélectionné, n'afficher que lui
  const visibleItems = draft.stopNorm
    ? items.filter((item) => item.norm === draft.stopNorm)
    : items.slice(0, 12);

  for (const item of visibleItems) {
    const li  = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = toDisplayName(item.norm);
    if (draft.stopNorm === item.norm) btn.classList.add("selected");
    btn.addEventListener("click", () => onPickStop(item.norm));
    li.appendChild(btn);
    el.stopResults.appendChild(li);
  }
}

function renderLineChoices(lines) {
  el.lineResults.innerHTML = "";

  // Si une ligne est déjà sélectionnée, n'afficher que celle-ci
  const visibleLines = draft.lineCode
    ? lines.filter((l) => l === draft.lineCode)
    : lines;

  for (const line of visibleLines) {
    const li  = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add("lineOption");
    btn.setAttribute("aria-label", `Ligne ${line}`);
    if (draft.lineCode === line) btn.classList.add("selected");

    const pill = document.createElement("span");
    pill.className = "linePill";
    pill.textContent = line;
    const colors = lineColors[line.toUpperCase()];
    if (colors && colors.bg) pill.style.backgroundColor = colors.bg;
    if (colors && colors.fg) pill.style.color = colors.fg;

    btn.appendChild(pill);
    btn.addEventListener("click", () => onPickLine(line));
    li.appendChild(btn);
    el.lineResults.appendChild(li);
  }
}

function renderDirectionChoices(directions) {
  el.directionResults.innerHTML = "";

  // Si une direction est déjà sélectionnée, n'afficher que celle-ci
  const visibleDirs = draft.direction
    ? directions.filter((d) => d === draft.direction)
    : directions;

  for (const dir of visibleDirs) {
    const li  = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = dir;
    if (draft.direction === dir) btn.classList.add("selected");
    btn.addEventListener("click", () => onPickDirection(dir));
    li.appendChild(btn);
    el.directionResults.appendChild(li);
  }
}

function updateSummary() {
  const ready = !!(draft.stopNorm && draft.lineCode && draft.direction);
  show(el.validateSection, ready);
  if (!ready) return;
  el.summary.textContent = t("summary_template", {
    stop:      toDisplayName(draft.stopNorm),
    line:      draft.lineCode,
    direction: draft.direction,
  });
}

// --- Affichage des minutes ----------------------------------------------------

async function showNextMinutes() {
  if (!draft.stopNorm || !draft.lineCode || !draft.direction) return;
  setStatus(t("status_loading"));

  let liveMin = null;
  try {
    liveMin = await fetchLiveMinutes(draft.stopNorm, draft.lineCode, draft.direction);
  } catch (_) { /* réseau indisponible -> fallback */ }

  if (liveMin !== null) {
    setStatus(t("next_live", { min: liveMin }));
    return;
  }

  const thMin = await nextTheoreticalMinutes(draft.stopNorm, draft.lineCode, draft.direction);
  setStatus(thMin !== null ? t("next_theoretical", { min: thMin }) : t("no_next"));
}

// --- Handlers -----------------------------------------------------------------

async function onPickStop(stopNorm) {
  // Clic sur l'arrêt déjà sélectionné → désélection, on réaffiche tout
  if (draft.stopNorm === stopNorm) {
    draft.stopNorm  = null;
    draft.lineCode  = null;
    draft.direction = null;
    show(el.lineSection, false);
    show(el.directionSection, false);
    show(el.validateSection, false);
    el.lineResults.innerHTML = "";
    el.directionResults.innerHTML = "";
    setStatus("");
    // Réaffiche toutes les suggestions
    const q = normalizeForSearch(el.stopSearch.value.trim());
    const prefix = [], contains = [];
    for (const s of allStops) {
      if (!s.searchNorm.includes(q)) continue;
      if (s.searchNorm.startsWith(q)) prefix.push(s);
      else contains.push(s);
      if (prefix.length + contains.length >= 60) break;
    }
    renderStopSuggestions(prefix.concat(contains), el.stopSearch.value);
    return;
  }

  draft.stopNorm  = stopNorm;
  draft.lineCode  = null;
  draft.direction = null;
  show(el.directionSection, false);
  show(el.validateSection, false);
  el.directionResults.innerHTML = "";
  setStatus("");
  const lines = await getLinesForStop(stopNorm);
  // Rend la liste avec seulement l'arrêt sélectionné visible
  const q = normalizeForSearch(el.stopSearch.value.trim());
  const prefix = [], contains = [];
  for (const s of allStops) {
    if (!s.searchNorm.includes(q)) continue;
    if (s.searchNorm.startsWith(q)) prefix.push(s);
    else contains.push(s);
    if (prefix.length + contains.length >= 60) break;
  }
  renderStopSuggestions(prefix.concat(contains), el.stopSearch.value);
  show(el.lineSection, true);
  renderLineChoices(lines);
}

async function onPickLine(lineCode) {
  // Clic sur la ligne déjà sélectionnée → désélection
  if (draft.lineCode === lineCode) {
    draft.lineCode  = null;
    draft.direction = null;
    show(el.directionSection, false);
    show(el.validateSection, false);
    el.directionResults.innerHTML = "";
    setStatus("");
    const lines = await getLinesForStop(draft.stopNorm);
    renderLineChoices(lines);
    return;
  }

  draft.lineCode  = lineCode;
  draft.direction = null;
  show(el.validateSection, false);
  el.directionResults.innerHTML = "";
  setStatus("");
  const directions = await getDirections(draft.stopNorm, lineCode);
  // Rend la liste avec seulement la ligne sélectionnée visible
  const lines = await getLinesForStop(draft.stopNorm);
  renderLineChoices(lines);
  show(el.directionSection, true);
  renderDirectionChoices(directions);
}

async function onPickDirection(direction) {
  // Clic sur la direction déjà sélectionnée → désélection
  if (draft.direction === direction) {
    draft.direction = null;
    show(el.validateSection, false);
    setStatus("");
    const directions = await getDirections(draft.stopNorm, draft.lineCode);
    renderDirectionChoices(directions);
    return;
  }

  draft.direction = direction;
  const directions = await getDirections(draft.stopNorm, draft.lineCode);
  renderDirectionChoices(directions);
  updateSummary();
  await showNextMinutes();
}

// --- Validation ---------------------------------------------------------------

async function validateSelection() {
  if (!draft.stopNorm || !draft.lineCode || !draft.direction) return;
  const selection = {
    stopName:  draft.stopNorm,
    stopLabel: toDisplayName(draft.stopNorm),
    lineCode:  draft.lineCode,
    direction: draft.direction,
  };
  setStatus(t("status_saving"));
  await chrome.storage.local.set({ [STORAGE_KEYS.selection]: selection });
  await chrome.runtime.sendMessage({ type: "selection:set", selection });
  window.close();
}

// --- Recherche ----------------------------------------------------------------

function onStopInput() {
  const query = el.stopSearch.value;
  draft.stopNorm  = null;
  draft.lineCode  = null;
  draft.direction = null;
  show(el.lineSection, false);
  show(el.directionSection, false);
  show(el.validateSection, false);
  el.lineResults.innerHTML = "";
  el.directionResults.innerHTML = "";
  setStatus("");
  const q = normalizeForSearch(query.trim());
  if (q.length < 2) { renderStopSuggestions([], query); return; }
  const prefix = [], contains = [];
  for (const s of allStops) {
    if (!s.searchNorm.includes(q)) continue;
    if (s.searchNorm.startsWith(q)) prefix.push(s);
    else contains.push(s);
    if (prefix.length + contains.length >= 60) break;
  }
  renderStopSuggestions(prefix.concat(contains), query);
}

// --- Init ---------------------------------------------------------------------

async function init() {
  await loadPrefs();
  applyTheme();
  applyLanguage();

  const [stopNames] = await Promise.all([
    getStopNames(),
    loadLineColors().catch(() => {}),
  ]);

  allStops = stopNames.map((norm) => ({ norm, searchNorm: normalizeForSearch(norm) }));

  const { [STORAGE_KEYS.selection]: sel } =
    await chrome.storage.local.get([STORAGE_KEYS.selection]);
  if (sel && sel.stopName && sel.lineCode && sel.direction) {
    draft = { stopNorm: sel.stopName, lineCode: sel.lineCode, direction: sel.direction };
    el.stopSearch.value = toDisplayName(sel.stopName);
    el.stopHint.textContent = t("hint_selection_loaded");
    updateSummary();
    showNextMinutes();
  }

  el.stopSearch.addEventListener("input", onStopInput);
  el.validateBtn.addEventListener("click", validateSelection);
  if (el.openOptionsBtn) {
    el.openOptionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
  }

  // --- Bouton pause/play ---
  const { [STORAGE_KEYS.paused]: pausedVal } =
    await chrome.storage.local.get([STORAGE_KEYS.paused]);
  let paused = pausedVal === true;

  function applyPauseUI() {
    el.pauseBtn.setAttribute("aria-pressed", String(paused));
    el.pauseBtn.setAttribute("aria-label", t(paused ? "btn_resume" : "btn_pause"));
    el.pauseBtnLabel.textContent = t(paused ? "btn_resume" : "btn_pause");
  }

  applyPauseUI();

  el.pauseBtn.addEventListener("click", async () => {
    paused = !paused;
    applyPauseUI();
    await chrome.runtime.sendMessage({ type: "badge:pause", paused });
  });
}

init();
