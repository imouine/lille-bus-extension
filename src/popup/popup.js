import {
  MAX_WATCHERS,
  STORAGE_KEYS,
  normalizePrefs,
  normalizeWatcher,
  refreshPeriodMinutes,
  resolveWatcherStation,
} from "../lib/config.js";
import { fetchLineColors } from "../lib/mel-api.js";
import { normalizeStopSearch, stopSearchRank } from "../lib/search.js";
import { departureUrgencyClass, minutesUntil } from "../lib/transit.js";

const I18N = {
  fr: {
    label_watchers: "Mes trajets", btn_clear_all: "Tout supprimer",
    empty_title: "Votre prochain bus, en un coup d’œil",
    empty_desc: "Ajoutez un trajet pour afficher ses prochains passages ici et sur le badge Chrome.",
    btn_open_add: "Ajouter un trajet", planner_title: "Nouveau trajet",
    planner_desc: "Arrêt, ligne puis direction", label_stop: "Arrêt",
    placeholder_stop: "Rechercher un arrêt", title_line: "Ligne", title_direction: "Direction",
    btn_add_trip: "Ajouter ce trajet", btn_pause: "Pause", btn_resume: "Reprendre",
    btn_settings: "Préférences", hint_min_letters: "Saisissez au moins 2 lettres.",
    hint_no_suggestion: "Aucun arrêt trouvé.", source_live: "Direct",
    source_theoretical: "Théorique", no_departure: "Aucun passage trouvé",
    schedule_expired: "Horaires de secours à actualiser", api_unavailable: "Temps réel indisponible",
    sync_initializing: "Initialisation…", sync_paused: "Actualisation en pause",
    sync_live: "Actualisé {time}", sync_degraded: "Mode dégradé · {time}",
    sync_stale: "Données anciennes · {time}", sync_waiting: "En attente d’actualisation",
    notice_degraded: "Le temps réel est momentanément indisponible. Les horaires théoriques sont affichés lorsqu’ils sont valides.",
    notice_expired: "Les horaires théoriques embarqués sont périmés. Le temps réel reste disponible.",
    notice_stale: "Les passages affichés n’ont pas été actualisés récemment. Utilisez le bouton d’actualisation pour réessayer.",
    count_one: "1 trajet surveillé", count_many: "{count} trajets surveillés",
    remove_trip: "Supprimer {line} à {stop}", duplicate_trip: "Ce trajet est déjà surveillé.",
    max_watchers: "Maximum {count} trajets.", clear_confirm: "Supprimer tous les trajets surveillés ?",
    summary: "{stop} · {line} vers {direction}", min_unit: "min",
    refresh_label: "Actualiser", close_label: "Fermer", watchers_list_label: "Trajets surveillés",
    stop_suggestions_label: "Suggestions d’arrêts", line_choices_label: "Choix de la ligne",
    direction_choices_label: "Choix de la direction", departure_tooltip: "{source} à {time} · dans {minutes} min",
    loading_schedules: "Chargement des arrêts…", schedules_error: "Impossible de charger la liste des arrêts.",
  },
  en: {
    label_watchers: "My trips", btn_clear_all: "Clear all",
    empty_title: "Your next bus, at a glance",
    empty_desc: "Add a trip to see upcoming departures here and on the Chrome badge.",
    btn_open_add: "Add a trip", planner_title: "New trip", planner_desc: "Stop, line, then direction",
    label_stop: "Stop", placeholder_stop: "Search for a stop", title_line: "Line",
    title_direction: "Direction", btn_add_trip: "Add this trip", btn_pause: "Pause",
    btn_resume: "Resume", btn_settings: "Preferences", hint_min_letters: "Type at least 2 letters.",
    hint_no_suggestion: "No stop found.", source_live: "Live", source_theoretical: "Scheduled",
    no_departure: "No departure found", schedule_expired: "Backup schedules need updating",
    api_unavailable: "Live data unavailable", sync_initializing: "Initializing…",
    sync_paused: "Refresh paused", sync_live: "Updated {time}",
    sync_degraded: "Degraded mode · {time}", sync_stale: "Old data · {time}",
    sync_waiting: "Waiting for refresh",
    notice_degraded: "Live data is temporarily unavailable. Scheduled times are shown when valid.",
    notice_expired: "Embedded schedules are outdated. Live departures remain available.",
    notice_stale: "Displayed departures have not refreshed recently. Use the refresh button to try again.",
    count_one: "1 watched trip", count_many: "{count} watched trips",
    remove_trip: "Remove {line} at {stop}", duplicate_trip: "This trip is already watched.",
    max_watchers: "Maximum {count} trips.", clear_confirm: "Remove all watched trips?",
    summary: "{stop} · {line} toward {direction}", min_unit: "min",
    refresh_label: "Refresh", close_label: "Close", watchers_list_label: "Watched trips",
    stop_suggestions_label: "Stop suggestions", line_choices_label: "Line choices",
    direction_choices_label: "Direction choices", departure_tooltip: "{source} at {time} · in {minutes} min",
    loading_schedules: "Loading stops…", schedules_error: "Unable to load the stop list.",
  },
};

