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

function makeRegistry(master = 'Master') {
  const hidden = new FakeHidden();
  const registry = new NoteIdentityRegistry(
    {},
    () => master,
    hidden
  );
  return { registry, hidden };
}

function makeLifecycle({ master = 'Master', vaultId = 'vid', idGenerator } = {}) {
  const hidden = new FakeHidden();
  const registry = new NoteIdentityRegistry(
    {},
    () => master,
    hidden,
    undefined,
    idGenerator
  );
  const boards = new FakeStoreRepo();
  const context = new FakeStoreRepo();
  const storage = new FakeStorage();
  // Adapter de diario (M2): mapa simple con la misma forma.
  const journalFiles = new Map();
  const journalDirs = new Set();
  const journalApp = {
    vault: {
      adapter: {
        async exists(p) {
          return journalFiles.has(p) || journalDirs.has(p);
        },
        async read(p) {
          return journalFiles.get(p);
        },
        async write(p, c) {
          journalFiles.set(p, c);
        },
        async mkdir(p) {
          journalDirs.add(p);
        }
      }
    }
  };
  const lifecycle = new NoteLifecycle({
    registry,
    boards,
    context,
    vaultId,
    storage,
    getRootPath: () => (master ? master.replace(/^\/+/, '') : null),
    journalApp
  });
  return { lifecycle, registry, boards, context, storage, hidden, journalFiles };
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
  assert.ok(hidden.files.has('Master/ids.json'));
});

test('sin Master: getId devuelve null (fallback a ruta)', async () => {
  const { registry } = makeRegistry(null);
  assert.equal(await registry.getId('a.md'), null);
});

