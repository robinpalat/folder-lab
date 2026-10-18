// ============================================================
// PRUEBAS: NotesWidget — botón Guardar y guardado como bloque
// ============================================================
// Ejecutar con: npm test
//
// - Botón aparece con texto vivo, no aparece vacío.
// - Guardar crea bloque independiente con el texto exacto.
// - Tras guardar, editor y borrador quedan vacíos.
// - Si el guardado falla, el texto vivo se conserva.
// - Bloques anteriores intactos.
// - Texto guardado no re-entera al editor.
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
export class Notice { constructor(m) { globalThis.__notices = globalThis.__notices || []; globalThis.__notices.push(String(m)); } }
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
    if (this.listeners[name]) this.listeners[name] = this.listeners[name].filter((f) => f !== fn);
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  setAttr(obj) { Object.assign(this.attrs, obj); }
  setText(t) { this.textContent = t; }
  remove() {} addClassAll() {} scrollTo() {} scrollHeight = 0;
  querySelector(sel) {
    const s = String(sel);
    if (s.includes('capture-editor') || s.includes('draft-editor')) return this._findEditor(this);
    if (s.includes('save')) return this._findButton(this, 'save');
    return null;
  }
  querySelectorAll(sel) {
    if (String(sel) === 'button') return this._findAllButtons(this);
    return [];
  }
  _findEditor(el) {
    if (el.tag === 'textarea' && el.classes.has('fl-notes-capture-editor')) return el;
    for (const c of el.children) { const r = c._findEditor?.(c); if (r) return r; }
    return null;
  }
  _findButton(el, id) {
    if (el.tag === 'button' && el.attrs['data-control-id'] === id) return el;
    for (const c of el.children) { const r = c._findButton?.(c, id); if (r) return r; }
    return null;
  }
  _findAllButtons(el) {
    const out = [];
    if (el.tag === 'button') out.push(el);
    for (const c of el.children) { out.push(...(c._findAllButtons?.(c) ?? [])); }
    return out;
  }
  instanceOf(t) { return this instanceof t || t === globalThis.HTMLElement; }
}

globalThis.document = {
  createElement: () => new FakeEl(),
  body: new FakeEl(),
  addEventListener: () => {},
  removeEventListener: () => {}
};

const { NotesWidget } = await bundle('src/focus/widgets/NotesWidget.ts');

function makeMirror() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v))
  };
}

function makeWidget({ notePath = 'Libro/N.md', mirrorStorage = makeMirror(), failWrite = false } = {}) {
  const localMirror = {
    read: async (family, path) => {
      const key = `${family}-id-${path}`;
      const v = mirrorStorage.getItem(key);
      return { value: v, adopted: false };
    },
    write: async (family, path, value) => {
      if (failWrite) throw new Error('write-fail');
      const key = `${family}-id-${path}`;
      if (value === null || value === '') mirrorStorage.map.delete(key);
      else mirrorStorage.setItem(key, value);
    }
  };
  const draftStore = {
    read: async () => ({ draft: '', blocks: [] }),
    write: async (patch) => {
      if (failWrite) throw new Error('draft-store-fail');
    }
  };
  const plugin = { localMirror, draftStore, settings: undefined };
  const app = {
    plugins: { plugins: { 'folder-lab': plugin } },
    workspace: { getActiveFile: () => null, getName: () => 'V' },
    fileManager: {},
    vault: { getAbstractFileByPath: () => null, read: async () => '', getName: () => 'V' }
  };
  const widget = new NotesWidget(app);
  widget.currentFile = { path: notePath };
  widget.container = new FakeEl();
  widget.lastContext = { activeFile: { path: notePath }, widgetController: null };
  widget.draftStorageKey = `focus-notes-draft-id-${notePath}`;
  widget.mirrorWrite = localMirror.write;
  widget.mirrorRead = localMirror.read;
  return { widget, mirrorStorage, localMirror };
}

// ============================================================
// Tests
// ============================================================

test('el botón Guardar aparece cuando hay texto vivo en el editor', () => {
  const { widget } = makeWidget();
  widget.render(widget.container, widget.lastContext);
  // Escribir texto.
  widget.draftText = 'texto vivo';
  widget.textarea.value = 'texto vivo';
  widget.updateSaveActionVisibility();

  const btn = widget.container._findButton(widget.container, 'save');
  assert.ok(btn, 'botón save existe en el DOM');
  assert.ok(!btn.classes.has('is-hidden'), 'botón visible con texto');
});

