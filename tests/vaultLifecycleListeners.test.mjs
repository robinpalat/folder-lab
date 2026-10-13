// ============================================================
// PRUEBAS: Listeners de ciclo de vida del plugin (E2)
// ============================================================
// Ejecutar con: npm test
//
// Cubre:
// - Los listeners viven en el PLUGIN (no en la vista): reaccionan
//   con la «vista cerrada» (simulada: ningún consumidor de vista).
// - delete → id pendiente; rename → migración; create → sin
//   auto-reclamo + aviso si hay pendientes.
// - Limpieza: registerEvent registra disposers (unload del plugin).
// - Rutas técnicas (.folder-lab y Folder Lab/) ignoradas.
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
export class TFile { constructor(path) { this.path = path; this.name = path.split('/').pop(); } }
export class TFolder { constructor(path) { this.path = path; this.name = path.split('/').pop(); } }
export class Notice { constructor(msg) { globalThis.__notices.push(String(msg)); } }
globalThis.__notices = [];
globalThis.__TFolder = TFolder;
globalThis.__TFile = TFile;
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

function makeFakePlugin() {
  const handlers = { create: [], delete: [], rename: [] };
  const disposers = [];
  const plugin = {
    app: {
      vault: {
        on: (event, cb) => {
          handlers[event].push(cb);
          return { event, cb };
        }
      }
    },
    registerEvent: (ref) => {
      disposers.push(() => {
        const list = handlers[ref.event];
        const idx = list.indexOf(ref.cb);
        if (idx >= 0) list.splice(idx, 1);
      });
    }
  };
  return { plugin, handlers, disposers };
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
const { NoteLifecycle } = await bundle('src/storage/NoteLifecycle.ts');
const { registerLifecycleListeners } = await bundle(
  'src/storage/vaultLifecycleListeners.ts'
);
const TFile = globalThis.__TFile;
const TFolder = globalThis.__TFolder;

function makeSystem() {
  const hidden = new FakeHidden();
  const registry = new NoteIdentityRegistry({}, () => 'Master', hidden);
  const boards = {
    migrateEntry: async () => {},
    migrateFolderPrefix: async () => {}
  };
  const context = {
    migrateEntry: async () => {},
    migrateFolderPrefix: async () => {}
  };
  const lifecycle = new NoteLifecycle({
    registry,
    boards,
    context,
    vaultId: 'vid',
    storage: null
  });
  const { plugin, handlers, disposers } = makeFakePlugin();
  registerLifecycleListeners(plugin, lifecycle, registry, () => 'Master');
  return { registry, lifecycle, handlers, disposers, hidden };
}

async function flush() {
  await new Promise((r) => setTimeout(r, 10));
}

test('listeners en el plugin: delete crea pendiente con la vista «cerrada»', async () => {
  const { registry, handlers } = makeSystem();
  const id = await registry.getId('n.md');
  assert.ok(id);

  // Vista cerrada: nadie más consume los eventos; solo el plugin.
  for (const cb of handlers.delete) {
    cb(new TFile('n.md'));
  }
  await flush();

  const pending = await registry.getPendingFor('n.md');
  assert.equal(pending.length, 1, 'pendiente creada por el listener');
  assert.equal(pending[0].id, id);
});

test('listeners: rename dispara la migración del ciclo de vida', async () => {
  const { registry, handlers } = makeSystem();
  const id = await registry.getId('viejo.md');
  for (const cb of handlers.rename) {
    cb(new TFile('nuevo.md'), 'viejo.md');
  }
  await flush();
  assert.equal(await registry.findIdByPath('nuevo.md'), id);
  assert.equal(await registry.findIdByPath('viejo.md'), null);
});

test('listeners: create no auto-reclama y avisa si hay pendientes', async () => {
  globalThis.__notices.length = 0;
  const { registry, handlers } = makeSystem();
  await registry.getId('n.md');
  await registry.onDeleted('n.md');

  for (const cb of handlers.create) {
    cb(new TFile('n.md'));
  }
  await flush();

  // Sin auto-reclamo: la ruta queda sin id activo.
  assert.equal(await registry.findIdByPath('n.md'), null);
  // Aviso con instrucción de comando.
  assert.ok(
    globalThis.__notices.some((m) => m.includes('reclamar datos de nota'))
  );
});

test('listeners: rutas técnicas ignoradas (.folder-lab y Folder Lab/)', async () => {
  const { registry, handlers } = makeSystem();
  await registry.getId('Master/Folder Lab/exports/x.md');
  for (const cb of handlers.delete) {
    cb(new TFile('Master/Folder Lab/exports/x.md'));
  }
  for (const cb of handlers.delete) {
    cb(new TFile('Master/.folder-lab/ids.json'));
  }
  await flush();
  // Sin pendientes: la identidad activa NO se tocó.
  assert.ok(await registry.findIdByPath('Master/Folder Lab/exports/x.md'));
});

test('limpieza: los disposers de registerEvent desregistran los handlers', async () => {
  const { handlers, disposers } = makeSystem();
  const total = handlers.create.length + handlers.delete.length + handlers.rename.length;
  assert.equal(total, 3);
  for (const dispose of disposers) dispose();
  assert.equal(handlers.create.length, 0);
  assert.equal(handlers.delete.length, 0);
  assert.equal(handlers.rename.length, 0);
});