const elements = Object.fromEntries([
  "liveDot", "syncStatus", "refreshBtn", "globalNotice", "watchersCount", "clearWatchersBtn",
  "emptyState", "watchersList", "togglePlannerBtn", "plannerSection", "closePlannerBtn", "stopSearch",
  "stopHint", "stopResults", "lineSection", "lineResults", "directionSection", "directionResults",
  "selectionSummary", "addWatcherBtn", "plannerStatus", "pauseBtn", "pauseBtnLabel", "openOptionsBtn",
].map((id) => [id, document.getElementById(id)]));

let prefs = normalizePrefs(null, globalThis.matchMedia("(prefers-color-scheme: dark)").matches);
let schedules = null;
let schedulesPromise = null;
let lineColors = {};
let watchers = [];
let results = {};
let refreshMeta = null;
let paused = false;
let plannerOpen = false;
let allStops = [];
let stopChoices = [];
let activeStopIndex = -1;
let draft = emptyDraft();
let refreshTimer = null;
let clockTimer = null;

function emptyDraft() {
  return { stopId: null, stopName: null, stopLabel: null, lineCode: null, direction: null };
}

function t(key, variables = {}) {
  let value = I18N[prefs.lang]?.[key] ?? I18N.fr[key] ?? key;
  for (const [name, replacement] of Object.entries(variables)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

function setHidden(element, hidden) {
  element?.classList.toggle("hidden", hidden);
}

function toDisplayName(value) {
  return String(value ?? "").toLowerCase().replaceAll(
    /(^|[\s—-])(\S)/g,
    (_, separator, letter) => separator + letter.toUpperCase()
  );
}

function watcherLabel(watcher) {
  return toDisplayName(watcher.stopLabel || watcher.stopName);
}

function applyPreferences() {
  document.documentElement.lang = prefs.lang;
  document.documentElement.dataset.theme = prefs.theme;
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  elements.refreshBtn.setAttribute("aria-label", t("refresh_label"));
  elements.closePlannerBtn.setAttribute("aria-label", t("close_label"));
  elements.watchersList.setAttribute("aria-label", t("watchers_list_label"));
  elements.stopResults.setAttribute("aria-label", t("stop_suggestions_label"));
  elements.lineResults.setAttribute("aria-label", t("line_choices_label"));
  elements.directionResults.setAttribute("aria-label", t("direction_choices_label"));
  applyPauseUi();
}

async function loadSchedules() {
  if (schedules) return schedules;
  const response = await fetch(chrome.runtime.getURL("data/schedules.json"));
  if (!response.ok) throw new Error(`Schedules HTTP ${response.status}`);
  schedules = await response.json();
  return schedules;
}

async function prepareSchedules() {
  if (schedulesPromise) return schedulesPromise;
  schedulesPromise = loadSchedules().then(async (data) => {
    allStops = Object.entries(data?.stops ?? {})
      .map(([id, station]) => ({
        id,
        name: station.name,
        label: station.label || station.name,
        search: normalizeStopSearch(`${station.label || station.name} ${station.city || ""}`),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "fr", { numeric: true }));
    const resolved = watchers.map((watcher) => resolveWatcherStation(data, watcher));
    if (JSON.stringify(resolved) !== JSON.stringify(watchers)) {
      watchers = resolved;
      await persistWatchers();
      renderWatchers();
    }
    return data;
  }).catch((error) => {
    schedulesPromise = null;
    throw error;
  });
  return schedulesPromise;
}

async function loadLineColors() {
  const ttl = 30 * 24 * 60 * 60 * 1000;
  const { [STORAGE_KEYS.lineColorsCache]: cache } = await chrome.storage.local.get([STORAGE_KEYS.lineColorsCache]);
  if (cache?.colorsByCode) {
    lineColors = cache.colorsByCode;
    renderWatchers();
  }
  if (cache?.colorsByCode && Date.now() - cache.updatedAt < ttl) return;
  try {
    lineColors = await fetchLineColors();
    await chrome.storage.local.set({
      [STORAGE_KEYS.lineColorsCache]: { updatedAt: Date.now(), colorsByCode: lineColors },
    });
    renderWatchers();
    if (plannerOpen && draft.stopId) renderLineChoices();
  } catch (error) {
    console.warn("Line colors unavailable", error);
  }
}

function normalizeStoredResults(storedResults) {
  if (storedResults && !Array.isArray(storedResults) && typeof storedResults === "object") return storedResults;
  if (!Array.isArray(storedResults)) return {};
  return Object.fromEntries(watchers.map((watcher, index) => [watcher.id, storedResults[index]]).filter(([, result]) => result));
}

async function loadState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.prefs, STORAGE_KEYS.watchers, STORAGE_KEYS.watcherResults,
    STORAGE_KEYS.refreshMeta, STORAGE_KEYS.paused,
  ]);
  prefs = normalizePrefs(stored[STORAGE_KEYS.prefs], globalThis.matchMedia("(prefers-color-scheme: dark)").matches);
  watchers = Array.isArray(stored[STORAGE_KEYS.watchers])
    ? stored[STORAGE_KEYS.watchers].map(normalizeWatcher)
    : [];
  results = normalizeStoredResults(stored[STORAGE_KEYS.watcherResults]);
  refreshMeta = stored[STORAGE_KEYS.refreshMeta] ?? null;
  paused = stored[STORAGE_KEYS.paused] === true;
}

