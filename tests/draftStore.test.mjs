// ============================================================
// PRUEBAS: DraftStore — borradores recuperables (Etapa 2)
// ============================================================
// Ejecutar con: npm test
//
// Cubre:
// - Roundtrip escritura/lectura (archivo en <Master>/Folder Lab/drafts).
// - Parche parcial: escribir draft no pisa blocks y viceversa.
// - Archivo ilegible: lanza y NO borra el archivo (fallback posible).
// - Sin Master / sin id: operación como no-op (fallback a espejo).
// - Idempotencia: reescribir no duplica.
// - Identidad: renombrar la nota conserva el archivo (mismo id).
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
export default {};
export class FileSystemAdapter {
  getBasePath() { return '/stub'; }
}
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
    if (!this.files.has(p)) throw new Error('not found: ' + p);
    return this.files.get(p);
  }
  async write(p, content) {
    this.files.set(p, content);
  }
}

class FakeHidden {
  files = new Map();
  async readJSON(folder, name) {
    const key = `${folder}/${name}`;
    return this.files.has(key) ? structuredClone(this.files.get(key)) : null;
  }
  async writeJSON(folder, name, data) {
    this.files.set(`${folder}/${name}`, structuredClone(data));
  }
}

const { NoteIdentityRegistry } = await bundle(
  'src/storage/NoteIdentityRegistry.ts'
);
const { DraftStore } = await bundle('src/storage/DraftStore.ts');

function makeDraftStore({ master = 'Master' } = {}) {
  const hidden = new FakeHidden();
  const registry = new NoteIdentityRegistry({}, () => master, hidden);
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  const store = new DraftStore(app, () => master, registry);
  return { store, adapter, hidden, registry };
}

test('roundtrip: escribir y leer el borrador de la nota', async () => {
  const { store, adapter } = makeDraftStore();
  await store.write('Notas/a.md', {
    draft: 'hola',
    blocks: [{ text: 'bloque', active: true }]
  });
  const file = await store.read('Notas/a.md');
  assert.equal(file.draft, 'hola');
  assert.deepEqual(file.blocks, [{ text: 'bloque', active: true }]);
  assert.equal(file.notePath, 'Notas/a.md');
  // Archivo en la ubicación correcta.
  const keys = [...adapter.files.keys()];
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^Master\/Folder Lab\/drafts\/.+\.json$/);
});

test('parche parcial: draft no pisa blocks', async () => {
  const { store } = makeDraftStore();
  await store.write('n.md', { blocks: [{ text: 'b', active: false }] });
  await store.write('n.md', { draft: 'texto' });
  const file = await store.read('n.md');
  assert.equal(file.draft, 'texto');
  assert.deepEqual(file.blocks, [{ text: 'b', active: false }]);
});

test('archivo ilegible: lanza y NO lo borra', async () => {
  const { store, adapter } = makeDraftStore();
  await store.write('n.md', { draft: 'x' });
  // Corromper el archivo a mano.
  const key = [...adapter.files.keys()][0];
  adapter.files.set(key, '{corrupt');
  await assert.rejects(() => store.read('n.md'));
  // El archivo corrupto se conserva (recuperable manualmente).
  assert.equal(adapter.files.get(key), '{corrupt');
});

test('sin Master: write/read son no-op/ null', async () => {
  const { store } = makeDraftStore({ master: null });
  await store.write('n.md', { draft: 'x' });
  assert.equal(await store.read('n.md'), null);
});

test('renombrar la nota conserva el archivo (mismo id)', async () => {
  const { store, registry } = makeDraftStore();
  await store.write('viejo.md', { draft: 'd' });
  const id = await registry.getId('viejo.md');
  await registry.onRenamed('viejo.md', 'nuevo.md');
  // La ruta del archivo depende del id, no de la ruta.
  const file = await store.read('nuevo.md');
  assert.equal(file.draft, 'd');
  assert.equal(await registry.findPathById(id), 'nuevo.md');
});

test('idempotencia: reescribir no duplica entradas', async () => {
  const { store, adapter } = makeDraftStore();
  await store.write('n.md', { draft: 'a' });
  await store.write('n.md', { draft: 'b' });
  await store.write('n.md', { draft: 'b' });
  assert.equal(adapter.files.size, 1);
  assert.equal((await store.read('n.md')).draft, 'b');
});

// ------------------------------------------------------------
// A2: protección de borradores corruptos
// ------------------------------------------------------------

test('A2: escribir sobre borrador corrupto conserva el original en .bak', async () => {
  const { store, adapter } = makeDraftStore();
  await store.write('n.md', { draft: 'valioso', blocks: [{ text: 'b', active: false }] });
  const key = [...adapter.files.keys()].find((k) => k.endsWith('.json'));
  const original = adapter.files.get(key);
  adapter.files.set(key, '{ corrupt');

  await store.write('n.md', { draft: 'nuevo' });

  // El original corrupto está recuperable en .corrupt.bak.
  const bak = adapter.files.get(`${key}.corrupt.bak`);
  assert.equal(bak, '{ corrupt');
  // El archivo principal se reconstruye con el parche.
  const rebuilt = await store.read('n.md');
  assert.equal(rebuilt.draft, 'nuevo');
});

test('A2: si el respaldo falla, la escritura PROPAGA y el original queda intacto', async () => {
  const { store, adapter } = makeDraftStore();
  await store.write('n.md', { draft: 'x' });
  const key = [...adapter.files.keys()].find((k) => k.endsWith('.json'));
  adapter.files.set(key, '{ corrupt');
  const originalRead = adapter.read.bind(adapter);
  adapter.read = async (p) => {
    if (p === key) throw new Error('EIO');
    return originalRead(p);
  };

  await assert.rejects(() => store.write('n.md', { draft: 'y' }));
  assert.equal(adapter.files.get(key), '{ corrupt');
});

test('A2: el primer .bak no se pisa con sucesivas corrupciones', async () => {
  const { store, adapter } = makeDraftStore();
  await store.write('n.md', { draft: 'primero' });
  const key = [...adapter.files.keys()].find((k) => k.endsWith('.json'));
  adapter.files.set(key, '{ corrupt-1');
  await store.write('n.md', { draft: 'a' });
  adapter.files.set(key, '{ corrupt-2');
  await store.write('n.md', { draft: 'b' });
  assert.equal(adapter.files.get(`${key}.corrupt.bak`), '{ corrupt-1');
});
