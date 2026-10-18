// ============================================================
// PRUEBAS: widgetInstances → PromptBuilder (filtrado + prompt)
// ============================================================
// Ejecutar con: npm test
//
// - Instancia con 3 bloques (2 activos, 1 inactivo) → exactamente 2.
// - Varias instancias separadas e identificadas.
// - Bloque inactivo no aparece en el prompt final.
// - Notes: distingue texto del editor de bloques guardados.
// - Tasks: excluye completadas.
// - Instancia no seleccionada no aporta contenido.
// - Selección de capacidades no modifica bloques elegibles.
// - Widget sin modelo inspeccionado no envía todos sus datos.
// - Ausencia de instancias no activa el contexto heredado.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const OBSIDIAN_STUB = `
export class App {}
export class TFile {}
export class TFolder {}
export class Component { load() {} onunload() {} register() {} registerEvent() {} registerDomEvent() {} addChild() {} removeChild() {} }
export class Modal { constructor(app) { this.app = app; this.contentEl = { empty() {}, createEl() { return {}; }, createDiv() { return {}; } }; this.titleEl = { setText() {} }; } open() {} close() {} }
export class Menu { constructor() { this.items = []; } addItem(cb) { const it = { setTitle(){return this;}, setIcon(){return this;}, setChecked(){return this;}, setDisabled(){return this;}, onClick(){return this;} }; cb(it); this.items.push(it); return this; } addSeparator(){return this;} showAtPosition(){} onHide(){} hide(){} }
export function setIcon(el, icon) { if (el) el.icon = icon; }
export class MarkdownRenderer { static render() { return Promise.resolve(); } }
export class Notice { constructor(m) {} }
export default {};
`;

async function bundle(entryRel) {
  const result = await build({
    entryPoints: [join(root, entryRel)],
    bundle: true, write: false, format: 'esm', platform: 'neutral',
    plugins: [{
      name: 'obsidian-stub',
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'obsidian-stub' }));
        b.onLoad({ filter: /.*/, namespace: 'obsidian-stub' }, () => ({ contents: OBSIDIAN_STUB, loader: 'js' }));
      }
    }]
  });
  const code = result.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const { ContextResolver } = await bundle('src/ai/context/ContextResolver.ts');
const { PromptBuilder } = await bundle('src/ai/prompt/PromptBuilder.ts');

// ---- Definiciones de widget simuladas ----
const SNIPS_DEF = {
  id: 'snips',
  state: { field: 'active', initial: true, toggleable: true },
  semantic: { contentType: 'snippets', role: 'context' }
};
const TASKS_DEF = {
  id: 'tasks',
  state: { field: 'completed', initial: true, toggleable: true },
  semantic: { contentType: 'tasks', role: 'context' }
};
const COLLECTIONS_DEF = {
  id: 'collections',
  state: { field: 'active', initial: true, toggleable: true },
  semantic: { contentType: 'facts', role: 'context' }
};
const NOTES_DEF = {
  id: 'notes',
  cardinality: 'singleton',
  identity: { label: 'Apuntes' }
  // Sin state → criterio especial (draft + bloques activos).
};
const MEMORY_DEF = {
  id: 'memory',
  cardinality: 'singleton',
  identity: { label: 'Asistente' }
  // Sin state → no incluir (requisito 8).
};

function makeResolver({ instances = [], definitions = {}, storageData = {}, draftStoreData = null }) {
  const widgetManager = {
    getInstances: () => [...instances],
    getDefinition: (typeId) => definitions[typeId]
  };
  const widgetController = {
    storage: {
      get: async (typeId, notePath, instanceId) =>
        storageData[instanceId] ?? null
    }
  };
  const plugin = {
    settings: {},
    draftStore: draftStoreData
      ? { read: async (path) => draftStoreData }
      : null
  };
  const notesController = {
    getActiveSource: async () => plugin.__draftText ?? ''
  };
  const resolver = new ContextResolver(
    {},
    plugin,
    widgetController,
    widgetManager
  );
  // Inyectar notesController (es privado pero accesible en runtime).
  resolver.notesController = notesController;
  return { resolver, plugin, notesController };
}

function makePromptContext({ widgetInstances, contextMode, contextType = 'note', noteContent = 'contenido nota' }) {
  return {
    note: { path: 'Libro/N.md', name: 'N', content: noteContent, metadata: {} },
    folder: { path: 'Libro', name: 'Libro' },
    contextType,
    session: { id: 's1', history: [] },
    execution: { temperature: 0.3, maxTokens: 500 },
    additional: {
      ...(contextMode !== undefined ? { contextMode } : {}),
      ...(widgetInstances !== undefined ? { widgetInstances } : {})
    }
  };
}

const TEMPLATE = { system: 'Sys', user: 'Analiza: {noteName}' };

// ============================================================
// Tests de filtrado (ContextResolver)
// ============================================================

test('instancia con 3 bloques (2 activos, 1 inactivo) → exactamente 2', async () => {
  const { resolver } = makeResolver({
    instances: [{ instanceId: 's1', typeId: 'snips', name: 'Snips' }],
    definitions: { snips: SNIPS_DEF },
    storageData: {
      s1: {
        items: [
          { text: 'fragmento activo 1', active: true },
          { text: 'fragmento inactivo', active: false },
          { text: 'fragmento activo 2', active: true }
        ]
      }
    }
  });
  const result = await resolver.resolveWidgetInstances(['s1'], 'Libro/N.md');
  assert.equal(result.length, 1);
  assert.equal(result[0].items.length, 2, 'exactamente 2 activos');
  const texts = result[0].items.map((i) => i.text);
  assert.ok(texts.includes('fragmento activo 1'));
  assert.ok(texts.includes('fragmento activo 2'));
  assert.ok(!texts.includes('fragmento inactivo'), 'inactivo excluido');
});

test('varias instancias conservan identidad y bloques separados', async () => {
  const { resolver } = makeResolver({
    instances: [
      { instanceId: 's1', typeId: 'snips', name: 'Snips A' },
      { instanceId: 's2', typeId: 'snips', name: 'Snips B' }
    ],
    definitions: { snips: SNIPS_DEF },
    storageData: {
      s1: { items: [{ text: 'contenido A', active: true }] },
      s2: { items: [{ text: 'contenido B', active: true }] }
    }
  });
  const result = await resolver.resolveWidgetInstances(['s1', 's2'], 'Libro/N.md');
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'Snips A');
  assert.equal(result[0].items[0].text, 'contenido A');
  assert.equal(result[1].name, 'Snips B');
  assert.equal(result[1].items[0].text, 'contenido B');
});

test('tasks: excluye las completadas (completed: false)', async () => {
  const { resolver } = makeResolver({
    instances: [{ instanceId: 't1', typeId: 'tasks', name: 'Tareas' }],
    definitions: { tasks: TASKS_DEF },
    storageData: {
      t1: {
        items: [
          { text: 'tarea pendiente', completed: true },
          { text: 'tarea completada', completed: false }
        ]
      }
    }
  });
  const result = await resolver.resolveWidgetInstances(['t1'], 'Libro/N.md');
  assert.equal(result[0].items.length, 1);
  assert.equal(result[0].items[0].text, 'tarea pendiente');
});

test('instancia no seleccionada no aporta contenido', async () => {
  const { resolver } = makeResolver({
    instances: [
      { instanceId: 's1', typeId: 'snips', name: 'Seleccionada' },
      { instanceId: 's2', typeId: 'snips', name: 'No seleccionada' }
    ],
    definitions: { snips: SNIPS_DEF },
    storageData: {
      s1: { items: [{ text: 'sí', active: true }] },
      s2: { items: [{ text: 'no', active: true }] }
    }
  });
  const result = await resolver.resolveWidgetInstances(['s1'], 'Libro/N.md');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Seleccionada');
});

test('widget sin state (memory) no envía todos sus datos', async () => {
  const { resolver } = makeResolver({
    instances: [{ instanceId: 'm1', typeId: 'memory', name: 'Asistente' }],
    definitions: { memory: MEMORY_DEF },
    storageData: {
      m1: { items: [{ id: 'r1', content: 'resultado', active: false }] }
    }
  });
  const result = await resolver.resolveWidgetInstances(['m1'], 'Libro/N.md');
  assert.equal(result.length, 0, 'widget sin state excluido');
});

test('instancia sin contenido elegible no aparece en el resultado', async () => {
  const { resolver } = makeResolver({
    instances: [{ instanceId: 's1', typeId: 'snips', name: 'Vacío' }],
    definitions: { snips: SNIPS_DEF },
    storageData: { s1: { items: [{ text: 'inactivo', active: false }] } }
  });
  const result = await resolver.resolveWidgetInstances(['s1'], 'Libro/N.md');
  assert.equal(result.length, 0, 'sin activos → instancia omitida');
});

test('selection de capacidades no modifica bloques elegibles', async () => {
  // Las sources (capacidades) no afectan a resolveWidgetInstances.
  const { resolver } = makeResolver({
    instances: [{ instanceId: 'c1', typeId: 'collections', name: 'Hechos' }],
    definitions: { collections: COLLECTIONS_DEF },
    storageData: {
      c1: {
        items: [
          { text: 'hecho 1', active: true },
          { text: 'hecho 2', active: true }
        ]
      }
    }
  });
  const result = await resolver.resolveWidgetInstances(['c1'], 'Libro/N.md');
  assert.equal(result[0].items.length, 2, 'las 2 activas presentes');
});

// ============================================================
// Tests de Notes (draft + bloques activos)
// ============================================================

test('Notes: distingue texto del editor de bloques guardados', async () => {
  const { resolver, notesController } = makeResolver({
    instances: [{ instanceId: 'n1', typeId: 'notes', name: 'Apuntes' }],
    definitions: { notes: NOTES_DEF },
    draftStoreData: {
      draft: '',
      blocks: [
        { text: 'bloque activo', active: true },
        { text: 'bloque inactivo', active: false }
      ]
    }
  });
  notesController.getActiveSource = async () => 'texto del editor';

  const result = await resolver.resolveWidgetInstances(['n1'], 'Libro/N.md');
  assert.equal(result.length, 1);
  const items = result[0].items;
  const editorItem = items.find((i) => i.__source === 'editor');
  const blockItems = items.filter((i) => i.__source === 'block');
  assert.ok(editorItem, 'texto del editor presente');
  assert.equal(editorItem.text, 'texto del editor');
  assert.equal(blockItems.length, 1, 'solo 1 bloque activo');
  assert.equal(blockItems[0].text, 'bloque activo');
  assert.ok(!items.some((i) => i.text === 'bloque inactivo'), 'inactivo excluido');
});

// ============================================================
// Tests de prompt (PromptBuilder)
// ============================================================

test('prompt: texto de instancia seleccionada llega al prompt final', () => {
  const ctx = makePromptContext({
    contextMode: 'widget',
    widgetInstances: [
      { instanceId: 's1', name: 'Snips', items: [{ text: 'contenido único' }] }
    ]
  });
  const builder = new PromptBuilder(ctx, TEMPLATE);
  const { user } = builder.build();
  assert.ok(user.includes('contenido único'), 'texto en el prompt');
  assert.ok(user.includes('Contexto de widgets seleccionados'), 'target correcto');
});

test('prompt: varias instancias separadas e identificadas', () => {
  const ctx = makePromptContext({
    contextMode: 'widget',
    widgetInstances: [
      { instanceId: 'a', name: 'Hechos', items: [{ text: 'dato A' }] },
      { instanceId: 'b', name: 'Restricciones', items: [{ text: 'dato B' }] }
    ]
  });
  const builder = new PromptBuilder(ctx, TEMPLATE);
  const { user } = builder.build();
  assert.ok(user.includes('[Hechos]'), 'nombre Hechos presente');
  assert.ok(user.includes('[Restricciones]'), 'nombre Restricciones presente');
  assert.ok(user.includes('dato A') && user.includes('dato B'), 'ambos contenidos');
  assert.ok(user.includes('---'), 'separador entre instancias');
});

test('prompt: bloque inactivo no aparece aunque su texto siga en los datos', () => {
  // El filtrado ocurre en ContextResolver; el prompt recibe solo activos.
  const ctx = makePromptContext({
    contextMode: 'widget',
    widgetInstances: [
      { instanceId: 's1', name: 'Snips', items: [{ text: 'activo' }] }
      // El inactivo fue filtrado por ContextResolver.
    ]
  });
  const builder = new PromptBuilder(ctx, TEMPLATE);
  const { user } = builder.build();
  assert.ok(user.includes('activo'));
  assert.ok(!user.includes('inactivo'), 'inactivo no presente');
});

test('prompt widget SIN instancias: no activa el contexto heredado', () => {
  // contextMode widget + sin widgetInstances → contexto vacío,
  // SIN caer a additional.notes/tasks/snips ni contextType.
  const ctx = makePromptContext({
    contextMode: 'widget',
    contextType: 'snips',
    noteContent: 'contenido de la nota'
  });
  ctx.additional.snips = [{ items: [{ text: 'snip heredado' }] }];
  const builder = new PromptBuilder(ctx, TEMPLATE);
  const { user } = builder.build();
  assert.ok(!user.includes('Contexto de widgets'), 'sin contenido widgets');
  assert.ok(!user.includes('snip heredado'), 'heredado NO activado');
  assert.ok(!user.includes('contenido de la nota'), 'note heredado NO activado');
});

test('prompt widget con instancias SIN contenido elegible: no activa heredado', () => {
  // Instancias presentes pero todas descartadas por filtro de activación.
  const ctx = makePromptContext({
    contextMode: 'widget',
    widgetInstances: [],
    contextType: 'tasks',
    noteContent: 'contenido nota'
  });
  ctx.additional.tasks = [{ items: [{ text: 'tarea heredada' }] }];
  const builder = new PromptBuilder(ctx, TEMPLATE);
  const { user } = builder.build();
  assert.ok(!user.includes('tarea heredada'), 'heredado NO activado');
  assert.ok(!user.includes('contenido nota'), 'note heredado NO activado');
});

test('prompt widget con contenido elegible: usa instancias, no heredado', () => {
  const ctx = makePromptContext({
    contextMode: 'widget',
    widgetInstances: [
      { instanceId: 's1', name: 'Snips', items: [{ text: 'contenido widget' }] }
    ],
    contextType: 'snips',
    noteContent: 'contenido nota'
  });
  ctx.additional.snips = [{ items: [{ text: 'snip heredado' }] }];
  const builder = new PromptBuilder(ctx, TEMPLATE);
  const { user } = builder.build();
  assert.ok(user.includes('contenido widget'), 'widget presente');
  assert.ok(!user.includes('snip heredado'), 'heredado NO usado');
  assert.ok(!user.includes('contenido nota'), 'note heredado NO usado');
});

test('prompt: flujos heredados (snips/notes/tasks/note) sin cambios', () => {
  // Sin contextMode → heredado intacto.
  const ctxNote = makePromptContext({ contextType: 'note', noteContent: 'texto nota' });
  const { user: uNote } = new PromptBuilder(ctxNote, TEMPLATE).build();
  assert.ok(uNote.includes('texto nota'));

  const ctxSnips = makePromptContext({ contextType: 'snips' });
  ctxSnips.additional.snips = [{ items: [{ text: 'snip heredado' }] }];
  const { user: uSnips } = new PromptBuilder(ctxSnips, TEMPLATE).build();
  assert.ok(uSnips.includes('snip heredado'));
  assert.ok(uSnips.includes('Snips seleccionados'));
});
