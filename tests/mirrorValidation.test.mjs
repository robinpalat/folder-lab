// ============================================================
// PRUEBAS: Validación de espejos y fix del bucle MemoryWidget
// ============================================================
// Ejecutar con: npm test
//
// Causa raíz del bloqueo (reproducida): render() limpia results y
// lanza resolveResultsMirror(); con espejo poblado, éste aplicaba
// resultados y re-lanzaba render(), que volvía a limpiar y a
// resolver → bucle infinito async que saturaba el event loop.
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
export function setIcon(el, icon) { if (el) el.icon = icon; }
export class Menu { addItem() { return this; } showAtMouseEvent() {} showAtPosition() {} }
export class MarkdownRenderer { static render(app, md, el, sourcePath) { if (el) el.textContent = sourcePath; return Promise.resolve(); } }
globalThis.__TFolder = TFolder;
globalThis.__TFile = TFile;
globalThis.__notices = [];
export class Notice { constructor(m) { globalThis.__notices.push(String(m)); } }
export default {};
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

const { LocalMirror, mirrorKey, legacyMirrorKey } = await bundle(
  'src/storage/localMirror.ts'
);

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v))
  };
}

function makeMirror({ storage, id = 'id-1' } = {}) {
  return new LocalMirror({
    storage: storage ?? fakeStorage(),
    vaultId: 'v1',
    getNoteId: async () => id,
    hasSafeOwnership: async () => true
  });
}

// ============================================================
// LocalMirror: validación por familia
// ============================================================

test('espejo válido de resultados: se sirve intacto', async () => {
  const storage = fakeStorage();
  const value = JSON.stringify([
    { id: 'memory-1-abc', content: 'ok', active: true }
  ]);
  storage.setItem(mirrorKey('focus-memory-results', 'v1', 'id-1'), value);
  const mirror = makeMirror({ storage });
  const r = await mirror.read('focus-memory-results', 'Nota.md');
  assert.equal(r.value, value);
  assert.equal(r.adopted, false);
});

test('JSON corrupto en resultados: descartado y clave limpiada', async () => {
  const storage = fakeStorage();
  const key = mirrorKey('focus-memory-results', 'v1', 'id-1');
  storage.setItem(key, 'no-es-json{{{');
  const mirror = makeMirror({ storage });
  const r = await mirror.read('focus-memory-results', 'Nota.md');
  assert.equal(r.value, null, 'descartado');
  assert.equal(storage.getItem(key), '', 'clave limpiada');
});

test('estructura incompatible en resultados (objeto en vez de array): descartado', async () => {
  const storage = fakeStorage();
  storage.setItem(
    mirrorKey('focus-memory-results', 'v1', 'id-1'),
    '{"no":"array"}'
  );
  const mirror = makeMirror({ storage });
  const r = await mirror.read('focus-memory-results', 'Nota.md');
  assert.equal(r.value, null);
});

test('estructura incompatible en resultados (items sin campos requeridos): descartado', async () => {
  const storage = fakeStorage();
  storage.setItem(
    mirrorKey('focus-memory-results', 'v1', 'id-1'),
    JSON.stringify([{ foo: 1 }, { id: 'x', content: 'y' }])
  );
  const mirror = makeMirror({ storage });
  const r = await mirror.read('focus-memory-results', 'Nota.md');
  assert.equal(r.value, null);
});

test('bloques válidos ({text, active}): se sirven', async () => {
  const storage = fakeStorage();
  const value = JSON.stringify([{ text: 'hola', active: true }]);
  storage.setItem(mirrorKey('focus-notes-blocks', 'v1', 'id-1'), value);
  const mirror = makeMirror({ storage });
  const r = await mirror.read('focus-notes-blocks', 'Nota.md');
  assert.equal(r.value, value);
});

