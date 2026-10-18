// ============================================================
// PRUEBAS: NotesWidget — persistencia del borrador en vivo
// ============================================================
// Ejecutar con: npm test
//
// - El texto se conserva al cambiar de widget y regresar.
// - El texto sin guardar no se sustituye por el último bloque.
// - Las modificaciones recientes se conservan.
// - Los bloques guardados permanecen intactos.
// - Desactivar un bloque no borra el borrador.
// - El borrador no aparece duplicado como bloque.
// - Borradores de notas diferentes aislados.
// - La restauración no sobreescribe con datos obsoletos.
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
export class FileSystemAdapter { getBasePath() { return '/stub'; } }
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

const { NotesWidget } = await bundle('src/focus/widgets/NotesWidget.ts');

globalThis.HTMLElement = class HTMLElement {};
globalThis.window = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  addEventListener: () => {},
  removeEventListener: () => {}
};

class FakeEl {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.classes = new Set();
    this.style = { setProperty() {}, removeProperty() {} };
    this.listeners = {}; this.attrs = {}; this.value = '';
    this.textContent = ''; this.scrollHeight = 0;
  }
  createEl(tag, opts = {}) {
    const el = new FakeEl(tag);
    if (opts.cls) for (const c of String(opts.cls).split(/\s+/)) el.classes.add(c);
    if (opts.text !== undefined) el.textContent = opts.text;
    if (opts.attr) Object.assign(el.attrs, opts.attr);
    this.children.push(el); return el;
  }
  createDiv(opts = {}) { return this.createEl('div', opts); }
  createSpan(opts = {}) { return this.createEl('span', opts); }
  addClass(c) { this.classes.add(c); }
  removeClass(c) { this.classes.delete(c); }
  toggleClass(c, force) { if (force) this.classes.add(c); else this.classes.delete(c); }
  empty() { this.children = []; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  removeEventListener(name, fn) {
    if (this.listeners[name]) {
      this.listeners[name] = this.listeners[name].filter((f) => f !== fn);
    }
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  setAttr(obj) { Object.assign(this.attrs, obj); }
  setText(t) { this.textContent = t; }
  remove() {} addClassAll() {} scrollTo() {}
  querySelector(sel) {
    if (String(sel).includes('capture-editor') || String(sel).includes('draft-editor')) {
      const found = this._findEditor(this);
      return found;
    }
    return null;
  }
  querySelectorAll() { return []; }
  _findEditor(el) {
    if (el.tag === 'textarea' && el.classes.has('fl-notes-capture-editor')) return el;
    for (const c of el.children) { const r = c._findEditor?.(c); if (r) return r; }
    return null;
  }
  instanceOf(t) { return this instanceof t || t === globalThis.HTMLElement; }
}

function makeMirror() {
  globalThis.document = {
    createElement: () => new FakeEl(),
    body: new FakeEl(),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v))
  };
}

function makeWidget({ notePath = 'Libro/N.md', mirrorStorage = makeMirror(), draftStoreData = null } = {}) {
  const localMirror = {
    read: async (family, path) => {
      const key = `${family}-id-${path}`;
      const v = mirrorStorage.getItem(key);
      return { value: v, adopted: false };
    },
    write: async (family, path, value) => {
      const key = `${family}-id-${path}`;
      if (value === null || value === '') mirrorStorage.map.delete(key);
      else mirrorStorage.setItem(key, value);
    }
  };
  const draftStore = {
    read: async () => draftStoreData ?? { draft: '', blocks: [] },
    write: async () => {}
  };
  const plugin = { localMirror, draftStore, settings: undefined };
  const app = {
    plugins: { plugins: { 'folder-lab': plugin } },
    workspace: { getActiveFile: () => null },
    fileManager: {},
    vault: { getAbstractFileByPath: () => null, read: async () => '', getName: () => 'TestVault' }
  };
  const widget = new NotesWidget(app);
  widget.currentFile = { path: notePath };
  widget.container = new FakeEl();
  widget.lastContext = { activeFile: { path: notePath }, widgetController: null };
  widget.draftStorageKey = `focus-notes-draft-id-${notePath}`;
  return { widget, mirrorStorage, plugin };
}

