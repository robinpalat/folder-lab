// ============================================================
// PRUEBAS: Selector de contexto del Assistant (multi-instancia)
// ============================================================
// Ejecutar con: npm test
//
// - Menú principal: exactamente dos opciones (Board / Widgets).
// - Segundo menú al elegir Widgets.
// - Selección múltiple, incluidas dos instancias del mismo tipo.
// - Confirmación con OK y conservación de la selección.
// - Reapertura del menú recupera las selecciones.
// - Solo las instancias seleccionadas aportan contexto.
// - Borrado de instancia elimina referencias obsoletas.
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
export class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = { empty() {}, createEl() { return {}; }, createDiv() { return {}; } };
    this.titleEl = { setText() {} };
  }
  open() {}
  close() {}
}
export class Menu {
  constructor() {
    this.items = [];
    this.separators = 0;
    this.onHideFn = null;
    this.shownAt = null;
    if (typeof globalThis.__menuCapture === 'function') globalThis.__menuCapture(this);
  }
  addItem(cb) {
    const item = {
      title: '', icon: null, checked: false, disabled: false, onClickFn: null,
      setTitle(t) { this.title = t; return this; },
      setIcon(i) { this.icon = i; return this; },
      setChecked(c) { this.checked = !!c; return this; },
      setDisabled(d) { this.disabled = !!d; return this; },
      onClick(fn) { this.onClickFn = fn; return this; }
    };
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator() { this.separators++; return this; }
  showAtPosition(p) { this.shownAt = p; }
  onHide(fn) { this.onHideFn = fn; }
  hide() { if (this.onHideFn) this.onHideFn(); }
  clickByTitle(t) {
    const item = this.items.find((i) => i.title === t);
    if (item && item.onClickFn) item.onClickFn();
    return !!item;
  }
}
export function setIcon(el, icon) { if (el) el.icon = icon; }
export class MarkdownRenderer { static render(app, md, el, sourcePath) { if (el) el.textContent = sourcePath; return Promise.resolve(); } }
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
        b.onLoad({ filter: /.*/, namespace: 'obsidian-stub' }, () => ({
          contents: OBSIDIAN_STUB,
          loader: 'js'
        }));
      }
    }]
  });
  const code = result.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const capturedMenus = [];
globalThis.__menuCapture = (m) => capturedMenus.push(m);
// HTMLElement no existe en Node; el widget usa instanceOf(HTMLElement).
globalThis.HTMLElement = class HTMLElement {};
// window no existe en Node; el widget usa window.setTimeout y requestAnimationFrame.
globalThis.window = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  addEventListener: () => {},
  removeEventListener: () => {}
};

const { MemoryWidget } = await bundle('src/focus/widgets/MemoryWidget.ts');

class FakeEl {
  constructor() { this.children = []; this.classes = new Set(); this.style = { setProperty() {}, removeProperty() {} }; this.listeners = {}; }
  createEl(tag, opts = {}) { const el = new FakeEl(); if (opts.cls) for (const c of String(opts.cls).split(/\s+/)) el.classes.add(c); if (opts.text !== undefined) el.textContent = opts.text; this.children.push(el); return el; }
  createDiv(opts = {}) { return this.createEl('div', opts); }
  createSpan(opts = {}) { return this.createEl('span', opts); }
  addClass(c) { this.classes.add(c); }
  removeClass(c) { this.classes.delete(c); }
  toggleClass(c, force) { if (force) this.classes.add(c); else this.classes.delete(c); }
  empty() { this.children = []; }
  addEventListener() {}
  setAttribute() {} removeAttribute() {} getAttribute() { return null; }
  setAttr() {} remove() {} addClassAll() {} scrollTo() {} scrollHeight = 0;
  querySelector(sel) {
    // Devolver un ancla válida para el picker de input.
    if (String(sel).includes('data-control-id="input"')) {
      const anchor = new FakeEl();
      anchor.getBoundingClientRect = () => ({ left: 0, bottom: 20, top: 0, right: 100 });
      anchor.instanceOf = (t) => t === globalThis.HTMLElement || this instanceof t;
      return anchor;
    }
    return null;
  }
  querySelectorAll() { return []; }
  instanceOf(t) { return this instanceof t || t === globalThis.HTMLElement; }
}