function formatTime(timestamp) {
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat(prefs.lang === "en" ? "en-GB" : "fr-FR", {
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(timestamp));
}

function snapshotIsStale() {
  if (!refreshMeta?.completedAt || paused || watchers.length === 0) return false;
  const threshold = Math.max(120000, refreshPeriodMinutes(prefs) * 120000 + 30000);
  return Date.now() - refreshMeta.completedAt > threshold;
}

function renderSyncState() {
  elements.liveDot.className = "liveDot";
  if (paused) {
    elements.liveDot.classList.add("paused");
    elements.syncStatus.textContent = t("sync_paused");
    return;
  }
  if (!refreshMeta?.completedAt) {
    elements.syncStatus.textContent = t("sync_waiting");
    return;
  }
  const time = formatTime(refreshMeta.completedAt);
  if (refreshMeta.status === "degraded") {
    elements.liveDot.classList.add("warning");
    elements.syncStatus.textContent = t("sync_degraded", { time });
  } else if (snapshotIsStale()) {
    elements.liveDot.classList.add("warning");
    elements.syncStatus.textContent = t("sync_stale", { time });
  } else {
    elements.liveDot.classList.add("live");
    elements.syncStatus.textContent = t("sync_live", { time });
  }
}

function renderNotice() {
  const hasExpired = Object.values(results).some((result) => result?.status === "schedule_expired");
  const key = refreshMeta?.status === "degraded"
    ? "notice_degraded"
    : (snapshotIsStale() ? "notice_stale" : (hasExpired ? "notice_expired" : null));
  setHidden(elements.globalNotice, !key);
  elements.globalNotice.textContent = key ? t(key) : "";
}

function currentDepartures(result) {
  if (!Array.isArray(result?.departures)) return [];
  const now = Date.now();
  return result.departures
    .map((departure) => ({ ...departure, minutes: minutesUntil(departure.departureAt, now) }))
    .filter((departure) => departure.minutes !== null && departure.departureAt >= now - 30000)
    .slice(0, 3);
}

function departureSource(departure, resultSource) {
  if (departure?.source === "live" || departure?.source === "theoretical") return departure.source;
  if (departure?.isLive === true) return "live";
  if (departure?.isLive === false) return "theoretical";
  return resultSource === "live" ? "live" : "theoretical";
}

function createDepartureChip(departure, source, index) {
  const chip = document.createElement("span");
  chip.className = "departureChip";
  if (source !== "live" || index === 0) {
    const urgencyClass = departureUrgencyClass(departure.minutes, source);
    if (urgencyClass) chip.classList.add(urgencyClass);
  }
  const accessible = t("departure_tooltip", {
    source: t(source === "live" ? "source_live" : "source_theoretical"),
    time: formatTime(departure.departureAt),
    minutes: departure.minutes,
  });
  chip.title = accessible;
  chip.setAttribute("aria-label", accessible);
  chip.append(document.createTextNode(String(departure.minutes)));
  const unit = document.createElement("span");
  unit.className = "departureUnit";
  unit.textContent = t("min_unit");
  chip.append(unit);
  return chip;
}

function watcherStatusText(result) {
  if (result?.status === "schedule_expired") return t("schedule_expired");
  if (result?.status === "api_unavailable") return t("api_unavailable");
  return t("no_departure");
}

function createDepartureRow(watcher, result) {
  const row = document.createElement("div");
  row.className = "departureRow";
  row.dataset.watcherId = watcher.id;
  const departures = currentDepartures(result);
  if (departures.length === 0) {
    const empty = document.createElement("span");
    empty.className = "noDeparture";
    empty.textContent = watcherStatusText(result);
    row.append(empty);
    return row;
  }
  const sources = departures.map((departure) => departureSource(departure, result?.source));
  departures.forEach((departure, index) => row.append(createDepartureChip(departure, sources[index], index)));
  const source = document.createElement("span");
  source.className = "sourceLabel";
  source.textContent = t(sources.includes("live") ? "source_live" : "source_theoretical");
  row.append(source);
  return row;
}

function createWatcherCard(watcher) {
  const result = results[watcher.id] ?? null;
  const card = document.createElement("li");
  card.className = "watcherCard";
  card.dataset.watcherId = watcher.id;

  const pill = document.createElement("span");
  pill.className = "linePill";
  pill.textContent = watcher.lineCode;
  const colors = lineColors[watcher.lineCode.toUpperCase()];
  if (colors?.bg) pill.style.backgroundColor = colors.bg;
  if (colors?.fg) pill.style.color = colors.fg;

  const route = document.createElement("div");
  route.className = "watcherRoute";
  const stop = document.createElement("span");
  stop.className = "watcherStop";
  stop.textContent = watcherLabel(watcher);
  stop.title = stop.textContent;
  const direction = document.createElement("span");
  direction.className = "watcherDirection";
  direction.textContent = `→ ${toDisplayName(watcher.direction)}`;
  direction.title = direction.textContent;
  route.append(stop, direction);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "watcherRemove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", t("remove_trip", { line: watcher.lineCode, stop: watcherLabel(watcher) }));
  remove.addEventListener("click", () => removeWatcher(watcher.id));
  card.append(pill, route, remove, createDepartureRow(watcher, result));
  return card;
}

