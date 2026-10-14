// ============================================================
// PRUEBAS: Auditoría de huérfanos solo lectura (E4a)
// ============================================================
// Ejecutar con: npm test
//
// - Clasificaciones: activo, pending, archived, journal, huérfano
//   con gracia, reciente, ambiguo e ilegible.
// - Determinismo (misma entrada → mismo informe).
// - Ausencia total de escrituras (snapshot del adapter idéntico).
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

const { runOrphanAudit, ORPHAN_GRACE_MS } = await bundle(
  'src/storage/orphanAudit.ts'
);

const BASE = 'Master/Folder Lab';
const NOW = 1_792_000_000_000;

class FakeAdapter {
  files = new Map();
  mtimes = new Map();
  dirs = new Set();
  async exists(p) {
    if (this.files.has(p) || this.dirs.has(p)) return true;
    // Deriva: un directorio existe si hay archivos bajo él.
    const prefix = p.endsWith('/') ? p : p + '/';
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  }
  async read(p) {
    if (!this.files.has(p)) throw new Error('nf ' + p);
    return this.files.get(p);
  }
  async list(p) {
    const pre = p.endsWith('/') ? p : p + '/';
    return {
      files: [...this.files.keys()].filter((k) => k.startsWith(pre)),
      folders: []
    };
  }
  async stat(p) {
    if (!this.files.has(p)) return null;
    return { mtime: this.mtimes.get(p) ?? NOW - 1000 };
  }
}

function seedVault() {
  const adapter = new FakeAdapter();
  const set = (p, obj, mtime = NOW - 48 * 60 * 60 * 1000) => {
    adapter.files.set(p, JSON.stringify(obj));
    adapter.mtimes.set(p, mtime);
  };

  // Registro: activa, pendiente, archivada + huérfana de identidad.
  set(`${BASE}/ids.json`, {
    version: 1,
    ids: {
      'Master/viva.md': 'id-viva',
      'Master/fuera.md': 'id-fuera'
    },
    tombstones: {},
    pending: { 'Master/borrada.md': { id: 'id-pend', deletedAt: 1, detectedAt: 1 } },
    archived: { 'Master/vieja.md': { id: 'id-arch', deletedAt: 1 } }
  });

  // Journal con una operación incompleta que referencia id-jr.
  adapter.files.set(
    `${BASE}/lifecycle-journal.json`,
    JSON.stringify([
      {
        type: 'note-delete',
        oldPath: 'Master/jr.md',
        newPath: 'Master/jr.md',
        noteId: 'id-jr',
        steps: { snapshot: true, pending: false, order: false, file: false },
        startedAt: 1
      }
    ])
  );

  // Datos por identidad.
  set(`${BASE}/boards/id-viva.json`, { notePath: 'Master/viva.md', data: {} });
  set(`${BASE}/drafts/id-pend.json`, { notePath: 'Master/borrada.md', draft: '' });
  set(`${BASE}/polish/id-arch.json`, { notePath: 'Master/vieja.md', data: { versions: [] } });
  set(`${BASE}/context/id-jr.json`, { notePath: 'Master/jr.md', data: {} });

  // Huérfanos reales.
  set(`${BASE}/boards/id-huerfano.json`, { notePath: 'Master/nadie.md', data: {} }); // >24h
  set(
    `${BASE}/drafts/id-reciente.json`,
    { notePath: 'Master/tampoco.md', draft: '' },
    NOW - 60 * 60 * 1000
  ); // <24h
  // Ambiguo: el notePath sí existe como nota.
  set(`${BASE}/context/id-dudo.json`, { notePath: 'Master/viva.md', data: {} });
  // Ilegible.
  adapter.files.set(`${BASE}/polish/id-ilegible.json`, '{ roto');
  adapter.mtimes.set(`${BASE}/polish/id-ilegible.json`, NOW - 48 * 60 * 60 * 1000);

  return adapter;
}

const EXISTING = ['Master/viva.md'];