function makeWidget({ instances = [] } = {}) {
  const widgetManager = {
    getInstances: () => [...instances],
    getInstance: (id) => instances.find((i) => i.instanceId === id) ?? null,
    getLayout: () => ({
      top: instances[0]?.instanceId ?? '',
      bottom: instances[1]?.instanceId ?? ''
    }),
    getDefinition: (typeId) => ({
      identity: { icon: typeId === 'memory' ? 'brain' : 'sticky-note', label: typeId }
    })
  };
  const contextResolver = {
    resolve: async () => ({ additional: { widgetInstances: [] } }),
    resolveWidgetInstances: async (ids) =>
      ids.map((id) => {
        const inst = instances.find((i) => i.instanceId === id);
        return { instanceId: id, name: inst?.name ?? '?', items: [] };
      })
  };
  const plugin = {
    localMirror: null,
    noteLifecycle: { getNoteId: async () => 'id-1' },
    settings: undefined,
    draftStore: null
  };
  const app = {
    plugins: { plugins: { 'folder-lab': plugin } },
    workspace: { getActiveFile: () => null },
    fileManager: {}, vault: {}
  };
  const widget = new MemoryWidget(
    app,
    { getStatus: () => ({ configured: true }), callTool: async () => ({ success: true, content: 'ok' }) },
    {}, {}, widgetManager, {}
  );
  widget.contextResolver = contextResolver;
  widget.currentFile = { path: 'Libro/Nota.md' };
  widget.container = new FakeEl();
  widget.lastContext = { activeFile: { path: 'Libro/Nota.md' } };
  return { widget, widgetManager, contextResolver };
}

function captureMenus() {
  capturedMenus.length = 0;
  return { captured: capturedMenus };
}

// ============================================================
// Tests
// ============================================================

test('menú principal: Board (deshabilitado en modo Nota) y Widgets (habilitado)', () => {
  const { widget } = makeWidget();
  const { captured } = captureMenus();
  widget.showInputMenu();
  const menu = captured[captured.length - 1];
  assert.ok(menu, 'menú creado');
  // Ambas opciones presentes (incluyendo deshabilitadas).
  const titles = menu.items.map((i) => i.title);
  assert.ok(titles.some((t) => /board/i.test(t)), 'Board presente');
  assert.ok(titles.some((t) => /widget/i.test(t)), 'Widgets presente');
  // En modo Nota (sin BoardView), Board está deshabilitado.
  const boardItem = menu.items.find((i) => /board/i.test(i.title));
  const widgetItem = menu.items.find((i) => /widget/i.test(i.title));
  assert.equal(boardItem.disabled, true, 'Board deshabilitado en modo Nota');
  assert.ok(!widgetItem.disabled, 'Widgets habilitado');
});

test('elegir Widgets abre el segundo menú de instancias (sin Assistant/Active Note)', async () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' },
    { instanceId: 'coll-1', typeId: 'collections', name: 'Hechos' }
  ];
  const { widget } = makeWidget({ instances });
  const { captured } = captureMenus();
  widget.showInputMenu();
  const mainMenu = captured[captured.length - 1];
  mainMenu.clickByTitle('Widgets');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(captured.length >= 2, 'segundo menú abierto');
  const second = captured[captured.length - 1];
  const titles = second.items.map((i) => i.title);
  assert.ok(!titles.includes('Asistente'), 'Assistant excluido');
  assert.ok(titles.includes('Apuntes'), 'instancia Apuntes listada');
  assert.ok(titles.includes('Hechos'), 'instancia Hechos listada');
  assert.ok(widget.inputSource === 'widget', 'fuente = widget');
});