function renderWatchers() {
  elements.watchersList.replaceChildren(...watchers.map(createWatcherCard));
  setHidden(elements.emptyState, watchers.length > 0);
  setHidden(elements.clearWatchersBtn, watchers.length === 0);
  elements.watchersCount.textContent = watchers.length === 1 ? t("count_one") : t("count_many", { count: watchers.length });
  renderSyncState();
  renderNotice();
}

function updateDepartureRows() {
  for (const watcher of watchers) {
    const card = [...elements.watchersList.children].find((node) => node.dataset.watcherId === watcher.id);
    const oldRow = card?.querySelector(".departureRow");
    const newRow = createDepartureRow(watcher, results[watcher.id] ?? null);
    newRow.classList.add("clockUpdate");
    oldRow?.replaceWith(newRow);
  }
  renderSyncState();
  renderNotice();
}

async function persistWatchers() {
  await chrome.storage.local.set({ [STORAGE_KEYS.watchers]: watchers });
}

async function removeWatcher(id) {
  watchers = watchers.filter((watcher) => watcher.id !== id);
  delete results[id];
  await chrome.storage.local.set({ [STORAGE_KEYS.watchers]: watchers, [STORAGE_KEYS.watcherResults]: results });
  renderWatchers();
  await chrome.runtime.sendMessage({ type: "watchers:changed" }).catch(() => null);
  await readLatestSnapshot();
}

async function clearWatchers() {
  if (!globalThis.confirm(t("clear_confirm"))) return;
  watchers = [];
  results = {};
  await chrome.storage.local.set({ [STORAGE_KEYS.watchers]: [], [STORAGE_KEYS.watcherResults]: {} });
  await chrome.runtime.sendMessage({ type: "watchers:clear" }).catch(() => null);
  renderWatchers();
  await setPlannerOpen(true);
}

