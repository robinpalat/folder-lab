// ============================================================
// PRUEBAS: Núcleo del comando de restauración (E4c-3)
// ============================================================
// Ejecutar con: npm test
//
// Fixtures aislados (sin bóvedas reales). Cubre:
// - sin Master / manifiesto vacío / solo restauradas;
// - pendientes con clasificación de inválidas y restauradas;
// - manifiesto ilegible → error conservador;
// - restoreEntry: éxito, destination-changed, entrada inexistente;
// - el núcleo NO se invoca en el arranque (estático).
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const OBSIDIAN_STUB = `
export class App {}
export class TFile {}
export class TFolder {}
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

const { prepareRestoreCommand, restoreEntry } = await bundle(
  'src/storage/restoreCommand.ts'
);
const { QuarantineManager } = await bundle('src/storage/quarantine.ts');

class FakeAdapter {
  files = new Map();
  dirs = new Set();
  async exists(p) {
    if (this.files.has(p) || this.dirs.has(p)) return true;
    const prefix = p.endsWith('/') ? p : p + '/';
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
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
  async remove(p) {
    this.files.delete(p);
  }
}

const CONTENT = JSON.stringify({ version: 1, notePath: 'nadie.md', data: {} });

function makeSystem({ master = 'Master' } = {}) {
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  const getRootPath = () => (master === null ? null : master);
  const manager = new QuarantineManager(app, getRootPath);
  const deps = { app, getRootPath, manager };
  return { adapter, manager, deps };
}

function candidate(overrides = {}) {
  return {
    path: 'Master/Folder Lab/boards/id-huerfano.json',
    noteId: 'id-huerfano',
    subfolder: 'boards',
    reason: 'fixture',
    mtime: Date.now() - 48 * 60 * 60 * 1000,
    ...overrides
  };
}

async function seedQuarantine(adapter, manager) {
  adapter.files.set('Master/Folder Lab/boards/id-huerfano.json', CONTENT);
  const q = await manager.quarantine(candidate());
  assert.equal(q.status, 'quarantined');
  return q.entry;
}

test('R1: sin Master → no-master', async () => {
  const { deps } = makeSystem({ master: null });
  const outcome = await prepareRestoreCommand(deps);
  assert.equal(outcome.status, 'no-master');
});

test('R2: manifiesto ausente (sin cuarentenas) → no-entries', async () => {
  const { deps } = makeSystem();
  const outcome = await prepareRestoreCommand(deps);
  assert.equal(outcome.status, 'no-entries');
});

test('R3: solo entradas restauradas → no-entries (informativo)', async () => {
  const { adapter, manager, deps } = makeSystem();
  const entry = await seedQuarantine(adapter, manager);
  const r = await manager.restore(entry.entryId);
  assert.equal(r.status, 'restored');
  const outcome = await prepareRestoreCommand(deps);
  assert.equal(outcome.status, 'no-entries');
});

test('R4: pendientes + restauradas + inválidas → needs-confirmation clasificado', async () => {
  const { adapter, manager, deps } = makeSystem();
  // Entrada 1: restaurada.
  const e1 = await seedQuarantine(adapter, manager);
  await manager.restore(e1.entryId);
  // Entrada 2: pendiente válida.
  adapter.files.set(
    'Master/Folder Lab/boards/id-b.json',
    JSON.stringify({ version: 1, notePath: 'b.md', data: {} })
  );
  const q2 = await manager.quarantine(
    candidate({
      path: 'Master/Folder Lab/boards/id-b.json',
      noteId: 'id-b'
    })
  );
  assert.equal(q2.status, 'quarantined');
  // Entrada 3: forma inválida (tampered).
  const mpath = 'Master/Folder Lab/quarantine/manifest.json';
  const manifest = JSON.parse(adapter.files.get(mpath));
  manifest.entries.push({
    entryId: 'maliciosa',
    originPath: 'Master/Notas/x.json',
    quarantinePath: 'Master/Notas/y.json',
    noteId: 'x',
    subfolder: 'boards',
    reason: 'r',
    size: 1,
    contentHash: 'h',
    quarantinedAt: Date.now()
  });
  adapter.files.set(mpath, JSON.stringify(manifest));

  const outcome = await prepareRestoreCommand(deps);
  assert.equal(outcome.status, 'needs-confirmation');
  assert.equal(outcome.pending.length, 1);
  assert.equal(outcome.pending[0].noteId, 'id-b');
  assert.equal(outcome.restoredCount, 1);
  assert.equal(outcome.invalidCount, 1);
});

test('R5: manifiesto ilegible → error conservador', async () => {
  const { adapter, deps } = makeSystem();
  adapter.files.set(
    'Master/Folder Lab/quarantine/manifest.json',
    '{ roto'
  );
  const outcome = await prepareRestoreCommand(deps);
  assert.equal(outcome.status, 'error');
  assert.ok(outcome.error.includes('manifiesto'));
});

test('R6: restoreEntry — éxito con fixtures (archivo de vuelta + restoredAt)', async () => {
  const { adapter, manager, deps } = makeSystem();
  const entry = await seedQuarantine(adapter, manager);
  const outcome = await prepareRestoreCommand(deps);
  assert.equal(outcome.status, 'needs-confirmation');

  const r = await restoreEntry(deps, outcome.pending[0].entryId);
  assert.equal(r.status, 'restored');
  assert.equal(
    adapter.files.get('Master/Folder Lab/boards/id-huerfano.json'),
    CONTENT
  );
  const manifest = await manager.readManifest();
  assert.ok(manifest.entries[0].restoredAt);
  // La copia en cuarentena se conserva.
  assert.equal(adapter.files.get(entry.quarantinePath), CONTENT);
});

test('R7: restoreEntry — destino ocupado con contenido distinto → destination-changed', async () => {
  const { adapter, manager, deps } = makeSystem();
  const entry = await seedQuarantine(adapter, manager);
  const nuevo = JSON.stringify({ version: 1, notePath: 'nadie.md', data: { nuevo: true } });
  adapter.files.set(entry.originPath, nuevo);

  const r = await restoreEntry(deps, entry.entryId);
  assert.equal(r.status, 'destination-changed');
  assert.equal(adapter.files.get(entry.originPath), nuevo, 'destino sin tocar');
  assert.equal(adapter.files.get(entry.quarantinePath), CONTENT);
});

test('R8: restoreEntry — entrada inexistente → not-found', async () => {
  const { deps } = makeSystem();
  const r = await restoreEntry(deps, 'id-que-no-existe');
  assert.equal(r.status, 'not-found');
});

test('R9: el núcleo de restauración NO se invoca en el arranque', () => {
  const maintenance = readFileSync(
    join(root, 'src/storage/startupMaintenance.ts'),
    'utf8'
  );
  assert.ok(!maintenance.includes('restoreCommand'));
  assert.ok(!maintenance.includes('prepareRestoreCommand'));
  const main = readFileSync(join(root, 'src/main.ts'), 'utf8');
  // main puede importarlo (E4c-4 registra el comando), pero el
  // bloque de arranque no debe referenciarlo.
  const readyIdx = main.indexOf('onLayoutReady(');
  const maintIdx = main.indexOf('runStartupMaintenance(');
  assert.ok(readyIdx >= 0 && maintIdx > readyIdx);
  const startupBlock = main.slice(readyIdx, maintIdx);
  assert.ok(!startupBlock.includes('restore'));
  assert.ok(!startupBlock.includes('Restore'));
});

// ------------------------------------------------------------
// E4c-4: interfaz — modal de restauración y registro del comando
// ------------------------------------------------------------
test('R10: modal de restauración con acción por entrada, resultados y advertencia', () => {
  const src = readFileSync(
    join(root, 'src/modals/RestoreQuarantineModal.ts'),
    'utf8'
  );
  // Acción «Restaurar» por entrada + «Cancelar» global.
  assert.ok(/for \(const entry of this\.outcome\.pending\)/.test(src));
  assert.ok(src.includes("text: 'Restaurar'"));
  assert.ok(src.includes("text: 'Cancelar'"));
  assert.ok(/cancelBtn\.onclick = \(\) => this\.close\(\);/.test(src));
  // La fila no se borra sin constancia; resultado por fila.
  assert.ok(!/\.remove\(\)/.test(src), 'sin borrado silencioso de filas');
  assert.ok(src.includes('resultEl.setText'));
  assert.ok(src.includes('this.processed'));
  // Ruta original + fecha de cuarentena visibles.
  assert.ok(src.includes('entry.originPath'));
  assert.ok(src.includes('entry.quarantinedAt'));
  // Destino ocupado explicado claramente.
  assert.ok(src.includes('destination-changed'));
  assert.ok(src.includes('Nada se ha sobrescrito'));
  // Advertencia: restaurar ≠ reactivar identidad.
  assert.ok(src.includes('NO reactiva la identidad'));
  assert.ok(src.includes('ids.json'));
  // Cierre solo tras procesar todas; callback con resultado.
  assert.ok(/this\.processed\.size >= this\.outcome\.pending\.length/.test(src));
  assert.ok(/Promise<RestoreResult \| void>/.test(src));
});

test('R11: comando registrado en main, fuera del arranque, con modal enlazado', () => {
  const main = readFileSync(join(root, 'src/main.ts'), 'utf8');
  assert.ok(main.includes("id: 'restore-quarantine-data'"));
  assert.ok(main.includes("name: 'Restaurar datos en cuarentena…'"));
  // Registro ANTES del bloque de arranque.
  const cmdIdx = main.indexOf("id: 'restore-quarantine-data'");
  const readyIdx = main.indexOf('onLayoutReady(');
  const maintIdx = main.indexOf('runStartupMaintenance(');
  assert.ok(cmdIdx >= 0 && cmdIdx < readyIdx && readyIdx < maintIdx);
  // Sin new QuarantineManager en el comando (usa el compartido).
  const cmdBlock = main.slice(cmdIdx, readyIdx);
  assert.ok(!cmdBlock.includes('new QuarantineManager'));
  assert.ok(cmdBlock.includes('getQuarantineManager'));
  // Modal enlazado con resultado notificado.
  assert.ok(main.includes('new RestoreQuarantineModal('));
  assert.ok(main.includes('notifyRestoreResult(result, entry)'));
});
