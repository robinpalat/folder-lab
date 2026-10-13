// ============================================================
// PRUEBAS: Stores por entidad — Board y Contexto (Etapa 3)
// ============================================================
// Ejecutar con: npm test
//
// Cubre:
// - Guardar/cargar por entidad con identidad activa.
// - Fallback al store multipath legado + migración perezosa.
// - Aislamiento de hermanos: corromper una entidad no afecta a
//   otras; guardar sobre entidad corrupta PROPAGA sin pisar.
// - Store legado corrupto + entidad presente → la entidad gana.
// - loadFolder fusiona legado + entidades (entidad gana).
// - Sin identidad → comportamiento legado intacto (P0-1).
// - Renombrar (migrateEntry) re-clava el notePath de la entidad.
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
  failReads = false;
  async exists(p) {
    return this.files.has(p) || this.dirs.has(p);
  }
  async mkdir(p) {
    this.dirs.add(p);
  }
  async read(p) {
    if (this.failReads) throw new Error('EIO simulado');
    if (!this.files.has(p)) throw new Error('not found: ' + p);
    return this.files.get(p);
  }
  async write(p, content) {
    this.files.set(p, content);
  }
  async list(p) {
    const prefix = p.endsWith('/') ? p : p + '/';
    const files = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) files.push(key);
    }
    return { files, folders: [] };
  }
}

class FakeHidden {
  files = new Map();
  async readJSON(folder, name) {
    const key = `${folder}/${name}`;
    if (!this.files.has(key)) return null;
    return JSON.parse(this.files.get(key));
  }
  async writeJSON(folder, name, data) {
    this.files.set(`${folder}/${name}`, JSON.stringify(data));
  }
}

const { BoardRepository } = await bundle('src/storage/BoardRepository.ts');
const { NoteRepository } = await bundle('src/storage/NoteRepository.ts');

function boardData(tag) {
  return {
    blocks: [
      { id: `block-${tag}`, x: 0, y: 0, w: 10, h: 10, content: tag }
    ],
    connections: []
  };
}

function contextData() {
  return {
    widgets: [{ typeId: 'notes', instanceId: 'i1', name: 'n' }],
    layout: { top: 'i1', bottom: 'i1' }
  };
}

const MASTER = '/Master';

function makeBoardRepo({ withIdentity = true } = {}) {
  const hidden = new FakeHidden();
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  const ids = new Map();
  const identity = async (p) => {
    if (!ids.has(p)) ids.set(p, 'id-' + Math.random().toString(36).slice(2, 8));
    return ids.get(p);
  };
  const repo = new BoardRepository(
    app,
    withIdentity ? { identity, getRootPath: () => MASTER } : undefined
  );
  // Inyectar el mismo HiddenFolderManager lógico: el repo crea el
  // suyo contra app.vault.adapter; para el store legado usamos
  // adapter directamente con la ruta .folder-lab.
  return { repo, adapter, hidden, ids, app };
}

// El HiddenFolderManager real escribe vía adapter con la ruta
// `<folder>/.folder-lab/<file>`; replicamos esa convención en el
// fake adapter para que repo y test hablen igual.
function legacyBoardPath(folder) {
  return `${folder}/.folder-lab/_board.json`;
}

async function seedLegacyBoard(adapter, folder, store) {
  await adapter.mkdir(`${folder}/.folder-lab`);
  await adapter.write(legacyBoardPath(folder), JSON.stringify(store));
}

test('con identidad: saveNote escribe archivo por entidad', async () => {
  const { repo, adapter } = makeBoardRepo();
  await repo.saveNote('Libro/A.md', boardData('A'));
  const keys = [...adapter.files.keys()].filter((k) =>
    k.startsWith('/Master/Folder Lab/boards/')
  );
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^\/Master\/Folder Lab\/boards\/id-.+\.json$/);
  const loaded = await repo.loadNote('Libro/A.md');
  assert.equal(loaded.blocks[0].content, 'A');
});

test('fallback legado + migración perezosa', async () => {
  const { repo, adapter } = makeBoardRepo();
  await seedLegacyBoard(adapter, 'Libro', {
    'Libro/legacy.md': boardData('legacy')
  });
  const loaded = await repo.loadNote('Libro/legacy.md');
  assert.equal(loaded.blocks[0].content, 'legacy');
  // Tras la primera lectura existe el archivo de entidad.
  const entityKeys = [...adapter.files.keys()].filter((k) =>
    k.startsWith('/Master/Folder Lab/boards/')
  );
  assert.equal(entityKeys.length, 1);
  // Y una segunda lectura sirve desde la entidad.
  const again = await repo.loadNote('Libro/legacy.md');
  assert.equal(again.blocks[0].content, 'legacy');
});

