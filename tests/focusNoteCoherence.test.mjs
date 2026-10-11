// ============================================================
// PRUEBAS: coherencia Focus ↔ nota activa (P2-B)
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - Con Focus abierto, cambiar la nota activa re-apunta el
//   FocusWorkspace (contexto/instancias) a la nueva nota.
// - El Board de la nota ANTERIOR se cierra (subordinación).
// - El mismo path no dispara nada (clic en la pestaña del Board).
// - Fuera de Focus no se toca nada.
// - updateNote superseded no aplica layout/paneles de una nota
//   antigua cuando llega una más reciente.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

// FolderLabView registra listeners de document en su constructor.
globalThis.document = {
  addEventListener() {},
  removeEventListener() {}
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const OBSIDIAN_STUB = `
export class Component {
  registerEvent(ref) {
    (this._registeredEvents || (this._registeredEvents = [])).push(ref);
    return ref;
  }
  register() {}
  registerDomEvent() {}
  load() {}
  onunload() {}
}
export class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.app = leaf && leaf.app;
    this.contentEl = {
      empty() {},
      createEl() { return this.contentEl; },
      createDiv() { return this.contentEl; },
      addClass() {},
      removeClass() {},
      toggleClass() {},
      setAttr() {},
      style: {}
    };
  }
  getViewType() { return ''; }
  getDisplayText() { return ''; }
  getIcon() { return ''; }
  onOpen() {}
  onClose() {}
}
export class TextFileView extends ItemView {
  getViewData() { return ''; }
  setViewData() {}
  clear() {}
}
export class App {}
export class TAbstractFile { constructor() { this.path = ''; } }
export class TFile extends TAbstractFile {
  constructor() { super(); this.extension = 'md'; this.basename = ''; this.name = ''; }
}
export class TFolder extends TAbstractFile {}
export class WorkspaceLeaf {}
export class MarkdownView {}
export class MarkdownRenderer {}
export class Notice { constructor() {} }
export class Menu { addItem() { return this; } showAtPosition() {} }
export class Modal {
  constructor() { this.contentEl = { empty() {}, createEl() { return this.contentEl; }, addClass() {}, createDiv() { return this.contentEl; } }; }
  open() {}
  close() {}
}
export class Plugin {}
export class Setting { constructor() {} setName() { return this; } setDesc() { return this; } addText() { return this; } addToggle() { return this; } addButton() { return this; } addDropdown() { return this; } addSlider() { return this; } addExtraButton() { return this; } addClass() { return this; } setHeading() { return this; } setDisabled() { return this; } }
export class ButtonComponent { constructor() { this.buttonEl = { addEventListener() {}, setAttr() {}, addClass() {}, createEl() { return this; } }; } setButtonText() { return this; } setIcon() { return this; } setTooltip() { return this; } onClick() { return this; } setDisabled() { return this; } setCta() { return this; } }
export class FuzzySuggestModal extends Modal { constructor() { super(); } setPlaceholder() {} }
export class FuzzyMatch {}
export function setIcon() {}
export function debounce(fn) { return fn; }
export default {};
globalThis.__MarkdownView = MarkdownView;
`;

async function loadModule(entry) {
  const result = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    plugins: [
      {
        name: 'obsidian-stub',
        setup(b) {
          b.onResolve({ filter: /^obsidian$/ }, () => ({
            path: 'obsidian',
            namespace: 'obsidian-stub'
          }));
          b.onLoad({ filter: /.*/, namespace: 'obsidian-stub' }, () => ({
            contents: OBSIDIAN_STUB,
            loader: 'js'
          }));
          // '../main' se usa solo como tipo en la vista; se
          // sustituye por un stub para no arrastrar el plugin.
          b.onResolve({ filter: /^(\.\.\/)+main$/ }, () => ({
            path: 'main-stub',
            namespace: 'main-stub'
          }));
          b.onLoad({ filter: /.*/, namespace: 'main-stub' }, () => ({
            contents: 'export default class FolderLabPlugin {}\n',
            loader: 'js'
          }));
        }
      }
    ]
  });
  const url =
    'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(url);
}

