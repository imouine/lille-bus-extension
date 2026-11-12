import {
  DEFAULT_REFRESH_IDX,
  REFRESH_STEPS_LABEL,
  REFRESH_STEPS_MIN,
  STORAGE_KEYS,
  normalizePrefs,
} from "../lib/config.js";

const I18N = {
  fr: {
    documentTitle: "Préférences — Bus Lille Ilévia",
    pageSubtitle: "Préférences de l’extension",
    settingsTitle: "Préférences",
    settingsDesc: "Adaptez l’interface à vos habitudes.",
    labelTheme: "Mode sombre",
    hintTheme: "Utiliser le thème sombre dans le popup et cette page",
    labelLang: "Interface en anglais",
    hintLang: "Afficher les textes de l’extension en anglais",
    refreshTitle: "Données en direct",
    refreshDesc: "Réglez la fréquence de mise à jour des prochains passages.",
    labelRefresh: "Fréquence d’actualisation",
    colorLegendTitle: "Code couleur",
    colorLegendDesc: "Couleur du badge et du prochain passage affiché.",
    colorBlueLabel: "Bleu",
    colorBlueDesc: "Plus de 5 minutes · temps réel",
    colorOrangeLabel: "Orange",
    colorOrangeDesc: "Entre 2 et 5 minutes · temps réel",
    colorRedLabel: "Rouge",
    colorRedDesc: "Dans 1 minute ou à l’approche",
    colorGrayLabel: "Gris",
    colorGrayDesc: "Horaire théorique, sans temps réel",
    aboutTitle: "À propos",
    aboutDesc: "Extension open source pour consulter les prochains bus de la métropole lilloise.",
    sourceLink: "Code source",
    issueLink: "Signaler un problème",
    privacyLink: "Confidentialité",
    resetBtn: "Rétablir les réglages par défaut",
    dataNote: "Extension indépendante, non affiliée à Ilévia ou à la MEL. Données ouvertes MEL et Ilévia.",
    saved: "Préférences enregistrées",
    resetSaved: "Réglages par défaut rétablis",
    versionLabel: "Version {version}",
  },
  en: {
    documentTitle: "Preferences — Bus Lille Ilévia",
    pageSubtitle: "Extension preferences",
    settingsTitle: "Preferences",
    settingsDesc: "Adjust the interface to your habits.",
    labelTheme: "Dark mode",
    hintTheme: "Use the dark theme in the popup and on this page",
    labelLang: "Interface in English",
    hintLang: "Display the extension interface in English",
    refreshTitle: "Live data",
    refreshDesc: "Choose how often upcoming departures are refreshed.",
    labelRefresh: "Refresh interval",
    colorLegendTitle: "Colour guide",
    colorLegendDesc: "Colour used for the badge and the next displayed departure.",
    colorBlueLabel: "Blue",
    colorBlueDesc: "More than 5 minutes · live",
    colorOrangeLabel: "Orange",
    colorOrangeDesc: "Between 2 and 5 minutes · live",
    colorRedLabel: "Red",
    colorRedDesc: "1 minute or arriving now",
    colorGrayLabel: "Grey",
    colorGrayDesc: "Scheduled time without live data",
    aboutTitle: "About",
    aboutDesc: "An open-source extension for upcoming buses in the Lille metropolitan area.",
    sourceLink: "Source code",
    issueLink: "Report an issue",
    privacyLink: "Privacy",
    resetBtn: "Restore default settings",
    dataNote: "Independent extension, not affiliated with Ilévia or MEL. Open data from MEL and Ilévia.",
    saved: "Preferences saved",
    resetSaved: "Default settings restored",
    versionLabel: "Version {version}",
  },
};

const elements = Object.fromEntries([
  "pageSubtitle",
  "extensionVersion",
  "settingsTitle",
  "settingsDesc",
  "labelTheme",
  "hintTheme",
  "themeToggle",
  "labelLang",
  "hintLang",
  "langToggle",
  "refreshTitle",
  "refreshDesc",
  "labelRefresh",
  "refreshSlider",
  "refreshValue",
  "colorLegendTitle",
  "colorLegendDesc",
  "colorBlueLabel",
  "colorBlueDesc",
  "colorOrangeLabel",
  "colorOrangeDesc",
  "colorRedLabel",
  "colorRedDesc",
  "colorGrayLabel",
  "colorGrayDesc",
  "aboutTitle",
  "aboutDesc",
  "sourceLink",
  "issueLink",
  "privacyLink",
  "resetBtn",
  "dataNote",
  "savedMsg",
].map((id) => [id, document.getElementById(id)]));

const systemPrefersDark = () => globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
let prefs = normalizePrefs(null, systemPrefersDark());

function t(key, values = {}) {
  let value = I18N[prefs.lang]?.[key] ?? I18N.fr[key] ?? key;
  for (const [name, replacement] of Object.entries(values)) {
    value = value.replaceAll(`{${name}}`, replacement);
  }
  return value;
}

function applyI18n() {
  document.documentElement.lang = prefs.lang;
  document.title = t("documentTitle");
  for (const key of Object.keys(I18N.fr)) {
    if (elements[key]) elements[key].textContent = t(key);
  }
  const version = chrome.runtime.getManifest().version;
  elements.extensionVersion.setAttribute("aria-label", t("versionLabel", { version }));
}

function applyPreferences() {
  document.documentElement.dataset.theme = prefs.theme;
  elements.themeToggle.checked = prefs.theme === "dark";
  elements.langToggle.checked = prefs.lang === "en";

  const index = Number.isInteger(prefs.refreshIdx) ? prefs.refreshIdx : DEFAULT_REFRESH_IDX;
  elements.refreshSlider.value = String(index);
  elements.refreshValue.textContent = REFRESH_STEPS_LABEL[index];
  elements.refreshSlider.style.setProperty("--pct", `${(index / (REFRESH_STEPS_MIN.length - 1)) * 100}%`);
  applyI18n();
}

function showToast(message) {
  elements.savedMsg.textContent = message;
  elements.savedMsg.classList.add("visible");
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => elements.savedMsg.classList.remove("visible"), 1800);
}

async function savePrefs(messageKey = "saved") {
  await chrome.storage.local.set({ [STORAGE_KEYS.prefs]: prefs });
  await chrome.runtime.sendMessage({ type: "prefs:refreshInterval" }).catch(() => null);
  showToast(t(messageKey));
}

function bindEvents() {
  elements.themeToggle.addEventListener("change", async (event) => {
    prefs.theme = event.target.checked ? "dark" : "light";
    applyPreferences();
    await savePrefs();
  });

  elements.langToggle.addEventListener("change", async (event) => {
    prefs.lang = event.target.checked ? "en" : "fr";
    applyPreferences();
    await savePrefs();
  });

  elements.refreshSlider.addEventListener("input", (event) => {
    prefs.refreshIdx = Number(event.target.value);
    applyPreferences();
  });
  elements.refreshSlider.addEventListener("change", () => savePrefs());

  elements.resetBtn.addEventListener("click", async () => {
    prefs = normalizePrefs(null, systemPrefersDark());
    applyPreferences();
    await savePrefs("resetSaved");
  });
}

async function init() {
  const version = chrome.runtime.getManifest().version;
  elements.extensionVersion.textContent = `v${version}`;
  const { [STORAGE_KEYS.prefs]: stored } = await chrome.storage.local.get([STORAGE_KEYS.prefs]);
  prefs = normalizePrefs(stored, systemPrefersDark());
  applyPreferences();
  bindEvents();
}

init().catch((error) => console.error("Options initialization failed", error));
