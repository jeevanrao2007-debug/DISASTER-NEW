import { translations } from "./translations.js";

const STORAGE_KEY = "disaster_alert_lang";
const EVENT_NAME = "disaster-language-change";

let currentLanguage = "en";

function canUseDom() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function getByPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc && acc[key] != null ? acc[key] : null), obj);
}

function interpolate(template, vars = {}) {
  if (typeof template !== "string") return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : `{${key}}`));
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function detectBrowserLanguage() {
  if (!canUseDom()) return "en";
  const code = (navigator.language || "en").slice(0, 2).toLowerCase();
  return code === "ta" ? "ta" : "en";
}

export function getLanguage() {
  return currentLanguage;
}

export function t(key, fallback = "", vars = {}) {
  const value =
    getByPath(translations[currentLanguage], key) ??
    getByPath(translations.en, key) ??
    fallback ??
    key;

  return interpolate(value, vars);
}

export function translateAlertType(value) {
  const token = normalizeToken(value);
  const key = `alertTypes.${token || "alert"}`;
  return t(key, value || t("alertTypes.alert", "Alert"));
}

export function translateSeverity(value) {
  const token = normalizeToken(value);
  const key = `severity.${token || "moderate"}`;
  return t(key, value || t("severity.moderate", "Moderate"));
}

export function translateDynamicText(value) {
  if (value == null) return "";
  const source = String(value);
  if (!source.trim()) return source;

  let text = source;

  const replacements = [
    ["Flood", translateAlertType("flood")],
    ["Fire", translateAlertType("fire")],
    ["Earthquake", translateAlertType("earthquake")],
    ["Cyclone", translateAlertType("cyclone")],
    ["Landslide", translateAlertType("landslide")],
    ["Accident", translateAlertType("accident")],
    ["Emergency", translateAlertType("emergency")],
    ["Critical", translateSeverity("critical")],
    ["High", translateSeverity("high")],
    ["Moderate", translateSeverity("moderate")],
    ["Low", translateSeverity("low")],
    ["Severity", t("ui.severity", "Severity")],
    ["Alert", t("ui.alert", "Alert")]
  ];

  replacements.forEach(([from, to]) => {
    if (!from || !to || from === to) return;
    const rx = new RegExp(`\\b${from}\\b`, "gi");
    text = text.replace(rx, to);
  });

  return text;
}

export function initLanguage() {
  if (!canUseDom()) return currentLanguage;

  const saved = localStorage.getItem(STORAGE_KEY);
  currentLanguage = saved === "ta" || saved === "en" ? saved : detectBrowserLanguage();

  document.documentElement.lang = currentLanguage;
  applyDocumentTranslations();
  return currentLanguage;
}

export function setLanguage(nextLanguage) {
  const next = nextLanguage === "ta" ? "ta" : "en";
  if (next === currentLanguage) return;

  currentLanguage = next;

  if (canUseDom()) {
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
    applyDocumentTranslations();
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { lang: next } }));
  }
}

export function applyDocumentTranslations(root = document) {
  if (!root || typeof root.querySelectorAll !== "function") return;

  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    el.textContent = t(key, el.textContent);
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    el.setAttribute("placeholder", t(key, el.getAttribute("placeholder") || ""));
  });
}

export function onLanguageChange(callback) {
  if (!canUseDom() || typeof callback !== "function") {
    return () => {};
  }

  const wrapped = (evt) => callback(evt.detail?.lang || currentLanguage);
  window.addEventListener(EVENT_NAME, wrapped);
  return () => window.removeEventListener(EVENT_NAME, wrapped);
}

function setToggleState(enButton, taButton) {
  const isTamil = currentLanguage === "ta";

  if (enButton) {
    enButton.classList.toggle("active", !isTamil);
    enButton.setAttribute("aria-pressed", String(!isTamil));
  }

  if (taButton) {
    taButton.classList.toggle("active", isTamil);
    taButton.setAttribute("aria-pressed", String(isTamil));
  }
}

export function setupLanguageToggle({ enButtonId = "langEnBtn", taButtonId = "langTaBtn" } = {}) {
  if (!canUseDom()) return;

  const enButton = document.getElementById(enButtonId);
  const taButton = document.getElementById(taButtonId);

  if (!enButton || !taButton) return;

  if (!enButton.dataset.langBound) {
    enButton.addEventListener("click", () => setLanguage("en"));
    enButton.dataset.langBound = "true";
  }

  if (!taButton.dataset.langBound) {
    taButton.addEventListener("click", () => setLanguage("ta"));
    taButton.dataset.langBound = "true";
  }

  const sync = () => setToggleState(enButton, taButton);
  sync();
  onLanguageChange(sync);
}