const { FolderLabView } = await loadModule('src/views/FolderLabView.ts');
/*
 * Cada bundle lleva su propia copia del stub de obsidian: la
 * clase MarkdownView del bundle de la vista se captura aquí,
 * ANTES de que la carga del segundo bundle reasigne
 * globalThis.__MarkdownView con una clase distinta.
 */
const MarkdownViewClass = globalThis.__MarkdownView;
const { FocusWorkspace } = await loadModule('src/focus/FocusWorkspace.ts');

// ------------------------------------------------------------
// Dobles de prueba
// ------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWorkspaceStub() {
  const ws = {
    handlers: [],
    leafQueries: 0,
    boardLeaves: [],
    markdownLeaves: [],
    activeFile: null,
    on(name, cb) {
      const ref = { name, cb };
      ws.handlers.push(ref);
      return ref;
    },
    off() {},
    offref() {},
    getActiveFile() {
      return ws.activeFile;
    },
    getLeavesOfType(type) {
      ws.leafQueries++;
      ws.lastLeafType = type;
      if (type === 'folder-lab-board') return ws.boardLeaves;
      if (type === 'markdown') return ws.markdownLeaves;
      return [];
    },
    revealLeaf() {},
    getLeftLeaf() { return null; },
    detachLeavesOfType() {},
    onLayoutChange() {}
  };
  return ws;
}

function createFakeApp() {
  const workspace = createWorkspaceStub();
  const adapter = {
    async exists() { return true; },
    async mkdir() {},
    async read() { return ''; },
    async write() {},
    async append() {},
    async remove() {},
    async list() { return { files: [], folders: [] }; }
  };
  return {
    workspace,
    vault: {
      adapter,
      async read() { return ''; },
      async modify() {},
      async create() {},
      on() { return {}; },
      offref() {},
      getAbstractFileByPath() { return null; },
      getFileByPath() { return null; },
      getRoot() { return null; },
      getFiles() { return []; },
      getFolders() { return []; }
    }
  };
}

function makeNote(path) {
  return { path, extension: 'md', basename: path.split('/').pop().replace('.md', ''), name: path.split('/').pop() };
}

function createView(app) {
  const plugin = {
    app,
    settings: {
      bookRootPath: '',
      lastFolderPath: '',
      lastOpenedNote: '',
      navigationPropertyMapping: { order: 'order', ignoredFolders: [] }
    },
    saveSettings: async () => {}
  };
  const leaf = { app };
  const widgetRegistry = { getDefinition: () => undefined, getWidget: () => undefined };
  const widgetManager = { onChange: () => () => {}, loadForNote: async () => {}, getLayout: () => ({ top: '', bottom: '' }), getInstance: () => undefined, getInstances: () => [] };
  const view = new FolderLabView(leaf, plugin, {}, widgetRegistry, widgetManager);
  // Registrar el handler bajo prueba (en producción lo hace onOpen).
  view.setupActiveLeafEvents();
  return view;
}

function fireActiveLeafChange(view, app) {
  const ref = view._registeredEvents.find(
    (r) => r && r.name === 'active-leaf-change'
  );
  assert.ok(ref, 'el handler active-leaf-change debe estar registrado');
  ref.cb();
}

// ------------------------------------------------------------
// FolderLabView: cambio de nota activa con Focus abierto
// ------------------------------------------------------------

test('P2-B: con Focus abierto, cambiar la nota activa re-apunta el FocusWorkspace', async () => {
  const app = createFakeApp();
  const view = createView(app);
  view.state.isFocusMode = true;
  view.state.setFocusNote('Libro/A.md');

  const updateCalls = [];
  view.focusWorkspace = {
    updateNote(file) {
      updateCalls.push(file.path);
      return Promise.resolve();
    },
    setBoardActive() {}
  };

  app.workspace.activeFile = makeNote('Libro/B.md');
  fireActiveLeafChange(view, app);

  assert.equal(view.state.getFocusNote(), 'Libro/B.md');
  assert.deepEqual(updateCalls, ['Libro/B.md']);
});