async function readLatestSnapshot() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.watcherResults, STORAGE_KEYS.refreshMeta]);
  results = normalizeStoredResults(stored[STORAGE_KEYS.watcherResults]);
  refreshMeta = stored[STORAGE_KEYS.refreshMeta] ?? refreshMeta;
  updateDepartureRows();
}

async function refresh({ force = false } = {}) {
  if (paused || watchers.length === 0) return;
  elements.refreshBtn.classList.add("loading");
  elements.refreshBtn.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "badge:refresh", force });
    if (response && response.ok === false) throw new Error(response.error);
    await readLatestSnapshot();
  } catch (error) {
    refreshMeta = { completedAt: Date.now(), status: "degraded", error: String(error) };
    renderSyncState();
    renderNotice();
  } finally {
    elements.refreshBtn.classList.remove("loading");
    elements.refreshBtn.disabled = false;
  }
}

function restartRefreshTimer() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => refresh(), refreshPeriodMinutes(prefs) * 60000);
}

function searchStops(query) {
  const normalized = normalizeStopSearch(query);
  if (normalized.length < 2) return [];
  return allStops
    .map((stop) => ({ stop, rank: stopSearchRank(stop.search, normalized) }))
    .filter(({ rank }) => rank !== null)
    .sort((left, right) => (
      left.rank - right.rank
      || left.stop.label.localeCompare(right.stop.label, "fr", { numeric: true })
    ))
    .slice(0, 12)
    .map(({ stop }) => stop);
}

function choiceButton(label, selected, onClick, { className = "", id = "", option = false } = {}) {
  const item = document.createElement("li");
  item.setAttribute("role", "none");
  const button = document.createElement("button");
  button.type = "button";
  button.className = `choiceBtn ${className}`.trim();
  button.classList.toggle("selected", selected);
  if (id) button.id = id;
  if (option) {
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(selected));
  }
  button.append(label);
  button.addEventListener("click", onClick);
  item.append(button);
  return item;
}

function setActiveStop(index) {
  if (stopChoices.length === 0) return;
  activeStopIndex = (index + stopChoices.length) % stopChoices.length;
  const buttons = [...elements.stopResults.querySelectorAll('[role="option"]')];
  buttons.forEach((button, buttonIndex) => button.classList.toggle("keyboardActive", buttonIndex === activeStopIndex));
  const active = buttons[activeStopIndex];
  elements.stopSearch.setAttribute("aria-activedescendant", active?.id ?? "");
  active?.scrollIntoView({ block: "nearest" });
}

function renderStopChoices() {
  const query = elements.stopSearch.value;
  const selected = draft.stopId ? allStops.find((stop) => stop.id === draft.stopId) : null;
  stopChoices = selected ? [selected] : searchStops(query);
  activeStopIndex = -1;
  elements.stopSearch.setAttribute("aria-expanded", String(stopChoices.length > 0));
  elements.stopSearch.removeAttribute("aria-activedescendant");
  elements.stopHint.textContent = query.trim().length < 2
    ? t("hint_min_letters")
    : (stopChoices.length === 0 ? t("hint_no_suggestion") : "");
  elements.stopResults.replaceChildren(...stopChoices.map((stop, index) => choiceButton(
    document.createTextNode(toDisplayName(stop.label)),
    draft.stopId === stop.id,
    () => pickStop(stop),
    { id: `stop-option-${index}`, option: true }
  )));
}

function stationForDraft() {
  return schedules?.stops?.[draft.stopId] ?? null;
}

function linesForStop(stopId) {
  return Object.keys(schedules?.stops?.[stopId]?.lines ?? {}).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
}

function directionsFor(stopId, lineCode) {
  return Object.keys(schedules?.stops?.[stopId]?.lines?.[lineCode] ?? {}).sort((a, b) => a.localeCompare(b, "fr"));
}