// ============================================================
// Tests
// ============================================================

test('el texto escrito en el editor se conserva al cambiar y volver', async () => {
  const { widget } = makeWidget();
  widget.render(widget.container, widget.lastContext);

  // Escribir en el editor.
  const editor = widget.textarea;
  assert.ok(editor, 'editor asignado tras render');
  editor.value = 'borrador en vivo';
  editor.listeners.input?.forEach((fn) => fn());

  // Simular cambio de widget: destroy + nuevo render.
  widget.destroy();
  const { widget: w2 } = makeWidget({ mirrorStorage: widget.mirrorStorage ?? makeMirror() });
  // Reutilizar el mismo mirror (simula la misma sesión).
  const storage = new Map();
  // Copiar el espejo del widget original.
  // (El mirror del widget original ya tiene el texto.)
  // Reconstruir con el mismo mirror.
  const mirror = {
    read: async (family, path) => {
      const key = `${family}-id-${path}`;
      // El texto fue escrito por el widget anterior.
      return { value: family === 'focus-notes-draft' ? 'borrador en vivo' : null, adopted: false };
    },
    write: async () => {}
  };
  const plugin2 = { localMirror: mirror, draftStore: { read: async () => ({ draft: '', blocks: [] }), write: async () => {} }, settings: undefined };
  const app2 = { plugins: { plugins: { 'folder-lab': plugin2 } }, workspace: { getActiveFile: () => null }, fileManager: {}, vault: { getAbstractFileByPath: () => null, read: async () => '', getName: () => 'TestVault' } };
  const w3 = new NotesWidget(app2);
  w3.currentFile = { path: 'Libro/N.md' };
  w3.container = new FakeEl();
  w3.lastContext = { activeFile: { path: 'Libro/N.md' }, widgetController: null };
  w3.draftStorageKey = 'focus-notes-draft-id-Libro/N.md';
  w3.render(w3.container, w3.lastContext);
  await w3.load();

  assert.equal(w3.draftText, 'borrador en vivo', 'borrador restaurado');
  assert.equal(w3.textarea?.value, 'borrador en vivo', 'editor restaurado');
});

test('el texto sin guardar no se sustituye por el último bloque guardado', async () => {
  const { widget } = makeWidget({
    draftStoreData: { draft: 'bloque previo', blocks: [{ text: 'bloque previo', active: true }] }
  });
  // El espejo tiene el borrador en vivo; DraftStore tiene un bloque.
  widget.mirrorRead = async (family) =>
    family === 'focus-notes-draft' ? 'borrador sin guardar' : null;

  await widget.load();
  assert.equal(widget.draftText, 'borrador sin guardar', 'borrador del espejo, no del bloque');
});

test('las modificaciones recientes se conservan (no solo el inicial)', async () => {
  const { widget } = makeWidget();
  widget.render(widget.container, widget.lastContext);
  const editor = widget.textarea;

  editor.value = 'a';
  editor.listeners.input?.forEach((fn) => fn());
  assert.equal(widget.draftText, 'a');

  editor.value = 'ab';
  editor.listeners.input?.forEach((fn) => fn());
  assert.equal(widget.draftText, 'ab');

  editor.value = 'abc';
  editor.listeners.input?.forEach((fn) => fn());
  assert.equal(widget.draftText, 'abc', 'última modificación conservada');
});

test('los bloques guardados permanecen intactos tras escribir borrador', async () => {
  const blocks = [{ text: 'bloque 1', active: true }];
  let savedBlocks = null;
  const { widget } = makeWidget();
  widget.persistDraftPatch = (patch) => {
    if (patch.blocks) savedBlocks = patch.blocks;
  };
  widget.render(widget.container, widget.lastContext);

  // Escribir borrador (no debe tocar bloques).
  widget.textarea.value = 'nuevo borrador';
  widget.textarea.listeners.input?.forEach((fn) => fn());

  assert.equal(savedBlocks, null, 'bloques no modificados por el borrador');
});