test('bloques en formato legado string[]: se sirven', async () => {
  const storage = fakeStorage();
  const value = JSON.stringify(['a', 'b']);
  storage.setItem(mirrorKey('focus-notes-blocks', 'v1', 'id-1'), value);
  const mirror = makeMirror({ storage });
  const r = await mirror.read('focus-notes-blocks', 'Nota.md');
  assert.equal(r.value, value);
});

test('bloques corruptos: descartados', async () => {
  const storage = fakeStorage();
  const key = mirrorKey('focus-notes-blocks', 'v1', 'id-1');
  storage.setItem(key, '[{"text": 123}]'); // text no-string → inválido
  const mirror = makeMirror({ storage });
  const r = await mirror.read('focus-notes-blocks', 'Nota.md');
  assert.equal(r.value, null);
  assert.equal(storage.getItem(key), '');
});

test('familias de texto plano (focus-notes): siempre válidas', async () => {
  const storage = fakeStorage();
  const value = 'texto libre { [ incompleto';
  storage.setItem(mirrorKey('focus-notes', 'v1', 'id-1'), value);
  const mirror = makeMirror({ storage });
  const r = await mirror.read('focus-notes', 'Nota.md');
  assert.equal(r.value, value, 'texto no-JSON se conserva');
});

test('legado por ruta inválido: no se adopta ni se copia', async () => {
  const storage = fakeStorage();
  storage.setItem(
    legacyMirrorKey('focus-memory-results', 'v1', 'Nota.md'),
    'corrupto{{{'
  );
  const mirror = makeMirror({ storage });
  const r = await mirror.read('focus-memory-results', 'Nota.md');
  assert.equal(r.value, null);
  assert.equal(r.adopted, false);
  assert.equal(
    storage.map.has(mirrorKey('focus-memory-results', 'v1', 'id-1')),
    false,
    'no se copia al espejo del id'
  );
});

test('legado por ruta válido: se adopta como antes', async () => {
  const storage = fakeStorage();
  const value = JSON.stringify([
    { id: 'r1', content: 'c', active: false }
  ]);
  storage.setItem(
    legacyMirrorKey('focus-memory-results', 'v1', 'Nota.md'),
    value
  );
  const mirror = makeMirror({ storage });
  const r = await mirror.read('focus-memory-results', 'Nota.md');
  assert.equal(r.value, value);
  assert.equal(r.adopted, true);
});

test('cambio de contexto de 8 a 2 widgets: el espejo sigue siendo válido (sin invalidación innecesaria)', async () => {
  // Verificación de dependencia estructural: los resultados NO
  // referencian instancias de widgets; un espejo de la sesión de 8
  // widgets sigue siendo compatible con la entidad de 2.
  const storage = fakeStorage();
  const stale = JSON.stringify([
    { id: 'memory-1792276794524-lg4mnq', content: 'análisis viejo', active: false }
  ]);
  storage.setItem(mirrorKey('focus-memory-results', 'v1', 'id-1'), stale);
  const mirror = makeMirror({ storage });
  const r = await mirror.read('focus-memory-results', 'Nota.md');
  assert.equal(r.value, stale, 'conservado: compatible con 2 widgets');
});

// ============================================================
// Fix del bucle MemoryWidget (causa raíz del bloqueo)
// ============================================================

