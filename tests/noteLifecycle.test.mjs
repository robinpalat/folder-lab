// ============================================================
// PRUEBAS: Identidad y ciclo de vida (Etapa 1 de la reforma)
// ============================================================
// Ejecutar con: npm test
//
// Cubre:
// - getId idempotente y persistente (con y sin Master).
// - Renombrar nota: migración de Board/Contexto (destino antes que
//   origen) + identidad + copia de borradores (origen intacto).
// - Fallo de escritura de destino: el origen queda intacto.
// - Renombrar carpeta: re-clavado por prefijo.
// - Borrar→tombstone; crear/restaurar→mismo id.
// - Migración repetida (idempotencia).
// - reconcile: huérfanos reportados, tombstones restaurados.
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

// ------------------------------------------------------------
// Fakes
// ------------------------------------------------------------

class FakeHidden {
  files = new Map();
  failWrite = false;
  async readJSON(folder, name) {
    const key = `${folder}/${name}`;
    return this.files.has(key) ? structuredClone(this.files.get(key)) : null;
  }
  async writeJSON(folder, name, data) {
    if (this.failWrite) throw new Error('write failure');
    const key = `${folder}/${name}`;
    this.files.set(key, structuredClone(data));
  }
}

class FakeStoreRepo {
  // Simula el store multipath: folder → { notePath: entry }
  stores = new Map();
  failDestWrite = false;
  _parent(p) {
    const i = p.lastIndexOf('/');
    return i === -1 ? '' : p.slice(0, i);
  }
  async migrateEntry(oldPath, newPath) {
    const oldFolder = this._parent(oldPath);
    const newFolder = this._parent(newPath);
    if (oldFolder === newFolder) {
      const store = this.stores.get(oldFolder) ?? {};
      if (!(oldPath in store)) return;
      store[newPath] = store[oldPath];
      delete store[oldPath];
      this.stores.set(oldFolder, store);
      return;
    }
    const source = this.stores.get(oldFolder) ?? {};
    if (!(oldPath in source)) return;
    const target = this.stores.get(newFolder) ?? {};
    target[newPath] = source[oldPath];
    if (this.failDestWrite) throw new Error('dest write failure');
    this.stores.set(newFolder, target);
    delete source[oldPath];
    this.stores.set(oldFolder, source);
  }
  async migrateFolderPrefix(oldPrefix, newPrefix) {
    const oldBase = oldPrefix.replace(/\/+$/, '');
    const newBase = newPrefix.replace(/\/+$/, '');
    const folder = newBase;
    const store = this.stores.get(folder) ?? {};
    let changed = false;
    for (const key of Object.keys(store)) {
      if (key === oldBase || key.startsWith(oldBase + '/')) {
        const next =
          key === oldBase
            ? newBase
            : newBase + '/' + key.slice(oldBase.length + 1);
        store[next] = store[key];
        delete store[key];
        changed = true;
      }
    }
    if (changed) this.stores.set(folder, store);
  }
}

class FakeStorage {
  map = new Map();
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, v);
  }
  removeItem(k) {
    this.map.delete(k);
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
}

const { NoteIdentityRegistry } = await bundle(
  'src/storage/NoteIdentityRegistry.ts'
);
const { NoteLifecycle } = await bundle('src/storage/NoteLifecycle.ts');

function makeRegistry(master = '/Master') {
  const hidden = new FakeHidden();
  const registry = new NoteIdentityRegistry(
    {},
    () => master,
    hidden
  );
  return { registry, hidden };
}

function makeLifecycle({ master = '/Master', vaultId = 'vid' } = {}) {
  const { registry, hidden } = makeRegistry(master);
  const boards = new FakeStoreRepo();
  const context = new FakeStoreRepo();
  const storage = new FakeStorage();
  const lifecycle = new NoteLifecycle({
    registry,
    boards,
    context,
    vaultId,
    storage
  });
  return { lifecycle, registry, boards, context, storage, hidden };
}

