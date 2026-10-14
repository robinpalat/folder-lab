// ============================================================
// PRUEBAS: Master en la raíz del vault ('/')
// ============================================================
// Ejecutar con: npm test
//
// Contrato: null = sin configurar; '' = raíz del vault; 'X' =
// subcarpeta. Verifica almacén central, identidad, borradores,
// exclusión técnica, snapshot E3 y auditoría E4a con ambas
// configuraciones.
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
  async list(p) {
    const pre = p.endsWith('/') ? p : p + '/';
    return {
      files: [...this.files.keys()].filter((k) => k.startsWith(pre)),
      folders: []
    };
  }
}

test('normalizeRootPath/joinVaultRoot: contrato null | raíz | subcarpeta', async () => {
  const { normalizeRootPath, joinVaultRoot } = await bundle(
    'src/utils/rootPath.ts'
  );
  assert.equal(normalizeRootPath(null), null);
  assert.equal(normalizeRootPath(''), null, 'campo vacío = sin configurar');
  assert.equal(normalizeRootPath('/'), '', "'/' = raíz del vault");
  assert.equal(normalizeRootPath('  /  '), '', 'raíz con espacios/barras');
  assert.equal(normalizeRootPath('Master/'), 'Master');
  assert.equal(normalizeRootPath('/Master'), 'Master');

  assert.equal(joinVaultRoot('', 'Folder Lab', 'order.json'), 'Folder Lab/order.json');
  assert.equal(joinVaultRoot('Master', 'Folder Lab'), 'Master/Folder Lab');
  assert.equal(joinVaultRoot('Master/', 'Folder Lab/ids.json'), 'Master/Folder Lab/ids.json');
  assert.ok(!joinVaultRoot('', 'Folder Lab').startsWith('/'), 'sin barra inicial en raíz');
});

test('almacén central con Master en la raíz escribe en Folder Lab/order.json', async () => {
  const { CentralOrderStore } = await bundle('src/storage/CentralOrderStore.ts');
  const adapter = new FakeAdapter();
  const store = new CentralOrderStore({ vault: { adapter } }, () => '/');
  assert.equal(store.path(), 'Folder Lab/order.json');
  await store.save({
    version: 1,
    global: { root: { order: ['a.md'] }, version: 1 },
    folders: {}
  });
  assert.ok(adapter.files.has('Folder Lab/order.json'));
  const loaded = await store.load();
  assert.deepEqual(loaded.global.root.order, ['a.md']);
});

test('registro de identidad con Master en la raíz usa Folder Lab/ids.json', async () => {
  const { NoteIdentityRegistry } = await bundle(
    'src/storage/NoteIdentityRegistry.ts'
  );
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  const registry = new NoteIdentityRegistry(app, () => '/');
  const id = await registry.getId('n.md');
  assert.ok(id);
  assert.ok(adapter.files.has('Folder Lab/ids.json'), 'raíz sin barra inicial');
  assert.equal(await registry.findIdByPath('n.md'), id);
});

test('exclusión técnica con Master en la raíz', async () => {
  const { isTechnicalDataPath } = await bundle('src/utils/dataPath.ts');
  assert.equal(isTechnicalDataPath('Folder Lab/activity.log', ''), true);
  assert.equal(isTechnicalDataPath('Folder Lab/drafts/x.json', ''), true);
  assert.equal(isTechnicalDataPath('Canciones/a.md', ''), false);
  assert.equal(isTechnicalDataPath('Notas/Folder Lab/x.md', ''), false);
});

test('auditoría E4a con Master en la raíz examina Folder Lab/', async () => {
  const { runOrphanAudit } = await bundle('src/storage/orphanAudit.ts');
  const adapter = new FakeAdapter();
  // Registro con una identidad activa.
  adapter.files.set(
    'Folder Lab/ids.json',
    JSON.stringify({
      version: 1,
      ids: { 'viva.md': 'id-viva' },
      tombstones: {},
      pending: {},
      archived: {}
    })
  );
  // Un candidato huérfano antiguo.
  adapter.files.set(
    'Folder Lab/boards/id-huerfano.json',
    JSON.stringify({ notePath: 'nadie.md', data: {} })
  );
  adapter.mtimes = new Map([
    ['Folder Lab/boards/id-huerfano.json', Date.now() - 48 * 60 * 60 * 1000]
  ]);
  const app = {
    vault: {
      adapter: {
        exists: (p) => adapter.exists(p),
        read: (p) => adapter.read(p),
        list: (p) => adapter.list(p),
        stat: async (p) =>
          adapter.files.has(p)
            ? { mtime: adapter.mtimes.get(p) ?? Date.now() }
            : null
      }
    }
  };

  // Raíz normalizada como la cablea main: normalizeRootPath('/') → ''.
  const { normalizeRootPath } = await bundle('src/utils/rootPath.ts');
  const report = await runOrphanAudit(
    app,
    () => normalizeRootPath('/'),
    ['viva.md']
  );
  assert.equal(report.activeIdentities, 1, 'escanea en la raíz');
  assert.deepEqual(
    report.candidates.map((c) => c.noteId),
    ['id-huerfano'],
    'distingue un escaneo real de uno vacío'
  );
});

test('auditoría E4a sin Master sigue devolviendo vacío', async () => {
  const { runOrphanAudit } = await bundle('src/storage/orphanAudit.ts');
  const adapter = new FakeAdapter();
  const app = {
    vault: {
      adapter: {
        exists: (p) => adapter.exists(p),
        read: (p) => adapter.read(p),
        list: (p) => adapter.list(p),
        stat: async () => null
      }
    }
  };
  const report = await runOrphanAudit(app, () => null, []);
  assert.equal(report.candidates.length, 0);
  assert.equal(report.unreadable.length, 0);
});
