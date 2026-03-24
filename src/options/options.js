/*
 * Lille Bus Extension
 * Author: imouine
 * Copyright (c) 2026
 * License: GPL-3.0
 * https://github.com/imouine/lille-bus-extension
 */

const STORAGE_KEY_PREFS = "prefs";

const I18N = {
  fr: {
    subtitle:        "Préférences",
    label_appearance:"Apparence",
    label_theme:     "Mode nuit",
    label_lang:      "English",
    saved:           "Préférences enregistrées",
  },
  en: {
    subtitle:        "Preferences",
    label_appearance:"Appearance",
    label_theme:     "Night mode",
    label_lang:      "Français",
    saved:           "Preferences saved",
  },
};

let prefs = { theme: "light", lang: "fr" };

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

  document.getElementById("subtitle").textContent        = t("subtitle");
  document.getElementById("label_appearance").textContent = t("label_appearance");
  document.getElementById("label_theme").textContent      = t("label_theme");
  document.getElementById("label_lang").textContent       = t("label_lang");
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
  } else {
    prefs.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
}

async function savePrefs() {
  await chrome.storage.local.set({ [STORAGE_KEY_PREFS]: prefs });
  showSaved();
}

async function init() {
  await loadPrefs();
  applyTheme();
  applyLanguage();

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
}

init();