test('ids.json ilegible: no se pisa ni lanza', async () => {
  const hidden = new FakeHidden();
  hidden.files.set('Master/ids.json', { broken: true });
  const registry = new NoteIdentityRegistry({}, () => 'Master', hidden);
  assert.equal(await registry.getId('a.md'), null);
  assert.deepEqual(hidden.files.get('Master/ids.json'), { broken: true });
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
test('E2: borrar deja id pendiente; el reclamo explícito lo recupera', async () => {
  const { lifecycle, registry } = makeLifecycle();
  const id = await lifecycle.getNoteId('n.md');
  await lifecycle.onNoteDeleted('n.md');
  // Sin reclamo: la nota no tiene id asociado.
  assert.equal(await registry.findIdByPath('n.md'), null);
  // onCreated NO auto-reclama (creación nueva = id nuevo después).
  assert.equal(await lifecycle.onNoteCreated('n.md'), null);
  // Reclamo explícito recupera el mismo id (sin límite de tiempo).
  const pending = await registry.getPendingFor('n.md');
  assert.equal(pending.length, 1);
  const result = await registry.claim('n.md');
  assert.equal(result.status, 'claimed');
  assert.equal(await registry.findIdByPath('n.md'), id);
});
test('nota nueva sin pendientes: onCreated no asigna id', async () => {
  const { lifecycle } = makeLifecycle();
  assert.equal(await lifecycle.onNoteCreated('nueva.md'), null);
});

// ------------------------------------------------------------
// 5. reconcile (E2: sin restauración automática)
// ------------------------------------------------------------

test('reconcile reporta huérfanos y pendientes existentes sin auto-restaurar', async () => {
  const { lifecycle, registry } = makeLifecycle();
  await registry.getId('viva.md');
  const muertaId = await registry.getId('muerta.md');
  await registry.onDeleted('muerta.md');

  // La nota muerta «reaparece» sin evento (p. ej. sync) → reporte.
  const report = await registry.reconcile(['viva.md', 'muerta.md']);
  assert.deepEqual(report.orphans, []);
  assert.deepEqual(report.pendingExisting, ['muerta.md']);
  // NO se restaura automáticamente: sigue sin id activo.
  assert.equal(await registry.findIdByPath('muerta.md'), null);

  // La nota desaparece de nuevo: pending sin nota existente NO es
  // huérfano (huérfano = id ACTIVO sin nota); queda pendiente.
  const report2 = await registry.reconcile(['viva.md']);
  assert.deepEqual(report2.orphans, []);
  assert.deepEqual(report2.pendingExisting, []);
  const pending = await registry.getPendingFor('muerta.md');
  assert.equal(pending.length, 1, 'el pendiente se conserva');
  void lifecycle;
  void muertaId;
});

test('reconcile detecta ids duplicados sin modificar nada', async () => {
  const hidden = new FakeHidden();
  hidden.files.set('Master/ids.json', {
    version: 1,
    ids: { 'a.md': 'same', 'b.md': 'same' },
    tombstones: {}
  });
  const registry = new NoteIdentityRegistry({}, () => 'Master', hidden);
  const report = await registry.reconcile(['a.md', 'b.md']);
  assert.deepEqual(report.duplicateIds, ['same']);
});

// ------------------------------------------------------------
// A3: restauración vs creación nueva
// ------------------------------------------------------------

test('E2: recuperación más allá de cualquier plazo (claim tardío)', async () => {
  const { registry, hidden } = makeRegistry();
  const oldId = await registry.getId('n.md');
  await registry.onDeleted('n.md');
  // Envejecer la pendencia años (sin ventana temporal en E2).
  const file = hidden.files.get('Master/ids.json');
  file.pending['n.md'].deletedAt = Date.now() - 365 * 24 * 60 * 60 * 1000;

  const fresh = new NoteIdentityRegistry({}, () => 'Master', hidden);
  const result = await fresh.claim('n.md');
  assert.equal(result.status, 'claimed');
  assert.equal(await fresh.findIdByPath('n.md'), oldId);
});

test('E2: creación nueva en ruta antigua recibe id nuevo; el reclamo recupera el viejo', async () => {
  const { registry, hidden } = makeRegistry();
  const oldId = await registry.getId('n.md');
  await registry.onDeleted('n.md');

  // Nota nueva (sin reclamo): id nuevo; los datos viejos NO se asocian.
  const fresh = new NoteIdentityRegistry({}, () => 'Master', hidden);
  assert.equal(await fresh.onCreated('n.md'), null);
  const newId = await fresh.getId('n.md');
  assert.notEqual(newId, oldId);
  assert.notEqual(await fresh.findPathById(oldId), 'n.md');

  // Reclamo explícito conflicto: la ruta ya tiene id activo distinto.
  const claim = await fresh.claim('n.md');
  assert.equal(claim.status, 'conflict');
  // La pendencia se conserva (recuperable en el futuro).
  const after = hidden.files.get('Master/ids.json');
  assert.equal(after.pending['n.md'].id, oldId);
});

test('E2: reconcile reporta pendientes existentes sin restaurar', async () => {
  const { registry, hidden } = makeRegistry();
  const oldId = await registry.getId('n.md');
  await registry.onDeleted('n.md');

  const fresh = new NoteIdentityRegistry({}, () => 'Master', hidden);
  const report = await fresh.reconcile(['n.md']);
  assert.deepEqual(report.pendingExisting, ['n.md']);
  assert.equal(await fresh.findIdByPath('n.md'), null);
  void oldId;
});

test('E2: ids.json v1 con tombstones migra a pending conservando datos', async () => {
  const hidden = new FakeHidden();
  hidden.files.set('Master/ids.json', {
    version: 1,
    ids: { 'viva.md': 'id-viva' },
    tombstones: {
      'muerta.md': { id: 'id-muerta', deletedAt: 1234567890 }
    }
  });
  const registry = new NoteIdentityRegistry({}, () => 'Master', hidden);
  // La carga migra: pendiente con las MISMAS fechas.
  const pending = await registry.getPendingFor('muerta.md');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'id-muerta');
  assert.equal(pending[0].deletedAt, 1234567890);
  // El id activo de la nota viva se conserva.
  assert.equal(await registry.findIdByPath('viva.md'), 'id-viva');
  // tombstones vacío tras la migración; los datos no se pierden.
  const file = hidden.files.get('Master/ids.json');
  assert.deepEqual(file.tombstones, {});
  assert.equal(file.pending['muerta.md'].id, 'id-muerta');
});

test('E2: ambigüedad pending+archived no se resuelve arbitrariamente', async () => {
  const { registry, hidden } = makeRegistry();
  const pendingId = await registry.getId('n.md');
  await registry.onDeleted('n.md');
  // Sembrar además un archived para la MISMA ruta (id distinto).
  const file = hidden.files.get('Master/ids.json');
  file.archived = { 'n.md': { id: 'archived-id', deletedAt: 111 } };

  const fresh = new NoteIdentityRegistry({}, () => 'Master', hidden);
  const result = await fresh.claim('n.md');
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidates.length, 2);
  // Con bucket explícito sí se reclama.
  const claimed = await fresh.claim('n.md', 'pending');
  assert.equal(claimed.status, 'claimed');
  assert.equal(await fresh.findIdByPath('n.md'), pendingId);
  // El archivado se conserva.
  const after = hidden.files.get('Master/ids.json');
  assert.equal(after.archived['n.md'].id, 'archived-id');
});

