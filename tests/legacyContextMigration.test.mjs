// ============================================================
// PRUEBAS: Migración de _note_context.json a entidades
// ============================================================
// Ejecutar con: npm test
//
// - Migración completa: entradas migradas a Folder Lab/context/
// - Entidad ya existente con mismos datos: already_migrated
// - Entidad existente con datos diferentes: conflicto (sin sobrescribir)
// - Archivo JSON inválido: error, archivo intacto
// - Entrada con ruta inválida: error
// - Nota sin identidad: skipped
// - Segunda ejecución: idempotente, sin duplicaciones
// - Fallo de escritura: error, archivo intacto
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
export class TFile { constructor() { this.path = ''; } }
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
  failWrite = false;
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
    if (this.failWrite) throw new Error('write-fail');
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
const ENTITY_DIR = 'Libro/Folder Lab/context';
const LEGACY_DIR = 'Libro/.folder-lab';

const { LegacyContextMigration } = await bundle(
  'src/storage/legacyContextMigration.ts'
);
const { NoteIdentityRegistry } = await bundle(
  'src/storage/NoteIdentityRegistry.ts'
);
const { EntityFileStore } = await bundle('src/storage/EntityFileStore.ts');

function makeRegistry({ adapter, ids = {} } = {}) {
  // Pre-cargar ids.json en el vault stub para que load() devuelva los IDs
  if (Object.keys(ids).length > 0) {
    adapter.files.set(
      `${MASTER}/Folder Lab/ids.json`,
      JSON.stringify({
        version: 1,
        ids,
        tombstones: {},
        pending: {},
        archived: {}
      })
    );
  }
  const registry = new NoteIdentityRegistry(
    { vault: { adapter } },
    () => MASTER
  );
  return registry;
}

function makeContextStore({ adapter }) {
  return new EntityFileStore(
    { vault: { adapter } },
    {
      subfolder: 'context',
      getRootPath: () => MASTER,
      validate: () => {}
    }
  );
}

function makeApp(adapter) {
  return {
    vault: {
      adapter,
      getFiles: () =>
        [...adapter.files.keys()]
          .filter((p) => p.endsWith('/.folder-lab/_note_context.json'))
          .map((p) => ({ path: p }))
    }
  };
}

function noteData(name = 'Test') {
  return {
    widgets: [
      { instanceId: `memory-${name}-1`, typeId: 'memory', name: 'Assistant' },
      { instanceId: `notes-${name}-1`, typeId: 'notes', name: 'Notes' }
    ],
    layout: {
      top: `notes-${name}-1`,
      bottom: `memory-${name}-1`
    }
  };
}

function legacyStore(entries) {
  return JSON.stringify(entries, null, 2);
}

// Helper: poblar vault con archivos legados
function seedLegacy(adapter, legacyPath, entries) {
  adapter.files.set(legacyPath, legacyStore(entries));
}

test('migración completa: entradas migradas a Folder Lab/context/', async () => {
  const adapter = new FakeAdapter();
  const notePath = `${MASTER}/Nota1.md`;
  const entityId = 'ent001';

  seedLegacy(adapter, `${LEGACY_DIR}/_note_context.json`, {
    [notePath]: noteData('A')
  });

  const registry = makeRegistry({ adapter, ids: { [notePath]: entityId } });
  const contextStore = makeContextStore({ adapter });
  const app = makeApp(adapter);

  const migration = new LegacyContextMigration(app, registry, contextStore);
  const report = await migration.run();

  assert.equal(report.filesProcessed, 1);
  assert.equal(report.totalEntries, 1);
  assert.equal(report.migrated, 1);
  assert.equal(report.errors, 0);

  // Entidad escrita
  const entityPath = `${ENTITY_DIR}/${entityId}.json`;
  assert.ok(adapter.files.has(entityPath), 'entidad creada');
  const entity = JSON.parse(adapter.files.get(entityPath));
  assert.equal(entity.notePath, notePath);
  assert.equal(entity.data.widgets.length, 2);

  // Archivo legado intacto (no se elimina)
  assert.ok(adapter.files.has(`${LEGACY_DIR}/_note_context.json`));
});

test('entidad ya existente con mismos datos: already_migrated', async () => {
  const adapter = new FakeAdapter();
  const notePath = `${MASTER}/Nota1.md`;
  const entityId = 'ent001';

  seedLegacy(adapter, `${LEGACY_DIR}/_note_context.json`, {
    [notePath]: noteData('A')
  });

  // Entidad preexistente con mismos datos
  const entityPath = `${ENTITY_DIR}/${entityId}.json`;
  adapter.files.set(entityPath, JSON.stringify({
    version: 1,
    notePath,
    savedAt: Date.now(),
    data: noteData('A')
  }, null, 2));

  const registry = makeRegistry({ adapter, ids: { [notePath]: entityId } });
  const contextStore = makeContextStore({ adapter });
  const app = makeApp(adapter);

  const migration = new LegacyContextMigration(app, registry, contextStore);
  const report = await migration.run();

  assert.equal(report.alreadyMigrated, 1);
  assert.equal(report.migrated, 0);
});

