// ============================================================
// I18N SERVICE
// ============================================================
// Servicio central de internacionalización. Módulo puro (sin
// Obsidian, sin E/S en tiempo de ejecución): los catálogos
// es.json / en.json se importan estáticamente y quedan
// inlineados en el bundle por esbuild.
//
// API:
// - t(key, params?)   → cadena resolviendo claves anidadas
//                       ('a.b.c') con parámetros {name}.
// - tn(key, count)    → pluralización con Intl.PluralRules
//                       sobre subclaves .one/.other, exponiendo
//                       {count} a la plantilla.
//
// Idioma activo: español ('es'), también idioma de referencia
// (fallback). Diagnóstico de claves inexistentes vía
// onMissingKey (o console.warn por defecto).
// ============================================================

import defaultEs from './locales/es.json';
import defaultEn from './locales/en.json';

export type Locale = 'es' | 'en';

export interface PluralForms {
  one: string;
  other: string;
}

export type I18nParams = Record<string, string | number>;

export type Catalog = Record<string, unknown>;

export interface I18nServiceOptions {
  /**
   * Se invoca cuando una clave no existe en el idioma activo
   * (aunque luego se resuelva por fallback). Diagnóstico de
   * desarrollo: en producción el valor sigue resolviéndose.
   */
  onMissingKey?: (key: string, locale: Locale) => void;
}

const FALLBACK_LOCALE: Locale = 'es';
const SUPPORTED_LOCALES: readonly Locale[] = ['es', 'en'];

function isPluralForms(value: unknown): value is PluralForms {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PluralForms).one === 'string' &&
    typeof (value as PluralForms).other === 'string'
  );
}

/**
 * Recorre una clave anidada ('a.b.c') sobre un catálogo.
 * Devuelve la cadena, las formas de plural o undefined.
 */
function resolveKey(catalog: Catalog | undefined, key: string): unknown {
  if (!catalog) return undefined;

  let current: unknown = catalog;

  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export class I18nService {
  private locale: Locale = FALLBACK_LOCALE;
  private readonly catalogs: Record<Locale, Catalog>;
  private readonly onMissingKey: ((key: string, locale: Locale) => void) | null;
  private pluralRules: Intl.PluralRules;

  constructor(
    catalogs: Partial<Record<Locale, Catalog>>,
    options: I18nServiceOptions = {}
  ) {
    this.catalogs = {
      es: catalogs.es ?? {},
      en: catalogs.en ?? catalogs.es ?? {}
    };
    this.onMissingKey = options.onMissingKey ?? null;
    this.pluralRules = new Intl.PluralRules(this.locale);
  }

  getLocale(): Locale {
    return this.locale;
  }

  /**
   * Indica si una clave existe en el idioma activo o en el de
   * referencia (fallback). Permite resolvers de texto con
   * fallback externo (p. ej. valores heredados de JSON).
   */
  has(key: string): boolean {
    return (
      resolveKey(this.catalogs[this.locale], key) !== undefined ||
      resolveKey(this.catalogs[FALLBACK_LOCALE], key) !== undefined
    );
  }

  /**
   * Cambia el idioma activo y regenera las reglas de plural.
   * Idiomas no soportados se ignoran.
   */
  setLocale(locale: Locale): void {
    if (!SUPPORTED_LOCALES.includes(locale)) return;

    this.locale = locale;
    this.pluralRules = new Intl.PluralRules(locale);
  }

  /**
   * Resuelve una clave anidadas con parámetros {name}.
   *
   * - Cadena → se sustituyen los parámetros.
   * - Objeto plural ({one, other}) → se usa la forma 'other'
   *   (para plurales usar tn()).
   * - Ausente en el idioma activo → diagnóstico + fallback al
   *   español; ausente en ambos → se devuelve la propia clave.
   */
  t(key: string, params?: I18nParams): string {
    const value = this.lookup(key);
    return this.format(this.toTemplate(value, key), params);
  }

  /**
   * Resuelve una clave con pluralización según el recuento,
   * usando Intl.PluralRules del idioma activo sobre las
   * subclaves .one/.other.
   *
   * Devuelve SOLO la forma inflecta (p. ej. «nota»/«notas»),
   * pensada para componer: `${count} ${tn('stats.note', count)}`.
   * El recuento queda disponible como {count} por si una plantilla
   * quiere incorporarlo explícitamente.
   *
   * LIMITACIÓN CONOCIDA (documentada en la auditoría de cierre):
   * los catálogos solo tienen formas one/other, suficientes para
   * los idiomas admitidos (es/en). Cualquier categoría de
   * Intl.PluralRules distinta de 'one' (p. ej. 'few'/'many' en
   * ruso o árabe) colapsa a 'other'. Añadir un idioma con más
   * categorías exige ampliar el contrato de claves plurales
   * (p. ej. subclaves few/many) antes de declararlo soportado.
   */
  tn(key: string, count: number, params?: I18nParams): string {
    const value = this.lookup(key);

    let template: string;

    if (isPluralForms(value)) {
      // Solo existen las formas 'one' y 'other' en los
      // catálogos (es/en); cualquier otra categoría de
      // Intl.PluralRules cae a 'other'.
      const form = this.pluralRules.select(count);
      template = form === 'one' ? value.one : value.other;
    } else {
      // Sin formas de plural: se trata como cadena normal.
      template = this.toTemplate(value, key);
    }

    return this.format(template, { count, ...params });
  }

  // ------------------------------------------------------------
  // INTERNAS
  // ------------------------------------------------------------

  /**
   * Busca la clave en el idioma activo; si falta, diagnostica
   * y prueba el idioma de referencia.
   */
  private lookup(key: string): string | PluralForms | undefined {
    const inActive = resolveKey(this.catalogs[this.locale], key);

    if (inActive !== undefined) {
      return inActive as string | PluralForms;
    }

    this.reportMissing(key);

    if (this.locale === FALLBACK_LOCALE) {
      return undefined;
    }

    const inFallback = resolveKey(this.catalogs[FALLBACK_LOCALE], key);
    return inFallback as string | PluralForms | undefined;
  }

  /**
   * Convierte el valor resuelto en plantilla de texto.
   */
  private toTemplate(value: string | PluralForms | undefined, key: string): string {
    if (typeof value === 'string') return value;

    // t() sobre una clave plural: forma 'other' por defecto.
    if (isPluralForms(value)) return value.other;

    // Clave ausente en ambos idiomas: se devuelve la clave
    // (señal visible de bug, ya diagnosticado).
    return key;
  }

  private reportMissing(key: string): void {
    if (this.onMissingKey) {
      this.onMissingKey(key, this.locale);
      return;
    }

    console.warn(
      `[i18n] Clave no encontrada: "${key}" (locale "${this.locale}")`
    );
  }

  /**
   * Sustituye los placeholders {name} por los parámetros.
   * Un parámetro ausente deja su placeholder literal.
   */
  private format(template: string, params?: I18nParams): string {
    if (!params) return template;

    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name];
      return value === undefined ? match : String(value);
    });
  }
}

// ============================================================
// SINGLETON
// ============================================================
// Catálogos importados estáticamente: esbuild los incluye en
// main.js (no hay lectura de archivos en tiempo de ejecución).
// ============================================================

export const i18n = new I18nService({
  es: defaultEs,
  en: defaultEn
});
