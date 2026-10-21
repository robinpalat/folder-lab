// ============================================================
// PRUEBAS: MemoryWidget — módulo de preparación y transiciones
// ============================================================
// Ejecutar con: npm test
//
// - El módulo de preparación aparece con área vacía.
// - El módulo muestra la capacidad seleccionada.
// - El módulo se oculta al haber respuesta.
// - La ficha antigua (spec-card) ya no se renderiza.
// - currentResponse no se contamina con texto de configuración.
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
export class Modal { constructor(app) { this.app = app; this.contentEl = { empty() {}, createEl() { return {}; }, createDiv() { return {}; } }; this.titleEl = { setText() {} }; this.modalEl = { addClass() {} }; } open() {} close() {} }
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
    if (s.includes('spec-card')) return this._findByClass(this, 'fl-memory-spec-card');
    if (s.includes('response-area')) return this._findByClass(this, 'fl-memory-response-area');
    return null;
  }
  querySelectorAll(sel) { return []; }
  _findByClass(el, cls) {
    if (el.classes.has(cls)) return el;
    for (const c of el.children) { const r = c._findByClass?.(c, cls); if (r) return r; }
    return null;
  }
  _findAllByClass(el, cls, out = []) {
    if (el.classes.has(cls)) out.push(el);
    for (const c of el.children) c._findAllByClass?.(c, cls, out);
    return out;
  }
  instanceOf(t) { return this instanceof t || t === globalThis.HTMLElement; }
}

const { MemoryWidget } = await bundle('src/focus/widgets/MemoryWidget.ts');

function makeWidget({
  instances = [],
  currentFile = { path: 'Libro/N.md', basename: 'N' },
  inputSource = 'widget',
  selectedCapability = '',
  selectedDomain = 'Memoria',
  selectedWidgetInstances = new Set(),
  registry = null
} = {}) {
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
  const reg = registry ?? {
    getByGroup: () => [],
    getGroups: () => [],
    getDefaultGroup: () => 'Memoria'
  };
  const plugin = {
    localMirror: null,
    noteLifecycle: { getNoteId: async () => 'id-1' },
    settings: undefined,
    draftStore: null
  };
  const app = {
    plugins: { plugins: { 'folder-lab': plugin } },
    workspace: { getActiveFile: () => currentFile, getLeavesOfType: () => [] },
    fileManager: {},
    vault: { getAbstractFileByPath: () => null, read: async () => '', getName: () => 'V' }
  };
  const widget = new MemoryWidget(
    app,
    { getStatus: () => ({ configured: true }), callTool: async () => ({ success: true, content: 'ok' }) },
    reg,
    {},
    widgetManager,
    {}
  );
  widget.currentFile = currentFile;
  widget.container = new FakeEl();
  widget.lastContext = { activeFile: currentFile, widgetController: null };
  widget.inputSource = inputSource;
  widget.selectedCapability = selectedCapability;
  widget.selectedDomain = selectedDomain;
  widget.selectedWidgetInstances = selectedWidgetInstances;
  return { widget, widgetManager, registry: reg };
}

// ============================================================
// Tests
// ============================================================

test('el módulo de preparación aparece con área vacía', () => {
  const { widget } = makeWidget();
  widget.currentResponse = '';
  widget.hasResponse = false;
  widget.render(widget.container, widget.lastContext);

  const prep = widget.container._findByClass(widget.container, 'fl-memory-prep-module');
  assert.ok(prep, 'módulo de preparación presente en el DOM');
});

test('la ficha antigua (spec-card) ya no se renderiza', () => {
  const { widget } = makeWidget();
  widget.currentResponse = '';
  widget.hasResponse = false;
  widget.render(widget.container, widget.lastContext);

  const card = widget.container._findByClass(widget.container, 'fl-memory-spec-card');
  assert.equal(card, null, 'spec-card no debe existir');
});

test('el módulo de preparación muestra la capacidad seleccionada', () => {
  const registry = {
    getByGroup: () => [{ id: 'research-thesis', label: 'Tesis de investigación' }],
    getGroups: () => [{ id: 'Memoria', label: 'Memoria' }],
    getDefaultGroup: () => 'Memoria'
  };
  const { widget } = makeWidget({
    selectedCapability: 'research-thesis',
    selectedDomain: 'Memoria',
    registry
  });
  widget.currentResponse = '';
  widget.hasResponse = false;
  widget.render(widget.container, widget.lastContext);

  const prep = widget.container._findByClass(widget.container, 'fl-memory-prep-module');
  assert.ok(prep, 'módulo presente');
  const combo = prep._findByClass(prep, 'fl-memory-prep-cap-combo');
  assert.ok(combo, 'combo de capacidad presente');
  const capLabel = combo._findByClass(combo, 'fl-memory-prep-cap-value');
  assert.ok(capLabel, 'etiqueta de capacidad presente');
  assert.ok(capLabel.textContent.includes('Tesis'), 'nombre de la capacidad visible');
});

test('el módulo de preparación se oculta al haber respuesta', () => {
  const { widget } = makeWidget();
  widget.currentResponse = 'respuesta previa del asistente';
  widget.hasResponse = true;
  widget.render(widget.container, widget.lastContext);

  const prep = widget.container._findByClass(widget.container, 'fl-memory-prep-module');
  assert.equal(prep, null, 'sin módulo de preparación con respuesta');
});

test('la respuesta no se contamina con texto de configuración', async () => {
  const { widget, registry } = makeWidget({
    selectedCapability: 'research-thesis',
    registry: { getByGroup: () => [{ id: 'research-thesis', label: 'Tesis' }], getGroups: () => [], getDefaultGroup: () => 'Memoria' }
  });
  widget.currentResponse = '';
  widget.render(widget.container, widget.lastContext);

  // Verificar que currentResponse no contiene texto de la ficha antigua.
  assert.ok(!widget.currentResponse.includes('CAPACIDADES'), 'ficha no en currentResponse');
  assert.ok(!widget.currentResponse.includes('FUENTES'), 'ficha no en currentResponse');
});
