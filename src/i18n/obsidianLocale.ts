// ============================================================
// OBSIDIAN LOCALE
// ============================================================
// Detección automática del idioma de Obsidian para el servicio
// i18n. Mecanismo: el locale de la app según moment (bundle
// oficial de Obsidian, expuesto globalmente como `moment`).
//
// - `es` y variantes regionales (es-419, es-MX, …) → 'es'.
// - `en` y variantes regionales (en-US, en-GB, …) → 'en'.
// - Cualquier otro idioma (o ausencia de moment) → 'es'
//   (idioma de referencia).
//
// Obsidian no expone un evento oficial de cambio de idioma: la
// detección se ejecuta al cargar el plugin y al abrir la vista.
// Sin polling, sin preferencia persistida en data.json.
// ============================================================

import { i18n, Locale } from './I18nService';

const SUPPORTED_PREFIXES = new Set(['es', 'en']);
const FALLBACK: Locale = 'es';

/**
 * Mapea un locale de la app (p. ej. 'es-419', 'en-US', 'fr') al
 * idioma soportado más específico, o al fallback en español.
 * Pura y testeable sin Obsidian.
 */
export function resolveSupportedLocale(
  appLocale: string | null | undefined
): Locale {
  const base = String(appLocale ?? '')
    .toLowerCase()
    .split(/[-_]/)[0];

  if (SUPPORTED_PREFIXES.has(base)) {
    return base as Locale;
  }

  return FALLBACK;
}

/**
 * Lee el locale de Obsidian (`moment.locale()` del bundle de la
 * app). Si moment no está disponible, devuelve el fallback.
 */
export function detectObsidianLocale(): Locale {
  const momentRef = (
    globalThis as { moment?: { locale?: () => string } }
  ).moment;

  const locale =
    typeof momentRef?.locale === 'function'
      ? momentRef.locale()
      : '';

  return resolveSupportedLocale(locale);
}

/**
 * Aplica el locale detectado al servicio i18n de forma idempotente
 * (solo llama a setLocale si el idioma activo cambia). Devuelve
 * el locale resultante.
 *
 * Usar en el onload del plugin (antes de registrar comandos/vistas)
 * y al abrir la vista para reevaluar cambios de idioma de la app.
 */
export function applyObsidianLocale(): Locale {
  const locale = detectObsidianLocale();

  if (i18n.getLocale() !== locale) {
    i18n.setLocale(locale);
  }

  return locale;
}