// ------------------------------------------------------------
// 1. Identidad básica
// ------------------------------------------------------------
test('getId crea y persiste; segunda llamada devuelve el mismo id', async () => {
  const { registry, hidden } = makeRegistry();
  const id1 = await registry.getId('Notas/a.md');
  const id2 = await registry.getId('Notas/a.md');
  assert.ok(id1 && id1.length > 0);
  assert.equal(id1, id2);
  assert.ok(hidden.files.has('/Master/ids.json'));
});

test('sin Master: getId devuelve null (fallback a ruta)', async () => {
  const { registry } = makeRegistry(null);
  assert.equal(await registry.getId('a.md'), null);
});

test('ids.json ilegible: no se pisa ni lanza', async () => {
  const hidden = new FakeHidden();
  hidden.files.set('/Master/ids.json', { broken: true });
  const registry = new NoteIdentityRegistry({}, () => '/Master', hidden);
  assert.equal(await registry.getId('a.md'), null);
  assert.deepEqual(hidden.files.get('/Master/ids.json'), { broken: true });
});

// ------------------------------------------------------------
// 2. Renombrar nota
// ------------------------------------------------------------
test('renombrar nota migra Board, Contexto, identidad y borradores', async () => {
  const { lifecycle, boards, context, storage } = makeLifecycle();
  boards.stores.set('Notas', { 'Notas/a.md': { blocks: [1] } });
  context.stores.set('Notas', { 'Notas/a.md': { widgets: [] } });
  storage.setItem('focus-notes-draft-vid-Notas/a.md', 'borrador');
  const id = await lifecycle.getNoteId('Notas/a.md');

  await lifecycle.onFileRenamed('Notas/a.md', 'Notas/b.md');

  assert.deepEqual(boards.stores.get('Notas'), { 'Notas/b.md': { blocks: [1] } });
  assert.deepEqual(context.stores.get('Notas'), { 'Notas/b.md': { widgets: [] } });
  assert.equal(await lifecycle.getNoteId('Notas/b.md'), id);
  // Borrador copiado y origen intacto.
  assert.equal(storage.getItem('focus-notes-draft-vid-Notas/b.md'), 'borrador');
  assert.equal(storage.getItem('focus-notes-draft-vid-Notas/a.md'), 'borrador');
});

test('renombrar nota entre carpetas: destino antes que origen', async () => {
  const { lifecycle, boards } = makeLifecycle();
  boards.stores.set('A', { 'A/x.md': { blocks: [7] } });
  boards.stores.set('B', {});
  await lifecycle.onFileRenamed('A/x.md', 'B/x.md');
  assert.deepEqual(boards.stores.get('B'), { 'B/x.md': { blocks: [7] } });
  assert.deepEqual(boards.stores.get('A'), {});
});

test('fallo de escritura de destino: el origen queda intacto', async () => {
  const { lifecycle, boards } = makeLifecycle();
  boards.stores.set('A', { 'A/x.md': { blocks: [1] } });
  boards.failDestWrite = true;
  await assert.rejects(() => lifecycle.onFileRenamed('A/x.md', 'B/x.md'));
  // Origen intacto (migración abortada).
  assert.deepEqual(boards.stores.get('A'), { 'A/x.md': { blocks: [1] } });
  assert.ok(!((boards.stores.get('B') ?? {})['B/x.md']));
});

test('migración repetida (idempotencia): no duplica ni pierde', async () => {
  const { lifecycle, boards, context, storage } = makeLifecycle();
  boards.stores.set('Notas', { 'Notas/a.md': { blocks: [1] } });
  context.stores.set('Notas', { 'Notas/a.md': { widgets: [] } });
  storage.setItem('focus-notes-draft-vid-Notas/a.md', 'b');
  await lifecycle.onFileRenamed('Notas/a.md', 'Notas/b.md');
  await lifecycle.onFileRenamed('Notas/a.md', 'Notas/b.md');
  assert.deepEqual(boards.stores.get('Notas'), { 'Notas/b.md': { blocks: [1] } });
  assert.deepEqual(context.stores.get('Notas'), { 'Notas/b.md': { widgets: [] } });
});