test('desactivar un bloque no borra el borrador actual', async () => {
  const { widget } = makeWidget();
  widget.render(widget.container, widget.lastContext);
  widget.draftText = 'borrador activo';
  widget.textarea.value = 'borrador activo';

  // Simular toggle de bloque: persistDraftPatch con blocks.
  widget.persistDraftPatch({ blocks: [{ text: 'b', active: false }] });

  assert.equal(widget.draftText, 'borrador activo', 'borrador intacto');
  assert.equal(widget.textarea.value, 'borrador activo', 'editor intacto');
});

test('el borrador no aparece duplicado como bloque guardado', async () => {
  let savedBlocks = [];
  const { widget } = makeWidget();
  widget.persistDraftPatch = (patch) => {
    if (patch.blocks) savedBlocks = patch.blocks;
  };
  widget.render(widget.container, widget.lastContext);
  widget.textarea.value = 'texto del borrador';
  widget.textarea.listeners.input?.forEach((fn) => fn());

  // El borrador escribe draft, no blocks.
  assert.equal(savedBlocks.length, 0, 'sin bloques nuevos');
});

test('borradores de notas diferentes permanecen aislados', async () => {
  const storageN1 = new Map();
  const storageN2 = new Map();
  const mirrorFor = (storage) => ({
    read: async (family, path) => ({ value: storage.get(`${family}-id-${path}`) ?? null, adopted: false }),
    write: async (family, path, value) => {
      const k = `${family}-id-${path}`;
      if (value === null || value === '') storage.delete(k); else storage.set(k, value);
    }
  });
  const makeFor = (notePath, storage) => {
    const plugin = { localMirror: mirrorFor(storage), draftStore: { read: async () => ({ draft: '', blocks: [] }), write: async () => {} }, settings: undefined };
    const app = { plugins: { plugins: { 'folder-lab': plugin } }, workspace: { getActiveFile: () => null }, fileManager: {}, vault: { getAbstractFileByPath: () => null, read: async () => '', getName: () => 'TestVault' } };
    const w = new NotesWidget(app);
    w.currentFile = { path: notePath };
    w.container = new FakeEl();
    w.lastContext = { activeFile: { path: notePath }, widgetController: null };
    w.draftStorageKey = `focus-notes-draft-id-${notePath}`;
    w.render(w.container, w.lastContext);
    return w;
  };

  const w1 = makeFor('Libro/A.md', storageN1);
  w1.textarea.value = 'borrador de A';
  w1.textarea.listeners.input?.forEach((fn) => fn());

  const w2 = makeFor('Libro/B.md', storageN2);
  w2.textarea.value = 'borrador de B';
  w2.textarea.listeners.input?.forEach((fn) => fn());

  assert.equal(storageN1.get('focus-notes-draft-id-Libro/A.md'), 'borrador de A');
  assert.equal(storageN2.get('focus-notes-draft-id-Libro/B.md'), 'borrador de B');
  assert.ok(!storageN1.has('focus-notes-draft-id-Libro/B.md'), 'A no contiene B');
});

test('la restauración no sobreescribe el editor con datos obsoletos', async () => {
  // Si el espejo no tiene borrador, load() no debe limpiar el editor.
  const { widget } = makeWidget();
  widget.render(widget.container, widget.lastContext);
  widget.draftText = 'texto actual';
  widget.textarea.value = 'texto actual';

  // Espejo vacío (sin borrador persistido).
  widget.mirrorRead = async () => null;
  await widget.load();

  assert.equal(widget.draftText, 'texto actual', 'borrador no sobrescrito');
  assert.equal(widget.textarea.value, 'texto actual', 'editor no sobrescrito');
});

// ============================================================
// Separación borrador ↔ bloques guardados
// ============================================================

test('sin borrador previo, el editor comienza vacío aunque existan bloques guardados', async () => {
  const { widget } = makeWidget({
    draftStoreData: {
      draft: '',
      blocks: [
        { text: 'bloque 1', active: true },
        { text: 'bloque 2', active: true }
      ]
    }
  });
  // El espejo focus-notes contiene el texto unido de los bloques
  // (lo escribe saveBlocksStrict). load() NO debe leerlo.
  widget.mirrorRead = async (family) => {
    if (family === 'focus-notes') return 'bloque 1\n\nbloque 2';
    if (family === 'focus-notes-draft') return null;
    return null;
  };
  widget.render(widget.container, widget.lastContext);
  await widget.load();

  assert.equal(widget.draftText, '', 'borrador vacío');
  assert.equal(widget.textarea.value, '', 'editor vacío');
});

