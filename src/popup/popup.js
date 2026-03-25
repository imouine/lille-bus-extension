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
  selection:       "selection",
  lineColorsCache: "lineColorsCache",
  prefs:           "prefs",
  paused:          "paused",
  watchers:        "watchers",
  watcherResults:  "watcherResults",
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
  addWatcherBtn:    document.getElementById("addWatcherBtn"),
  watchersSection:  document.getElementById("watchersSection"),
  watchersList:     document.getElementById("watchersList"),
  clearWatchersBtn: document.getElementById("clearWatchersBtn"),
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
    btn_add:               "+ Ajouter",
    btn_settings:          "Préférences",
    btn_pause:             "Pause",
    btn_resume:            "Reprendre",
    label_watchers:        "Surveillés",
    btn_clear_all:         "Tout supprimer",
    hint_min_letters:      "Tape au moins 2 lettres.",
    hint_no_suggestion:    "Aucune suggestion.",
    hint_selection_loaded: "Sélection actuelle chargée.",
    status_saving:         "Enregistrement…",
    status_loading:        "Calcul en cours…",
    summary_template:      "Arrêt : {stop} — Ligne : {line} — Sens : {direction}",
    next_live:             "Prochain bus dans {min} min",
    next_best:             "Meilleur : {min} min (live)",
    next_theoretical:      "~{min} min (horaire théorique)",
    no_next:               "Aucun prochain passage trouvé.",
    status_paused:         "Actualisation en pause",
  },
  en: {
    label_stop:            "Stop",
    placeholder_stop:      "Type the stop name",
    title_line:            "Line",
    title_direction:       "Direction",
    btn_validate:          "Save",
    btn_add:               "+ Add",
    btn_settings:          "Preferences",
    btn_pause:             "Pause",
    btn_resume:            "Resume",
    label_watchers:        "Watching",
    btn_clear_all:         "Clear all",
    hint_min_letters:      "Type at least 2 letters.",
    hint_no_suggestion:    "No suggestions.",
    hint_selection_loaded: "Current selection loaded.",
    status_saving:         "Saving…",
    status_loading:        "Calculating…",
    summary_template:      "Stop: {stop} — Line: {line} — Dir: {direction}",
    next_live:             "Next bus in {min} min",
    next_best:             "Best: {min} min (live)",
    next_theoretical:      "~{min} min (scheduled)",
    no_next:               "No upcoming departure found.",
    status_paused:         "Refresh paused",
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

/** Retourne les stop_id GTFS pour une combinaison (arrêt, ligne, direction). */
async function getStopIds(stopNorm, lineCode, direction) {
  const data = await loadSchedules();
  if (!data?.stops) return [];
  return data.stops[stopNorm]?.[lineCode]?.[direction]?._stopIds ?? [];
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

let draft    = { stopNorm: null, lineCode: null, direction: null };
let allStops = [];
let watchers = [];
let isPaused = false; // miroir de l'état pause, accessible partout

// --- Helpers UI ---------------------------------------------------------------

function show(elem, v) { elem.classList.toggle("hidden", !v); }
function setStatus(text) { el.status.textContent = text || ""; }

async function saveWatchers() {
  await chrome.storage.local.set({ [STORAGE_KEYS.watchers]: watchers });
  if (watchers.length === 0) {
    await chrome.storage.local.remove([STORAGE_KEYS.selection]);
    // Notifie le service worker pour qu'il nettoie badge + résultats (sans refetch)
    await chrome.runtime.sendMessage({ type: "watchers:clear" }).catch(() => {});
  }
}

/**
 * Demande un refresh au service worker (1 seul appel API par watcher),
 * puis met à jour in-place les badges de temps dans la popup.
 * Pas de destruction/reconstruction du DOM, pas de double appel.
 */
async function refreshAndRender() {
  await chrome.runtime.sendMessage({ type: "badge:refresh" }).catch(() => {});
  await renderWatchers();
}

/** Retourne l'urgence CSS d'un nombre de minutes live ou théorique */
function timeUrgency(minutes, isLive) {
  if (!isLive) return "theoretical";
  if (minutes <= 1) return "now";
  if (minutes <= 5) return "soon";
  return "normal";
}

/** Crée ou met à jour le badge temps d'un watcher */
function setWatcherTimeBadge(badge, minutes, isLive) {
  if (minutes === null) {
    badge.removeAttribute("data-urgency");
    badge.innerHTML = `<span class="watcherTimeUnit">—</span>`;
    return;
  }
  badge.dataset.urgency = timeUrgency(minutes, isLive);
  if (isLive) {
    badge.innerHTML =
      `<span class="watcherTimeDot"></span>${minutes}<span class="watcherTimeUnit"> min</span>`;
  } else {
    badge.innerHTML =
      `<span class="watcherTimeUnit">~</span>${minutes}<span class="watcherTimeUnit"> min</span>`;
  }
}

/** Signature des watchers actuellement affichés — sert à détecter si on doit reconstruire le DOM */
let _renderedWatchersSig = "";

function watchersSig(list) {
  return list.map((w) => `${w.stopName}|${w.lineCode}|${w.direction}`).join(";;");
}

/**
 * Construit ou met à jour la liste des watchers.
 * - Reconstruit le DOM uniquement si la composition a changé (ajout/suppression)
 * - Sinon, met à jour les badges de temps in-place (pas de flash)
 */
async function renderWatchers() {
  show(el.watchersSection, watchers.length > 0);
  if (watchers.length === 0) {
    el.watchersList.innerHTML = "";
    _renderedWatchersSig = "";
    return;
  }

  const newSig = watchersSig(watchers);
  const structureChanged = (newSig !== _renderedWatchersSig);

  // Lit les résultats déjà calculés par le service worker (0 appel API)
  const { [STORAGE_KEYS.watcherResults]: stored } =
    await chrome.storage.local.get([STORAGE_KEYS.watcherResults]);
  const results = Array.isArray(stored) ? stored : [];

  if (structureChanged) {
    // Reconstruction complète du DOM
    el.watchersList.innerHTML = "";
    _renderedWatchersSig = newSig;

    for (let i = 0; i < watchers.length; i++) {
      const w  = watchers[i];
      const li = document.createElement("li");
      li.className = "watcherItem";
      li.dataset.idx = String(i);

      // Col 1 — pill ligne
      const pill = document.createElement("span");
      pill.className = "linePill watcherPill";
      pill.textContent = w.lineCode;
      const colors = lineColors[w.lineCode.toUpperCase()];
      if (colors?.bg) pill.style.backgroundColor = colors.bg;
      if (colors?.fg) pill.style.color           = colors.fg;
      li.appendChild(pill);

      // Col 2 — arrêt + direction
      const stopEl = document.createElement("span");
      stopEl.className   = "watcherStop";
      stopEl.textContent = toDisplayName(w.stopName);
      stopEl.title       = toDisplayName(w.stopName);
      li.appendChild(stopEl);

      const dirEl = document.createElement("span");
      dirEl.className   = "watcherDir";
      dirEl.textContent = `→ ${w.direction}`;
      dirEl.title       = w.direction;
      li.appendChild(dirEl);

      // Col 3 — badge temps
      const right = document.createElement("div");
      right.className = "watcherRight";
      const timeBadge = document.createElement("span");
      timeBadge.className = "watcherTime";
      timeBadge.dataset.watcherTime = String(i);
      right.appendChild(timeBadge);
      li.appendChild(right);

      // Bouton × — positionné en absolu haut-droite de l'item
      const rm = document.createElement("button");
      rm.className   = "watcherRemove";
      rm.type        = "button";
      rm.textContent = "×";
      rm.setAttribute("aria-label", "Supprimer");
      rm.addEventListener("click", async () => {
        watchers.splice(i, 1);
        await saveWatchers();
        await renderWatchers();
      });
      li.appendChild(rm);

      el.watchersList.appendChild(li);
    }
  }

  // Mise à jour in-place des badges de temps (pas de reconstruction DOM)
  const badges = el.watchersList.querySelectorAll("[data-watcher-time]");
  for (const badge of badges) {
    const idx = parseInt(badge.dataset.watcherTime, 10);
    if (isPaused) {
      badge.dataset.urgency = "theoretical";
      badge.innerHTML = `<span>II</span>`;
    } else {
      const res = results[idx] ?? null;
      if (res) {
        setWatcherTimeBadge(badge, res.minutes, res.isLive);
      } else {
        badge.innerHTML = `<span>…</span>`;
      }
    }
  }
}

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
  setStatus("");
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

async function addWatcher() {
  if (!draft.stopNorm || !draft.lineCode || !draft.direction) return;
  const stopIds = await getStopIds(draft.stopNorm, draft.lineCode, draft.direction);
  const w = { stopName: draft.stopNorm, lineCode: draft.lineCode, direction: draft.direction, stopIds };
  // Évite les doublons
  const exists = watchers.some(
    (x) => x.stopName === w.stopName && x.lineCode === w.lineCode && x.direction === w.direction
  );
  if (!exists) {
    watchers.push(w);
    await saveWatchers();
    await refreshAndRender();
  }
  // Réinitialise le draft pour permettre d'en ajouter un autre
  draft = { stopNorm: null, lineCode: null, direction: null };
  el.stopSearch.value = "";
  el.stopHint.textContent = "";
  el.stopResults.innerHTML = "";
  show(el.lineSection, false);
  show(el.directionSection, false);
  show(el.validateSection, false);
  el.lineResults.innerHTML = "";
  el.directionResults.innerHTML = "";
  setStatus("");
}

async function validateSelection() {
  if (!draft.stopNorm || !draft.lineCode || !draft.direction) return;
  const stopIds = await getStopIds(draft.stopNorm, draft.lineCode, draft.direction);
  // "Valider" = remplace tout par ce seul watcher
  watchers = [{ stopName: draft.stopNorm, lineCode: draft.lineCode, direction: draft.direction, stopIds }];
  setStatus(t("status_saving"));
  await saveWatchers();
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

  // Charge les watchers (nouveau format) ou migration one-shot depuis l'ancien format selection
  const stored = await chrome.storage.local.get([STORAGE_KEYS.watchers, STORAGE_KEYS.selection, STORAGE_KEYS.paused]);
  if (Array.isArray(stored[STORAGE_KEYS.watchers])) {
    watchers = stored[STORAGE_KEYS.watchers];
  } else if (stored[STORAGE_KEYS.selection]?.stopName) {
    const sel = stored[STORAGE_KEYS.selection];
    watchers = [{ stopName: sel.stopName, lineCode: sel.lineCode, direction: sel.direction }];
    await chrome.storage.local.set({ [STORAGE_KEYS.watchers]: watchers });
  }

  // Enrichit les watchers legacy qui n'ont pas de stopIds
  let needsSave = false;
  for (const w of watchers) {
    if (!Array.isArray(w.stopIds) || w.stopIds.length === 0) {
      w.stopIds = await getStopIds(w.stopName, w.lineCode, w.direction);
      if (w.stopIds.length > 0) needsSave = true;
    }
  }
  if (needsSave) await chrome.storage.local.set({ [STORAGE_KEYS.watchers]: watchers });

  // Initialise isPaused avant le premier rendu
  isPaused = stored[STORAGE_KEYS.paused] === true;

  // Refresh immédiat : demande au service worker de fetcher puis lit les résultats
  if (watchers.length > 0) {
    await refreshAndRender();
  } else {
    await renderWatchers(); // affiche juste la section vide
  }

  // --- Auto-refresh de la popup ---
  // La popup prend le contrôle du refresh : on suspend l'alarme du SW
  // pour éviter les doubles appels. Elle est réactivée à la fermeture.
  await chrome.runtime.sendMessage({ type: "popup:opened" }).catch(() => {});

  const REFRESH_STEPS_MS   = [5000, 10000, 15000, 30000, 60000];
  const DEFAULT_REFRESH_MS = 30000;
  const { [STORAGE_KEYS.prefs]: prefsStored } =
    await chrome.storage.local.get([STORAGE_KEYS.prefs]);
  const refreshIdx = prefsStored?.refreshIdx;
  const intervalMs = (Number.isInteger(refreshIdx) && refreshIdx >= 0 && refreshIdx < REFRESH_STEPS_MS.length)
    ? REFRESH_STEPS_MS[refreshIdx]
    : DEFAULT_REFRESH_MS;

  const popupRefreshTimer = setInterval(async () => {
    if (watchers.length === 0 || isPaused) return;
    await refreshAndRender();
  }, intervalMs);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      clearInterval(popupRefreshTimer);
      // Réactive l'alarme du SW quand la popup se ferme
      chrome.runtime.sendMessage({ type: "popup:closed" }).catch(() => {});
    }
  });

  el.stopSearch.addEventListener("input", onStopInput);
  el.validateBtn.addEventListener("click", validateSelection);
  el.addWatcherBtn.addEventListener("click", addWatcher);
  if (el.openOptionsBtn) {
    el.openOptionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
  }
  if (el.clearWatchersBtn) {
    el.clearWatchersBtn.addEventListener("click", async () => {
      watchers = [];
      await saveWatchers();
      await renderWatchers();
    });
  }

  // --- Bouton pause/play ---
  // isPaused est déjà initialisé dans le stored groupé ci-dessus

  function applyPauseUI() {
    el.pauseBtn.setAttribute("aria-pressed", String(isPaused));
    el.pauseBtn.setAttribute("aria-label", t(isPaused ? "btn_resume" : "btn_pause"));
    el.pauseBtnLabel.textContent = t(isPaused ? "btn_resume" : "btn_pause");
  }

  applyPauseUI();

  el.pauseBtn.addEventListener("click", async () => {
    isPaused = !isPaused;
    applyPauseUI();
    await chrome.runtime.sendMessage({ type: "badge:pause", paused: isPaused });
    // Met à jour la popup immédiatement sans attendre l'intervalle
    await renderWatchers();
  });
}

init();