// ------------------------------------------------------------
// 3. Renombrar carpeta
// ------------------------------------------------------------
test('renombrar carpeta re-clava stores, identidad y borradores', async () => {
  const { lifecycle, boards, context, storage, registry } = makeLifecycle();
  // Tras el rename de Obsidian el archivo del store ya vive en la
  // carpeta nueva, pero sus claves aún usan el prefijo antiguo.
  boards.stores.set('Libro', {
    'Lib/c1.md': { blocks: [1] },
    'Lib/c2.md': { blocks: [2] },
    'Otro/n.md': { blocks: [3] }
  });
  context.stores.set('Libro', { 'Lib/c1.md': { widgets: [] } });
  storage.setItem('focus-notes-draft-vid-Lib/c1.md', 'd1');
  const id = await registry.getId('Lib/c1.md');

  await lifecycle.onFolderRenamed('Lib', 'Libro');

  assert.deepEqual(boards.stores.get('Libro'), {
    'Libro/c1.md': { blocks: [1] },
    'Libro/c2.md': { blocks: [2] },
    'Otro/n.md': { blocks: [3] }
  });
  assert.deepEqual(context.stores.get('Libro'), { 'Libro/c1.md': { widgets: [] } });
  assert.equal(await registry.findIdByPath('Libro/c1.md'), id);
  assert.equal(storage.getItem('focus-notes-draft-vid-Libro/c1.md'), 'd1');
  assert.equal(storage.getItem('focus-notes-draft-vid-Lib/c1.md'), 'd1');
});

// ------------------------------------------------------------
// 4. Borrar / restaurar
// ------------------------------------------------------------
test('borrar conserva id como tombstone; restaurar lo recupera', async () => {
  const { lifecycle, registry } = makeLifecycle();
  const id = await lifecycle.getNoteId('n.md');
  await lifecycle.onNoteDeleted('n.md');
  assert.equal(await registry.findIdByPath('n.md'), null);
  const restored = await lifecycle.onNoteCreated('n.md');
  assert.equal(restored, id);
  assert.equal(await registry.findIdByPath('n.md'), id);
});

test('nota nueva sin tombstone: onCreated no asigna id', async () => {
  const { lifecycle } = makeLifecycle();
  assert.equal(await lifecycle.onNoteCreated('nueva.md'), null);
});

// ------------------------------------------------------------
// 5. reconcile
// ------------------------------------------------------------
test('reconcile reporta huérfanos y restaura tombstones', async () => {
  const { lifecycle, registry } = makeLifecycle();
  await registry.getId('viva.md');
  await registry.getId('muerta.md');
  await registry.onDeleted('muerta.md');

  const report = await registry.reconcile(['viva.md', 'muerta.md']);
  assert.deepEqual(report.orphans, []);
  assert.deepEqual(report.restored, ['muerta.md']);
  // Tras restaurar, la identidad vuelve.
  assert.ok((await registry.findIdByPath('muerta.md')) !== null);

  const report2 = await registry.reconcile(['viva.md']);
  assert.deepEqual(report2.orphans, ['muerta.md']);
});

test('reconcile detecta ids duplicados sin modificar nada', async () => {
  const hidden = new FakeHidden();
  hidden.files.set('/Master/ids.json', {
    version: 1,
    ids: { 'a.md': 'same', 'b.md': 'same' },
    tombstones: {}
  });
  const registry = new NoteIdentityRegistry({}, () => '/Master', hidden);
  const report = await registry.reconcile(['a.md', 'b.md']);
  assert.deepEqual(report.duplicateIds, ['same']);
});