function renderLineChoices() {
  const lines = draft.lineCode ? [draft.lineCode] : linesForStop(draft.stopId);
  elements.lineResults.replaceChildren(...lines.map((lineCode) => {
    const fragment = document.createDocumentFragment();
    const pill = document.createElement("span");
    pill.className = "linePill";
    pill.textContent = lineCode;
    const colors = lineColors[lineCode.toUpperCase()];
    if (colors?.bg) pill.style.backgroundColor = colors.bg;
    if (colors?.fg) pill.style.color = colors.fg;
    fragment.append(pill);
    const metadata = schedules?.routes?.[lineCode.toUpperCase()] ?? schedules?.routes?.[lineCode];
    if (metadata) {
      const meta = document.createElement("span");
      meta.className = "lineMeta";
      const name = document.createElement("span");
      name.className = "lineName";
      name.textContent = metadata.long_name || lineCode;
      const terminus = document.createElement("span");
      terminus.className = "lineTerminus";
      terminus.textContent = metadata.terminus || "";
      meta.append(name, terminus);
      fragment.append(meta);
    }
    return choiceButton(fragment, draft.lineCode === lineCode, () => pickLine(lineCode));
  }));
}

function renderDirectionChoices() {
  const directions = draft.direction ? [draft.direction] : directionsFor(draft.stopId, draft.lineCode);
  elements.directionResults.replaceChildren(...directions.map((direction) => choiceButton(
    document.createTextNode(toDisplayName(direction)),
    draft.direction === direction,
    () => pickDirection(direction)
  )));
}

function renderDraft() {
  const hasStop = Boolean(draft.stopId);
  const hasLine = Boolean(draft.lineCode);
  const complete = Boolean(draft.stopId && draft.lineCode && draft.direction);
  setHidden(elements.lineSection, !hasStop);
  setHidden(elements.directionSection, !hasLine);
  setHidden(elements.selectionSummary, !complete);
  setHidden(elements.addWatcherBtn, !complete);
  if (complete) {
    elements.selectionSummary.textContent = t("summary", {
      stop: toDisplayName(draft.stopLabel), line: draft.lineCode, direction: toDisplayName(draft.direction),
    });
  }
}

function pickStop(stop) {
  if (draft.stopId === stop.id) {
    draft = emptyDraft();
    elements.stopSearch.value = "";
  } else {
    draft = { ...emptyDraft(), stopId: stop.id, stopName: stop.name, stopLabel: stop.label };
    elements.stopSearch.value = toDisplayName(stop.label);
  }
  renderStopChoices();
  if (draft.stopId) renderLineChoices();
  renderDraft();
}

function pickLine(lineCode) {
  if (draft.lineCode === lineCode) {
    draft.lineCode = null;
    draft.direction = null;
  } else {
    draft.lineCode = lineCode;
    draft.direction = null;
  }
  renderLineChoices();
  if (draft.lineCode) renderDirectionChoices();
  renderDraft();
}

function pickDirection(direction) {
  draft.direction = draft.direction === direction ? null : direction;
  renderDirectionChoices();
  renderDraft();
}

function resetPlanner() {
  draft = emptyDraft();
  stopChoices = [];
  activeStopIndex = -1;
  elements.stopSearch.value = "";
  elements.stopHint.textContent = "";
  elements.stopResults.replaceChildren();
  elements.lineResults.replaceChildren();
  elements.directionResults.replaceChildren();
  elements.plannerStatus.textContent = "";
  elements.stopSearch.setAttribute("aria-expanded", "false");
  renderDraft();
}

async function setPlannerOpen(open) {
  if (open) {
    elements.togglePlannerBtn.disabled = true;
    elements.togglePlannerBtn.setAttribute("aria-busy", "true");
    elements.globalNotice.textContent = t("loading_schedules");
    setHidden(elements.globalNotice, false);
    try {
      await prepareSchedules();
    } catch (error) {
      console.error("Schedules loading failed", error);
      elements.globalNotice.textContent = t("schedules_error");
      return;
    } finally {
      elements.togglePlannerBtn.disabled = false;
      elements.togglePlannerBtn.removeAttribute("aria-busy");
      renderNotice();
    }
  }
  plannerOpen = open;
  setHidden(elements.plannerSection, !open);
  setHidden(elements.togglePlannerBtn, open);
  elements.togglePlannerBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    resetPlanner();
    setTimeout(() => elements.stopSearch.focus(), 0);
  }
}