test('P2-B: el Board de la nota anterior se cierra al cambiar de nota en Focus', async () => {
  const app = createFakeApp();
  const view = createView(app);
  view.state.isFocusMode = true;
  view.state.setFocusNote('Libro/A.md');

  view.focusWorkspace = {
    updateNote: async () => {},
    setBoardActive() {}
  };

  // Hay un leaf de Board abierto (nota anterior A).
  const setViewCalls = [];
  app.workspace.boardLeaves = [
    {
      view: {
        getState: () => ({ file: 'Libro/A.md' })
      },
      async setViewState(state) {
        setViewCalls.push(state);
      }
    }
  ];

  app.workspace.activeFile = makeNote('Libro/B.md');
  fireActiveLeafChange(view, app);

  await sleep(10); // closeBoardIfOpen es asíncrono (fire-and-forget)

  assert.equal(setViewCalls.length, 1, 'el leaf del Board debe restaurarse a markdown');
  assert.equal(setViewCalls[0].type, 'markdown');
});

test('P2-B: el mismo path no dispara updateNote ni cierre de Board (pestaña del Board)', async () => {
  const app = createFakeApp();
  const view = createView(app);
  view.state.isFocusMode = true;
  view.state.setFocusNote('Libro/A.md');

  const updateCalls = [];
  view.focusWorkspace = {
    updateNote(file) {
      updateCalls.push(file.path);
      return Promise.resolve();
    },
    setBoardActive() {}
  };

  app.workspace.activeFile = makeNote('Libro/A.md');
  const queriesBefore = app.workspace.leafQueries;
  fireActiveLeafChange(view, app);
  await sleep(10);

  assert.deepEqual(updateCalls, []);
  assert.equal(
    app.workspace.leafQueries,
    queriesBefore,
    'con la misma nota no se consulta ni se cierra el Board'
  );
});

test('P2-B: fuera de Focus el cambio de nota no toca el FocusWorkspace', async () => {
  const app = createFakeApp();
  const view = createView(app);
  view.state.isFocusMode = false;

  const updateCalls = [];
  view.focusWorkspace = {
    updateNote(file) {
      updateCalls.push(file.path);
      return Promise.resolve();
    },
    setBoardActive() {}
  };

  app.workspace.activeFile = makeNote('Libro/B.md');
  fireActiveLeafChange(view, app);
  await sleep(10);

  assert.deepEqual(updateCalls, []);
  assert.equal(view.state.getFocusNote(), '');
});

test('P2-B: cambios rápidos A→B→B (mismo path repetido) solo actualizan una vez', async () => {
  const app = createFakeApp();
  const view = createView(app);
  view.state.isFocusMode = true;
  view.state.setFocusNote('Libro/A.md');

  const updateCalls = [];
  view.focusWorkspace = {
    updateNote(file) {
      updateCalls.push(file.path);
      return Promise.resolve();
    },
    setBoardActive() {}
  };

  app.workspace.activeFile = makeNote('Libro/B.md');
  fireActiveLeafChange(view, app);
  fireActiveLeafChange(view, app);
  await sleep(10);

  assert.deepEqual(updateCalls, ['Libro/B.md']);
});

// ------------------------------------------------------------
// FocusWorkspace.updateNote interleaving
// ------------------------------------------------------------

