/**
 * Lille Bus Extension — Popup
 *
 * Responsibilities:
 *   - Display the stop/line/direction picker (data from schedules.json)
 *   - Manage the watchlist (add, remove, clear)
 *   - Show live countdowns per watcher (data from service worker via storage)
 *   - Drive refresh cycles while the popup is open (via badge:refresh messages)
 *   - Pause/resume controls
 *
 * Architecture:
 *   - schedules.json is the single source for stop names, lines, and directions
 *   - The popup never calls the live API directly; it delegates to the service worker
 *   - Results are read from chrome.storage.local (watcherResults)
 *   - A persistent port ("popup") tells the SW to skip its alarm ticks while open
 *
 * @author imouine
 * @license GPL-3.0
 * @see https://github.com/imouine/lille-bus-extension
 */

// ── Constants ──────────────────────────────────────────────────────────────────


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

// ── DOM references ─────────────────────────────────────────────────────────────

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

// ── i18n ───────────────────────────────────────────────────────────────────────

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
    summary_template:      "Arrêt : {stop} — Ligne : {line} — Sens : {direction}",
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
    summary_template:      "Stop: {stop} — Line: {line} — Dir: {direction}",
  },
};

/** Returns a translated string, with optional {var} interpolation. */
function t(key, vars) {
  const lang = prefs.lang in I18N ? prefs.lang : "fr";
  let s = I18N[lang]?.[key] || I18N.fr[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

// ── Preferences ────────────────────────────────────────────────────────────────

async function loadPrefs() {
  const { [STORAGE_KEYS.prefs]: stored } = await chrome.storage.local.get([STORAGE_KEYS.prefs]);
  const theme = stored && (stored.theme === "dark" || stored.theme === "light") ? stored.theme : null;
  const lang  = stored && (stored.lang  === "en"   || stored.lang  === "fr")   ? stored.lang  : null;
  prefs.theme = theme || (globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  prefs.lang  = lang  || "fr";
}

function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
}

function applyLanguage() {
  document.documentElement.lang = prefs.lang;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    if (node instanceof HTMLInputElement) {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    }
  }
}

// ── schedules.json ─────────────────────────────────────────────────────────────

/** @type {object|null} In-memory cache for the static timetable data. */
let _sched = null;

/** Loads schedules.json once. Returns the parsed object or null. */
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

/** Returns all stop names (sorted) from the static timetable. */
async function getStopNames() {
  const data = await loadSchedules();
  if (!data?.stops) return [];
  return Object.keys(data.stops).sort((a, b) => a.localeCompare(b, "fr"));
}

/** Returns all line codes serving a given stop. */
async function getLinesForStop(stopNorm) {
  const data = await loadSchedules();
  const entry = data?.stops?.[stopNorm];
  if (!entry) return [];
  return Object.keys(entry).sort((a, b) => a.localeCompare(b, "fr"));
}

/** Returns all directions for a given stop + line. */
async function getDirections(stopNorm, lineCode) {
  const data = await loadSchedules();
  const lineEntry = data?.stops?.[stopNorm]?.[lineCode];
  if (!lineEntry) return [];
  return Object.keys(lineEntry).sort((a, b) => a.localeCompare(b, "fr"));
}

/** Returns the GTFS stop IDs for a (stop, line, direction) combination. */
async function getStopIds(stopNorm, lineCode, direction) {
  const data = await loadSchedules();
  return data?.stops?.[stopNorm]?.[lineCode]?.[direction]?._stopIds ?? [];
}

// ── Line colors ────────────────────────────────────────────────────────────────

/** @type {Record<string, {bg: string, fg: string}>} Cached line color map. */
let lineColors = {};

/** Normalizes a hex color string. Returns "#RRGGBB" or null. */
function normalizeHex(v) {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(s) ? `#${s.toUpperCase()}` : null;
}

/** Fetches JSON with an abort timeout. */
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

/**
 * Loads official Ilevia line colors from the MEL API (cached 30 days in storage).
 * Populates the `lineColors` map keyed by uppercase line code.
 */
async function loadLineColors() {
  const TTL = 30 * 24 * 60 * 60 * 1000;
  const { [STORAGE_KEYS.lineColorsCache]: cache } =
    await chrome.storage.local.get([STORAGE_KEYS.lineColorsCache]);
  if (cache?.colorsByCode && Date.now() - cache.updatedAt < TTL) {
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

// ── State ──────────────────────────────────────────────────────────────────────

let draft    = { stopNorm: null, lineCode: null, direction: null };
let allStops = [];
let watchers = [];
let isPaused = false;

// ── UI helpers ─────────────────────────────────────────────────────────────────

function show(elem, v) { elem.classList.toggle("hidden", !v); }
function setStatus(text) { el.status.textContent = text || ""; }

/**
 * Persists the watcher list to storage.
 * If the list is empty, also clears the legacy selection key and tells the
 * service worker to reset the badge.
 */
async function saveWatchers() {
  await chrome.storage.local.set({ [STORAGE_KEYS.watchers]: watchers });
  if (watchers.length === 0) {
    await chrome.storage.local.remove([STORAGE_KEYS.selection]);
    await chrome.runtime.sendMessage({ type: "watchers:clear" }).catch(() => {});
  }
}

/**
 * Asks the service worker to refresh (single API call per watcher),
 * then updates the watcher time badges in-place (no DOM rebuild).
 */
async function refreshAndRender() {
  await chrome.runtime.sendMessage({ type: "badge:refresh" }).catch(() => {});
  await renderWatchers();
}

// ── Watcher time badges ────────────────────────────────────────────────────────

/** Returns the CSS urgency class for a given minute count. */
function timeUrgency(minutes, isLive) {
  if (!isLive) return "theoretical";
  if (minutes <= 1) return "now";
  if (minutes <= 5) return "soon";
  return "normal";
}

/** Sets the content and urgency styling of a watcher time badge element. */
function setWatcherTimeBadge(badge, minutes, isLive) {
  if (minutes === null) {
    delete badge.dataset.urgency;
    badge.innerHTML = `<span class="watcherTimeUnit">—</span>`;
    return;
  }
  badge.dataset.urgency = timeUrgency(minutes, isLive);
  badge.innerHTML = isLive
    ? `<span class="watcherTimeDot"></span>${minutes}<span class="watcherTimeUnit"> min</span>`
    : `<span class="watcherTimeUnit">~</span>${minutes}<span class="watcherTimeUnit"> min</span>`;
}

// ── Watcher list rendering ─────────────────────────────────────────────────────

/** Signature of the currently rendered watcher list — used to detect structural changes. */
let _renderedWatchersSig = "";

function watchersSig(list) {
  return list.map((w) => `${w.stopName}|${w.lineCode}|${w.direction}`).join(";;");
}

/**
 * Builds or updates the watcher list UI.
 * - Rebuilds the DOM only when the watcher composition changes (add/remove)
 * - Otherwise, updates time badges in-place (no flicker)
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

  // Read pre-computed results from storage (zero API calls)
  const { [STORAGE_KEYS.watcherResults]: stored } =
    await chrome.storage.local.get([STORAGE_KEYS.watcherResults]);
  const results = Array.isArray(stored) ? stored : [];

  if (structureChanged) {
    el.watchersList.innerHTML = "";
    _renderedWatchersSig = newSig;

    for (let i = 0; i < watchers.length; i++) {
      const w  = watchers[i];
      const li = document.createElement("li");
      li.className = "watcherItem";
      li.dataset.idx = String(i);

      // Line pill
      const pill = document.createElement("span");
      pill.className = "linePill watcherPill";
      pill.textContent = w.lineCode;
      const colors = lineColors[w.lineCode.toUpperCase()];
      if (colors?.bg) pill.style.backgroundColor = colors.bg;
      if (colors?.fg) pill.style.color           = colors.fg;
      li.appendChild(pill);

      // Stop name
      const stopEl = document.createElement("span");
      stopEl.className   = "watcherStop";
      stopEl.textContent = toDisplayName(w.stopName);
      stopEl.title       = toDisplayName(w.stopName);
      li.appendChild(stopEl);

      // Direction
      const dirEl = document.createElement("span");
      dirEl.className   = "watcherDir";
      dirEl.textContent = `→ ${w.direction}`;
      dirEl.title       = w.direction;
      li.appendChild(dirEl);

      // Time badge
      const right = document.createElement("div");
      right.className = "watcherRight";
      const timeBadge = document.createElement("span");
      timeBadge.className = "watcherTime";
      timeBadge.dataset.watcherTime = String(i);
      right.appendChild(timeBadge);
      li.appendChild(right);

      // Remove button (positioned absolute top-right)
      const rm = document.createElement("button");
      rm.className   = "watcherRemove";
      rm.type        = "button";
      rm.textContent = "×";
      rm.setAttribute("aria-label", "Remove");
      rm.addEventListener("click", async () => {
        watchers.splice(i, 1);
        await saveWatchers();
        await renderWatchers();
      });
      li.appendChild(rm);

      el.watchersList.appendChild(li);
    }
  }

  // In-place update of time badges (no DOM rebuild)
  const badges = el.watchersList.querySelectorAll("[data-watcher-time]");
  for (const badge of badges) {
    const idx = Number.parseInt(badge.dataset.watcherTime, 10);
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

// ── Text helpers ───────────────────────────────────────────────────────────────

/** Normalizes a string for accent-insensitive search. */
function normalizeForSearch(s) {
  return String(s).normalize("NFD").replaceAll(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Converts an UPPER_CASE key (from schedules.json) to Title Case for display. */
function toDisplayName(norm) {
  return norm.toLowerCase().replaceAll(/(^|[\s-])(\S)/g, (_, sep, c) => sep + c.toUpperCase());
}

// ── Rendering: stop / line / direction pickers ─────────────────────────────────

function renderStopSuggestions(items, query) {
  el.stopResults.innerHTML = "";
  if (!query || query.trim().length < 2) {
    el.stopHint.textContent = t("hint_min_letters");
    return;
  }
  el.stopHint.textContent = items.length ? "" : t("hint_no_suggestion");

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
  const visibleLines = draft.lineCode
    ? lines.filter((l) => l === draft.lineCode)
    : lines;

  for (const line of visibleLines) {
    const li  = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add("lineOption");
    btn.setAttribute("aria-label", `Line ${line}`);
    if (draft.lineCode === line) btn.classList.add("selected");

    const pill = document.createElement("span");
    pill.className = "linePill";
    pill.textContent = line;
    const colors = lineColors[line.toUpperCase()];
    if (colors?.bg) pill.style.backgroundColor = colors.bg;
    if (colors?.fg) pill.style.color = colors.fg;

    btn.appendChild(pill);
    btn.addEventListener("click", () => onPickLine(line));
    li.appendChild(btn);
    el.lineResults.appendChild(li);
  }
}

function renderDirectionChoices(directions) {
  el.directionResults.innerHTML = "";
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

// ── Search helpers ─────────────────────────────────────────────────────────────

/** Runs a prefix + contains search on allStops and returns matching items. */
function searchStops(query) {
  const q = normalizeForSearch(query.trim());
  if (q.length < 2) return [];
  const prefix = [], contains = [];
  for (const s of allStops) {
    if (!s.searchNorm.includes(q)) continue;
    if (s.searchNorm.startsWith(q)) prefix.push(s);
    else contains.push(s);
    if (prefix.length + contains.length >= 60) break;
  }
  return prefix.concat(contains);
}

// ── Event handlers ─────────────────────────────────────────────────────────────

async function onPickStop(stopNorm) {
  // Click on already-selected stop → deselect, show all suggestions again
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
    renderStopSuggestions(searchStops(el.stopSearch.value), el.stopSearch.value);
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
  renderStopSuggestions(searchStops(el.stopSearch.value), el.stopSearch.value);
  show(el.lineSection, true);
  renderLineChoices(lines);
}

async function onPickLine(lineCode) {
  // Click on already-selected line → deselect
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
  const lines = await getLinesForStop(draft.stopNorm);
  renderLineChoices(lines);
  show(el.directionSection, true);
  renderDirectionChoices(directions);
}

async function onPickDirection(direction) {
  // Click on already-selected direction → deselect
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
}

// ── Watcher actions ────────────────────────────────────────────────────────────

/** Adds the current draft as a new watcher (prevents duplicates). */
async function addWatcher() {
  if (!draft.stopNorm || !draft.lineCode || !draft.direction) return;
  const stopIds = await getStopIds(draft.stopNorm, draft.lineCode, draft.direction);
  const w = { stopName: draft.stopNorm, lineCode: draft.lineCode, direction: draft.direction, stopIds };

  const exists = watchers.some(
    (x) => x.stopName === w.stopName && x.lineCode === w.lineCode && x.direction === w.direction
  );
  if (!exists) {
    watchers.push(w);
    await saveWatchers();
    await refreshAndRender();
  }

  // Reset draft for adding another watcher
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

/** Replaces the entire watchlist with the current draft and closes the popup. */
async function validateSelection() {
  if (!draft.stopNorm || !draft.lineCode || !draft.direction) return;
  const stopIds = await getStopIds(draft.stopNorm, draft.lineCode, draft.direction);
  watchers = [{ stopName: draft.stopNorm, lineCode: draft.lineCode, direction: draft.direction, stopIds }];
  await saveWatchers();
  globalThis.close();
}

function onStopInput() {
  draft.stopNorm  = null;
  draft.lineCode  = null;
  draft.direction = null;
  show(el.lineSection, false);
  show(el.directionSection, false);
  show(el.validateSection, false);
  el.lineResults.innerHTML = "";
  el.directionResults.innerHTML = "";
  setStatus("");
  renderStopSuggestions(searchStops(el.stopSearch.value), el.stopSearch.value);
}

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
  await loadPrefs();
  applyTheme();
  applyLanguage();

  const [stopNames] = await Promise.all([
    getStopNames(),
    loadLineColors().catch(() => {}),
  ]);
  allStops = stopNames.map((norm) => ({ norm, searchNorm: normalizeForSearch(norm) }));

  // Load watchers (new format) or migrate from legacy single-selection format
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.watchers, STORAGE_KEYS.selection, STORAGE_KEYS.paused,
  ]);
  if (Array.isArray(stored[STORAGE_KEYS.watchers])) {
    watchers = stored[STORAGE_KEYS.watchers];
  } else if (stored[STORAGE_KEYS.selection]?.stopName) {
    const sel = stored[STORAGE_KEYS.selection];
    watchers = [{ stopName: sel.stopName, lineCode: sel.lineCode, direction: sel.direction }];
    await chrome.storage.local.set({ [STORAGE_KEYS.watchers]: watchers });
  }

  // Enrich legacy watchers that lack GTFS stop IDs
  let needsSave = false;
  for (const w of watchers) {
    if (!Array.isArray(w.stopIds) || w.stopIds.length === 0) {
      w.stopIds = await getStopIds(w.stopName, w.lineCode, w.direction);
      if (w.stopIds.length > 0) needsSave = true;
    }
  }
  if (needsSave) await chrome.storage.local.set({ [STORAGE_KEYS.watchers]: watchers });

  isPaused = stored[STORAGE_KEYS.paused] === true;

  // Initial render
  if (watchers.length > 0) {
    await refreshAndRender();
  } else {
    await renderWatchers();
  }

  // Open a persistent port so the SW knows the popup is active
  // (the SW skips alarm ticks while the port is connected)
  chrome.runtime.connect({ name: "popup" });

  // Auto-refresh at the user-configured interval
  const REFRESH_STEPS_MS   = [5000, 10000, 15000, 30000, 60000];
  const DEFAULT_REFRESH_MS = 30000;
  const { [STORAGE_KEYS.prefs]: prefsStored } =
    await chrome.storage.local.get([STORAGE_KEYS.prefs]);
  const refreshIdx = prefsStored?.refreshIdx;
  const intervalMs = (Number.isInteger(refreshIdx) && refreshIdx >= 0 && refreshIdx < REFRESH_STEPS_MS.length)
    ? REFRESH_STEPS_MS[refreshIdx]
    : DEFAULT_REFRESH_MS;

  setInterval(async () => {
    if (watchers.length === 0 || isPaused) return;
    await refreshAndRender();
  }, intervalMs);

  // Event listeners
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

  // Pause/resume button
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
    await renderWatchers();
  });
}

init();