test('selección múltiple incluye dos instancias del mismo tipo', async () => {
  const instances = [
    { instanceId: 'coll-1', typeId: 'collections', name: 'Hechos' },
    { instanceId: 'coll-2', typeId: 'collections', name: 'Datos' }
  ];
  const { widget } = makeWidget({ instances });
  const { captured } = captureMenus();
  widget.inputSource = 'widget';
  widget.showWidgetInstanceMenu();
  const menu = captured[captured.length - 1];
  menu.clickByTitle('Hechos');
  await new Promise((r) => setTimeout(r, 10));
  const menu2 = captured[captured.length - 1];
  menu2.clickByTitle('Datos');
  await new Promise((r) => setTimeout(r, 10));
  const menu3 = captured[captured.length - 1];
  menu3.clickByTitle('OK');
  assert.equal(widget.selectedWidgetInstances.size, 2, 'dos instancias seleccionadas');
  assert.ok(widget.selectedWidgetInstances.has('coll-1'));
  assert.ok(widget.selectedWidgetInstances.has('coll-2'));
});

test('OK confirma y conserva la selección; cancelar no aplica cambios', async () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' }
  ];
  const { widget } = makeWidget({ instances });
  const { captured } = captureMenus();
  widget.selectedWidgetInstances = new Set(['memory-1']);
  widget.inputSource = 'widget';

  widget.showWidgetInstanceMenu();
  const menu = captured[captured.length - 1];
  menu.clickByTitle('Apuntes');
  await new Promise((r) => setTimeout(r, 10));
  const menu2 = captured[captured.length - 1];
  menu2.hide();
  assert.equal(widget.selectedWidgetInstances.size, 1, 'cancelar no aplica');
  assert.ok(widget.selectedWidgetInstances.has('memory-1'));

  widget.showWidgetInstanceMenu();
  const menu3 = captured[captured.length - 1];
  menu3.clickByTitle('Apuntes');
  await new Promise((r) => setTimeout(r, 10));
  const menu4 = captured[captured.length - 1];
  menu4.clickByTitle('OK');
  assert.equal(widget.selectedWidgetInstances.size, 2, 'OK aplica');
  assert.ok(widget.selectedWidgetInstances.has('notes-1'));
});

test('reabrir el menú recupera las selecciones previas (casillas marcadas)', () => {
  const instances = [
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' },
    { instanceId: 'coll-1', typeId: 'collections', name: 'Hechos' }
  ];
  const { widget } = makeWidget({ instances });
  const { captured } = captureMenus();
  widget.selectedWidgetInstances = new Set(['notes-1']);
  widget.inputSource = 'widget';
  widget.showWidgetInstanceMenu();
  const menu = captured[captured.length - 1];
  const apuntes = menu.items.find((i) => i.title === 'Apuntes');
  const hechos = menu.items.find((i) => i.title === 'Hechos');
  assert.equal(apuntes.checked, true, 'Apuntes marcada');
  assert.equal(hechos.checked, false, 'Hechos sin marcar');
});

test('compañero + explícitas aportan contexto al ejecutar (sin duplicados)', async () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' },
    { instanceId: 'coll-1', typeId: 'collections', name: 'Hechos' }
  ];
  const { widget, contextResolver } = makeWidget({ instances });
  // Posición 'top' (default) → compañero = layout.bottom = notes-1.
  widget.inputSource = 'widget';
  widget.selectedWidgetInstances = new Set(['memory-1', 'coll-1']);
  widget.selectedCapability = 'research-thesis';
  widget.selectedSources = ['note'];

  let capturedRequest = null;
  contextResolver.resolve = async (req) => {
    capturedRequest = req;
    return { additional: { widgetInstances: [] } };
  };
  await widget.execute();

  assert.ok(capturedRequest, 'request capturado');
  const ids = [...(capturedRequest.widgetInstanceIds ?? [])].sort();
  // Compañero (notes-1) + explícitas (memory-1, coll-1) = 3.
  assert.deepEqual(ids, ['coll-1', 'memory-1', 'notes-1'], 'compañero + explícitas');
  assert.equal(new Set(ids).size, ids.length, 'sin duplicados');
});

