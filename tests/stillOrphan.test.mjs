// ============================================================
// PRUEBAS: stillOrphan integrado con fuentes reales (E4b)
// ============================================================
// Ejecutar con: npm test
//
// Fixtures aislados (sin bóvedas reales). Cubre:
// - candidato realmente elegible;
// - identidad reclamada entre auditoría y cuarentena;
// - pendientes y archivados;
// - referencia del diario;
// - error de lectura del diario (conservador);
// - ciclo completo cuarentena → restauración;
// - verificación de que nada se activa en el arranque.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

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

const { NoteIdentityRegistry } = await bundle(
  'src/storage/NoteIdentityRegistry.ts'
);
const { QuarantineManager } = await bundle('src/storage/quarantine.ts');
const { createStillOrphanPredicate } = await bundle(
  'src/storage/stillOrphan.ts'
);

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
  async remove(p) {
    this.files.delete(p);
  }
}

const CANDIDATE = {
  path: 'Master/Folder Lab/boards/id-huerfano.json',
  noteId: 'id-huerfano',
  subfolder: 'boards',
  reason: 'id ausente (fixture)',
  mtime: Date.now()
};
const CONTENT = JSON.stringify({ version: 1, notePath: 'nadie.md', data: {} });

function makeSystem() {
  const hidden = new FakeHidden();
  const adapter = new FakeAdapter();
  const registry = new NoteIdentityRegistry({}, () => 'Master', hidden);
  const app = { vault: { adapter } };
  const stillOrphan = createStillOrphanPredicate(app, registry, () => 'Master');
  const manager = new QuarantineManager(app, () => 'Master', stillOrphan);
  adapter.files.set(CANDIDATE.path, CONTENT);
  return { hidden, adapter, registry, manager, stillOrphan };
}

test('S1: candidato realmente elegible → huérfano y en cuarentena', async () => {
  const { manager, stillOrphan } = makeSystem();
  assert.equal(await stillOrphan('id-huerfano'), true);
  const result = await manager.quarantine(CANDIDATE);
  assert.equal(result.status, 'quarantined');
});

test('S2: identidad reclamada entre auditoría y cuarentena → skipped', async () => {
  const { manager, registry } = makeSystem();
  // La nota reaparece y obtiene identidad activa (claim o nueva).
  await registry.getId('nadie.md');
  // Simular que el id huérfano es ahora el de la nota (reclamo).
  await registry.onDeleted('nadie.md');
  await registry.claim('nadie.md');
  // Mismo id de la nota activa que el del candidato:
  const activeId = await registry.findIdByPath('nadie.md');
  assert.ok(activeId);

  const result = await manager.quarantine({ ...CANDIDATE, noteId: activeId });
  assert.equal(result.status, 'skipped');
  assert.ok(result.reason.includes('revalidación'));
});

test('S3: id pendiente o archivado → no huérfano', async () => {
  const { stillOrphan, registry, hidden } = makeSystem();
  // Pendiente (vía API pública: el id pendiente es el generado).
  await registry.getId('x.md');
  await registry.onDeleted('x.md');
  const pending = await registry.listAllPending();
  assert.equal(pending.length, 1);
  assert.equal(await stillOrphan(pending[0].id), false, 'pendiente bloquea');

  // Archivado (sembrado y recargado con instancia fresca = arranque).
  const file = hidden.files.get('Master/ids.json');
  file.archived = { 'y.md': { id: 'mv-arch', deletedAt: 1 } };
  const fresh = new NoteIdentityRegistry({}, () => 'Master', hidden);
  const { QuarantineManager: QM } = { QuarantineManager: null };
  void QM;
  const { createStillOrphanPredicate: create2 } = await bundle(
    'src/storage/stillOrphan.ts'
  );
  const still2 = create2({ vault: { adapter: { exists: async () => false } } }, fresh, () => 'Master');
  assert.equal(await still2('mv-arch'), false, 'archivado bloquea');
});

