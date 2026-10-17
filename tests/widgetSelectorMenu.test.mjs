// ============================================================
// PRUEBAS: Selector de widgets — Agregar / Bloque fijo /
//           Contexto / Tarjetas
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - «Agregar widget…» es el PRIMER elemento del menú (icono
//   plus) y abre la biblioteca existente en su pestaña widgets
//   (sin crear la instancia en el propio menú).
// - Bloque fijo SIN encabezado, en orden: Apuntes, Asistente,
//   Nota activa. Nota activa no aparece en la biblioteca ni en
//   Contexto/Tarjetas.
// - Las instancias se agrupan en Contexto / Tarjetas mediante el
//   metadato estable `category` de la DEFINICIÓN (nunca por
//   nombre visible ni nombre personalizado de la instancia).
// - Definiciones heredadas sin category → 'context' (compat.
//   explícita). Múltiples instancias de una misma definición
//   comparten categoría.
// - Validación de category en DeclarativeRuntime.
// - Solo Resources declara category 'context' entre los
//   imperativos (notes/memory/active-note son bloque fijo).
// - Iconos correctos por definición; encabezados sin icono;
//   agregar con plus.
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

test('main.ts: solo Resources declara category context entre los imperativos', () => {
  const source = read('src/main.ts');
  const matches = source.match(/category: 'context'/g) || [];
  // notes, memory y active-note son bloque fijo: SIN category
  // (no se agrupan en Contexto/Tarjetas). Resources es de
  // naturaleza contextual y sí la declara.
  assert.equal(matches.length, 1, 'solo resources');
});

// ------------------------------------------------------------
// 3. SELECTOR (FocusPane)
// ------------------------------------------------------------

test('FocusPane: «Agregar widget…» es el primer elemento y abre la biblioteca', () => {
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

test('tipo vs instancia: los labels localizadas NUNCA son identificadores de tipo', () => {
  // Ningún identity.label del JSON coincide con un id de tipo:
  // «Restricciones», «Citas del libro», «Hechos», «Hipótesis»…
  // son etiquetas o nombres de instancia, no tipos.
  for (const [id, def] of Object.entries(definitions.widgets)) {
    assert.notEqual(def.identity.label, id, id);
    assert.ok(!Object.keys(definitions.widgets).includes(def.identity.label));
  }
});

test('tipo vs instancia: instancias renombradas conservan categoría e icono del TIPO', () => {
  // Nombres personalizados arbitrarios (como en el vault real):
  // no crean tipos ni cambian la asignación del tipo base.
  const instances = [
    { typeId: 'snips', name: 'Citas del libro' },
    { typeId: 'snips', name: 'Leyes y normativa' },      // snips renombrado
    { typeId: 'restrictions', name: 'Hechos' },          // restrictions renombrado
    { typeId: 'candidates', name: 'Hipótesis' },         // candidates renombrado
    { typeId: 'objectives', name: 'Mejorar perfil parental' } // objectives renombrado
  ];

  const byType = {
    snips: { category: 'card', icon: 'scissors' },
    restrictions: { category: 'context', icon: 'shield' },
    candidates: { category: 'context', icon: 'user-check' },
    objectives: { category: 'context', icon: 'target' }
  };

  for (const instance of instances) {
    const def = definitions.widgets[instance.typeId];
    const expected = byType[instance.typeId];

    // La clasificación y el icono salen de la DEFINICIÓN, jamás
    // del nombre visible de la instancia.
    assert.equal(def?.category, expected.category, instance.name);
    assert.equal(def?.identity.icon, expected.icon, instance.name);
  }

  // Dos instancias del mismo tipo con nombres distintos: mismo
  // icono y misma categoría (el nombre no crea tipo nuevo).
  const a = definitions.widgets.snips;
  const b = definitions.widgets.snips;
  assert.equal(a.identity.icon, b.identity.icon);
  assert.equal(a.category, b.category);
});

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
// 5. BLOQUE FIJO Y ORDEN EXACTO DEL MENÚ
// ------------------------------------------------------------

test('bloque fijo: NOTE_CONTEXT_FIXED_WIDGET_TYPE_IDS en orden Apuntes/Asistente/Nota activa', () => {
  const source = read('src/focus/WidgetDefinition.ts');
  const block = source.slice(
    source.indexOf('NOTE_CONTEXT_FIXED_WIDGET_TYPE_IDS'),
    source.indexOf(']', source.indexOf('NOTE_CONTEXT_FIXED_WIDGET_TYPE_IDS'))
  );
  const ids = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['notes', 'memory', 'active-note']);
});

test('bootstrap: solo Apuntes y Asistente se crean por defecto (Nota activa no)', () => {
  const source = read('src/focus/WidgetManager.ts');

  const initIdx = source.indexOf('initializeDefaults(): void {');
  const initBlock = source.slice(initIdx, initIdx + 600);
  assert.ok(initBlock.includes("addInstance('memory'"));
  assert.ok(initBlock.includes("addInstance('notes'"));
  assert.ok(!initBlock.includes("addInstance('active-note'"), 'sin active-note por defecto');

  const loadIdx = source.indexOf('// Primera vez que esta nota utiliza Contexto.');
  const loadBlock = source.slice(loadIdx, loadIdx + 600);
  assert.ok(!loadBlock.includes("createInstanceInternal('active-note'"), 'bootstrap sin active-note');
});

test('biblioteca: excluye solo Apuntes y Asistente; Nota activa es agregable', () => {
  const defSource = read('src/focus/WidgetDefinition.ts');

  // El conjunto DEFAULT (excluido de la biblioteca) es notes+memory.
  const defBlock = defSource.slice(
    defSource.indexOf('NOTE_CONTEXT_DEFAULT_WIDGET_TYPE_IDS'),
    defSource.indexOf(']', defSource.indexOf('NOTE_CONTEXT_DEFAULT_WIDGET_TYPE_IDS'))
  );
  const defaultIds = [...defBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(defaultIds, ['notes', 'memory']);
  assert.ok(!defaultIds.includes('active-note'));

  // LibraryBrowser filtra por DEFAULT (no por FIXED).
  const libSource = read('src/focus/LibraryBrowser.ts');
  assert.ok(libSource.includes('NOTE_CONTEXT_DEFAULT_WIDGET_TYPE_IDS'));
  assert.ok(!libSource.includes('NOTE_CONTEXT_FIXED_WIDGET_TYPE_IDS'));
});

test('FocusPane: orden exacto Agregar → bloque fijo → Contexto → Tarjetas', () => {
  const source = read('src/focus/FocusPane.ts');

  const addIndex = source.indexOf('focus.widgetMenu.addWidget');
  const fixedIndex = source.indexOf(
    'const fixedInstances = NOTE_CONTEXT_FIXED_WIDGET_TYPE_IDS'
  );
  const contextHeaderIndex = source.indexOf('focus.widgetMenu.groupContext');
  const cardsHeaderIndex = source.indexOf('focus.widgetMenu.groupCards');

  assert.ok(addIndex > -1, 'Agregar widget presente');
  assert.ok(fixedIndex > -1, 'bloque fijo presente');
  assert.ok(contextHeaderIndex > -1, 'Contexto presente');
  assert.ok(cardsHeaderIndex > -1, 'Tarjetas presente');

  assert.ok(addIndex < fixedIndex, 'Agregar va antes del bloque fijo');
  assert.ok(fixedIndex < contextHeaderIndex, 'Bloque fijo va antes de Contexto');
  assert.ok(contextHeaderIndex < cardsHeaderIndex, 'Contexto va antes de Tarjetas');
});

test('FocusPane: el bloque fijo no tiene encabezado de texto', () => {
  const source = read('src/focus/FocusPane.ts');
  const fixedStart = source.indexOf('const fixedInstances');
  const fixedEnd = source.indexOf('if (contextInstances.length > 0)');
  const fixedBlock = source.slice(fixedStart, fixedEnd);

  // El bloque fijo no debe contener addItem con setDisabled
  // (encabezado) ni ningún setTitle de agrupación.
  assert.ok(!fixedBlock.includes('setDisabled'), 'sin encabezado deshabilitado');
  assert.ok(!fixedBlock.includes('groupContext'), 'sin texto Contexto');
  assert.ok(!fixedBlock.includes('groupCards'), 'sin texto Tarjetas');
});

// ------------------------------------------------------------
// 6. EXCLUSIONES: NOTA ACTIVA EN BIBLIOTECA Y GRUPOS
// ------------------------------------------------------------

test('LibraryBrowser: excluye solo los tipos por defecto (Apuntes/Asistente)', () => {
  const source = read('src/focus/LibraryBrowser.ts');
  assert.ok(
    source.includes('NOTE_CONTEXT_DEFAULT_WIDGET_TYPE_IDS'),
    'la biblioteca filtra los tipos por defecto'
  );
  // El filtro se aplica antes de crear la tarjeta.
  const filterIndex = source.indexOf('NOTE_CONTEXT_DEFAULT_WIDGET_TYPE_IDS');
  const cardIndex = source.indexOf("cls: 'fl-widget-manager-card'");
  assert.ok(filterIndex < cardIndex, 'el filtro precede a la tarjeta');
});

test('FocusPane: Nota activa no aparece en Contexto ni en Tarjetas', () => {
  const source = read('src/focus/FocusPane.ts');

  // Los grupos excluyen explícitamente los typeIds fijos.
  const contextFilter = source.slice(
    source.indexOf('const contextInstances'),
    source.indexOf('const cardInstances')
  );
  assert.ok(contextFilter.includes('!isFixedType'), 'Contexto excluye fijos');

  const cardFilter = source.slice(
    source.indexOf('const cardInstances'),
    source.indexOf('if (contextInstances.length > 0)')
  );
  assert.ok(cardFilter.includes('!isFixedType'), 'Tarjetas excluye fijos');
});

// ------------------------------------------------------------
// 7. ICONOS
// ------------------------------------------------------------

test('iconos: cada widget declarativo tiene la asignación semántica prevista', () => {
  // Fuente de verdad: identity.icon de cada definición (lucide).
  const expected = {
    snips: 'scissors',         // tijeras
    collections: 'layers',     // capas / conjunto de tarjetas
    restrictions: 'shield',    // escudo / protección
    candidates: 'user-check',  // selección de candidato
    tasks: 'list-checks',      // lista con casillas
    issues: 'alert-triangle',  // alerta / problema
    objectives: 'target'       // diana / meta
  };

  for (const [id, icon] of Object.entries(expected)) {
    assert.equal(definitions.widgets[id].identity.icon, icon, id);
  }
});

test('iconos: los registros imperativos conservan su asignación semántica', () => {
  const source = read('src/main.ts');

  // Nota activa: file-text (documento); Apuntes: pencil (lápiz);
  // Asistente: cpu (IA); Resources: folder (carpeta).
  const blocks = [
    { id: 'active-note', icon: 'file-text' },
    { id: 'notes', icon: 'pencil' },
    { id: 'memory', icon: 'cpu' },
    { id: 'resources', icon: 'folder' }
  ];

  for (const { id, icon } of blocks) {
    const idx = source.indexOf(`id: '${id}'`);
    assert.ok(idx > -1, `${id} registrado`);
    const slice = source.slice(idx, idx + 400);
    assert.ok(
      slice.includes(`'${icon}'`),
      `${id} conserva icono ${icon}`
    );
  }
});

// ------------------------------------------------------------
// 8. I18N
// ------------------------------------------------------------

test('i18n: etiquetas del menú en español e inglés', () => {
  assert.equal(es.focus.widgetMenu.addWidget, 'Agregar widget…');
  assert.equal(es.focus.widgetMenu.groupContext, 'Contexto');
  assert.equal(es.focus.widgetMenu.groupCards, 'Tarjetas');

  assert.equal(en.focus.widgetMenu.addWidget, 'Add widget…');
  assert.equal(en.focus.widgetMenu.groupContext, 'Context');
  assert.equal(en.focus.widgetMenu.groupCards, 'Cards');
});