test('ejecutar en modo board NO envía widgetInstanceIds', async () => {
  const { widget, contextResolver } = makeWidget({
    instances: [{ instanceId: 'memory-1', typeId: 'memory', name: 'A' }]
  });
  widget.inputSource = 'board';
  widget.selectedWidgetInstances = new Set(['memory-1']);
  widget.selectedCapability = 'research-thesis';
  widget.selectedSources = ['note'];

  let capturedRequest = null;
  contextResolver.resolve = async (req) => {
    capturedRequest = req;
    return { additional: {} };
  };
  await widget.execute();
  assert.equal(capturedRequest.widgetInstanceIds, undefined, 'sin instancias en modo board');
});

test('borrar una instancia elimina referencias contextuales obsoletas', () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' }
  ];
  const { widget, widgetManager } = makeWidget({ instances });
  widget.selectedWidgetInstances = new Set(['memory-1', 'notes-1']);

  const remaining = instances.filter((i) => i.instanceId !== 'notes-1');
  widgetManager.getInstances = () => [...remaining];

  widget.pruneSelectedInstances();
  assert.equal(widget.selectedWidgetInstances.size, 1, 'solo memory-1 queda');
  assert.ok(widget.selectedWidgetInstances.has('memory-1'));
  assert.ok(!widget.selectedWidgetInstances.has('notes-1'), 'notes-1 eliminada');
});

test('ContextResolver.resolveWidgetInstances: filtra por state y excluye sin state', async () => {
  const { ContextResolver } = await bundle('src/ai/context/ContextResolver.ts');
  const instances = [
    { instanceId: 'snips-1', typeId: 'snips', name: 'Snips' },
    { instanceId: 'tasks-1', typeId: 'tasks', name: 'Tareas' },
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' }
  ];
  const definitions = {
    snips: { id: 'snips', state: { field: 'active', initial: true } },
    tasks: { id: 'tasks', state: { field: 'completed', initial: true } },
    memory: { id: 'memory' } // Sin state → excluido.
  };
  const widgetManager = {
    getInstances: () => instances,
    getDefinition: (typeId) => definitions[typeId]
  };
  const storageData = {
    'snips-1': {
      items: [
        { text: 'activo', active: true },
        { text: 'inactivo', active: false }
      ]
    },
    'tasks-1': {
      items: [
        { text: 'pendiente', completed: true },
        { text: 'hecha', completed: false }
      ]
    },
    'memory-1': { items: [{ id: 'r1' }] }
  };
  const widgetController = {
    storage: {
      get: async (typeId, notePath, instanceId) =>
        storageData[instanceId] ?? null
    }
  };
  const resolver = new ContextResolver(
    {},
    { settings: {} },
    widgetController,
    widgetManager
  );

  const resolved = await resolver.resolveWidgetInstances(
    ['snips-1', 'tasks-1', 'memory-1'],
    'Libro/Nota.md'
  );

  // memory-1 excluido (sin state); snips-1 y tasks-1 filtrados.
  assert.equal(resolved.length, 2, 'solo 2 con state');
  assert.equal(resolved[0].instanceId, 'snips-1');
  assert.equal(resolved[0].items.length, 1, 'solo activos');
  assert.equal(resolved[0].items[0].text, 'activo');
  assert.equal(resolved[1].instanceId, 'tasks-1');
  assert.equal(resolved[1].items.length, 1, 'solo pendientes');
  assert.equal(resolved[1].items[0].text, 'pendiente');
});

// ============================================================
// Widget compañero automático
// ============================================================

test('el companion aparece con nombre, icono, sin casilla, bajo Current context widget', () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' }
  ];
  const { widget } = makeWidget({ instances });
  const { captured } = captureMenus();
  widget.showInputMenu();
  const menu = captured[captured.length - 1];
  // Etiqueta informativa del apartado.
  const header = menu.items.find(
    (i) => i.title === 'Widget de contexto actual'
  );
  assert.ok(header, 'etiqueta Current context widget presente');
  assert.equal(header.disabled, true, 'etiqueta deshabilitada');
  // Ítem del compañero: sin casilla.
  const companionItem = menu.items.find((i) => i.title === 'Apuntes');
  assert.ok(companionItem, 'compañero presente en el menú');
  assert.ok(!companionItem.checked, 'sin casilla verificadora');
  assert.equal(companionItem.icon, 'sticky-note', 'icono del tipo');
});

