// ============================================================
// PRUEBAS: integridad de _folder_order.json (Fase 3A — corregido)
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - Ausencia real → regeneración legítima.
// - Error de lectura, JSON corrupto o forma inválida → NUNCA
//   sobrescritura destructiva; los datos se conservan en disco.
// - Orden global y notas particulares comparten una cola FIFO:
//   sus RMW completos no se pisan en ninguna dirección.
// - Una operación fallida no bloquea la cola.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

globalThis.__notices = [];

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const OBSIDIAN_STUB = `
export class App {}
export class TAbstractFile { constructor() { this.path = ''; this.name = ''; } }
export class TFile extends TAbstractFile {
  constructor() { super(); this.extension = 'md'; this.basename = ''; }
}
export class TFolder extends TAbstractFile {
  constructor() { super(); this.children = []; }
}
export class WorkspaceLeaf {}
export class Notice {
  constructor(message) {
    globalThis.__notices.push(String(message));
  }
}
export default {};
globalThis.__TFolder = TFolder;
globalThis.__TFile = TFile;
`;

async function loadRepository() {
  const result = await build({
    entryPoints: [join(root, 'src', 'storage', 'FolderRepository.ts')],
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
  const url =
    'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(url);
}

const { FolderRepository } = await loadRepository();
const TFolder = globalThis.__TFolder;
const TFile = globalThis.__TFile;

// ------------------------------------------------------------
// Doble de adapter con inyección de fallos
// ------------------------------------------------------------

// Migración: el orden vive ahora en Folder Lab/order.json (central).
const ORDER_PATH = 'Libro/Folder Lab/order.json';

function makeNote(name) {
  const f = new TFile();
  f.name = name;
  f.path = `Libro/${name}`;
  f.extension = 'md';
  f.basename = name.replace(/\.md$/, '');
  return f;
}

function makeFolder(name, children = []) {
  const f = new TFolder();
  f.name = name;
  f.path = name ? `Libro/${name}` : 'Libro';
  f.children = children;
  return f;
}

function createHarness(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const adapter = {
    failReads: false,
    async exists(path) { return files.has(path); },
    async read(path) {
      if (adapter.failReads) throw new Error('EIO transitorio simulado');
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async write(path, content) { files.set(path, content); },
    async mkdir() {},
    async remove(path) { files.delete(path); },
    async list() { return { files: [...files.keys()], folders: [] }; }
  };

  // Árbol: Libro/{ Alpha.md, Beta.md, Capitulo/{ Gamma.md } }
  const capitulo = makeFolder('Capitulo', [makeNote('Gamma.md')]);
  const rootFolder = makeFolder('Libro', [
    makeNote('Beta.md'),
    makeNote('Alpha.md'),
    capitulo
  ]);
  rootFolder.path = 'Libro';

  const app = {
    vault: {
      adapter,
      getRoot: () => rootFolder,
      getAbstractFileByPath(path) {
        if (path === 'Libro') return rootFolder;
        return null;
      },
      getFileByPath() { return null; }
    }
  };

  return { files, adapter, app };
}

/** Almacén central (Folder Lab/order.json) con el orden global sembrado. */
function seededGlobalFile(extra = {}) {
  return JSON.stringify(
    {
      version: 1,
      global: {
        root: {
          order: ['Zebra.md', 'Capitulo', 'Alpha.md'],
          folders: {
            Capitulo: { order: ['Gamma.md'], folders: {} }
          }
        },
        version: 1,
        notes: {
          'Alpha.md': '|STATUS|revisar|contenido especial de la nota'
        }
      },
      folders: {},
      ...extra
    },
    null,
    2
  );
}

function parseStore(files) {
  const central = JSON.parse(files.get(ORDER_PATH));
  // Los cuerpos de las pruebas trabajan sobre el orden global.
  return central.global ?? central;
}

// ------------------------------------------------------------
// Regresiones: ausencia vs. error (D1, D2, D3)
// ------------------------------------------------------------

test('3A-D1: error de lectura → loadGlobalOrder propaga y initGlobalOrder NO sobrescribe (regresión)', async () => {
  const h = createHarness({ [ORDER_PATH]: seededGlobalFile() });
  const repo = new FolderRepository(h.app);

  h.adapter.failReads = true;

  await assert.rejects(
    () => repo.loadGlobalOrder('Libro'),
    /EIO transitorio/,
    'un error de lectura ya no se confunde con «archivo ausente»'
  );
  await assert.rejects(() => repo.initGlobalOrder('Libro', []));

  h.adapter.failReads = false;

  // El fichero en disco queda INTACTO: orden manual y notes.
  const store = parseStore(h.files);
  assert.deepEqual(store.root.order, ['Zebra.md', 'Capitulo', 'Alpha.md']);
  assert.deepEqual(store.notes, {
    'Alpha.md': '|STATUS|revisar|contenido especial de la nota'
  });
});

test('3A-D2: JSON corrupto → initGlobalOrder aborta y conserva los datos (regresión)', async () => {
  const h = createHarness({ [ORDER_PATH]: seededGlobalFile() });
  const repo = new FolderRepository(h.app);

  const corrupted = seededGlobalFile().slice(0, 30);
  h.files.set(ORDER_PATH, corrupted);

  await assert.rejects(() => repo.loadGlobalOrder('Libro'));
  await assert.rejects(() => repo.initGlobalOrder('Libro', []));
  await assert.rejects(() => repo.reconcileGlobalOrder('Libro', []));

  // Ni una sola escritura: el fichero corrupto queda para
  // recuperación manual (los notes no son reconstruibles).
  assert.equal(h.files.get(ORDER_PATH), corrupted);
});

test('3A-D3: archivo AUSENTE → initGlobalOrder regenera (regeneración legítima)', async () => {
  const h = createHarness({});
  const repo = new FolderRepository(h.app);

  const data = await repo.loadGlobalOrder('Libro');
  assert.equal(data, null, 'ausente → null, sin error');

  await repo.initGlobalOrder('Libro', []);

  const store = parseStore(h.files);
  // Orden alfabético reconstruido: Beta.md antes que Alpha.md no
  // (alfabético: Alpha, Beta, Capitulo… carpetas primero).
  assert.deepEqual(store.root.order, ['Capitulo', 'Alpha.md', 'Beta.md']);
  assert.equal(store.version, 1);
});

// ------------------------------------------------------------
// Forma inválida y lectura degradada (C1, C2)
// ------------------------------------------------------------

test('3A-C1: JSON con forma inválida → error visible, sin regeneración ni escritura (regresión)', async () => {
  const invalid = '["no","es","un","objeto","global"]';
  const h = createHarness({ [ORDER_PATH]: invalid });
  const repo = new FolderRepository(h.app);

  await assert.rejects(
    () => repo.loadGlobalOrder('Libro'),
    /Forma inválida|no tiene la forma esperada/
  );
  await assert.rejects(() => repo.initGlobalOrder('Libro', []));

  assert.equal(h.files.get(ORDER_PATH), invalid, 'el fichero queda intacto');
});

test('3A-C2: lectura fallida → updateFolderOrder no escribe y avisa (regresión)', async () => {
  const h = createHarness({ [ORDER_PATH]: seededGlobalFile() });
  const repo = new FolderRepository(h.app);

  globalThis.__notices.length = 0;
  h.adapter.failReads = true;

  const before = h.files.get(ORDER_PATH);
  await repo.updateFolderOrder('Libro', 'Libro', ['Beta.md']);
  h.adapter.failReads = false;

  assert.equal(h.files.get(ORDER_PATH), before, 'sin escritura destructiva');
  assert.ok(
    globalThis.__notices.some((n) => n.includes('_folder_order.json')),
    'el fallo se hace visible con un Notice'
  );

  // La cola sigue viva: la reordenación posterior funciona.
  await repo.updateFolderOrder('Libro', 'Libro', ['Zebra.md', 'Capitulo', 'Alpha.md']);
  assert.deepEqual(parseStore(h.files).root.order, [
    'Zebra.md',
    'Capitulo',
    'Alpha.md'
  ]);
});

// ------------------------------------------------------------
// Coordinación orden ↔ notes (C3 y concurrencia)
// ------------------------------------------------------------

test('3A-C3: reordenar NO pisa notes escritos por la vía de notas (regresión)', async () => {
  const h = createHarness({ [ORDER_PATH]: seededGlobalFile() });
  const repo = new FolderRepository(h.app);

  // La sesión carga y cachea el orden global.
  await repo.loadGlobalOrder('Libro');

  // NoteService escribe una nota sobre el MISMO fichero (master).
  await repo.transactFolderLab('Libro', (data) => {
    if (!data.notes) data.notes = {};
    data.notes['Beta.md'] = 'nota nueva escrita por el editor de notas';
  });

  // Reordenación posterior: debe conservar los notes.
  await repo.updateFolderOrder('Libro', 'Libro', [
    'Alpha.md',
    'Zebra.md',
    'Capitulo'
  ]);

  const store = parseStore(h.files);
  assert.deepEqual(store.root.order, ['Alpha.md', 'Zebra.md', 'Capitulo']);
  assert.equal(
    store.notes['Beta.md'],
    'nota nueva escrita por el editor de notas',
    'la reordenación no debe pisar notes escritos después de la carga'
  );
  assert.equal(
    store.notes['Alpha.md'],
    '|STATUS|revisar|contenido especial de la nota',
    'los notes preexistentes también se conservan'
  );
});

test('3A-C4: escribir una nota NO pisa una reordenación concorrente (dirección inversa)', async () => {
  const h = createHarness({ [ORDER_PATH]: seededGlobalFile() });
  const repo = new FolderRepository(h.app);

  await repo.loadGlobalOrder('Libro');

  await Promise.all([
    repo.transactFolderLab('Libro', (data) => {
      if (!data.notes) data.notes = {};
      data.notes['Gamma.md'] = 'estado nuevo';
    }),
    repo.updateFolderOrder('Libro', 'Libro', ['Gamma.md', 'Alpha.md'])
  ]);

  const store = parseStore(h.files);
  assert.deepEqual(store.root.order, ['Gamma.md', 'Alpha.md']);
  assert.equal(store.notes['Gamma.md'], 'estado nuevo');
  assert.equal(store.notes['Alpha.md'], '|STATUS|revisar|contenido especial de la nota');
});

test('3A-C5: dos RMW concurrentes de notes conservan ambas entradas', async () => {
  const h = createHarness({ [ORDER_PATH]: seededGlobalFile() });
  const repo = new FolderRepository(h.app);

  await repo.loadGlobalOrder('Libro');

  await Promise.all([
    repo.transactFolderLab('Libro', (data) => {
      if (!data.notes) data.notes = {};
      data.notes['Gamma.md'] = 'uno';
    }),
    repo.transactFolderLab('Libro', (data) => {
      if (!data.notes) data.notes = {};
      data.notes['Zeta.md'] = 'dos';
    })
  ]);

  const store = parseStore(h.files);
  assert.equal(store.notes['Gamma.md'], 'uno');
  assert.equal(store.notes['Zeta.md'], 'dos');
  assert.equal(store.notes['Alpha.md'], '|STATUS|revisar|contenido especial de la nota');
});

test('3A-C6: una operación fallida no bloquea la cola (recuperación)', async () => {
  const h = createHarness({ [ORDER_PATH]: seededGlobalFile() });
  const repo = new FolderRepository(h.app);

  await repo.loadGlobalOrder('Libro');

  // RMW sobre fichero corrupto: rechaza, sin tocar el disco.
  const corrupted = '{ corrupto';
  h.files.set(ORDER_PATH, corrupted);
  await assert.rejects(
    () => repo.transactFolderLab('Libro', (data) => {
      data.notes = {};
    })
  );
  assert.equal(h.files.get(ORDER_PATH), corrupted);

  // Se repara el fichero: la cola continúa operando.
  h.files.set(ORDER_PATH, seededGlobalFile());
  await repo.updateFolderOrder('Libro', 'Libro', ['Zebra.md', 'Capitulo', 'Alpha.md']);
  await repo.transactFolderLab('Libro', (data) => {
    data.notes['Gamma.md'] = 'tras el fallo';
  });

  const store = parseStore(h.files);
  assert.deepEqual(store.root.order, ['Zebra.md', 'Capitulo', 'Alpha.md']);
  assert.equal(store.notes['Gamma.md'], 'tras el fallo');
  assert.equal(store.notes['Alpha.md'], '|STATUS|revisar|contenido especial de la nota');
});

test('3A-C7: transactFolderLab sobre archivo ausente crea la base legada', async () => {
  const h = createHarness({});
  const repo = new FolderRepository(h.app);

  // La sesión siempre carga el orden global al iniciar (initialize).
  await repo.loadGlobalOrder('Libro');

  await repo.transactFolderLab('Libro', (data) => {
    if (!data.notes) data.notes = {};
    data.notes['Alpha.md'] = 'primera nota';
  });

  const store = parseStore(h.files);
  assert.deepEqual(store.order, []);
  assert.deepEqual(store.notes, { 'Alpha.md': 'primera nota' });
});

test('3A-C8: saveGlobalOrder preserva notes del disco al guardar el árbol', async () => {
  const h = createHarness({ [ORDER_PATH]: seededGlobalFile() });
  const repo = new FolderRepository(h.app);

  const global = await repo.loadGlobalOrder('Libro');

  // Nota escrita tras la carga (fuera de la caché).
  await repo.transactFolderLab('Libro', (data) => {
    data.notes['Beta.md'] = 'posterior';
  });

  // Guardado del árbol con el objeto global de la sesión: las
  // notes del disco NO deben perderse.
  global.root.order = ['Beta.md', 'Capitulo', 'Alpha.md', 'Zebra.md'];
  await repo.saveGlobalOrder('Libro', global);

  const store = parseStore(h.files);
  assert.deepEqual(store.root.order, ['Beta.md', 'Capitulo', 'Alpha.md', 'Zebra.md']);
  assert.equal(store.notes['Beta.md'], 'posterior');
  assert.equal(store.notes['Alpha.md'], '|STATUS|revisar|contenido especial de la nota');
});
