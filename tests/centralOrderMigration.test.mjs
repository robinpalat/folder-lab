// ============================================================
// PRUEBAS: Migración del orden a Folder Lab/order.json
// ============================================================
// Ejecutar con: npm test
//
// - Migración del orden global y por carpeta conservando el legado.
// - Migración idempotente con verificación de la copia.
// - La central válida prevalece sobre datos legados distintos.
// - Las escrituras de orden NO crean ni modifican `.folder-lab`.
// - Comportamiento sin Master configurado (degradación segura).
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
globalThis.__TFolder = TFolder;
globalThis.__TFile = TFile;
globalThis.__notices = [];
export class Notice { constructor(m) { globalThis.__notices.push(String(m)); } }
export default {};
export class FileSystemAdapter { getBasePath() { return '/stub'; } }
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

class FakeAdapter {
  files = new Map();
  dirs = new Set();
  async exists(p) {
    return this.files.has(p) || this.dirs.has(p);
  }
  async mkdir(p) {
    this.dirs.add(p);
  }
  async read(p) {
    if (!this.files.has(p)) throw new Error('nf ' + p);
    return this.files.get(p);
  }
  async write(p, c) {
    this.files.set(p, c);
  }
  async list(p) {
    const pre = p.endsWith('/') ? p : p + '/';
    return {
      files: [...this.files.keys()].filter((k) => k.startsWith(pre)),
      folders: []
    };
  }
}

const MASTER = 'Libro';
const CENTRAL = 'Libro/Folder Lab/order.json';
const LEGACY = 'Libro/.folder-lab/_folder_order.json';

const { FolderRepository } = await bundle('src/storage/FolderRepository.ts');

function makeRepo({ master = MASTER } = {}) {
  const adapter = new FakeAdapter();
  const rootFolder = new globalThis.__TFolder();
  rootFolder.path = master || '';
  rootFolder.name = master ? master.split('/').pop() : '';
  rootFolder.children = [];
  const app = {
    vault: {
      adapter,
      getRoot: () => rootFolder,
      getAbstractFileByPath: (p) =>
        p === (master || '') || p === master ? rootFolder : null
    }
  };
  const repo = new FolderRepository(app);
  return { repo, adapter, master };
}

function legacyGlobal() {
  return JSON.stringify({
    root: {
      order: ['Zebra.md', 'Alpha.md'],
      folders: {}
    },
    version: 1,
    notes: { 'Alpha.md': 'nota vieja' }
  });
}

test('migración global: copia verificada; el legado queda intacto', async () => {
  const { repo, adapter } = makeRepo();
  adapter.files.set(LEGACY, legacyGlobal());

  const data = await repo.loadGlobalOrder(MASTER);
  assert.equal(data.root.order[0], 'Zebra.md', 'orden legado leído');
  // Copia central presente y verificada (JSON parseable).
  const central = JSON.parse(adapter.files.get(CENTRAL));
  assert.equal(central.version, 1);
  assert.equal(central.global.root.order[0], 'Zebra.md');
  assert.equal(central.global.notes['Alpha.md'], 'nota vieja');
  // Legado intacto.
  assert.equal(adapter.files.get(LEGACY), legacyGlobal());
});

test('migración idempotente: segunda lectura usa la central sin tocar nada', async () => {
  const { repo, adapter } = makeRepo();
  adapter.files.set(LEGACY, legacyGlobal());
  await repo.loadGlobalOrder(MASTER);
  const centralAfterFirst = adapter.files.get(CENTRAL);
  const legacyAfterFirst = adapter.files.get(LEGACY);

  // Nueva sesión (repositorio nuevo, misma bóveda).
  const repo2 = new FolderRepository({ vault: { adapter } });
  const data = await repo2.loadGlobalOrder(MASTER);
  assert.equal(data.root.order[0], 'Zebra.md');
  assert.equal(adapter.files.get(CENTRAL), centralAfterFirst, 'sin reescritura');
  assert.equal(adapter.files.get(LEGACY), legacyAfterFirst);
});

