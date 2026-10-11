// ============================================================
// PRUEBAS: ciclo de vida de FolderLabView — listeners (3B)
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - Los listeners de document se liberan en onClose con la MISMA
//   referencia con la que se registraron.
// - Tras el cierre, los eventos no actúan sobre la vista dispuesta.
// - Abrir/cerrar/reabrir no acumula handlers (sin duplicados).
// - navigation-tree-changed se libera con su referencia bound.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

// ------------------------------------------------------------
// Documento falso con registro real de listeners (3B)
// ------------------------------------------------------------

function createDocumentStub() {
  const listeners = new Map();
  return {
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      listeners.get(name)?.delete(fn);
    },
    count(name) {
      return listeners.get(name)?.size ?? 0;
    },
    dispatch(name, detail = {}) {
      const event = { type: name, detail };
      for (const fn of [...(listeners.get(name) ?? [])]) {
        fn(event);
      }
    }
  };
}

globalThis.document = createDocumentStub();

/** Documento limpio por prueba (los listeners no se acumulan entre tests). */
function resetDocument() {
  globalThis.document = createDocumentStub();
}

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
export class TAbstractFile { constructor() { this.path = ''; this.name = ''; } }
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
`;

async function loadViewModule() {
  const result = await build({
    entryPoints: [join(root, 'src', 'views', 'FolderLabView.ts')],
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

const { FolderLabView } = await loadViewModule();

// ------------------------------------------------------------
// Dobles de prueba
// ------------------------------------------------------------

function createWorkspaceStub() {
  const navHandlers = new Set();
  return {
    navHandlers,
    on(name, cb) {
      if (name === 'folder-lab:navigation-tree-changed') navHandlers.add(cb);
      return { name, cb };
    },
    off(name, cb) {
      if (name === 'folder-lab:navigation-tree-changed') navHandlers.delete(cb);
    },
    offref() {},
    getActiveFile() { return null; },
    getLeavesOfType() { return []; },
    revealLeaf() {},
    getLeftLeaf() { return null; },
    detachLeavesOfType() {},
    onLayoutChange() {}
  };
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

const spies = { exports: 0, loads: 0 };

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
  const widgetManager = {
    onChange: () => () => {},
    loadForNote: async () => {},
    getLayout: () => ({ top: '', bottom: '' }),
    getInstance: () => undefined,
    getInstances: () => []
  };
  const view = new FolderLabView(leaf, plugin, {}, widgetRegistry, widgetManager);

  // Espías sobre el controller real (constructor liviano).
  view.controller.exportAllNotes = async () => { spies.exports++; };
  view.controller.loadFolder = async () => { spies.loads++; };
  view.controller.getCurrentPath = () => 'Libro';
  view.controller.navigationService.getNavigationType = () => 'folders';

  return view;
}

function resetSpies() {
  spies.exports = 0;
  spies.loads = 0;
}

// ------------------------------------------------------------
// Pruebas
// ------------------------------------------------------------

test('3B: el constructor registra exactamente un listener por evento de document', async () => {
  resetDocument();
  const app = createFakeApp();
  createView(app);

  assert.equal(globalThis.document.count('folder-lab-export'), 1);
  assert.equal(globalThis.document.count('folder-lab-refresh'), 1);
});

test('3B: onClose libera los listeners de document con su referencia real (regresión de la fuga)', async () => {
  resetDocument();
  const app = createFakeApp();
  const view = createView(app);

  assert.equal(globalThis.document.count('folder-lab-export'), 1);
  assert.equal(globalThis.document.count('folder-lab-refresh'), 1);

  await view.onClose();

  assert.equal(
    globalThis.document.count('folder-lab-export'),
    0,
    'el listener de export debe eliminarse con la misma referencia'
  );
  assert.equal(
    globalThis.document.count('folder-lab-refresh'),
    0,
    'el listener de refresh debe eliminarse con la misma referencia'
  );
});

test('3B: tras el cierre, los eventos NO actúan sobre la vista dispuesta', async () => {
  resetDocument();
  resetSpies();
  const app = createFakeApp();
  const view = createView(app);

  await view.onClose();

  // Aunque existiera un listener residual (o un evento en cola),
  // los handlers no deben actuar con la vista dispuesta.
  globalThis.document.dispatch('folder-lab-export', { folderPath: 'Libro' });
  globalThis.document.dispatch('folder-lab-refresh', { folderPath: 'Libro' });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(spies.exports, 0, 'no debe exportar tras el cierre');
  assert.equal(spies.loads, 0, 'no debe recargar carpetas tras el cierre');
});

test('3B: abrir → cerrar → reabrir no acumula handlers (sin duplicados)', async () => {
  resetDocument();
  resetSpies();
  const app = createFakeApp();

  const view1 = createView(app);
  await view1.onClose();

  const view2 = createView(app);

  assert.equal(globalThis.document.count('folder-lab-export'), 1);
  assert.equal(globalThis.document.count('folder-lab-refresh'), 1);

  globalThis.document.dispatch('folder-lab-export', { folderPath: 'Libro' });
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Solo la vista viva actúa, y una única vez.
  assert.equal(spies.exports, 1);

  await view2.onClose();
  assert.equal(globalThis.document.count('folder-lab-export'), 0);
  assert.equal(globalThis.document.count('folder-lab-refresh'), 0);
});

test('3B: navigation-tree-changed se registra y libera con su referencia bound', async () => {
  resetDocument();
  const app = createFakeApp();
  const view = createView(app);

  // Simula el registro que hace onOpen (mismo código).
  app.workspace.on(
    'folder-lab:navigation-tree-changed',
    view.boundHandleNavigationTreeChanged
  );
  assert.equal(app.workspace.navHandlers.size, 1);

  await view.onClose();

  assert.equal(
    app.workspace.navHandlers.size,
    0,
    'onClose debe retirar el handler bound exacto'
  );
});