class FakeEl {
  constructor() {
    this.children = [];
    this.classes = new Set();
    this.style = { setProperty() {}, removeProperty() {} };
    this.listeners = {};
  }
  createEl(tag, opts = {}) {
    const el = new FakeEl();
    if (opts.cls) for (const c of String(opts.cls).split(/\s+/)) el.classes.add(c);
    this.children.push(el);
    return el;
  }
  createDiv(opts = {}) { return this.createEl('div', opts); }
  createSpan(opts = {}) { return this.createEl('span', opts); }
  addClass(c) { this.classes.add(c); }
  removeClass(c) { this.classes.delete(c); }
  toggleClass(c, force) { if (force) this.classes.add(c); else this.classes.delete(c); }
  empty() { this.children = []; }
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  getAttribute() { return null; }
  setAttr() {}
  remove() {}
  addClassAll() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

test('MemoryWidget: con espejo poblado, resolveResultsMirror termina sin bucle de render', async () => {
  const { MemoryWidget } = await bundle('src/focus/widgets/MemoryWidget.ts');

  const storage = fakeStorage();
  const notePath = 'Libro/Nota.md';
  const noteId = 'id-nota';
  const stale = JSON.stringify([
    { id: 'memory-1-abc', content: 'resultado', active: true }
  ]);
  storage.setItem(mirrorKey('focus-memory-results', 'v1', noteId), stale);

  const localMirror = new LocalMirror({
    storage,
    vaultId: 'v1',
    getNoteId: async () => noteId,
    hasSafeOwnership: async () => true
  });

  const plugin = {
    localMirror,
    noteLifecycle: { getNoteId: async () => noteId },
    settings: undefined
  };
  const app = {
    plugins: { plugins: { 'folder-lab': plugin } },
    workspace: { getActiveFile: () => null },
    fileManager: {},
    vault: {}
  };

  let renderCount = 0;
  const widget = new MemoryWidget(
    app,
    { getStatus: () => ({ configured: false }) },
    {},
    {},
    {},
    {}
  );

  const container = new FakeEl();
  const context = { activeFile: { path: notePath } };

  // Envolver render para contar re-entradas.
  const origRender = widget.render.bind(widget);
  widget.render = (c, ctx) => {
    renderCount++;
    if (renderCount > 10) {
      throw new Error('BUCLE: render() re-entró más de 10 veces');
    }
    return origRender(c, ctx);
  };

  widget.currentFile = { path: notePath };
  widget.container = container;
  widget.lastContext = context;

  // Lanza la resolución dos veces (patrón render→resolve) y espera
  // a que todas las promesas en vuelo se asienten.
  void widget.resolveResultsMirror();
  await new Promise((r) => setTimeout(r, 50));

  assert.ok(renderCount <= 3, `renders razonables (hubo ${renderCount})`);
  assert.equal(widget.results.length, 1, 'resultados aplicados');
  assert.equal(widget.results[0].id, 'memory-1-abc');
});

test('MemoryWidget: render() normal con espejo poblado no entra en bucle', async () => {
  const { MemoryWidget } = await bundle('src/focus/widgets/MemoryWidget.ts');

  const storage = fakeStorage();
  const notePath = 'Libro/Nota.md';
  const noteId = 'id-nota';
  storage.setItem(
    mirrorKey('focus-memory-results', 'v1', noteId),
    JSON.stringify([{ id: 'r1', content: 'c', active: true }])
  );
  const localMirror = new LocalMirror({
    storage,
    vaultId: 'v1',
    getNoteId: async () => noteId,
    hasSafeOwnership: async () => true
  });
  const plugin = {
    localMirror,
    noteLifecycle: { getNoteId: async () => noteId },
    settings: undefined
  };
  const app = {
    plugins: { plugins: { 'folder-lab': plugin } },
    workspace: { getActiveFile: () => null },
    fileManager: {},
    vault: {}
  };

  let renderCount = 0;
  const widget = new MemoryWidget(
    app,
    { getStatus: () => ({ configured: false }) },
    {},
    {},
    {},
    {}
  );

  const origRender = widget.render.bind(widget);
  widget.render = (c, ctx) => {
    renderCount++;
    if (renderCount > 10) {
      throw new Error('BUCLE: render() re-entró más de 10 veces');
    }
    return origRender(c, ctx);
  };

  const container = new FakeEl();
  const context = { activeFile: { path: notePath } };

  // Camino real: render() lanza la resolución.
  widget.render(container, context);
  await new Promise((r) => setTimeout(r, 50));

  assert.ok(renderCount <= 3, `renders razonables (hubo ${renderCount})`);
  assert.equal(widget.results.length, 1, 'espejo aplicado tras render');
});