async function addWatcher() {
  if (!draft.stopId || !draft.lineCode || !draft.direction) return;
  if (watchers.length >= MAX_WATCHERS) {
    elements.plannerStatus.textContent = t("max_watchers", { count: MAX_WATCHERS });
    return;
  }
  const station = stationForDraft();
  const entry = station?.lines?.[draft.lineCode]?.[draft.direction];
  const watcher = normalizeWatcher({
    stopId: draft.stopId, stopName: station?.name || draft.stopName,
    stopLabel: station?.label || draft.stopLabel, lineCode: draft.lineCode,
    direction: draft.direction, stopIds: entry?._stopIds ?? [],
  });
  const duplicate = watchers.some((existing) => (
    existing.id === watcher.id
    || (existing.stopId === watcher.stopId && existing.lineCode === watcher.lineCode && existing.direction === watcher.direction)
  ));
  if (duplicate) {
    elements.plannerStatus.textContent = t("duplicate_trip");
    return;
  }
  elements.addWatcherBtn.disabled = true;
  watchers.push(watcher);
  await persistWatchers();
  renderWatchers();
  await setPlannerOpen(false);
  try {
    await chrome.runtime.sendMessage({ type: "watchers:changed" });
    await readLatestSnapshot();
  } finally {
    elements.addWatcherBtn.disabled = false;
  }
}

function applyPauseUi() {
  elements.pauseBtn?.setAttribute("aria-pressed", String(paused));
  elements.pauseBtnLabel.textContent = t(paused ? "btn_resume" : "btn_pause");
  renderSyncState();
}

async function togglePause() {
  paused = !paused;
  applyPauseUi();
  await chrome.runtime.sendMessage({ type: "badge:pause", paused }).catch(() => null);
  if (!paused) await refresh({ force: true });
}

function onStopSearchKeydown(event) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveStop(activeStopIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveStop(activeStopIndex <= 0 ? stopChoices.length - 1 : activeStopIndex - 1);
  } else if (event.key === "Enter" && activeStopIndex >= 0) {
    event.preventDefault();
    pickStop(stopChoices[activeStopIndex]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    if (elements.stopResults.children.length > 0) {
      elements.stopResults.replaceChildren();
      elements.stopSearch.setAttribute("aria-expanded", "false");
    } else {
      setPlannerOpen(false);
    }
  }
}

function bindEvents() {
  elements.refreshBtn.addEventListener("click", () => refresh({ force: true }));
  elements.clearWatchersBtn.addEventListener("click", clearWatchers);
  elements.togglePlannerBtn.addEventListener("click", () => setPlannerOpen(true));
  elements.closePlannerBtn.addEventListener("click", () => setPlannerOpen(false));
  elements.stopSearch.addEventListener("input", () => {
    draft = emptyDraft();
    renderStopChoices();
    renderDraft();
  });
  elements.stopSearch.addEventListener("keydown", onStopSearchKeydown);
  elements.addWatcherBtn.addEventListener("click", addWatcher);
  elements.pauseBtn.addEventListener("click", togglePause);
  elements.openOptionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[STORAGE_KEYS.watchers]) {
      watchers = Array.isArray(changes[STORAGE_KEYS.watchers].newValue)
        ? changes[STORAGE_KEYS.watchers].newValue.map(normalizeWatcher)
        : [];
    }
    if (changes[STORAGE_KEYS.watcherResults]) results = normalizeStoredResults(changes[STORAGE_KEYS.watcherResults].newValue);
    if (changes[STORAGE_KEYS.refreshMeta]) refreshMeta = changes[STORAGE_KEYS.refreshMeta].newValue;
    if (changes[STORAGE_KEYS.paused]) paused = changes[STORAGE_KEYS.paused].newValue === true;
    if (changes[STORAGE_KEYS.prefs]) {
      prefs = normalizePrefs(changes[STORAGE_KEYS.prefs].newValue, globalThis.matchMedia("(prefers-color-scheme: dark)").matches);
      applyPreferences();
      restartRefreshTimer();
    }
    renderWatchers();
  });
}

async function init() {
  elements.syncStatus.textContent = t("sync_initializing");
  await loadState();
  applyPreferences();
  bindEvents();
  renderWatchers();
  restartRefreshTimer();
  clockTimer = setInterval(updateDepartureRows, 10000);
  loadLineColors();
  prepareSchedules().catch((error) => console.warn("Schedules preload failed", error));
  if (watchers.length === 0) await setPlannerOpen(true);
  else refresh();
}

init().catch((error) => {
  console.error("Popup initialization failed", error);
  elements.globalNotice.textContent = String(error.message || error);
  setHidden(elements.globalNotice, false);
});
