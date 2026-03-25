/*
 * Lille Bus Extension — Options
 * Author: imouine
 * Copyright (c) 2026
 * License: GPL-3.0
 * https://github.com/imouine/lille-bus-extension
 */

const STORAGE_KEY_PREFS = "prefs";

const REFRESH_STEPS_MIN   = [1/12, 1/6, 1/4, 0.5, 1];
const REFRESH_STEPS_LABEL = ["5s", "10s", "15s", "30s", "60s"];
const DEFAULT_REFRESH_IDX = 4;

const I18N = {
  fr: {
    nav_appearance:        "Apparence",
    nav_refresh:           "Actualisation",
    nav_about:             "À propos",
    label_appearance:      "Apparence",
    desc_appearance:       "Personnalisez l'apparence de l'extension.",
    label_theme:           "Mode nuit",
    hint_theme:            "Alterner entre le thème clair et sombre",
    label_lang:            "English",
    hint_lang:             "Changer la langue de l'interface",
    label_refresh_section: "Actualisation",
    desc_refresh:          "Contrôlez la fréquence de mise à jour des horaires.",
    label_refresh:         "Fréquence d'actualisation",
    label_glow:            "Effet de glow",
    hint_glow:             "Animer le badge pour indiquer les données en direct",
    label_about:           "À propos",
    desc_about:            "Une extension open-source pour les transports en commun de la Métropole Lilloise.",
    author_role:           "Créateur & Mainteneur",
    meta_version:          "Version",
    meta_license:          "Licence",
    meta_source:           "Code source",
    meta_data:             "Données",
    meta_gtfs:             "GTFS",
    saved:                 "Préférences enregistrées",
  },
  en: {
    nav_appearance:        "Appearance",
    nav_refresh:           "Refresh",
    nav_about:             "About",
    label_appearance:      "Appearance",
    desc_appearance:       "Customize the look and feel of the extension.",
    label_theme:           "Night mode",
    hint_theme:            "Switch between light and dark themes",
    label_lang:            "Français",
    hint_lang:             "Change the interface language",
    label_refresh_section: "Refresh",
    desc_refresh:          "Control how often bus times are updated.",
    label_refresh:         "Refresh interval",
    label_glow:            "Glow effect",
    hint_glow:             "Animate the badge to indicate live data",
    label_about:           "About",
    desc_about:            "An open-source extension for Lille Metropole public transport.",
    author_role:           "Creator & Maintainer",
    meta_version:          "Version",
    meta_license:          "License",
    meta_source:           "Source code",
    meta_data:             "Data",
    meta_gtfs:             "GTFS",
    saved:                 "Preferences saved",
  },
};

let prefs = { theme: "light", lang: "fr", refreshIdx: DEFAULT_REFRESH_IDX, glowEnabled: true };

function t(key) {
  const dict = I18N[prefs.lang] || I18N.fr;
  return dict[key] || I18N.fr[key] || key;
}

/** Apply translated text to all elements with matching IDs */
function applyI18n() {
  const keys = Object.keys(I18N.fr);
  for (const key of keys) {
    const el = document.getElementById(key);
    if (el) el.textContent = t(key);
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
  document.getElementById("themeToggle").checked = prefs.theme === "dark";
}

function applyLanguage() {
  document.documentElement.lang = prefs.lang;
  document.getElementById("langToggle").checked = prefs.lang === "en";
  applyI18n();
}

function applyRefresh() {
  const idx    = prefs.refreshIdx ?? DEFAULT_REFRESH_IDX;
  const slider = document.getElementById("refreshSlider");
  const label  = document.getElementById("refreshValue");
  slider.value = idx;
  label.textContent = REFRESH_STEPS_LABEL[idx];
  const pct = (idx / (REFRESH_STEPS_MIN.length - 1)) * 100;
  slider.style.setProperty("--pct", `${pct}%`);
}

function applyGlow() {
  document.getElementById("glowToggle").checked = prefs.glowEnabled !== false;
}

function showSaved() {
  const el = document.getElementById("savedMsg");
  el.textContent = t("saved");
  el.classList.add("visible");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("visible"), 2000);
}

async function loadPrefs() {
  const result = await chrome.storage.local.get([STORAGE_KEY_PREFS]);
  const stored = result[STORAGE_KEY_PREFS];
  if (stored) {
    if (stored.theme === "dark" || stored.theme === "light") prefs.theme = stored.theme;
    else prefs.theme = globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    if (stored.lang === "en" || stored.lang === "fr") prefs.lang = stored.lang;
    if (Number.isInteger(stored.refreshIdx) && stored.refreshIdx >= 0 && stored.refreshIdx < REFRESH_STEPS_MIN.length) {
      prefs.refreshIdx = stored.refreshIdx;
    }
    prefs.glowEnabled = stored.glowEnabled !== false;
  } else {
    prefs.theme = globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
}

async function savePrefs() {
  await chrome.storage.local.set({ [STORAGE_KEY_PREFS]: prefs });
  chrome.runtime.sendMessage({
    type: "prefs:refreshInterval",
    periodInMinutes: REFRESH_STEPS_MIN[prefs.refreshIdx],
  }).catch(() => {});
  showSaved();
}

// ─── Navigation ────────────────────────────────────────────────────────────────
function setupNav() {
  const navItems = document.querySelectorAll(".nav-item[data-section]");
  const sections = document.querySelectorAll(".card[id^='section-']");

  function activate(sectionName) {
    navItems.forEach((item) => item.classList.toggle("active", item.dataset.section === sectionName));
    sections.forEach((sec) => {
      const name = sec.id.replace("section-", "");
      if (name === sectionName) {
        sec.style.display = "";
        sec.style.animation = "none";
        // Force reflow to restart animation
        sec.offsetHeight;
        sec.style.animation = "";
      } else {
        sec.style.display = "none";
      }
    });
  }

  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      activate(item.dataset.section);
    });
  });

  // Show first section, hide others
  activate("appearance");
}

// ─── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadPrefs();
  applyTheme();
  applyLanguage();
  applyRefresh();
  applyGlow();
  setupNav();

  document.getElementById("themeToggle").addEventListener("change", async (e) => {
    prefs.theme = e.target.checked ? "dark" : "light";
    applyTheme();
    await savePrefs();
  });

  document.getElementById("langToggle").addEventListener("change", async (e) => {
    prefs.lang = e.target.checked ? "en" : "fr";
    applyLanguage();
    await savePrefs();
  });

  document.getElementById("refreshSlider").addEventListener("input", (e) => {
    prefs.refreshIdx = Number(e.target.value);
    applyRefresh();
  });

  document.getElementById("refreshSlider").addEventListener("change", async () => {
    await savePrefs();
  });

  document.getElementById("glowToggle").addEventListener("change", async (e) => {
    prefs.glowEnabled = e.target.checked;
    await savePrefs();
  });
}

init();
