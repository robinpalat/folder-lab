// ============================================================
// PRUEBAS: Sincronización de estados (caché visual)
// ============================================================
// Ejecutar con: npm test
//
// Regresión: tras guardar un icono de estado, el MODELO en memoria
// (state.items) debe quedar sincronizado; de lo contrario, al volver
// a la vista normal, renderNormalMode pintaba los iconos viejos.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const OBSIDIAN_STUB = `
export class Notice { constructor() {} }
export class Menu { addItem(){return this;} showAtPosition(){} }
export function setIcon() {}
export class App {}
export class TFile {}
export class TFolder {}
globalThis.__TFile = TFile;
export default {};
export class FileSystemAdapter { getBasePath(){return '/s';} }
`;

async function bundle(entryRel) {
  const result = await build({
    entryPoints: [join(root, entryRel)],
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

// Elemento falso compatible con las extensiones de Obsidian usadas.
class FakeEl {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.attrs = {};
    this.style = {};
  }
  createEl(tag, opts = {}) {
    const el = new FakeEl(tag);
    if (opts.cls) {
      String(opts.cls).split(/\s+/).filter(Boolean).forEach((c) => el.classes.add(c));
    }
    this.children.push(el);
    return el;
  }
  createDiv(opts) { return this.createEl('div', opts); }
  createSpan(opts) { return this.createEl('span', opts); }
  empty() { this.children = []; }
  addClass(c) { this.classes.add(c); }
  removeClass(c) { this.classes.delete(c); }
  toggleClass(c, force) { if (force) this.classes.add(c); else this.classes.delete(c); }
  setAttr(k, v) { this.attrs[k] = v; }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  remove() {}
  set textContent(v) { this._text = v; }
  get textContent() { return this._text ?? ''; }
  get classList() {
    const s = this.classes;
    return {
      add: (c) => s.add(c),
      remove: (c) => s.delete(c),
      toggle: (c, f) => (f ? s.add(c) : s.delete(c)),
      contains: (c) => s.has(c)
    };
  }
}

function makeFile(path) {
  const TFile = globalThis.__TFile;
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop();
  f.extension = 'md';
  return f;
}

const { NoteListComponent } = await bundle('src/components/NoteListComponent.ts');

function makeHarness(status = 'draft') {
  const file = makeFile('Master/Libro/a.md');
  const item = {
    name: 'a.md',
    path: 'Master/Libro/a.md',
    isSpecial: false,
    file,
    isEmpty: false,
    status
  };
  const state = { items: [item], isFocusMode: false, settings: { numberingStyle: 'roman', showNumbers: true }, activeFilter: null };
  const noteService = {
    async setNoteStatusByFile() {},
    async getNoteStatusByFile() {
      return item.status ?? '';
    },
    async isNoteEmpty() { return false; }
  };
  const controller = {
    getState: () => state,
    getCurrentPath: () => 'Master/Libro',
    propertyOrderService: {},
    navigationService: null,
    filterService: null
  };
  const container = new FakeEl();
  const list = new NoteListComponent(
    { vault: { getActiveFile: () => null }, workspace: { getActiveFile: () => null } },
    state,
    controller,
    { applyFilter: (items) => items }, // filterService
    {}, // orderService
    noteService,
    container,
    () => {}
  );
  return { list, item, file, state };
}

test('regresión: tras guardar el icono, el modelo (state.items) se sincroniza', async () => {
  const { list, item, file, state } = makeHarness('draft');
  const container = new FakeEl();
  await list.render([
    { type: 'note', data: item, level: 0, number: 1 }
  ]);

  // Simular: el usuario quita el icono (status vacío).
  const renderer = list.noteRenderer;
  assert.ok(renderer && renderer.onStatusChange, 'callback expuesto por el renderer');
  renderer.onStatusChange(file, '');

  // Dar tiempo a la promesa de persistencia + then().
  await new Promise((r) => setTimeout(r, 10));

  // El modelo debe reflejar el cambio: es lo que renderNormalMode
  // pintaría al volver de otra vista.
  assert.equal(state.items[0].status, undefined, 'modelo sincronizado');
  assert.equal(item.status, undefined, 'mismo objeto de state.items');
});

test('regresión: establecer un icono también actualiza el modelo', async () => {
  const { list, item, file, state } = makeHarness('');
  await list.render([
    { type: 'note', data: item, level: 0, number: 1 }
  ]);
  list.noteRenderer.onStatusChange(file, 'approved');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(state.items[0].status, 'approved');
});

test('regresión: si la persistencia falla, el modelo NO se cambia', async () => {
  const file = makeFile('Master/Libro/b.md');
  const item = {
    name: 'b.md',
    path: 'Master/Libro/b.md',
    isSpecial: false,
    file,
    isEmpty: false,
    status: 'draft'
  };
  const state = { items: [item], isFocusMode: false, settings: { numberingStyle: 'roman', showNumbers: true }, activeFilter: null };
  const noteService = {
    async setNoteStatusByFile() {
      throw new Error('EIO simulado');
    },
    async getNoteStatusByFile() { return 'draft'; },
    async isNoteEmpty() { return false; }
  };
  const list = new NoteListComponent(
    { vault: { getActiveFile: () => null }, workspace: { getActiveFile: () => null } },
    state,
    {
      getState: () => state,
      getCurrentPath: () => 'Master/Libro',
      propertyOrderService: {},
      navigationService: null
    },
    { applyFilter: (items) => items },
    {},
    noteService,
    new FakeEl(),
    () => {}
  );
  await list.render([{ type: 'note', data: item, level: 0, number: 1 }]);
  list.noteRenderer.onStatusChange(file, 'approved');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(state.items[0].status, 'draft', 'modelo intacto tras fallo');
});
