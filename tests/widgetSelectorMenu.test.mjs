// ============================================================
// PRUEBAS: Selector de widgets — Añadir / Contexto / Tarjetas
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - «Añadir widget…» es el PRIMER elemento del menú y abre la
//   biblioteca existente en su pestaña widgets (sin crear la
//   instancia en el propio menú).
// - Las instancias se agrupan en Contexto / Tarjetas mediante el
//   metadato estable `category` de la DEFINICIÓN (nunca por
//   nombre visible ni nombre personalizado de la instancia).
// - Definiciones heredadas sin category → 'context' (compat.
//   explícita). Múltiples instancias de una misma definición
//   comparten categoría.
// - Validación de category en DeclarativeRuntime.
// - Registros imperativos (notes/memory/resources/active-note)
//   declaran category 'context'.
// - Traducciones es/en del menú.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const definitions = JSON.parse(read('src/focus/widget-definitions.json'));
const es = JSON.parse(read('src/i18n/locales/es.json'));
const en = JSON.parse(read('src/i18n/locales/en.json'));

// ------------------------------------------------------------
// 1. METADATO category EN DEFINICIONES
// ------------------------------------------------------------

test('category: clasificación estable de los widgets declarativos', () => {
  assert.equal(definitions.widgets.snips.category, 'card');
  assert.equal(definitions.widgets.collections.category, 'card');

  for (const id of [
    'restrictions', 'candidates', 'tasks', 'issues', 'objectives'
  ]) {
    assert.equal(definitions.widgets[id].category, 'context', id);
  }
});

test('category: valores siempre ∈ {context, card}', () => {
  for (const [id, def] of Object.entries(definitions.widgets)) {
    assert.ok(
      def.category === 'context' || def.category === 'card',
      `${id}: ${def.category}`
    );
  }
});

// ------------------------------------------------------------
// 2. REGISTROS IMPERATIVOS
// ------------------------------------------------------------

test('main.ts: registros imperativos declaran category context', () => {
  const source = read('src/main.ts');
  const matches = source.match(/category: 'context'/g) || [];
  assert.equal(matches.length, 4, 'notes, memory, resources, active-note');
});

// ------------------------------------------------------------
// 3. SELECTOR (FocusPane)
// ------------------------------------------------------------

test('FocusPane: «Añadir widget…» es el primer elemento y abre la biblioteca', () => {
  const source = read('src/focus/FocusPane.ts');

  const addIndex = source.indexOf("focus.widgetMenu.addWidget");
  const groupContextIndex = source.indexOf("focus.widgetMenu.groupContext");
  const instancesIndex = source.indexOf('getInstances()');

  assert.ok(addIndex > -1);
  // Orden: Añadir → separador/grupos → instancias.
  assert.ok(addIndex < groupContextIndex);
  assert.ok(addIndex < instancesIndex);

  // Abre la biblioteca existente en la pestaña widgets.
  assert.ok(source.includes('new LibraryBrowser('));
  assert.ok(source.includes("'widgets'"));

  // La creación de instancias NO ocurre en el menú.
  assert.ok(!source.includes('createInstance('));
  assert.ok(!source.includes('applyInstances('));
});

test('FocusPane: grupos con encabezados deshabilitados y separadores', () => {
  const source = read('src/focus/FocusPane.ts');
  assert.ok(source.includes('.setDisabled(true)'));
  assert.ok(source.includes('menu.addSeparator()'));
  assert.ok(source.includes("focus.widgetMenu.groupCards"));
});

test('FocusPane: la categoría se resuelve desde la definición (typeId), no del nombre', () => {
  const source = read('src/focus/FocusPane.ts');
  // Regla de compatibilidad explícita.
  assert.ok(source.includes('?.category ??'));
  assert.ok(source.includes("'context'"));
  // Nunca se usa instance.name para clasificar.
  const classifyBlock = source.slice(
    source.indexOf('getWidgetCategory'),
    source.indexOf('private showWidgetMenu')
  );
  assert.ok(!classifyBlock.includes('instance.name'));
});

// ------------------------------------------------------------
// 4. BIBLIOTECA
// ------------------------------------------------------------

test('LibraryBrowser: initialTab y sincronización en onOpen', () => {
  const source = read('src/focus/LibraryBrowser.ts');
  assert.ok(source.includes("initialTab: BrowserTab = 'assistant'"));
  // onOpen sincroniza la pestaña inicial vía selectTab.
  assert.ok(source.includes('this.selectTab(\n      this.selectedTab,'));
  // La selección de la pestaña assistant vive SOLO dentro de
  // selectTab (una ocurrencia); onOpen no la codifica a mano.
  const selectedCount = (source.match(/assistantTab\.addClass\('is-selected'\);/g) || []).length;
  assert.equal(selectedCount, 1);
});

// ------------------------------------------------------------
// 5. VALIDACIÓN DEL RUNTIME
// ------------------------------------------------------------

test('DeclarativeRuntime: valida category (context|card)', () => {
  const source = read('src/focus/DeclarativeRuntime.ts');
  assert.ok(source.includes('category inválido'));
});

// ------------------------------------------------------------
// 6. LÓGICA DE CLASIFICACIÓN (simulación del contrato)
// ------------------------------------------------------------

test('clasificación: regla category ?? context sobre definiciones reales', () => {
  const categoryOf = (def) => def?.category ?? 'context';

  // Definición heredada sin category → context (compat. segura).
  assert.equal(categoryOf({ id: 'legacy' }), 'context');

  // Varias instancias de una misma definición comparten categoría
  // (la regla depende solo de la definición, no de la instancia).
  const instances = [
    { instanceId: 'collections-1', typeId: 'collections', name: 'Referencias' },
    { instanceId: 'collections-2', typeId: 'collections', name: 'Ideas ★' },
    { instanceId: 'snips-1', typeId: 'snips', name: 'Recortes' },
    { instanceId: 'issues-1', typeId: 'issues', name: 'Incidencias 2026' }
  ];

  const groups = { context: [], card: [] };
  for (const instance of instances) {
    const def = definitions.widgets[instance.typeId];
    groups[categoryOf(def)].push(instance.instanceId);
  }

  assert.deepEqual(groups.card.sort(), ['collections-1', 'collections-2', 'snips-1']);
  assert.deepEqual(groups.context, ['issues-1']);

  // Renombrar una instancia NO altera su clasificación.
  const renamed = { ...instances[0], name: 'Nuevo nombre libre' };
  assert.equal(
    categoryOf(definitions.widgets[renamed.typeId]),
    categoryOf(definitions.widgets[instances[0].typeId])
  );
});

// ------------------------------------------------------------
// 7. I18N
// ------------------------------------------------------------

test('i18n: etiquetas del menú en español e inglés', () => {
  assert.equal(es.focus.widgetMenu.addWidget, 'Añadir widget…');
  assert.equal(es.focus.widgetMenu.groupContext, 'Contexto');
  assert.equal(es.focus.widgetMenu.groupCards, 'Tarjetas');

  assert.equal(en.focus.widgetMenu.addWidget, 'Add widget…');
  assert.equal(en.focus.widgetMenu.groupContext, 'Context');
  assert.equal(en.focus.widgetMenu.groupCards, 'Cards');
});
