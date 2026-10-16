// ============================================================
// PRUEBAS: ActiveNoteWidget — guardado sin buffers obsoletos (P0-2)
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - Cerrar el widget sin ediciones locales NO escribe la nota.
// - Un cambio externo con el buffer limpio recarga el buffer.
// - Un cambio externo con ediciones locales NO se sobrescribe en
//   silencio: se avisa una vez y el disco conserva su contenido.
// - Una edición local POSTERIOR al aviso confirma la versión del
//   widget y entonces sí se escribe.
// - Tras un guardado correcto, un segundo guardado sin input no
//   vuelve a escribir.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

// window.setTimeout/clearTimeout se usan en el widget.
globalThis.window = {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args)
};

// Registro de Notices emitidas por el stub de obsidian.
globalThis.__notices = [];

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const OBSIDIAN_STUB = `
export class Notice {
  constructor(message) {
    globalThis.__notices.push(String(message));
  }
}
export class Menu {
  addItem() { return this; }
  showAtPosition() {}
}
export function setIcon() {}
export class App {}
export class TFile {}
export default {};
`;

async function loadWidgetModule() {
  const result = await build({
    entryPoints: [
      join(root, 'src', 'focus', 'widgets', 'ActiveNoteWidget.ts')
    ],
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

const { ActiveNoteWidget } = await loadWidgetModule();

// ------------------------------------------------------------
// Dobles de prueba: vault falso y DOM mínimo
// ------------------------------------------------------------

function createFakeVault(initialFiles) {
  const files = new Map(Object.entries(initialFiles));
  const listeners = [];
  const modifyCalls = [];

  return {
    files,
    listeners,
    modifyCalls,
    async read(file) {
      const content = files.get(file.path);
      if (content === undefined) {
        throw new Error(`ENOENT: ${file.path}`);
      }
      return content;
    },
    async modify(file, content) {
      modifyCalls.push({ path: file.path, content });
      files.set(file.path, content);
      // Obsidian notifica el modify a los oyentes (incluido el
      // propio widget, que con buffer limpio se recarga).
      for (const ref of [...listeners]) {
        ref.handler(file);
      }
    },
    on(name, handler) {
      const ref = { name, handler };
      listeners.push(ref);
      return ref;
    },
    offref(ref) {
      const index = listeners.indexOf(ref);
      if (index !== -1) listeners.splice(index, 1);
    },
    /** Simula una modificación EXTERNA (otra pestaña, sync…). */
    externalModify(path, content) {
      files.set(path, content);
      for (const ref of [...listeners]) {
        ref.handler({ path });
      }
    }
  };
}

class FakeEl {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attrs = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.classes = new Set();
    this.value = '';
    this.placeholder = '';
    this.textContent = '';
  }

  createEl(tag, opts = {}) {
    const el = new FakeEl(tag);
    if (opts.cls) {
      for (const c of String(opts.cls).split(/\s+/)) el.classes.add(c);
    }
    if (opts.text !== undefined) el.textContent = opts.text;
    if (opts.attr) Object.assign(el.attrs, opts.attr);
    this.children.push(el);
    return el;
  }

  createDiv(opts = {}) {
    return this.createEl('div', opts);
  }

  createSpan(opts = {}) {
    return this.createEl('span', opts);
  }

  addClass(c) {
    this.classes.add(c);
  }

  removeClass(c) {
    this.classes.delete(c);
  }

  toggleClass(c, force) {
    if (force) this.classes.add(c);
    else this.classes.delete(c);
  }

  empty() {
    this.children = [];
  }

  addEventListener(name, fn) {
    (this.listeners[name] ||= []).push(fn);
  }

  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }

  removeAttribute(k) {
    delete this.attrs[k];
  }

  getAttribute(k) {
    return this.attrs[k] ?? null;
  }

  setAttr(obj) {
    Object.assign(this.attrs, obj);
  }

  querySelector() {
    return null;
  }

  /** Busca el <textarea> del editor en el árbol. */
  findTextarea() {
    if (this.tag === 'textarea') return this;
    for (const child of this.children) {
      const found = child.findTextarea?.();
      if (found) return found;
    }
    return null;
  }

  dispatch(name) {
    for (const fn of this.listeners[name] || []) fn({});
  }
}

function makeFile(path = 'Libro/Nota.md') {
  return {
    path,
    extension: 'md',
    basename: 'Nota'
  };
}

async function flush() {
  // Deja completar microtareas y timers de 0ms (loadFile void).
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function resetNotices() {
  globalThis.__notices.length = 0;
}

async function renderWidget(vault, file) {
  const app = { vault };
  const widget = new ActiveNoteWidget(app);
  const container = new FakeEl('div');
  widget.render(container, { activeFile: file });
  await flush();
  const textarea = container.findTextarea();
  assert.ok(textarea, 'el widget debe renderizar un textarea');
  return { widget, textarea, container };
}

function typeInto(textarea) {
  textarea.dispatch('input');
}

// ------------------------------------------------------------
// Pruebas
// ------------------------------------------------------------

test('P0-2: cerrar sin ediciones locales NO escribe la nota', async () => {
  resetNotices();
  const vault = createFakeVault({ 'Libro/Nota.md': 'contenido original' });
  const file = makeFile();

  const { widget } = await renderWidget(vault, file);

  widget.destroy();
  await flush();

  assert.equal(vault.modifyCalls.length, 0);
  assert.equal(vault.files.get('Libro/Nota.md'), 'contenido original');
});

test('P0-2: cambio externo con buffer limpio recarga el buffer y cierra sin escribir', async () => {
  resetNotices();
  const vault = createFakeVault({ 'Libro/Nota.md': 'v1' });
  const file = makeFile();

  const { widget, textarea } = await renderWidget(vault, file);
  assert.equal(textarea.value, 'v1');

  vault.externalModify('Libro/Nota.md', 'v2 externa');
  await flush();

  // El buffer limpio se recarga: refleja el contenido externo.
  assert.equal(textarea.value, 'v2 externa');

  widget.destroy();
  await flush();

  assert.equal(vault.modifyCalls.length, 0);
  assert.equal(vault.files.get('Libro/Nota.md'), 'v2 externa');
  assert.equal(globalThis.__notices.length, 0);
});

test('P0-2: edición local normal se guarda y limpia el estado', async () => {
  resetNotices();
  const vault = createFakeVault({ 'Libro/Nota.md': 'v1' });
  const file = makeFile();

  const { textarea } = await renderWidget(vault, file);

  textarea.value = 'v1 + edición local';
  typeInto(textarea);

  await new Promise((resolve) => setTimeout(resolve, 450));

  assert.equal(vault.modifyCalls.length, 1);
  assert.equal(
    vault.files.get('Libro/Nota.md'),
    'v1 + edición local'
  );
  assert.equal(globalThis.__notices.length, 0);
});

test('P0-2: cambio externo + edición local (sin posterior) NO sobrescribe el disco', async () => {
  resetNotices();
  const vault = createFakeVault({ 'Libro/Nota.md': 'v1' });
  const file = makeFile();

  const { widget, textarea } = await renderWidget(vault, file);

  // Edición local.
  textarea.value = 'v1 + local';
  typeInto(textarea);

  // Cambio externo mientras el buffer está sucio.
  vault.externalModify('Libro/Nota.md', 'v1 + externa');
  await flush();

  // El guardado diferido (o el de cierre) se enfrenta al cambio.
  await widget.save();
  await flush();

  // Se avisa una vez y el disco NO se sobrescribe.
  assert.equal(globalThis.__notices.length, 1);
  assert.equal(vault.modifyCalls.length, 0);
  assert.equal(vault.files.get('Libro/Nota.md'), 'v1 + externa');
  // El buffer local se conserva en memoria.
  assert.equal(textarea.value, 'v1 + local');

  // Cerrar el widget tampoco sobrescribe (sin edición posterior).
  widget.destroy();
  await flush();
  assert.equal(vault.modifyCalls.length, 0);
  assert.equal(vault.files.get('Libro/Nota.md'), 'v1 + externa');
});

test('P0-2: edición local POSTERIOR al aviso confirma la versión del widget', async () => {
  resetNotices();
  const vault = createFakeVault({ 'Libro/Nota.md': 'v1' });
  const file = makeFile();

  const { widget, textarea } = await renderWidget(vault, file);

  textarea.value = 'v1 + local';
  typeInto(textarea);

  vault.externalModify('Libro/Nota.md', 'v1 + externa');
  await flush();

  // Primer guardado: avisa y no escribe.
  await widget.save();
  assert.equal(globalThis.__notices.length, 1);
  assert.equal(vault.modifyCalls.length, 0);

  // El usuario sigue editando DESPUÉS del aviso: confirma su versión.
  textarea.value = 'v1 + local + más';
  typeInto(textarea);

  await widget.save();
  await flush();

  assert.equal(vault.modifyCalls.length, 1);
  assert.equal(
    vault.files.get('Libro/Nota.md'),
    'v1 + local + más'
  );
  // El aviso solo se muestra una vez por conflicto.
  assert.equal(globalThis.__notices.length, 1);
});

test('P0-2: tras un guardado correcto, un segundo guardado sin input no escribe', async () => {
  resetNotices();
  const vault = createFakeVault({ 'Libro/Nota.md': 'v1' });
  const file = makeFile();

  const { textarea } = await renderWidget(vault, file);

  textarea.value = 'v1 + edición';
  typeInto(textarea);

  // El debounce (400 ms) dispara el primer guardado.
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(vault.modifyCalls.length, 1);

  // Segundo guardado sin input: dirty=false → nada que guardar.
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(vault.modifyCalls.length, 1);
  assert.equal(vault.files.get('Libro/Nota.md'), 'v1 + edición');
});

test('P0-2: el listener de modify se libera al destruir el widget', async () => {
  resetNotices();
  const vault = createFakeVault({ 'Libro/Nota.md': 'v1' });
  const file = makeFile();

  const { widget } = await renderWidget(vault, file);
  assert.equal(vault.listeners.length, 1);

  widget.destroy();
  await flush();

  assert.equal(vault.listeners.length, 0);
});