test('la central válida prevalece sobre un legado diferente', async () => {
  const { repo, adapter } = makeRepo();
  adapter.files.set(CENTRAL, JSON.stringify({
    version: 1,
    global: { root: { order: ['Central.md'], folders: {} }, version: 1 },
    folders: {}
  }));
  adapter.files.set(LEGACY, legacyGlobal());

  const data = await repo.loadGlobalOrder(MASTER);
  assert.equal(data.root.order[0], 'Central.md', 'gana la central');
  assert.equal(
    adapter.files.get(LEGACY),
    legacyGlobal(),
    'el legado no se modifica'
  );
});

test('regeneración (ausente) escribe SOLO en la central; `.folder-lab` no aparece', async () => {
  const { repo, adapter } = makeRepo();
  await repo.loadGlobalOrder(MASTER);
  await repo.initGlobalOrder(MASTER, []);

  assert.ok(adapter.files.has(CENTRAL), 'regenerado en la central');
  assert.equal(adapter.files.has(LEGACY), false, 'sin .folder-lab');
  const anyHidden = [...adapter.files.keys()].some((k) =>
    k.includes('.folder-lab')
  );
  assert.equal(anyHidden, false);
});

test('reordenar escribe solo en la central y conserva notes', async () => {
  const { repo, adapter } = makeRepo();
  adapter.files.set(LEGACY, legacyGlobal());
  await repo.loadGlobalOrder(MASTER);
  await repo.transactFolderLab(MASTER, (data) => {
    data.notes['Beta.md'] = 'nueva';
  });
  await repo.updateFolderOrder(MASTER, MASTER, ['Alpha.md', 'Zebra.md']);

  const central = JSON.parse(adapter.files.get(CENTRAL));
  assert.deepEqual(central.global.root.order, ['Alpha.md', 'Zebra.md']);
  assert.equal(central.global.notes['Beta.md'], 'nueva');
  assert.equal(central.global.notes['Alpha.md'], 'nota vieja');
  assert.equal(adapter.files.get(LEGACY), legacyGlobal(), 'legado intacto');
});

test('orden por carpeta: migración perezosa desde el legado', async () => {
  const { repo, adapter } = makeRepo();
  await repo.loadGlobalOrder(MASTER);
  // Carpeta Capitulo con su fichero legado.
  await adapter.mkdir('Libro/Capitulo/.folder-lab');
  await adapter.write(
    'Libro/Capitulo/.folder-lab/_folder_order.json',
    JSON.stringify({ order: ['Gamma.md', 'Delta.md'] })
  );

  const order = await repo.loadFolderLab('Libro/Capitulo');
  assert.deepEqual(order.order, ['Gamma.md', 'Delta.md']);
  // Copia central presente.
  const central = JSON.parse(adapter.files.get(CENTRAL));
  assert.deepEqual(central.folders['Libro/Capitulo'].order, [
    'Gamma.md',
    'Delta.md'
  ]);
  // Transact sobre la carpeta escribe solo en central.
  await repo.transactFolderLab('Libro/Capitulo', (data) => {
    data.notes = { 'Gamma.md': 'ok' };
  });
  const central2 = JSON.parse(adapter.files.get(CENTRAL));
  assert.equal(central2.folders['Libro/Capitulo'].notes['Gamma.md'], 'ok');
  assert.equal(
    adapter.files.get('Libro/Capitulo/.folder-lab/_folder_order.json'),
    JSON.stringify({ order: ['Gamma.md', 'Delta.md'] }),
    'legado de carpeta intacto'
  );
});

test('sin Master: degradación segura (sin escrituras, sin .folder-lab)', async () => {
  // Contrato: null = sin configurar ('' ahora significa raíz).
  const { repo, adapter } = makeRepo({ master: null });
  const data = await repo.loadGlobalOrder(null);
  assert.equal(data, null);
  // Escrituras: no-op con aviso, sin archivos nuevos.
  await repo.saveGlobalOrder(null, { root: { order: ['A.md'] }, version: 1 });
  await repo.transactFolderLab(null, (d) => {
    d.notes = {};
    return d;
  });
  assert.equal(adapter.files.size, 0, 'sin escrituras sin Master');
  const anyHidden = [...adapter.files.keys()].some((k) =>
    k.includes('.folder-lab')
  );
  assert.equal(anyHidden, false);
});