test('entidad corrupta: loadNote propaga; saveNote no pisa', async () => {
  const { repo, adapter } = makeBoardRepo();
  await repo.saveNote('Libro/A.md', boardData('A'));
  await repo.saveNote('Libro/B.md', boardData('B'));
  const keyA = [...adapter.files.keys()].find((k) =>
    k.includes('/boards/')
  );
  // Corromper SOLO la entidad de A (identificar por contenido).
  for (const [k, v] of adapter.files.entries()) {
    if (v.includes('"content": "A"')) {
      adapter.files.set(k, '{ corrupt');
    }
  }
  void keyA;
  await assert.rejects(() => repo.loadNote('Libro/A.md'), /JSON inválido/);
  await assert.rejects(
    () => repo.saveNote('Libro/A.md', boardData('A2')),
    /JSON inválido/
  );
  // B intacto.
  const b = await repo.loadNote('Libro/B.md');
  assert.equal(b.blocks[0].content, 'B');
});

test('store legado corrupto + entidad presente: la entidad gana', async () => {
  const { repo, adapter } = makeBoardRepo();
  await repo.saveNote('Libro/A.md', boardData('nuevo'));
  // Sembrar un store legado corrupto (no debe importar).
  await seedLegacyBoard(adapter, 'Libro', {});
  await adapter.write(legacyBoardPath('Libro'), '{ no es json');
  const loaded = await repo.loadNote('Libro/A.md');
  assert.equal(loaded.blocks[0].content, 'nuevo');
});

test('loadFolder fusiona legado y entidades (entidad gana)', async () => {
  const { repo, adapter } = makeBoardRepo();
  await seedLegacyBoard(adapter, 'Libro', {
    'Libro/legacy.md': boardData('legacy'),
    'Libro/both.md': boardData('legacy-both')
  });
  await repo.saveNote('Libro/both.md', boardData('nuevo-both'));
  await repo.saveNote('Libro/nuevo.md', boardData('nuevo'));
  const store = await repo.loadFolder('Libro');
  assert.equal(store['Libro/legacy.md'].blocks[0].content, 'legacy');
  assert.equal(store['Libro/both.md'].blocks[0].content, 'nuevo-both');
  assert.equal(store['Libro/nuevo.md'].blocks[0].content, 'nuevo');
});

test('sin identidad: P0-1 intacto (store parcial preserva hermanos)', async () => {
  const { repo, adapter } = makeBoardRepo({ withIdentity: false });
  await repo.saveNote('Libro/A.md', boardData('A'));
  await repo.saveNote('Libro/B.md', boardData('B'));
  await repo.saveNote('Libro/A.md', boardData('A-v2'));
  const store = await repo.loadFolder('Libro');
  assert.equal(store['Libro/A.md'].blocks[0].content, 'A-v2');
  assert.equal(store['Libro/B.md'].blocks[0].content, 'B');
});

test('renombrar re-clava el notePath de la entidad', async () => {
  const { repo, adapter, ids } = makeBoardRepo();
  await repo.saveNote('Libro/A.md', boardData('A'));
  // El registro de identidad conserva el id al renombrar (Etapa 1).
  ids.set('Libro/B.md', ids.get('Libro/A.md'));
  await repo.migrateEntry('Libro/A.md', 'Libro/B.md');
  const loaded = await repo.loadNote('Libro/B.md');
  assert.equal(loaded.blocks[0].content, 'A');
  // El sobre refleja la nueva ruta.
  const envelopeKey = [...adapter.files.keys()].find((k) =>
    k.startsWith('/Master/Folder Lab/boards/')
  );
  const envelope = JSON.parse(adapter.files.get(envelopeKey));
  assert.equal(envelope.notePath, 'Libro/B.md');
});

test('NoteRepository: entidad roundtrip y fallback legado', async () => {
  const hidden = new FakeHidden();
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  const ids = new Map([['Nota.md', 'ctx-1']]);
  const repo = new NoteRepository(app, {
    identity: async (p) => ids.get(p) ?? null,
    getRootPath: () => MASTER
  });

  await repo.saveNote('Nota.md', contextData());
  assert.ok(
    [...adapter.files.keys()].some((k) =>
      k.startsWith('/Master/Folder Lab/context/ctx-1.json')
    )
  );
  const loaded = await repo.loadNote('Nota.md');
  assert.equal(loaded.layout.top, 'i1');

  // Fallback legado con id desconocido.
  await adapter.mkdir('Otra/.folder-lab');
  await adapter.write(
    'Otra/.folder-lab/_note_context.json',
    JSON.stringify({ 'Otra/x.md': contextData() })
  );
  const legacy = await repo.loadNote('Otra/x.md');
  assert.equal(legacy.widgets.length, 1);
  void hidden;
});
