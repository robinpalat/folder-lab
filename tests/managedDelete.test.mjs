// ============================================================
// PRUEBAS: Borrado administrado de notas (E3)
// ============================================================
// Ejecutar con: npm test
//
// Cubre los 10 escenarios obligatorios:
// 1. Borrado exitoso con board, contexto, borrador e historial.
// 2. Snapshot fallido: markdown intacto, sin pérdida.
// 3. Fallo al registrar la identidad pendiente.
// 4. Fallo al actualizar el orden.
// 5. trashFile() falla sin fallback destructivo.
// 6. Sin trashFile: fallback a vault.delete (compat 1.4.4).
// 7. Recuperación al arrancar tras interrumpir cada paso.
// 8. Idempotencia de la recuperación (doble ejecución).
// 9. Restaurar markdown + reclamo recupera la identidad.
// 10. Exclusión de recursos y notas ajenas del snapshot.
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

class FakeVaultAdapter {
  files = new Map();
  dirs = new Set();
  failWritePrefix = null;
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
    if (this.failWritePrefix && p.startsWith(this.failWritePrefix)) {
      throw new Error('EIO simulado');
    }
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

const ROOT = 'Master';

const { NoteIdentityRegistry } = await bundle(
  'src/storage/NoteIdentityRegistry.ts'
);
const { NoteLifecycle } = await bundle('src/storage/NoteLifecycle.ts');
const { makeTrashOp, NoteDataSnapshot } = await bundle(
  'src/storage/managedDelete.ts'
);

function makeSystem({ trashMode = 'trashFile', failTrash = false } = {}) {
  const hidden = new FakeHidden();
  const adapter = new FakeVaultAdapter();
  const vaultFiles = new Map([['Master/Notas/n.md', '# nota']]);
  let vaultDeletes = 0;
  let trashCalls = 0;
  const app = {
    vault: {
      adapter,
      getAbstractFileByPath: (p) =>
        vaultFiles.has(p) ? { path: p } : null,
      delete: async (f) => {
        vaultDeletes += 1;
        vaultFiles.delete(f.path);
      }
    },
    fileManager:
      trashMode === 'trashFile'
        ? {
            trashFile: async (f) => {
              trashCalls += 1;
              if (failTrash) throw new Error('trash EIO');
              vaultFiles.delete(f.path);
            }
          }
        : {}
  };
  const registry = new NoteIdentityRegistry({}, () => ROOT, hidden);
  const boards = {
    migrateEntry: async () => {},
    migrateFolderPrefix: async () => {}
  };
  const context = {
    migrateEntry: async () => {},
    migrateFolderPrefix: async () => {}
  };
  const journalFiles = new Map();
  const journalApp = {
    vault: {
      adapter: {
        async exists(p) {
          return journalFiles.has(p) || adapter.dirs.has(p) || adapter.files.has(p);
        },
        async read(p) {
          if (journalFiles.has(p)) return journalFiles.get(p);
          return adapter.read(p);
        },
        async write(p, c) {
          if (journalFiles.has(p) || p.includes('lifecycle-journal')) {
            journalFiles.set(p, c);
            return;
          }
          return adapter.write(p, c);
        },
        async mkdir(p) {
          adapter.dirs.add(p);
        },
        async list(p) {
          return adapter.list(p);
        }
      }
    }
  };
  const snapshot = new NoteDataSnapshot(app, () => ROOT);
  const trashFile = makeTrashOp(app);
  let orderCalls = 0;
  const lifecycle = new NoteLifecycle({
    registry,
    boards,
    context,
    vaultId: 'vid',
    storage: null,
    getRootPath: () => ROOT,
    journalApp,
    snapshot,
    trashFile
  });
  return {
    lifecycle,
    registry,
    adapter,
    vaultFiles,
    journalFiles,
    get vaultDeletes() {
      return vaultDeletes;
    },
    get trashCalls() {
      return trashCalls;
    },
    orderCounter: () => orderCalls,
    bumpOrder: () => {
      orderCalls += 1;
    }
  };
}

async function seedNoteData(sys) {
  const id = await sys.registry.getId('Master/Notas/n.md');
  const base = `${ROOT}/Folder Lab`;
  await sys.adapter.mkdir(`${base}/boards`);
  await sys.adapter.mkdir(`${base}/context`);
  await sys.adapter.mkdir(`${base}/drafts`);
  await sys.adapter.mkdir(`${base}/polish`);
  await sys.adapter.write(
    `${base}/boards/${id}.json`,
    JSON.stringify({ version: 1, notePath: 'Master/Notas/n.md', data: { blocks: [{ id: 'b' }], connections: [] } })
  );
  await sys.adapter.write(
    `${base}/context/${id}.json`,
    JSON.stringify({ version: 1, notePath: 'Master/Notas/n.md', data: { widgets: [], layout: { top: '', bottom: '' } } })
  );
  await sys.adapter.write(
    `${base}/drafts/${id}.json`,
    JSON.stringify({ version: 1, notePath: 'Master/Notas/n.md', draft: 'borrador', blocks: [] })
  );
  await sys.adapter.write(
    `${base}/polish/${id}.json`,
    JSON.stringify({ version: 1, notePath: 'Master/Notas/n.md', data: { versions: [] } })
  );
  return id;
}

function snapshotDirs(adapter) {
  return [...adapter.files.keys()].filter((k) =>
    k.includes('/Folder Lab/trash/') && k.endsWith('identity.json')
  );
}

// ------------------------------------------------------------
// 1. Borrado exitoso
// ------------------------------------------------------------
test('E3-1: borrado exitoso crea snapshot completo, pendiente, orden y papelera', async () => {
  const sys = makeSystem();
  const id = await seedNoteData(sys);

  let orderInvoked = 0;
  await sys.lifecycle.deleteNoteManaged('Master/Notas/n.md', async () => {
    orderInvoked += 1;
  });

  // Snapshot con los4 datos + identidad.
  const dirs = snapshotDirs(sys.adapter);
  assert.equal(dirs.length, 1);
  const dir = dirs[0].slice(0, dirs[0].lastIndexOf('/'));
  for (const name of [
    'identity.json',
    'board.json',
    'context.json',
    'draft.json',
    'polish.json'
  ]) {
    assert.ok(sys.adapter.files.has(`${dir}/${name}`), name);
  }
  const identity = JSON.parse(sys.adapter.files.get(`${dir}/identity.json`));
  assert.equal(identity.noteId, id);
  assert.equal(identity.notePath, 'Master/Notas/n.md');

  // Pendiente + orden + archivo.
  const pending = await sys.registry.getPendingFor('Master/Notas/n.md');
  assert.equal(pending.length, 1);
  assert.equal(orderInvoked, 1);
  assert.equal(sys.trashCalls, 1);
  assert.equal(sys.vaultFiles.has('Master/Notas/n.md'), false);
  assert.equal(sys.vaultDeletes, 0, 'no se usa vault.delete con trashFile');

  // Diario limpio.
  const journalKey = [...sys.journalFiles.keys()][0];
  assert.equal(JSON.parse(sys.journalFiles.get(journalKey)).length, 0);
});

// ------------------------------------------------------------
// 2. Snapshot fallido
// ------------------------------------------------------------
test('E3-2: snapshot fallido → markdown intacto, sin pending, diario pendiente', async () => {
  const sys = makeSystem();
  await seedNoteData(sys);
  sys.adapter.failWritePrefix = `${ROOT}/Folder Lab/trash/`;

  await assert.rejects(() =>
    sys.lifecycle.deleteNoteManaged('Master/Notas/n.md', async () => {})
  );
  assert.equal(sys.vaultFiles.has('Master/Notas/n.md'), true, 'markdown intacto');
  assert.equal(sys.trashCalls, 0);
  const pending = await sys.registry.getPendingFor('Master/Notas/n.md');
  assert.equal(pending.length, 0);
  const journalKey = [...sys.journalFiles.keys()][0];
  const journal = JSON.parse(sys.journalFiles.get(journalKey));
  assert.equal(journal.length, 1);
  assert.equal(journal[0].steps.snapshot, false);
  assert.ok(journal[0].error.includes('snapshot'));
});

// ------------------------------------------------------------
// 3. Fallo registrando pendiente
// ------------------------------------------------------------
test('E3-3: fallo al registrar pendiente → snapshot conservado, markdown intacto', async () => {
  const sys = makeSystem();
  await seedNoteData(sys);
  const original = sys.registry.onDeleted.bind(sys.registry);
  sys.registry.onDeleted = async () => {
    throw new Error('registry EIO');
  };

  await assert.rejects(() =>
    sys.lifecycle.deleteNoteManaged('Master/Notas/n.md', async () => {})
  );
  assert.equal(sys.vaultFiles.has('Master/Notas/n.md'), true);
  assert.equal(snapshotDirs(sys.adapter).length, 1, 'snapshot conservado');
  const journalKey = [...sys.journalFiles.keys()][0];
  const journal = JSON.parse(sys.journalFiles.get(journalKey));
  assert.equal(journal[0].steps.snapshot, true);
  assert.equal(journal[0].steps.pending, false);
  sys.registry.onDeleted = original;
});

// ------------------------------------------------------------
// 4. Fallo actualizando el orden
// ------------------------------------------------------------
test('E3-4: fallo en el orden → pending y snapshot listos, archivo intacto', async () => {
  const sys = makeSystem();
  await seedNoteData(sys);

  await assert.rejects(() =>
    sys.lifecycle.deleteNoteManaged('Master/Notas/n.md', async () => {
      throw new Error('order EIO');
    })
  );
  assert.equal(sys.vaultFiles.has('Master/Notas/n.md'), true);
  const pending = await sys.registry.getPendingFor('Master/Notas/n.md');
  assert.equal(pending.length, 1);
  const journalKey = [...sys.journalFiles.keys()][0];
  const journal = JSON.parse(sys.journalFiles.get(journalKey));
  assert.equal(journal[0].steps.order, false);
  assert.equal(journal[0].steps.file, false);
});

// ------------------------------------------------------------
// 5. trashFile existe y falla → sin fallback destructivo
// ------------------------------------------------------------
test('E3-5: trashFile falla → no se ejecuta vault.delete', async () => {
  const sys = makeSystem({ failTrash: true });
  await seedNoteData(sys);

  await assert.rejects(() =>
    sys.lifecycle.deleteNoteManaged('Master/Notas/n.md', async () => {})
  );
  assert.equal(sys.trashCalls, 1);
  assert.equal(sys.vaultDeletes, 0, 'sin fallback destructivo');
  assert.equal(sys.vaultFiles.has('Master/Notas/n.md'), true, 'archivo intacto');
  const journalKey = [...sys.journalFiles.keys()][0];
  const journal = JSON.parse(sys.journalFiles.get(journalKey));
  assert.equal(journal[0].steps.file, false);
});

// ------------------------------------------------------------
// 6. Sin trashFile → vault.delete (compat 1.4.4)
// ------------------------------------------------------------
test('E3-6: sin trashFile se usa vault.delete', async () => {
  const sys = makeSystem({ trashMode: 'legacy' });
  await seedNoteData(sys);
  await sys.lifecycle.deleteNoteManaged('Master/Notas/n.md', async () => {});
  assert.equal(sys.trashCalls, 0);
  assert.equal(sys.vaultDeletes, 1);
  assert.equal(sys.vaultFiles.has('Master/Notas/n.md'), false);
});

// ------------------------------------------------------------
// 7 + 8. Recuperación al arrancar e idempotencia
// ------------------------------------------------------------
for (const failStep of ['snapshot', 'order', 'trash']) {
  test(`E3-7/8: interrupción en «${failStep}» → recoverPending completa (idempotente)`, async () => {
    const sys = makeSystem();
    await seedNoteData(sys);

    // Interrumpir el paso.
    if (failStep === 'snapshot') {
      sys.adapter.failWritePrefix = `${ROOT}/Folder Lab/trash/`;
    }
    const orderFn =
      failStep === 'order'
        ? async () => {
            throw new Error('order EIO');
          }
        : async () => {};
    if (failStep === 'trash') {
      sys.registry; // trash se falla con el modo dedicado:
    }
    const reject = failStep === 'trash';
    const appTrash = sys;
    if (reject) {
      // Re-sistema con trash fallido para el primer intento.
      const sys2 = makeSystem({ failTrash: true });
      await seedNoteData(sys2);
      await assert.rejects(() =>
        sys2.lifecycle.deleteNoteManaged('Master/Notas/n.md', async () => {})
      );
      // «Arranque»: reintentar con trash sano (misma instancia no es
      // posible con failTrash fijo; se simula el entorno reparado).
      const sys3 = makeSystem();
      await seedNoteData(sys3);
      // Copiar el diario pendiente del intento fallido.
      for (const [k, v] of sys2.journalFiles) {
        sys3.journalFiles.set(k, v);
      }
      // La entrada del diario apunta al mismo noteId (mismo generador
      // determinista no es guarantee; reconstruimos la entrada).
      const id3 = await sys3.registry.getId('Master/Notas/n.md');
      sys3.journalFiles.set(`${ROOT}/Folder Lab/lifecycle-journal.json`, JSON.stringify([
        {
          type: 'note-delete',
          oldPath: 'Master/Notas/n.md',
          newPath: 'Master/Notas/n.md',
          noteId: id3,
          steps: { snapshot: true, pending: true, order: true, file: false },
          startedAt: Date.now()
        }
      ]));
      await sys3.lifecycle.recoverPending();
      assert.equal(sys3.vaultFiles.has('Master/Notas/n.md'), false);
      // Idempotencia: segunda recuperación sin efecto.
      await sys3.lifecycle.recoverPending();
      assert.equal(sys3.vaultFiles.has('Master/Notas/n.md'), false);
      return;
    }

    sys.adapter.failWritePrefix =
      failStep === 'snapshot' ? `${ROOT}/Folder Lab/trash/` : null;

    await assert.rejects(() =>
      sys.lifecycle.deleteNoteManaged('Master/Notas/n.md', orderFn)
    );

    // «Arranque»: la vista vuelve a registrar el hook (sano) y se
    // retira la falla del entorno.
    sys.adapter.failWritePrefix = null;
    sys.lifecycle.setDeleteOrderHook(async () => {});
    await sys.lifecycle.recoverPending();

    assert.equal(sys.vaultFiles.has('Master/Notas/n.md'), false, 'archivo eliminado en la recuperación');
    const pending = await sys.registry.getPendingFor('Master/Notas/n.md');
    assert.equal(pending.length, 1);
    assert.ok(snapshotDirs(sys.adapter).length >= 1);

    // Idempotencia.
    const trashBefore = sys.trashCalls;
    await sys.lifecycle.recoverPending();
    assert.equal(sys.trashCalls, trashBefore, 'sin segundo envío a papelera');
    const journalKey = [...sys.journalFiles.keys()][0];
    assert.equal(JSON.parse(sys.journalFiles.get(journalKey)).length, 0);
  });
}

// ------------------------------------------------------------
// 9. Restaurar markdown + reclamo
// ------------------------------------------------------------
test('E3-9: tras restaurar el markdown, el reclamo recupera la identidad', async () => {
  const sys = makeSystem();
  const id = await seedNoteData(sys);
  await sys.lifecycle.deleteNoteManaged('Master/Notas/n.md', async () => {});

  // El usuario restaura el archivo (papelera → bóveda).
  sys.vaultFiles.set('Master/Notas/n.md', '# nota restaurada');
  // Reclamo explícito (único candidato pendiente).
  const claim = await sys.registry.claim('Master/Notas/n.md', 'pending');
  assert.equal(claim.status, 'claimed');
  assert.equal(await sys.registry.findIdByPath('Master/Notas/n.md'), id);
});

// ------------------------------------------------------------
// 10. Exclusión de recursos y notas ajenas
// ------------------------------------------------------------
test('E3-10: el snapshot no incluye recursos ni datos de otras notas', async () => {
  const sys = makeSystem();
  const id = await seedNoteData(sys);
  // Nota ajena + recurso de usuario.
  const idOther = await sys.registry.getId('Master/Notas/otra.md');
  await sys.adapter.mkdir(`${ROOT}/Folder Lab/boards`);
  await sys.adapter.write(
    `${ROOT}/Folder Lab/boards/${idOther}.json`,
    JSON.stringify({ version: 1, notePath: 'Master/Notas/otra.md', data: { blocks: [{ id: 'x' }], connections: [] } })
  );
  sys.vaultFiles.set('Master/Notas/_resources/foto.png', 'PNG');
  sys.vaultFiles.set('Master/Notas/_resources.json', '[]');

  await sys.lifecycle.deleteNoteManaged('Master/Notas/n.md', async () => {});

  const dirs = snapshotDirs(sys.adapter);
  assert.equal(dirs.length, 1);
  const dir = dirs[0].slice(0, dirs[0].lastIndexOf('/'));
  const snapFiles = [...sys.adapter.files.keys()].filter((k) =>
    k.startsWith(`${dir}/`)
  );
  assert.equal(
    snapFiles.some((k) => k.includes('foto.png') || k.includes('_resources')),
    false,
    'sin recursos'
  );
  assert.equal(
    snapFiles.some((k) => k.includes(idOther)),
    false,
    'sin datos de la nota ajena'
  );
  // Los originales siguen intactos.
  assert.ok(sys.vaultFiles.has('Master/Notas/_resources/foto.png'));
  assert.ok(
    sys.adapter.files.has(`${ROOT}/Folder Lab/boards/${idOther}.json`)
  );
  void id;
});
