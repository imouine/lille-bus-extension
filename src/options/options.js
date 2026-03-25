/*
 * Lille Bus Extension
 * Author: imouine
 * Copyright (c) 2026
 * License: GPL-3.0
 * https://github.com/imouine/lille-bus-extension
 */

const STORAGE_KEY_PREFS = "prefs";

// Valeurs en minutes correspondant aux crans du slider (index 0 → 4)
const REFRESH_STEPS_MIN  = [1/12, 1/6, 1/4, 0.5, 1]; // 5s, 10s, 15s, 30s, 60s
const REFRESH_STEPS_LABEL = ["5s", "10s", "15s", "30s", "60s"];
const DEFAULT_REFRESH_IDX = 4; // 60s par défaut

const I18N = {
  fr: {
    subtitle:              "Préférences",
    label_appearance:      "Apparence",
    label_theme:           "Mode nuit",
    label_lang:            "English",
    label_refresh_section: "Actualisation",
    label_refresh:         "Fréquence d'actualisation",
    saved:                 "Préférences enregistrées",
  },
  en: {
    subtitle:              "Preferences",
    label_appearance:      "Appearance",
    label_theme:           "Night mode",
    label_lang:            "Français",
    label_refresh_section: "Refresh",
    label_refresh:         "Refresh interval",
    saved:                 "Preferences saved",
  },
};

let prefs = { theme: "light", lang: "fr", refreshIdx: DEFAULT_REFRESH_IDX };

function t(key) {
  const dict = I18N[prefs.lang] || I18N.fr;
  return dict[key] || I18N.fr[key] || key;
}

function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
  document.getElementById("themeToggle").checked = prefs.theme === "dark";
}

function applyLanguage() {
  document.documentElement.lang = prefs.lang;
  document.getElementById("langToggle").checked = prefs.lang === "en";

  document.getElementById("subtitle").textContent              = t("subtitle");
  document.getElementById("label_appearance").textContent      = t("label_appearance");
  document.getElementById("label_theme").textContent           = t("label_theme");
  document.getElementById("label_lang").textContent            = t("label_lang");
  document.getElementById("label_refresh_section").textContent = t("label_refresh_section");
  document.getElementById("label_refresh").textContent         = t("label_refresh");
}

function applyRefresh() {
  const idx    = prefs.refreshIdx ?? DEFAULT_REFRESH_IDX;
  const slider = document.getElementById("refreshSlider");
  const label  = document.getElementById("refreshValue");
  slider.value = idx;
  label.textContent = REFRESH_STEPS_LABEL[idx];
  // Mise à jour de la couleur de la piste (CSS custom property)
  const pct = (idx / (REFRESH_STEPS_MIN.length - 1)) * 100;
  slider.style.setProperty("--pct", `${pct}%`);
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
    else prefs.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    if (stored.lang === "en" || stored.lang === "fr") prefs.lang = stored.lang;
    if (Number.isInteger(stored.refreshIdx) && stored.refreshIdx >= 0 && stored.refreshIdx < REFRESH_STEPS_MIN.length) {
      prefs.refreshIdx = stored.refreshIdx;
    }
  } else {
    prefs.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
}

async function savePrefs() {
  await chrome.storage.local.set({ [STORAGE_KEY_PREFS]: prefs });
  // Notifie le service worker pour qu'il recrée l'alarme avec la nouvelle fréquence
  chrome.runtime.sendMessage({
    type: "prefs:refreshInterval",
    periodInMinutes: REFRESH_STEPS_MIN[prefs.refreshIdx],
  }).catch(() => {/* service worker peut être inactif */});
  showSaved();
}

async function init() {
  await loadPrefs();
  applyTheme();
  applyLanguage();
  applyRefresh();

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
}

init();