test('E2: claim idempotente (dos veces = mismo resultado)', async () => {
  const { registry } = makeRegistry();
  const id = await registry.getId('n.md');
  await registry.onDeleted('n.md');
  const r1 = await registry.claim('n.md');
  const r2 = await registry.claim('n.md');
  assert.equal(r1.status, 'claimed');
  assert.equal(r2.status, 'claimed');
  assert.equal(await registry.findIdByPath('n.md'), id);
});

test('A3: ids.json sin campo archived es compatible (se hidrata)', async () => {
  const hidden = new FakeHidden();
  hidden.files.set('Master/ids.json', {
    version: 1,
    ids: { 'a.md': 'id-a' },
    tombstones: {}
  });
  const registry = new NoteIdentityRegistry({}, () => 'Master', hidden);
  assert.equal(await registry.findIdByPath('a.md'), 'id-a');
  // Tras persistir, archived existe y los datos previos se conservan.
  await registry.getId('b.md');
  const file = hidden.files.get('Master/ids.json');
  assert.deepEqual(file.ids, { 'a.md': 'id-a', 'b.md': file.ids['b.md'] });
  assert.ok(file.archived);
});

// ------------------------------------------------------------
// M3: unicidad de identificadores
// ------------------------------------------------------------

test('M3: una colisión del generador se resuelve sin mezclar datos', async () => {
  const { registry, hidden } = makeRegistry();
  // Sembrar un id existente 'dup'.
  hidden.files.set('Master/ids.json', {
    version: 1,
    ids: { 'otra.md': 'dup' },
    tombstones: {},
    archived: {}
  });
  const answers = ['dup', 'dup', 'unico'];
  const fresh = new NoteIdentityRegistry(
    {},
    () => 'Master',
    hidden,
    undefined,
    () => answers.shift() ?? 'fallback'
  );
  const id = await fresh.getId('nueva.md');
  assert.equal(id, 'unico', 'salta la colisión y usa el siguiente');
  // Dos notas jamás comparten id.
  assert.notEqual(id, await fresh.findIdByPath('otra.md'));
});

// ------------------------------------------------------------
// M2: diario de migraciones e inyección de fallos
// ------------------------------------------------------------

test('M2: fallo tras migrar Board deja diario pendiente y recoverPending completa', async () => {
  const { lifecycle, boards, context, registry, journalFiles } =
    makeLifecycle();
  boards.stores.set('Notas', { 'Notas/a.md': { blocks: [1] } });
  boards.failDestWrite = false;
  await lifecycle.getNoteId('Notas/a.md');

  // Inyectar fallo SOLO en context (paso 2), tras boards exitoso.
  const originalMigrate = context.migrateEntry.bind(context);
  let failOnce = true;
  context.migrateEntry = async (o, n) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('context I/O');
    }
    return originalMigrate(o, n);
  };

  await assert.rejects(() =>
    lifecycle.onFileRenamed('Notas/a.md', 'Notas/b.md')
  );
  // El diario persiste con boards completado y context pendiente.
  const journalKey = [...journalFiles.keys()][0];
  const journal = JSON.parse(journalFiles.get(journalKey));
  assert.equal(journal.length, 1);
  assert.equal(journal[0].steps.boards, true);
  assert.equal(journal[0].steps.context, false);
  assert.ok(journal[0].error.includes('context'));

  // Recuperación (siguiente arranque): completa los pasos restantes.
  await lifecycle.recoverPending();
  assert.deepEqual(boards.stores.get('Notas'), {
    'Notas/b.md': { blocks: [1] }
  });
  const idAfter = await registry.findIdByPath('Notas/b.md');
  assert.ok(idAfter, 'registry re-clavado en la recuperación');
  // El diario se vacía tras completarse.
  assert.equal(JSON.parse(journalFiles.get(journalKey)).length, 0);
});