test('el contenido del compañero llega al contexto sin selección manual', async () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' }
  ];
  const { widget, contextResolver } = makeWidget({ instances });
  widget.inputSource = 'widget';
  // Sin selección explícita: selectedWidgetInstances vacío.
  widget.selectedWidgetInstances = new Set();
  widget.selectedCapability = 'research-thesis';
  widget.selectedSources = ['note'];

  let capturedRequest = null;
  contextResolver.resolve = async (req) => {
    capturedRequest = req;
    return { additional: { widgetInstances: [] } };
  };
  await widget.execute();

  assert.deepEqual(
    capturedRequest.widgetInstanceIds,
    ['notes-1'],
    'compañero incluido automáticamente'
  );
});

test('cambiar de widget compañero actualiza el contexto automático', async () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' },
    { instanceId: 'coll-1', typeId: 'collections', name: 'Hechos' }
  ];
  const { widget, widgetManager, contextResolver } = makeWidget({ instances });
  widget.inputSource = 'widget';
  widget.selectedWidgetInstances = new Set();
  widget.selectedCapability = 'research-thesis';
  widget.selectedSources = ['note'];

  // Cambiar layout: compañero pasa a ser coll-1.
  widgetManager.getLayout = () => ({ top: 'memory-1', bottom: 'coll-1' });

  let capturedRequest = null;
  contextResolver.resolve = async (req) => {
    capturedRequest = req;
    return { additional: { widgetInstances: [] } };
  };
  await widget.execute();

  assert.deepEqual(
    capturedRequest.widgetInstanceIds,
    ['coll-1'],
    'nuevo compañero en contexto'
  );
});

test('una instancia seleccionada por ambos mecanismos no se duplica', async () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' }
  ];
  const { widget, contextResolver } = makeWidget({ instances });
  widget.inputSource = 'widget';
  // notes-1 es el compañero Y está seleccionada explícitamente.
  widget.selectedWidgetInstances = new Set(['notes-1']);
  widget.selectedCapability = 'research-thesis';
  widget.selectedSources = ['note'];

  let capturedRequest = null;
  contextResolver.resolve = async (req) => {
    capturedRequest = req;
    return { additional: { widgetInstances: [] } };
  };
  await widget.execute();

  const ids = capturedRequest.widgetInstanceIds;
  assert.equal(ids.length, 1, 'sin duplicados');
  assert.equal(ids[0], 'notes-1');
});

test('Widgets muestra + con instancias explícitas adicionales, sin + solo con compañero', () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' },
    { instanceId: 'coll-1', typeId: 'collections', name: 'Hechos' }
  ];
  const { widget } = makeWidget({ instances });
  widget.inputSource = 'widget';

  // Solo compañero (notes-1): sin +.
  widget.selectedWidgetInstances = new Set();
  let display = widget.getInputDisplay();
  assert.ok(!display.label.includes('+'), 'sin + solo con compañero');

  // Con explícita adicional (coll-1): con +.
  widget.selectedWidgetInstances = new Set(['coll-1']);
  display = widget.getInputDisplay();
  assert.ok(display.label.includes('+'), 'con + por explícita adicional');

  // Explícita que ES el compañero: sin + (no es adicional).
  widget.selectedWidgetInstances = new Set(['notes-1']);
  display = widget.getInputDisplay();
  assert.ok(!display.label.includes('+'), 'compañero explícito no cuenta como adicional');
});

test('Board conserva su comportamiento actual (sin compañero en contexto)', async () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' }
  ];
  const { widget, contextResolver } = makeWidget({ instances });
  widget.inputSource = 'board';
  widget.selectedCapability = 'research-thesis';
  widget.selectedSources = ['note'];

  let capturedRequest = null;
  contextResolver.resolve = async (req) => {
    capturedRequest = req;
    return { additional: {} };
  };
  await widget.execute();

  assert.equal(capturedRequest.widgetInstanceIds, undefined, 'sin instancias en board');
  assert.equal(capturedRequest.inputSource, undefined, 'sin inputSource en board');
});

// ============================================================
// Nota como fuente de contexto
// ============================================================