function makeApp(adapter) {
  return { vault: { adapter } };
}

test('E4a: clasificación completa (activo/pending/archived/journal/candidato/reciente/ambiguo/ilegible)', async () => {
  const adapter = seedVault();
  const report = await runOrphanAudit(makeApp(adapter), () => 'Master', EXISTING, NOW);

  assert.equal(report.activeIdentities, 1, 'solo viva.md tiene nota');
  assert.deepEqual(report.identityOrphans, ['Master/fuera.md']);
  assert.deepEqual(report.pendingIds, ['id-pend']);
  assert.deepEqual(report.archivedIds, ['id-arch']);
  assert.deepEqual(report.journalNoteIds, ['id-jr']);

  // Candidato: solo id-huerfano (gracia cumplida).
  assert.deepEqual(
    report.candidates.map((c) => c.noteId),
    ['id-huerfano']
  );
  assert.ok(report.candidates[0].mtime !== null);

  // Reciente bajo gracia.
  assert.deepEqual(
    report.recentOrphans.map((c) => c.noteId),
    ['id-reciente']
  );

  // Ambiguo: notePath existe como nota.
  assert.deepEqual(
    report.ambiguous.map((c) => c.noteId),
    ['id-dudo']
  );

  // Ilegible conservado.
  assert.deepEqual(report.unreadable, [`${BASE}/polish/id-ilegible.json`]);

  // Los datos referenciados NO aparecen como candidatos.
  for (const id of ['id-viva', 'id-pend', 'id-arch', 'id-jr']) {
    assert.ok(
      !report.candidates.some((c) => c.noteId === id),
      `${id} no es candidato`
    );
  }
});

test('E4a: determinismo — dos ejecuciones producen el mismo informe', async () => {
  const adapter = seedVault();
  const a = await runOrphanAudit(makeApp(adapter), () => 'Master', EXISTING, NOW);
  const b = await runOrphanAudit(makeApp(adapter), () => 'Master', EXISTING, NOW);
  assert.deepEqual(a, b);
});

test('E4a: cero escrituras — el estado del adapter no cambia', async () => {
  const adapter = seedVault();
  const before = JSON.stringify([...adapter.files.entries()].sort());
  const dirsBefore = [...adapter.dirs].sort().join(',');
  await runOrphanAudit(makeApp(adapter), () => 'Master', EXISTING, NOW);
  const after = JSON.stringify([...adapter.files.entries()].sort());
  assert.equal(after, before, 'sin cambios en archivos');
  assert.equal([...adapter.dirs].sort().join(','), dirsBefore, 'sin mkdir');
});

test('E4a: sin Master → informe vacío sin tocar nada', async () => {
  const adapter = seedVault();
  const before = adapter.files.size;
  const report = await runOrphanAudit(makeApp(adapter), () => '', EXISTING, NOW);
  assert.equal(report.candidates.length, 0);
  assert.equal(adapter.files.size, before);
});

test('E4a: la gracia usa 24 horas exactas como umbral', async () => {
  assert.equal(ORPHAN_GRACE_MS, 24 * 60 * 60 * 1000);
  const adapter = new FakeAdapter();
  adapter.files.set(
    `${BASE}/boards/id-x.json`,
    JSON.stringify({ notePath: 'Master/x.md' })
  );
  adapter.mtimes.set(`${BASE}/boards/id-x.json`, NOW - ORPHAN_GRACE_MS);
  const report = await runOrphanAudit(makeApp(adapter), () => 'Master', [], NOW);
  assert.deepEqual(report.candidates.map((c) => c.noteId), ['id-x'], 'umbral incluido');
  adapter.mtimes.set(`${BASE}/boards/id-x.json`, NOW - ORPHAN_GRACE_MS + 1);
  const report2 = await runOrphanAudit(makeApp(adapter), () => 'Master', [], NOW);
  assert.deepEqual(report2.recentOrphans.map((c) => c.noteId), ['id-x']);
});