test('P2-B: updateNote superseded no aplica layout/paneles de la nota antigua', async () => {
  const app = createFakeApp();

  // Repo de carga con gates por nota.
  const loads = [];
  const widgetManager = {
    loadForNote(file) {
      return new Promise((resolve) => {
        loads.push({ path: file.path, resolve });
      });
    },
    layoutQueries: 0,
    getLayout() {
      widgetManager.layoutQueries++;
      return { top: 't-vigente', bottom: 'b-vigente' };
    },
    getInstance(id) {
      return { instanceId: id, typeId: 'notes', name: id };
    },
    getInstances: () => [],
    onChange: () => () => {},
    setLayout() {}
  };

  const state = { splitRatio: 50, setSplitRatio() {} };
  const fw = new FocusWorkspace(
    { empty() {}, createEl() { return this; }, addClass() {}, style: {} },
    app,
    {},
    state,
    {},
    widgetManager,
    {},
    () => {}
  );

  // Contexto inyectado (en producción lo crea render()).
  const fileA = makeNote('Libro/A.md');
  const fileB = makeNote('Libro/B.md');
  fw.context = { app, activeFile: fileA, controller: {}, state, sessionId: 's' };

  // Paneles falsos que registran las instancias aplicadas.
  const applied = [];
  fw.topPane = {
    updateContext() {},
    setWidget(id) { applied.push(`top:${id}`); }
  };
  fw.bottomPane = {
    updateContext() {},
    setWidget(id) { applied.push(`bottom:${id}`); }
  };

  const uA = fw.updateNote(fileA); // solicitada primero
  const uB = fw.updateNote(fileB); // solicitada después (vigente)

  // La vigente (B) resuelve primero.
  loads[1].resolve(undefined);
  await uB;
  assert.equal(fw.context.activeFile, fileB);

  // La antigua (A) resuelve después: no debe tocar nada.
  loads[0].resolve(undefined);
  await uA;

  assert.equal(fw.context.activeFile, fileB, 'el contexto queda en la nota vigente');
  assert.deepEqual(
    applied,
    ['top:t-vigente', 'bottom:b-vigente'],
    'solo la actualización vigente aplica instancias a los paneles'
  );
  assert.equal(
    widgetManager.layoutQueries,
    1,
    'la actualización obsoleta no debe consultar ni aplicar layout'
  );
});

// ------------------------------------------------------------
// Estado del botón Board/Nota (P2-2)
// ------------------------------------------------------------

function makeMarkdownLeaf(file) {
  const view = new MarkdownViewClass();
  view.file = file;
  view.getState = () => ({ file: file.path });
  const leaf = {
    view,
    setViewCalls: [],
    async setViewState(state) {
      leaf.setViewCalls.push(state);
    }
  };
  return leaf;
}

test('P2-2: openBoardView devuelve false sin leaf markdown (el botón no asume éxito)', async () => {
  const app = createFakeApp();
  const view = createView(app);

  app.workspace.activeFile = makeNote('Libro/A.md');
  app.workspace.markdownLeaves = [];

  const opened = await view.openBoardView();

  assert.equal(opened, false);
  assert.equal(app.workspace.markdownLeaves.length, 0);
});

test('P2-2: openBoardView devuelve true y convierte el leaf cuando existe la nota abierta', async () => {
  const app = createFakeApp();
  const view = createView(app);

  const fileA = makeNote('Libro/A.md');
  app.workspace.activeFile = fileA;
  const leaf = makeMarkdownLeaf(fileA);
  app.workspace.markdownLeaves = [leaf];

  const opened = await view.openBoardView();

  assert.equal(opened, true);
  assert.equal(leaf.setViewCalls.length, 1);
  assert.equal(leaf.setViewCalls[0].type, 'folder-lab-board');
});

test('P2-2: openBoardView devuelve false si el leaf markdown es de otra nota', async () => {
  const app = createFakeApp();
  const view = createView(app);

  app.workspace.activeFile = makeNote('Libro/A.md');
  app.workspace.markdownLeaves = [makeMarkdownLeaf(makeNote('Libro/Otra.md'))];

  const opened = await view.openBoardView();

  assert.equal(opened, false);
});

test('P2-2: closeBoardView devuelve false sin Board abierto y true al restaurar', async () => {
  const app = createFakeApp();
  const view = createView(app);

  app.workspace.boardLeaves = [];
  assert.equal(await view.closeBoardView(), false);

  const boardLeaf = {
    view: {
      getState: () => ({ file: 'Libro/A.md' })
    },
    setViewCalls: [],
    async setViewState(state) {
      boardLeaf.setViewCalls.push(state);
    }
  };
  app.workspace.boardLeaves = [boardLeaf];

  assert.equal(await view.closeBoardView(), true);
  assert.equal(boardLeaf.setViewCalls.length, 1);
  assert.equal(boardLeaf.setViewCalls[0].type, 'markdown');
});