test('menú muestra Board, Widgets y Nota en ese orden con sus iconos', () => {
  const { widget } = makeWidget();
  const { captured } = captureMenus();
  widget.showInputMenu();
  const menu = captured[captured.length - 1];
  // Filtrar solo las opciones de fuente (no el header ni companion).
  const sourceItems = menu.items.filter(
    (i) => ['Board', 'Widgets', 'Nota'].includes(i.title)
  );
  assert.equal(sourceItems.length, 3, 'tres opciones de fuente');
  assert.equal(sourceItems[0].title, 'Board');
  assert.equal(sourceItems[0].icon, 'layout-dashboard', 'icono Board');
  assert.equal(sourceItems[1].title, 'Widgets');
  assert.equal(sourceItems[1].icon, 'blocks', 'icono Widgets');
  assert.equal(sourceItems[2].title, 'Nota');
  assert.equal(sourceItems[2].icon, 'file-text', 'icono Nota');
});

test('toolbar muestra solo el nombre de la fuente, sin icono', () => {
  const { widget } = makeWidget();
  // Nota seleccionado.
  widget.inputSource = 'nota';
  let display = widget.getInputDisplay();
  assert.equal(display.label, 'Nota');
  assert.equal(display.icon, '', 'sin icono para Nota');

  // Widgets seleccionado.
  widget.inputSource = 'widget';
  display = widget.getInputDisplay();
  assert.ok(display.label.startsWith('Widgets'));
  assert.equal(display.icon, '', 'sin icono para Widgets');

  // Board seleccionado (con modo Board activo simulado).
  widget.isBoardModeActive = () => true;
  widget.inputSource = 'board';
  display = widget.getInputDisplay();
  assert.equal(display.label, 'Board');
  assert.equal(display.icon, '', 'sin icono para Board');
});

test('Widgets + conserva el indicador con instancias adicionales', () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' },
    { instanceId: 'coll-1', typeId: 'collections', name: 'Hechos' }
  ];
  const { widget } = makeWidget({ instances });
  widget.inputSource = 'widget';
  // Companion = notes-1; explícita adicional = coll-1.
  widget.selectedWidgetInstances = new Set(['coll-1']);
  const display = widget.getInputDisplay();
  assert.ok(display.label.includes('+'), 'indicador + presente');
  assert.equal(display.icon, '', 'sin icono');
});

test('seleccionar Nota envía contextType note y no inputSource widget', async () => {
  const { widget, contextResolver } = makeWidget();
  widget.inputSource = 'nota';
  widget.selectedCapability = 'research-thesis';
  widget.selectedSources = ['snips']; // Fuente de capacidad ≠ note.

  let capturedRequest = null;
  contextResolver.resolve = async (req) => {
    capturedRequest = req;
    return { additional: {} };
  };
  await widget.execute();

  assert.equal(capturedRequest.contextType, 'note', 'contextType forzado a note');
  assert.equal(capturedRequest.inputSource, undefined, 'sin inputSource widget');
  assert.equal(capturedRequest.widgetInstanceIds, undefined, 'sin instancias');
  assert.ok(capturedRequest.activeNotePath, 'nota activa presente');
});

test('Board y Widgets conservan su comportamiento con Nota añadido', async () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' }
  ];
  const { widget, contextResolver } = makeWidget({ instances });
  widget.selectedCapability = 'research-thesis';
  widget.selectedSources = ['note'];

  // Board: sin inputSource widget.
  widget.inputSource = 'board';
  let capturedRequest = null;
  contextResolver.resolve = async (req) => {
    capturedRequest = req;
    return { additional: {} };
  };
  await widget.execute();
  assert.equal(capturedRequest.inputSource, undefined, 'board: sin inputSource widget');

  // Widget: con inputSource widget y companion.
  widget.inputSource = 'widget';
  contextResolver.resolve = async (req) => {
    capturedRequest = req;
    return { additional: { widgetInstances: [] } };
  };
  await widget.execute();
  assert.equal(capturedRequest.inputSource, 'widget', 'widget: inputSource presente');
  assert.deepEqual(capturedRequest.widgetInstanceIds, ['notes-1'], 'compañero incluido');
});