test('S4: referencia en el journal → no huérfano', async () => {
  const { stillOrphan, adapter } = makeSystem();
  await adapter.mkdir('Master/Folder Lab');
  await adapter.write(
    'Master/Folder Lab/lifecycle-journal.json',
    JSON.stringify([
      {
        type: 'note-delete',
        oldPath: 'a.md',
        newPath: 'a.md',
        noteId: 'id-jr',
        steps: { snapshot: false, pending: false, order: false, file: false },
        startedAt: 1
      }
    ])
  );
  assert.equal(await stillOrphan('id-jr'), false, 'journal bloquea');
  assert.equal(await stillOrphan('id-huerfano'), true, 'los demás siguen elegibles');
});

test('S5: journal ilegible → el predicado PROPAGA (conservador)', async () => {
  const { stillOrphan, adapter } = makeSystem();
  await adapter.mkdir('Master/Folder Lab');
  await adapter.write('Master/Folder Lab/lifecycle-journal.json', '{ roto');
  await assert.rejects(() => stillOrphan('id-huerfano'));
});

test('S6: ciclo completo cuarentena → restauración con verificación', async () => {
  const { manager, adapter, stillOrphan } = makeSystem();
  const q = await manager.quarantine(CANDIDATE);
  assert.equal(q.status, 'quarantined');
  assert.equal(adapter.files.has(CANDIDATE.path), false, 'original retirado');

  const restored = await manager.restore(q.entry.entryId);
  assert.equal(restored.status, 'restored');
  assert.equal(adapter.files.get(CANDIDATE.path), CONTENT, 'contenido idéntico');
  assert.equal(await stillOrphan('id-huerfano'), true, 'sigue sin identidad');
});

test('S7: la integración NO se ejecuta en el arranque', () => {
  // Verificación estática: ni startupMaintenance ni main importan
  // stillOrphan/createStillOrphanPredicate (solo el futuro activador).
  const maintenance = readFileSync(
    join(root, 'src/storage/startupMaintenance.ts'),
    'utf8'
  );
  const main = readFileSync(join(root, 'src/main.ts'), 'utf8');
  assert.ok(!maintenance.includes('stillOrphan'));
  assert.ok(!main.includes('stillOrphan'));
  assert.ok(!main.includes('QuarantineManager'));
});

// ------------------------------------------------------------
// Coherencia de la caché (misma instancia, sin reinstanciar)
// ------------------------------------------------------------

test('S8: coherencia en la misma instancia — getId/onDeleted/claim vs stillOrphan', async () => {
  const { stillOrphan, registry } = makeSystem();
  // Activa → no huérfano.
  const id = await registry.getId('viva.md');
  assert.equal(await stillOrphan(id), false, 'activa bloquea');
  // Borrada → pendiente → no huérfano.
  await registry.onDeleted('viva.md');
  assert.equal(await stillOrphan(id), false, 'pendiente bloquea');
  // Reclamada (misma instancia) → activa otra vez → no huérfano.
  const claim = await registry.claim('viva.md', 'pending');
  assert.equal(claim.status, 'claimed');
  assert.equal(await stillOrphan(id), false, 'reclamada bloquea');
});

test('S9: refresh() incorpora cambios EXTERNOS de ids.json (sync/u otro dispositivo)', async () => {
  const { stillOrphan, registry, hidden } = makeSystem();
  // Estado inicial del registro en disco (aún sin ids activos).
  hidden.files.set(
    'Master/ids.json',
    { version: 1, ids: {}, tombstones: {}, pending: {}, archived: {} }
  );
  // Huérfano según la caché actual.
  assert.equal(await stillOrphan('id-huerfano'), true);

  // Escritura EXTERNA: el id pasa a estar activo (otro dispositivo).
  const file = hidden.files.get('Master/ids.json');
  file.ids['nota-nueva.md'] = 'id-huerfano';

  // Caché vieja: aún diría huérfano (coherente con el contrato).
  assert.equal(await stillOrphan('id-huerfano'), true);

  // Tras refresh() (la futura pasarela de activación lo llamaría):
  registry.refresh();
  assert.equal(await stillOrphan('id-huerfano'), false, 'ya no huérfano');
});
