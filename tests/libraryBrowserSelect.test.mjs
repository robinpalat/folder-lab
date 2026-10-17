// ============================================================
// PRUEBAS: LibraryBrowser — botón Select de la pestaña Asistente
// ============================================================
// Ejecutar con: npm test
//
// Causa raíz corregida: `onSelect` se declaraba con `!` y nunca se
// asignaba; al pulsar Select se lanzaba `TypeError: this.onSelect
// is not a function` y el `close()` posterior nunca se ejecutaba
// (fallo silencioso: el modal quedaba abierto sin aplicar nada).
//
// Contrato verificado:
// - Seleccionar una capacidad y pulsar Select ejecuta el callback
//   con la selección correcta (fuentes, dominio, capacidad).
// - El estado se refleja en el callback y el modal se cierra.
// - Una selección inválida (sin capacidad) NO ejecuta el callback.
// - Un callback que lanza NO cierra el modal (estado recuperable)
//   y el error no queda silencioso (console.error).
// - Cancelar cierra el modal sin ejecutar el callback.
// - Sin `onSelect` inyectado, el comportamiento no revienta.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const OBSIDIAN_STUB = `
function makeNode(tag) {
  return {
    __tag: tag,
    __children: [],
    __attrs: {},
    __classes: new Set(),
    __text: '',
    __listeners: {},
    addClass(c) { this.__classes.add(c); },
    removeClass(c) { this.__classes.delete(c); },
    toggleClass(c, f) { if (f) this.__classes.add(c); else this.__classes.delete(c); },
    hasClass(c) { return this.__classes.has(c); },
    setAttr(k, v) { this.__attrs[k] = v; },
    setAttribute(k, v) { this.__attrs[k] = v; },
    getAttribute(k) { return this.__attrs[k] ?? null; },
    removeAttribute(k) { delete this.__attrs[k]; },
    setText(t) { this.__text = String(t); },
    empty() { this.__children = []; },
    addEventListener(name, fn) { (this.__listeners[name] ||= []).push(fn); },
    removeEventListener() {},
    createEl(tag, opts) { return this.__child(tag, opts || {}); },
    createDiv(opts) { return this.__child('div', opts || {}); },
    createSpan(opts) { return this.__child('span', opts || {}); },
    __child(tag, opts) {
      const el = makeNode(tag);
      if (opts.cls) for (const c of String(opts.cls).split(/\\s+/)) el.__classes.add(c);
      if (opts.text !== undefined) el.__text = String(opts.text);
      if (opts.attr) Object.assign(el.__attrs, opts.attr);
      this.__children.push(el);
      return el;
    },
    querySelector(sel) { return queryDescendants(this, sel)[0] ?? null; },
    querySelectorAll(sel) { return queryDescendants(this, sel); },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    focus() {},
    setSelectionRange() {}
  };
}
function allNodes(el, out) {
  out = out || [];
  out.push(el);
  for (const c of el.__children || []) allNodes(c, out);
  return out;
}
function queryDescendants(root, sel) {
  const s = String(sel).trim();
  if (s.startsWith('.')) {
    const cls = s.slice(1).split(/\\s+/);
    return allNodes(root).filter((n) => cls.every((c) => n.__classes.has(c)));
  }
  return [];
}
export class App {}
export class TFile {}
export class Modal {
  constructor(app) { this.app = app; this.modalEl = makeNode('div'); this.contentEl = makeNode('div'); this.modalEl.__children.push(this.contentEl); }
  open() { if (this.onOpen) this.onOpen(); }
  close() { this.__closed = true; if (this.onClose) this.onClose(); }
}
export function setIcon() {}
export function Notice() {}
export function debounce(fn) { return fn; }
export function normalizePath(p) { return p; }
export default {};
`;

async function loadLibraryBrowser() {
  const result = await build({
    entryPoints: [join(root, 'src', 'focus', 'LibraryBrowser.ts')],
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
        }
      }
    ]
  });

  const code = result.outputFiles[0].text;
  const url =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(url);
}

const { LibraryBrowser, CapabilitySelection } = await loadLibraryBrowser();

// ------------------------------------------------------------
// Dobles de prueba
// ------------------------------------------------------------

const GROUPS = [
  { id: 'Memoria', label: 'Memoria' },
  { id: 'Investigación', label: 'Investigación' }
];

const CAPABILITIES = [
  { id: 'resumir', groupId: 'Memoria', label: 'Resumir' },
  { id: 'extraer', groupId: 'Memoria', label: 'Extraer' },
  { id: 'comparar', groupId: 'Investigación', label: 'Comparar' }
];

function createCapabilityRegistry() {
  return {
    getGroups: () => GROUPS.map((g) => ({ ...g })),
    getByGroup: (groupId) =>
      CAPABILITIES.filter((c) => c.groupId === groupId).map((c) => ({ ...c })),
    getDefaultGroup: () => 'Memoria'
  };
}

function createWidgetRegistry() {
  return {
    getDefinitions: () => [],
    getDefinition: () => undefined,
    getAvailableIds: () => []
  };
}

function createWidgetManager() {
  return {
    getInstances: () => [],
    getDefinition: () => undefined,
    getLayout: () => ({ top: '', bottom: '' }),
    applyInstances: async () => {}
  };
}

/**
 * Abre la biblioteca, navega a la pestaña Asistente, y devuelve
 * los elementos de interés.
 */
function openAssistantTab(browser) {
  browser.open();
  const tabs = browser.contentEl.querySelectorAll('.fl-capability-browser-tab');
  // i18n devuelve el label en mayúsculas («ASISTENTE»).
  const assistantTab = tabs.find((t) => /asistente/i.test(t.__text));
  assert.ok(assistantTab, 'la pestaña Asistente existe');
  assistantTab.onclick();
}

function getSelectButton(browser) {
  return browser.modalEl.querySelector('.fl-capability-browser-select');
}

function getCancelButton(browser) {
  return browser.modalEl.querySelector('.fl-capability-browser-cancel');
}

function getCapabilityItem(browser, id) {
  return browser.modalEl
    .querySelectorAll('.fl-capability-browser-item')
    .find((el) => el.getAttribute('data-capability-id') === id);
}

function getGroupItem(browser, id) {
  return browser.modalEl
    .querySelectorAll('.fl-capability-browser-group')
    .find((el) => el.getAttribute('data-group-id') === id);
}

function createBrowser(onSelect) {
  return new LibraryBrowser(
    new (class {})(),
    createWidgetRegistry(),
    createCapabilityRegistry(),
    createWidgetManager(),
    'assistant',
    onSelect
  );
}

// ------------------------------------------------------------
// 1. FLUJO PRINCIPAL
// ------------------------------------------------------------

test('seleccionar capacidad y pulsar Select ejecuta el callback con la selección correcta', () => {
  const calls = [];
  const browser = createBrowser((sel) => calls.push(sel));

  openAssistantTab(browser);

  // Seleccionar la capacidad "resumir" y pulsar Select.
  getCapabilityItem(browser, 'resumir').onclick();
  getSelectButton(browser).onclick();

  assert.equal(calls.length, 1, 'el callback se ejecuta exactamente una vez');
  assert.deepEqual(calls[0], {
    sourceIds: ['note'],
    groupId: 'Memoria',
    capabilityId: 'resumir'
  });
});

test('el modal se cierra tras Select válido', () => {
  const browser = createBrowser(() => {});
  openAssistantTab(browser);
  getCapabilityItem(browser, 'extraer').onclick();
  getSelectButton(browser).onclick();
  assert.equal(browser.__closed, true, 'el modal se cierra');
});

test('cambiar de dominio y seleccionar allí llega el groupId correcto', () => {
  const calls = [];
  const browser = createBrowser((sel) => calls.push(sel));
  openAssistantTab(browser);

  getGroupItem(browser, 'Investigación').onclick();
  getCapabilityItem(browser, 'comparar').onclick();
  getSelectButton(browser).onclick();

  assert.deepEqual(calls[0], {
    sourceIds: ['note'],
    groupId: 'Investigación',
    capabilityId: 'comparar'
  });
});

test('las fuentes marcadas llegan al callback', () => {
  const calls = [];
  const browser = createBrowser((sel) => calls.push(sel));
  openAssistantTab(browser);

  // Marcar la fuente "snips" además de la "note" por defecto.
  const sources = browser.modalEl.querySelectorAll('.fl-capability-browser-source');
  const snips = sources.find((s) => s.getAttribute('data-source-id') === 'snips');
  snips.onclick();

  getCapabilityItem(browser, 'resumir').onclick();
  getSelectButton(browser).onclick();

  assert.deepEqual(calls[0].sourceIds, ['note', 'snips']);
});

// ------------------------------------------------------------
// 2. SELECCIÓN INVÁLIDA
// ------------------------------------------------------------

test('sin capacidad seleccionada, Select no ejecuta el callback', () => {
  const calls = [];
  const browser = createBrowser((sel) => calls.push(sel));
  openAssistantTab(browser);

  getSelectButton(browser).onclick();

  assert.equal(calls.length, 0, 'sin selección no se confirma nada');
  assert.equal(browser.__closed, undefined, 'el modal no se cierra');
});

test('cambiar de dominio limpia la capacidad previa', () => {
  const calls = [];
  const browser = createBrowser((sel) => calls.push(sel));
  openAssistantTab(browser);

  getCapabilityItem(browser, 'resumir').onclick();
  getGroupItem(browser, 'Investigación').onclick();
  getSelectButton(browser).onclick();

  assert.equal(calls.length, 0, 'la capacidad previa ya no es válida');
});

// ------------------------------------------------------------
// 3. ERRORES VISIBLES Y ESTADO RECUPERABLE
// ------------------------------------------------------------

test('un callback que lanza NO cierra el modal y el error es visible', () => {
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));

  try {
    const browser = createBrowser(() => {
      throw new Error('fallo de red');
    });
    openAssistantTab(browser);

    getCapabilityItem(browser, 'resumir').onclick();
    getSelectButton(browser).onclick();

    assert.equal(browser.__closed, undefined, 'el modal permanece abierto');
    assert.ok(
      errors.some((e) => e.includes('fallo de red')),
      'el error se registra en console.error'
    );

    // La selección se conserva: reintentar no requiere reseleccionar.
    getSelectButton(browser).onclick();
    assert.equal(browser.__closed, undefined, 'sigue abierto tras reintentar');
  } finally {
    console.error = originalError;
  }
});

// ------------------------------------------------------------
// 4. CANCELAR / CERRAR
// ------------------------------------------------------------

test('Cancelar cierra el modal sin ejecutar el callback', () => {
  const calls = [];
  const browser = createBrowser((sel) => calls.push(sel));
  openAssistantTab(browser);

  getCapabilityItem(browser, 'resumir').onclick();
  getCancelButton(browser).onclick();

  assert.equal(calls.length, 0, 'Cancelar no confirma la selección');
  assert.equal(browser.__closed, true, 'el modal se cierra');
});

// ------------------------------------------------------------
// 5. REGRESIÓN: SIN CALLBACK INYECTADO
// ------------------------------------------------------------

test('sin onSelect inyectado, pulsar Select no revienta', () => {
  const browser = new LibraryBrowser(
    new (class {})(),
    createWidgetRegistry(),
    createCapabilityRegistry(),
    createWidgetManager(),
    'assistant'
  );

  openAssistantTab(browser);
  getCapabilityItem(browser, 'resumir').onclick();

  // No debe lanzar TypeError.
  assert.doesNotThrow(() => getSelectButton(browser).onclick());
});

test('CapabilitySelection se exporta como tipo (contrato público)', () => {
  assert.equal(CapabilitySelection, undefined);
  // El tipo no existe en runtime; su uso se valida en TypeScript.
});