test('entidad existente con datos diferentes: conflicto sin sobrescribir', async () => {
  const adapter = new FakeAdapter();
  const notePath = `${MASTER}/Nota1.md`;
  const entityId = 'ent001';

  seedLegacy(adapter, `${LEGACY_DIR}/_note_context.json`, {
    [notePath]: noteData('LEGACY')
  });

  // Entidad con datos DIFERENTES
  const existingEntity = {
    version: 1,
    notePath,
    savedAt: Date.now(),
    data: noteData('EXISTING')
  };
  const entityPath = `${ENTITY_DIR}/${entityId}.json`;
  adapter.files.set(entityPath, JSON.stringify(existingEntity, null, 2));

  const registry = makeRegistry({ adapter, ids: { [notePath]: entityId } });
  const contextStore = makeContextStore({ adapter });
  const app = makeApp(adapter);

  const migration = new LegacyContextMigration(app, registry, contextStore);
  const report = await migration.run();

  assert.equal(report.conflicts, 1);
  assert.equal(report.migrated, 0);

  // Entidad NO sobrescrita
  const after = JSON.parse(adapter.files.get(entityPath));
  assert.equal(after.data.widgets[0].name, 'Assistant');
  // Verificar que los datos existentes no fueron tocados
  assert.ok(after.data.widgets.some((w) => w.instanceId.includes('EXISTING')));
});

test('JSON inválido: error, archivo intacto', async () => {
  const adapter = new FakeAdapter();
  adapter.files.set(`${LEGACY_DIR}/_note_context.json`, 'no-es-json{{{');

  const registry = makeRegistry({ adapter });
  const contextStore = makeContextStore({ adapter });
  const app = makeApp(adapter);

  const migration = new LegacyContextMigration(app, registry, contextStore);
  const report = await migration.run();

  assert.equal(report.filesProcessed, 1);
  assert.equal(report.fileResults[0].success, false);
  // Archivo intacto
  assert.equal(adapter.files.get(`${LEGACY_DIR}/_note_context.json`), 'no-es-json{{{');
});

test('entrada con ruta inválida: error', async () => {
  const adapter = new FakeAdapter();
  seedLegacy(adapter, `${LEGACY_DIR}/_note_context.json`, {
    'sin-extension': noteData('X')
  });

  const registry = makeRegistry({ adapter });
  const contextStore = makeContextStore({ adapter });
  const app = makeApp(adapter);

  const migration = new LegacyContextMigration(app, registry, contextStore);
  const report = await migration.run();

  assert.equal(report.errors, 1);
  assert.equal(report.fileResults[0].entries[0].reason, 'Ruta de nota inválida');
});

test('nota sin identidad previa: getId asigna una nueva y la entrada migra', async () => {
  const adapter = new FakeAdapter();
  const notePath = `${MASTER}/SinId.md`;

  seedLegacy(adapter, `${LEGACY_DIR}/_note_context.json`, {
    [notePath]: noteData('NoID')
  });

  // Sin ids.json: getId generará un ID nuevo (comportamiento M3)
  const registry = makeRegistry({ adapter, ids: {} });
  const contextStore = makeContextStore({ adapter });
  const app = makeApp(adapter);

  const migration = new LegacyContextMigration(app, registry, contextStore);
  const report = await migration.run();

  // La entrada se migra con un ID recién generado
  assert.equal(report.migrated, 1);
  assert.equal(report.skipped, 0);

  // Verificar que se creó una entidad
  const entityFiles = [...adapter.files.keys()].filter((f) =>
    f.startsWith(ENTITY_DIR)
  );
  assert.equal(entityFiles.length, 1);
});

test('segunda ejecución: idempotente, sin duplicaciones', async () => {
  const adapter = new FakeAdapter();
  const notePath = `${MASTER}/Nota1.md`;
  const entityId = 'ent001';

  seedLegacy(adapter, `${LEGACY_DIR}/_note_context.json`, {
    [notePath]: noteData('A')
  });

  const registry = makeRegistry({ adapter, ids: { [notePath]: entityId } });
  const contextStore = makeContextStore({ adapter });
  const app = makeApp(adapter);

  const migration = new LegacyContextMigration(app, registry, contextStore);

  const report1 = await migration.run();
  assert.equal(report1.migrated, 1);

  // Segunda ejecución con mismo estado
  const migration2 = new LegacyContextMigration(app, registry, contextStore);
  const report2 = await migration2.run();

  assert.equal(report2.migrated, 0);
  assert.equal(report2.alreadyMigrated, 1);
});

test('fallo de escritura: error, archivo intacto', async () => {
  const adapter = new FakeAdapter();
  adapter.failWrite = true;

  const notePath = `${MASTER}/Nota1.md`;
  const entityId = 'ent001';

  seedLegacy(adapter, `${LEGACY_DIR}/_note_context.json`, {
    [notePath]: noteData('FAIL')
  });

  const registry = makeRegistry({ adapter, ids: { [notePath]: entityId } });
  const contextStore = makeContextStore({ adapter });
  const app = makeApp(adapter);

  const migration = new LegacyContextMigration(app, registry, contextStore);
  const report = await migration.run();

  assert.equal(report.errors, 1);
  // Archivo intacto
  assert.ok(adapter.files.has(`${LEGACY_DIR}/_note_context.json`));
});

test('migración parcial: una entrada migra, otra falla', async () => {
  const adapter = new FakeAdapter();
  const okPath = `${MASTER}/OK.md`;
  const failPath = `${MASTER}/Fail.md`;
  const okId = 'ent-ok';

  seedLegacy(adapter, `${LEGACY_DIR}/_note_context.json`, {
    [okPath]: noteData('OK'),
    'sin-extension': noteData('BAD')
  });

  const registry = makeRegistry({ adapter, ids: { [okPath]: okId } });
  const contextStore = makeContextStore({ adapter });
  const app = makeApp(adapter);

  const migration = new LegacyContextMigration(app, registry, contextStore);
  const report = await migration.run();

  assert.equal(report.totalEntries, 2);
  assert.equal(report.migrated, 1);
  assert.equal(report.errors, 1);

  // La entrada OK migró
  assert.ok(adapter.files.has(`${ENTITY_DIR}/${okId}.json`));
  // Archivo legado intacto (hay errores)
  assert.ok(adapter.files.has(`${LEGACY_DIR}/_note_context.json`));
});
