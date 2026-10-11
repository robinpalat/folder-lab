// ============================================================
// PRUEBAS: detección automática del locale de Obsidian
// ============================================================
// Ejecutar con: npm test
//
// Verifica el mapeo es/en con variantes regionales, el fallback
// a español, la aplicación idempotente sobre i18n, la posición
// en el ciclo de vida (onload/onOpen) y la ausencia de
// preferencias persistidas.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const entry = `
export * from './src/i18n/obsidianLocale.ts';
export { i18n } from './src/i18n/I18nService.ts';
`;

const buildResult = await esbuild.build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'entry.ts', loader: 'ts' },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent'
});

const {
  resolveSupportedLocale,
  detectObsidianLocale,
  applyObsidianLocale,
  i18n
} = await import(
  'data:text/javascript;base64,' +
  Buffer.from(buildResult.outputFiles[0].text).toString('base64')
);

// ============================================================
// 1. MAPEO DE LOCALES (puro)
// ============================================================

test('locale español y variantes regionales → es', () => {
  for (const locale of ['es', 'es-ES', 'es-419', 'es-MX', 'es_ES', 'ES', 'Es-419']) {
    assert.equal(resolveSupportedLocale(locale), 'es', locale);
  }
});

test('locale inglés y variantes regionales → en', () => {
  for (const locale of ['en', 'en-US', 'en-GB', 'en_US', 'EN', 'En-US']) {
    assert.equal(resolveSupportedLocale(locale), 'en', locale);
  }
});

test('idiomas no admitidos y entradas vacías → fallback es', () => {
  for (const locale of ['fr', 'de', 'zh-CN', 'pt-BR', 'ja', '', null, undefined]) {
    assert.equal(resolveSupportedLocale(locale), 'es', String(locale));
  }
});

// ============================================================
// 2. DETECCIÓN VIA moment (bundle de Obsidian)
// ============================================================

test('detectObsidianLocale lee moment.locale() y mapea', () => {
  try {
    globalThis.moment = { locale: () => 'es-419' };
    assert.equal(detectObsidianLocale(), 'es');

    globalThis.moment = { locale: () => 'en-US' };
    assert.equal(detectObsidianLocale(), 'en');

    globalThis.moment = { locale: () => 'fr' };
    assert.equal(detectObsidianLocale(), 'es');
  } finally {
    delete globalThis.moment;
  }
});

test('sin moment disponible (o sin función locale) → fallback es', () => {
  try {
    delete globalThis.moment;
    assert.equal(detectObsidianLocale(), 'es');

    globalThis.moment = {};
    assert.equal(detectObsidianLocale(), 'es');
  } finally {
    delete globalThis.moment;
  }
});

// ============================================================
// 3. APLICACIÓN IDEMPOTENTE SOBRE i18n
// ============================================================

test('applyObsidianLocale actualiza el idioma activo', () => {
  try {
    globalThis.moment = { locale: () => 'en-GB' };
    const applied = applyObsidianLocale();
    assert.equal(applied, 'en');
    assert.equal(i18n.getLocale(), 'en');
  } finally {
    delete globalThis.moment;
    i18n.setLocale('es');
  }
});

test('applyObsidianLocale es idempotente y vuelve a es con locale no admitido', () => {
  try {
    globalThis.moment = { locale: () => 'en' };
    assert.equal(applyObsidianLocale(), 'en');
    // Segunda llamada: mismo resultado, sin cambios.
    assert.equal(applyObsidianLocale(), 'en');
    assert.equal(i18n.getLocale(), 'en');

    // Cambio de idioma de la app a uno no admitido → fallback.
    globalThis.moment = { locale: () => 'fr' };
    assert.equal(applyObsidianLocale(), 'es');
    assert.equal(i18n.getLocale(), 'es');
  } finally {
    delete globalThis.moment;
    i18n.setLocale('es');
  }
});

// ============================================================
// 4. CICLO DE VIDA Y AUSENCIA DE PREFERENCIA PERSISTIDA
// ============================================================

test('onload aplica el locale antes de registrar vistas y comandos', () => {
  const source = readFileSync(join(root, 'src', 'main.ts'), 'utf8');

  const onloadSection = source.slice(
    source.indexOf('async onload()'),
    source.indexOf('async onload()') + 2500
  );

  const applyIdx = onloadSection.indexOf('applyObsidianLocale()');
  assert.ok(applyIdx > -1, 'applyObsidianLocale en onload');

  // Antes del primer registerView y del primer addCommand.
  const registerIdx = onloadSection.indexOf('registerView(');
  const commandIdx = onloadSection.indexOf('addCommand(');
  assert.ok(registerIdx === -1 || applyIdx < registerIdx, 'antes de registerView');
  assert.ok(commandIdx === -1 || applyIdx < commandIdx, 'antes de addCommand');
});

test('la vista reevalúa el locale al abrirse', () => {
  const source = readFileSync(
    join(root, 'src', 'views', 'FolderLabView.ts'),
    'utf8'
  );

  const onOpenSection = source.slice(
    source.indexOf('async onOpen()'),
    source.indexOf('private showExplorerMode')
  );

  assert.ok(onOpenSection.includes('applyObsidianLocale()'));
  // Idempotente: sin renderizados forzados por el locale.
  assert.ok(!onOpenSection.includes('setTimeout'));
});

test('sin preferencia de idioma persistida ni migración de datos', () => {
  const localeSource = readFileSync(
    join(root, 'src', 'i18n', 'obsidianLocale.ts'),
    'utf8'
  );
  const settingsSource = readFileSync(
    join(root, 'src', 'config', 'settings.ts'),
    'utf8'
  );
  const mainSource = readFileSync(join(root, 'src', 'main.ts'), 'utf8');

  // El módulo de locale no toca ajustes ni persistencia.
  assert.ok(!localeSource.includes('saveSettings'));
  assert.ok(!localeSource.includes('saveData'));
  assert.ok(!localeSource.includes('bookWordGoal'));

  // Ninguna clave de idioma en los ajustes por defecto.
  assert.ok(!settingsSource.includes('bookWordGoal: 0\n  language'));
  assert.ok(!/language:|locale:|appLocale:/.test(settingsSource));

  // main.ts no persiste el idioma detectado.
  assert.ok(!mainSource.includes('this.settings.language'));
  assert.ok(!mainSource.includes('this.settings.locale'));
});
