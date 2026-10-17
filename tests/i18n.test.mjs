// ============================================================
// PRUEBAS: infraestructura i18n (I18nService + catálogos)
// ============================================================
// Ejecutar con: npm test
//
// El servicio se empaqueta con esbuild (mismo mecanismo que el
// build del plugin) para verificar que los catálogos JSON quedan
// inlineados en el bundle y el módulo funciona sin E/S.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// ------------------------------------------------------------
// Empaquetado del servicio (JSON inlineados, sin E/S)
// ------------------------------------------------------------
const buildResult = await esbuild.build({
  entryPoints: [join(root, 'src', 'i18n', 'I18nService.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent'
});

const bundleCode = buildResult.outputFiles[0].text;
const bundleUrl =
  'data:text/javascript;base64,' +
  Buffer.from(bundleCode).toString('base64');

const { I18nService, i18n } = await import(bundleUrl);

// ------------------------------------------------------------
// Utilidades de catálogo (lectura directa de los JSON fuente)
// ------------------------------------------------------------
const esCatalog = JSON.parse(
  readFileSync(join(root, 'src', 'i18n', 'locales', 'es.json'), 'utf8')
);
const enCatalog = JSON.parse(
  readFileSync(join(root, 'src', 'i18n', 'locales', 'en.json'), 'utf8')
);

/** Aplana el catálogo; los objetos {one, other} son hojas. */
function flatten(catalog, prefix = '') {
  const out = new Map();

  for (const [key, value] of Object.entries(catalog)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (
      value !== null &&
      typeof value === 'object' &&
      !('one' in value && 'other' in value)
    ) {
      for (const [k, v] of flatten(value, fullKey)) {
        out.set(k, v);
      }
    } else {
      out.set(fullKey, value);
    }
  }

  return out;
}

/** Extrae el conjunto de placeholders {name} de una plantilla. */
function placeholders(text) {
  return new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

// ============================================================
// 1. IDIOMA POR DEFECTO
// ============================================================

test('el idioma activo por defecto es español', () => {
  assert.equal(i18n.getLocale(), 'es');
  assert.equal(i18n.t('common.cancel'), 'Cancelar');
});

test('setLocale acepta soportados e ignora los demás', () => {
  i18n.setLocale('en');
  assert.equal(i18n.getLocale(), 'en');

  i18n.setLocale('xx');
  assert.equal(i18n.getLocale(), 'en');

  i18n.setLocale('es');
  assert.equal(i18n.getLocale(), 'es');
});

// ============================================================
// 2. RESOLUCIÓN DE CLAVES ANIDADAS
// ============================================================

test('resuelve claves anidadas en cualquier profundidad', () => {
  assert.equal(i18n.t('common.cancel'), 'Cancelar');
  assert.equal(i18n.t('settings.ai.provider.name'), 'Proveedor');
  assert.equal(
    i18n.t('board.architecture.action.moveUp'),
    'Mover arriba'
  );
  assert.equal(i18n.t('stats.zeroNotes'), '0 notas');
});

test('clave inexistente devuelve la propia clave (señal de bug)', () => {
  assert.equal(i18n.t('no.existe.está.clave'), 'no.existe.está.clave');
});

// ============================================================
// 3. PARÁMETROS DINÁMICOS
// ============================================================

test('sustituye parámetros {name} en plantillas', () => {
  assert.equal(
    i18n.t('notes.created', { name: 'Capítulo 1.md' }),
    'Nota creada: Capítulo 1.md'
  );
  assert.equal(
    i18n.t('folders.created', { name: 'Apéndice' }),
    'Carpeta creada: Apéndice'
  );
});

test('sustituye múltiples parámetros', () => {
  assert.equal(
    i18n.t('notices.contextTestResult', { name: 'nota.md', length: 42 }),
    '✅ Contexto: nota.md (42 caracteres)'
  );
  assert.equal(
    i18n.t('errors.folder.alreadyExists', { name: 'assets' }),
    'Ya existe una carpeta con el nombre "assets"'
  );
});

test('parámetro ausente deja el placeholder literal', () => {
  const result = i18n.t('notes.created', {});
  assert.equal(result, 'Nota creada: {name}');
});

// ============================================================
// 4. PLURALIZACIÓN CON Intl.PluralRules
// ============================================================

test('tn devuelve la forma inflecta para componer (formatCount)', () => {
  // Contrato: `${count} ${tn(...)}` — misma composición que el
  // formatCount actual de headerStats.
  assert.equal(`1 ${i18n.tn('stats.note', 1)}`, '1 nota');
  assert.equal(`2 ${i18n.tn('stats.note', 2)}`, '2 notas');
  assert.equal(`0 ${i18n.tn('stats.note', 0)}`, '0 notas');
  assert.equal(`1 ${i18n.tn('stats.folder', 1)}`, '1 carpeta');
  assert.equal(`8 ${i18n.tn('stats.folder', 8)}`, '8 carpetas');
  assert.equal(i18n.tn('stats.note', 1), 'nota');
  assert.equal(i18n.tn('stats.note', 5), 'notas');
});

test('tn pluraliza en inglés según el locale activo', () => {
  i18n.setLocale('en');
  try {
    assert.equal(i18n.tn('stats.note', 1), 'note');
    assert.equal(i18n.tn('stats.note', 2), 'notes');
    assert.equal(i18n.tn('stats.folder', 1), 'folder');
    assert.equal(i18n.tn('stats.folder', 8), 'folders');
  } finally {
    i18n.setLocale('es');
  }
});

test('el recuento queda disponible como {count} en la plantilla', () => {
  const service = new I18nService({
    es: { items: { one: '{count} elemento', other: '{count} elementos' } }
  });

  assert.equal(service.tn('items', 3), '3 elementos');
});

test('t() sobre una clave plural usa la forma other', () => {
  assert.equal(i18n.t('stats.note'), 'notas');
});

// ============================================================
// 5. FALLBACK AL ESPAÑOL Y DIAGNÓSTICO
// ============================================================

test('clave ausente en el idioma activo cae al fallback español', () => {
  const missing = [];
  const service = new I18nService(
    {
      es: { saludo: 'Hola' },
      en: {}
    },
    { onMissingKey: (key, locale) => missing.push({ key, locale }) }
  );

  service.setLocale('en');
  assert.equal(service.t('saludo'), 'Hola');
  assert.deepEqual(missing, [{ key: 'saludo', locale: 'en' }]);
});

test('clave ausente en ambos idiomas: diagnóstico + devuelve la clave', () => {
  const missing = [];
  const service = new I18nService(
    { es: {}, en: {} },
    { onMissingKey: (key) => missing.push(key) }
  );

  assert.equal(service.t('una.clave.rota'), 'una.clave.rota');
  assert.deepEqual(missing, ['una.clave.rota']);
});

test('sin onMissingKey, la clave ausente en es diagnostica (console.warn)', () => {
  const warns = [];
  const originalWarn = console.warn;
  console.warn = (message) => warns.push(message);

  try {
    const service = new I18nService({ es: {}, en: {} });
    service.t('clave.ausente');
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warns.length, 1);
  assert.ok(warns[0].includes('clave.ausente'));
  assert.ok(warns[0].includes('"es"'));
});

// ============================================================
// 6. PARIDAD DE CATÁLOGOS (claves, tipos e interpolaciones)
// ============================================================

test('es.json y en.json tienen exactamente el mismo conjunto de claves', () => {
  const esKeys = [...flatten(esCatalog).keys()].sort();
  const enKeys = [...flatten(enCatalog).keys()].sort();

  assert.ok(esKeys.length > 300, `catálogo demasiado pequeño: ${esKeys.length}`);
  assert.deepEqual(esKeys, enKeys);
});

test('todas las hojas son cadenas o formas de plural completas', () => {
  for (const [catalogName, catalog] of [['es', esCatalog], ['en', enCatalog]]) {
    for (const [key, value] of flatten(catalog)) {
      const isString = typeof value === 'string';
      const isPlural =
        value !== null &&
        typeof value === 'object' &&
        typeof value.one === 'string' &&
        typeof value.other === 'string' &&
        Object.keys(value).length === 2;

      assert.ok(
        isString || isPlural,
        `${catalogName}: hoja inválida en "${key}": ${JSON.stringify(value)}`
      );
    }
  }
});

test('cada clave usa los mismos parámetros en ambos idiomas', () => {
  const esFlat = flatten(esCatalog);
  const enFlat = flatten(enCatalog);

  for (const [key, esValue] of esFlat) {
    const enValue = enFlat.get(key);

    const esParams = placeholders(esValue);
    const enParams = placeholders(enValue);

    assert.deepEqual(
      [...esParams].sort(),
      [...enParams].sort(),
      `parámetros distintos en "${key}"`
    );
  }
});

test('las claves plurales cubren one y other en ambos idiomas', () => {
  let pluralKeys = 0;

  for (const [key, value] of flatten(esCatalog)) {
    if (value !== null && typeof value === 'object' && 'one' in value) {
      pluralKeys++;
      const enValue = flatten(enCatalog).get(key);
      assert.equal(typeof enValue.one, 'string', `en: falta one en "${key}"`);
      assert.equal(typeof enValue.other, 'string', `en: falta other en "${key}"`);
    }
  }

  assert.ok(pluralKeys >= 6, `demasiadas pocas claves plurales: ${pluralKeys}`);
});

// ============================================================
// 7. EMPAQUETADO EN EL BUNDLE (sin E/S en tiempo de ejecución)
// ============================================================

test('los catálogos quedan inlineados en el bundle, sin lectura de archivos', () => {
  // Cadenas representativas de distintos dominios presentes en
  // el bundle empaquetado.
  assert.ok(bundleCode.includes('Cancelar'));
  assert.ok(bundleCode.includes('Archivos compartidos de la carpeta'));
  assert.ok(bundleCode.includes('Arquitectura del documento'));

  // El servicio no usa módulos de E/S de Node.
  assert.ok(!bundleCode.includes('require("fs")'));
  assert.ok(!bundleCode.includes("require('fs')"));
  assert.ok(!bundleCode.includes('readFileSync'));
  assert.ok(!bundleCode.includes('node:fs'));
});