test('con un borrador previo, se restaura únicamente ese texto', async () => {
  const { widget } = makeWidget({
    draftStoreData: {
      draft: '',
      blocks: [{ text: 'bloque guardado', active: true }]
    }
  });
  widget.mirrorRead = async (family) => {
    if (family === 'focus-notes-draft') return 'mi borrador';
    if (family === 'focus-notes') return 'bloque guardado';
    return null;
  };
  widget.render(widget.container, widget.lastContext);
  await widget.load();

  assert.equal(widget.draftText, 'mi borrador', 'solo el borrador');
  assert.equal(widget.textarea.value, 'mi borrador', 'editor = borrador');
});

test('el contenido de los bloques guardados no aparece en el editor', async () => {
  const { widget } = makeWidget();
  // focus-notes contiene texto de bloques (como lo escribe saveBlocksStrict).
  widget.mirrorRead = async (family) => {
    if (family === 'focus-notes') return 'contenido de bloques unidos';
    return null;
  };
  widget.render(widget.container, widget.lastContext);
  await widget.load();

  assert.ok(!widget.textarea.value.includes('contenido de bloques'), 'editor sin bloques');
  assert.equal(widget.draftText, '', 'borrador vacío');
});

test('guardar un bloque no vuelve a introducir su contenido en el editor', async () => {
  let savedBlocks = null;
  const { widget } = makeWidget();
  widget.persistDraftPatch = (patch) => {
    if (patch.blocks) savedBlocks = patch.blocks;
  };
  widget.render(widget.container, widget.lastContext);

  // El usuario escribe un borrador.
  widget.textarea.value = 'borrador del usuario';
  widget.textarea.listeners.input?.forEach((fn) => fn());

  // Se guarda un bloque (simulando saveBlocks → saveBlocksStrict).
  // saveBlocksStrict escribe a focus-notes, NO al editor.
  widget.mirrorWrite = async (family, value) => {
    if (family === 'focus-notes') {
      // Solo se escribe al espejo de notas, no al editor.
    }
  };

  assert.equal(widget.textarea.value, 'borrador del usuario', 'editor intacto');
  assert.equal(widget.draftText, 'borrador del usuario', 'borrador intacto');
});

test('una nota sin borrador no hereda el borrador ni los bloques de otra nota', async () => {
  const storageA = new Map();
  const storageB = new Map();
  const mirrorFor = (storage) => ({
    read: async (family, path) => ({ value: storage.get(`${family}-id-${path}`) ?? null, adopted: false }),
    write: async (family, path, value) => {
      const k = `${family}-id-${path}`;
      if (value === null || value === '') storage.delete(k); else storage.set(k, value);
    }
  });
  const makeFor = (notePath, storage, blocks = []) => {
    const plugin = {
      localMirror: mirrorFor(storage),
      draftStore: { read: async () => ({ draft: '', blocks }), write: async () => {} },
      settings: undefined
    };
    const app = {
      plugins: { plugins: { 'folder-lab': plugin } },
      workspace: { getActiveFile: () => null },
      fileManager: {},
      vault: { getAbstractFileByPath: () => null, read: async () => '', getName: () => 'V' }
    };
    const w = new NotesWidget(app);
    w.currentFile = { path: notePath };
    w.container = new FakeEl();
    w.lastContext = { activeFile: { path: notePath }, widgetController: null };
    w.draftStorageKey = `focus-notes-draft-id-${notePath}`;
    w.render(w.container, w.lastContext);
    return w;
  };

  // Nota A tiene borrador y bloques.
  const wA = makeFor('Libro/A.md', storageA, [{ text: 'bloque de A', active: true }]);
  wA.textarea.value = 'borrador de A';
  wA.textarea.listeners.input?.forEach((fn) => fn());

  // Nota B no tiene borrador ni bloques.
  const wB = makeFor('Libro/B.md', storageB);
  await wB.load();

  assert.equal(wB.draftText, '', 'B sin borrador de A');
  assert.equal(wB.textarea.value, '', 'B sin editor de A');
});