test('el botón Guardar no aparece cuando el editor está vacío', () => {
  const { widget } = makeWidget();
  widget.render(widget.container, widget.lastContext);
  widget.draftText = '';
  widget.textarea.value = '';
  widget.updateSaveActionVisibility();

  const btn = widget.container._findButton(widget.container, 'save');
  assert.ok(btn, 'botón existe en el DOM');
  assert.ok(btn.classes.has('is-hidden'), 'botón oculto sin texto');
});

test('guardar crea un bloque independiente con el texto exacto', async () => {
  let savedBlocks = null;
  const { widget } = makeWidget();
  widget.render(widget.container, widget.lastContext);
  widget.draftText = 'mi apunte importante';
  widget.textarea.value = 'mi apunte importante';
  widget.saveBlocksStrict = async (blocks) => { savedBlocks = blocks; };

  await widget.saveDraftFromToolbar();

  assert.ok(savedBlocks, 'bloques guardados');
  const last = savedBlocks[savedBlocks.length - 1];
  assert.equal(last.text, 'mi apunte importante', 'texto exacto del bloque');
  assert.equal(last.active, true, 'nuevo bloque activo');
});

test('tras guardar, editor y borrador quedan vacíos', async () => {
  const { widget, mirrorStorage } = makeWidget();
  widget.render(widget.container, widget.lastContext);
  widget.draftText = 'texto a guardar';
  widget.textarea.value = 'texto a guardar';
  widget.saveBlocksStrict = async () => {};

  await widget.saveDraftFromToolbar();

  assert.equal(widget.draftText, '', 'borrador vacío');
  assert.equal(widget.textarea.value, '', 'editor vacío');
  // Espejo de borrador limpiado.
  const key = `focus-notes-draft-id-${widget.currentFile.path}`;
  assert.ok(!mirrorStorage.map.has(key), 'espejo borrador limpiado');
});

test('si el guardado falla, el texto vivo se conserva', async () => {
  const { widget } = makeWidget();
  widget.render(widget.container, widget.lastContext);
  widget.draftText = 'texto importante';
  widget.textarea.value = 'texto importante';
  widget.saveBlocksStrict = async () => { throw new Error('fallo de red'); };

  globalThis.__notices = [];
  await widget.saveDraftFromToolbar();

  assert.equal(widget.draftText, 'texto importante', 'borrador conservado');
  assert.equal(widget.textarea.value, 'texto importante', 'editor conservado');
});

test('bloques anteriores permanecen intactos al guardar uno nuevo', async () => {
  let savedBlocks = null;
  const { widget } = makeWidget();
  widget.render(widget.container, widget.lastContext);
  // Bloques previos.
  widget.loadBlocks = async () => [
    { text: 'bloque anterior 1', active: false },
    { text: 'bloque anterior 2', active: true }
  ];
  widget.saveBlocksStrict = async (blocks) => { savedBlocks = blocks; };
  widget.draftText = 'nuevo bloque';
  widget.textarea.value = 'nuevo bloque';

  await widget.saveDraftFromToolbar();

  assert.equal(savedBlocks.length, 3, '3 bloques (2 previos + 1 nuevo)');
  assert.equal(savedBlocks[0].text, 'bloque anterior 1', 'intacto 1');
  assert.equal(savedBlocks[1].text, 'bloque anterior 2', 'intacto 2');
  assert.equal(savedBlocks[2].text, 'nuevo bloque', 'nuevo añadido');
});

test('el texto guardado no re-entera al editor (espejo limpio tras guardar)', async () => {
  const { widget, mirrorStorage } = makeWidget();
  widget.render(widget.container, widget.lastContext);
  widget.draftText = 'guardado';
  widget.textarea.value = 'guardado';
  widget.saveBlocksStrict = async () => {};
  await widget.saveDraftFromToolbar();

  // El espejo del borrador debe estar limpio tras guardar:
  // load() de un widget nuevo no restaurará el texto guardado.
  const key = `focus-notes-draft-id-${widget.currentFile.path}`;
  assert.ok(!mirrorStorage.map.has(key), 'espejo borrador limpiado');
  assert.equal(mirrorStorage.getItem(key), null, 'espejo sin dato');
});

test('guardar no duplica el texto si el usuario sigue escribiendo durante el guardado', async () => {
  const { widget } = makeWidget();
  widget.render(widget.container, widget.lastContext);
  widget.draftText = 'texto inicial';
  widget.textarea.value = 'texto inicial';
  widget.saveBlocksStrict = async () => {
    // Simular que el usuario escribe mientras se guarda.
    widget.draftText = 'texto inicial + adición';
    widget.textarea.value = 'texto inicial + adición';
  };

  await widget.saveDraftFromToolbar();

  // El texto cambió durante el guardado: NO se limpia.
  assert.equal(widget.draftText, 'texto inicial + adición', 'borrador no limpiado');
});