test('M2: onFileRenamed exitoso no deja entradas en el diario', async () => {
  const { lifecycle, journalFiles } = makeLifecycle();
  await lifecycle.onFileRenamed('a.md', 'b.md');
  const journalKey = [...journalFiles.keys()][0];
  assert.equal(JSON.parse(journalFiles.get(journalKey)).length, 0);
});

// ------------------------------------------------------------
// M1: mantenimiento de arranque
// ------------------------------------------------------------

test('M1: runStartupMaintenance ejecuta recoverPending y reconcile', async () => {
  const { runStartupMaintenance } = await bundle(
    'src/storage/startupMaintenance.ts'
  );
  const { lifecycle, registry } = makeLifecycle();
  await lifecycle.getNoteId('viva.md');

  const app = {
    vault: {
      getMarkdownFiles: () => [{ path: 'viva.md' }]
    }
  };
  const report = await runStartupMaintenance(app, registry, lifecycle);
  assert.equal(report.recoveredJournal, true);
  assert.equal(report.reconcileOrphans, 0);
  assert.equal(report.reconcilePendingExisting, 0);
});

test('M1: un fallo en recoverPending no impide reconcile', async () => {
  const { runStartupMaintenance } = await bundle(
    'src/storage/startupMaintenance.ts'
  );
  const { registry } = makeLifecycle();
  const failingLifecycle = {
    recoverPending: async () => {
      throw new Error('journal I/O');
    }
  };
  const app = {
    vault: { getMarkdownFiles: () => [] }
  };
  const report = await runStartupMaintenance(
    app,
    registry,
    failingLifecycle
  );
  assert.equal(report.recoveredJournal, false);
  // reconcile corrió igualmente (sin huérfanos).
  assert.equal(report.reconcileOrphans, 0);
});

// ------------------------------------------------------------
// M5 + B1: normalización de rutas y caché del registro
// ------------------------------------------------------------

test('M5: normalizeRootPath elimina barras iniciales/finales', async () => {
  const { normalizeRootPath } = await bundle('src/utils/rootPath.ts');
  assert.equal(normalizeRootPath('Master/'), 'Master');
  assert.equal(normalizeRootPath('Master'), 'Master');
  assert.equal(normalizeRootPath(' /Master/ '), 'Master');
  assert.equal(normalizeRootPath('Libros/Mi Libro'), 'Libros/Mi Libro');
  assert.equal(normalizeRootPath(''), null);
  assert.equal(normalizeRootPath(null), null);
  // Solo barras = raíz del vault (contrato nuevo).
  assert.equal(normalizeRootPath('///'), '');
});

test('M5: rutas con barra inicial y final producen la MISMA clave', async () => {
  const { normalizeRootPath } = await bundle('src/utils/rootPath.ts');
  const a = normalizeRootPath('Master/');
  const b = normalizeRootPath('Master');
  const keyFor = (root) => {
    const { registry, hidden } = makeRegistry(root);
    void registry;
    return hidden;
  };
  // Mismo root normalizado → misma convención de clave del fake.
  assert.equal(a, b);
  void keyFor;
});

test('B1: cambiar el Master en caliente invalida la caché del registro', async () => {
  const hidden = new FakeHidden();
  let master = 'MasterA';
  const registry = new NoteIdentityRegistry({}, () => master, hidden);
  const idA = await registry.getId('n.md');
  assert.ok(hidden.files.has('MasterA/ids.json'));

  master = 'MasterB';
  const idB = await registry.getId('n.md');
  // Fichero del nuevo master creado; no se mezclan almacenes.
  assert.ok(hidden.files.has('MasterB/ids.json'));
  assert.notEqual(hidden.files.get('MasterA/ids.json').ids['n.md'] === undefined, true);
  void idA;
  void idB;
});
