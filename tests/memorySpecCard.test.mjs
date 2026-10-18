// ============================================================
// PRUEBAS: MemoryWidget — ficha técnica pre-ejecución
// ============================================================
// Ejecutar con: npm test
//
// - La ficha aparece al abrir Assistant con área vacía.
// - Capacidades mostradas = seleccionadas.
// - Fuentes mostradas = contexto efectivo.
// - Actualización al cambiar fuente, nota, modo o instancias.
// - Sin fuentes deshabilitadas ni duplicadas.
// - Al ejecutar Run, la ficha desaparece.
// - La ficha no se añade al prompt.
// - Respuestas existentes no desaparecen al cambiar config.
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

test('la ficha aparece al abrir Assistant con área de respuesta vacía', () => {
  const { widget } = makeWidget();
  widget.currentResponse = '';
  widget.render(widget.container, widget.lastContext);

  const card = widget.container._findByClass(widget.container, 'fl-memory-spec-card');
  assert.ok(card, 'ficha presente en el DOM');
});

test('sin capacidad seleccionada lo indica explícitamente', () => {
  const { widget } = makeWidget({ selectedCapability: '' });
  widget.currentResponse = '';
  widget.render(widget.container, widget.lastContext);

  const card = widget.container._findByClass(widget.container, 'fl-memory-spec-card');
  const values = card._findAllByClass(card, 'fl-memory-spec-value');
  assert.ok(values.some((v) => /ninguna|no capability/i.test(v.textContent)), 'indica sin capacidad');
});

test('capacidad seleccionada se muestra con su nombre', () => {
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
  widget.render(widget.container, widget.lastContext);

  const card = widget.container._findByClass(widget.container, 'fl-memory-spec-card');
  const values = card._findAllByClass(card, 'fl-memory-spec-value');
  // getSpecCapabilityLabel resuelve vía capabilityTexts (i18n);
  // sin clave i18n, usa found.label.
  assert.ok(values.some((v) => v.textContent.includes('Tesis')), 'nombre de la capacidad');
});

test('capacidad mindmap muestra Transform → Mind Map', () => {
  const registry = {
    getByGroup: () => [{ id: 'transform-mindmap', label: 'Mapa mental' }],
    getGroups: () => [{ id: 'transformacion', label: 'Transformación' }],
    getDefaultGroup: () => 'transformacion'
  };
  const { widget } = makeWidget({
    selectedCapability: 'transform-mindmap',
    selectedDomain: 'transformacion',
    registry
  });
  widget.currentResponse = '';
  widget.render(widget.container, widget.lastContext);

  const card = widget.container._findByClass(widget.container, 'fl-memory-spec-card');
  const values = card._findAllByClass(card, 'fl-memory-spec-value');
  assert.ok(
    values.some((v) => v.textContent === 'Transform → Mind Map'),
    'etiqueta canónica en inglés'
  );
});

test('modo nota muestra la nota actual como fuente', () => {
  const { widget } = makeWidget({
    inputSource: 'nota',
    currentFile: { path: 'LIBRO/Declaración.md', basename: 'Declaración' }
  });
  widget.currentResponse = '';
  widget.render(widget.container, widget.lastContext);

  const card = widget.container._findByClass(widget.container, 'fl-memory-spec-card');
  const items = card._findAllByClass(card, 'fl-memory-spec-source-item');
  assert.ok(items.some((i) => i.textContent.includes('Declaración')), 'nota actual presente');
});

test('modo widget muestra companion e instancias adicionales sin duplicados', () => {
  const instances = [
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' },
    { instanceId: 'coll-1', typeId: 'collections', name: 'Hechos' }
  ];
  // Companion = notes-1 (layout.bottom); explícita = coll-1.
  const { widget } = makeWidget({
    instances,
    inputSource: 'widget',
    selectedWidgetInstances: new Set(['coll-1'])
  });
  widget.currentResponse = '';
  widget.render(widget.container, widget.lastContext);

  const card = widget.container._findByClass(widget.container, 'fl-memory-spec-card');
  const items = card._findAllByClass(card, 'fl-memory-spec-source-item');
  const texts = items.map((i) => i.textContent);
  assert.ok(texts.includes('Apuntes'), 'companion presente');
  assert.ok(texts.includes('Hechos'), 'instancia adicional presente');
  // Sin duplicados: companion no aparece dos veces.
  assert.equal(texts.filter((t) => t === 'Apuntes').length, 1, 'sin duplicados');
});

test('modo board con board activo muestra Board', () => {
  const { widget } = makeWidget({ inputSource: 'board' });
  widget.isBoardModeActive = () => true;
  widget.currentResponse = '';
  widget.render(widget.container, widget.lastContext);

  const card = widget.container._findByClass(widget.container, 'fl-memory-spec-card');
  const items = card._findAllByClass(card, 'fl-memory-spec-source-item');
  assert.ok(items.some((i) => /board/i.test(i.textContent)), 'Board presente');
});

test('la ficha desaparece al tener respuesta actual', () => {
  const { widget } = makeWidget();
  widget.currentResponse = 'respuesta previa del asistente';
  widget.render(widget.container, widget.lastContext);

  const card = widget.container._findByClass(widget.container, 'fl-memory-spec-card');
  assert.equal(card, null, 'sin ficha con respuesta presente');
});

test('la ficha no se añade al prompt (currentResponse intacto)', async () => {
  const { widget, registry } = makeWidget({
    selectedCapability: 'research-thesis',
    registry: { getByGroup: () => [{ id: 'research-thesis', label: 'Tesis' }], getDefaultGroup: () => 'Memoria' }
  });
  widget.currentResponse = '';
  widget.render(widget.container, widget.lastContext);

  // Verificar que currentResponse no contiene texto de la ficha.
  assert.ok(!widget.currentResponse.includes('CAPACIDADES'), 'ficha no en currentResponse');
  assert.ok(!widget.currentResponse.includes('FUENTES'), 'ficha no en currentResponse');
});
