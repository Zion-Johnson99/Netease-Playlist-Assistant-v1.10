import type { AppLocale } from "./config.js";

export function text(locale: AppLocale, cn: string, en: string): string {
  return locale === "en" ? en : cn;
}

export function localeDisplayName(locale: AppLocale): string {
  return text(locale, "中文", "English");
}

export function formatSupportedModels(locale: AppLocale): string {
  return text(
    locale,
    "deepseek-v4-pro 或 deepseek-v4-flash",
    "deepseek-v4-pro or deepseek-v4-flash",
  );
}
