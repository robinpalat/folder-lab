// ============================================================
// PRUEBAS: Normalización de rutas Master (iconos de estado)
// ============================================================
// Ejecutar con: npm test
//
// Reproduce los casos A–D del diagnóstico: la vista normal (claves
// por currentPath/bookRootPath) y Todas las notas (parent.path)
// deben converger con independencia de barras iniciales/finales en
// la ruta configurada del Master.
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
globalThis.__TFile = TFile;
export class Notice {}
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
  async list(p) {
    const pre = p.endsWith('/') ? p : p + '/';
    return {
      files: [...this.files.keys()].filter((k) => k.startsWith(pre)),
      folders: []
    };
  }
}

/**
 * Simula: carga del orden global con `masterConfig` (ajustes, puede
 * llevar barras) + set/get de estado como lo hacen las vistas
 * (escritura por parent.path limpio; lectura por la clave que
 * indique cada vista).
 */
async function scenario(masterConfig, noteParent, readPath) {
  const { NoteService } = await bundle('src/services/NoteService.ts');
  const { FolderRepository } = await bundle('src/storage/FolderRepository.ts');
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  const repo = new FolderRepository(app);
  await repo.loadGlobalOrder(masterConfig);
  const svc = new NoteService(app, repo, {});
  await svc.setNoteStatus(noteParent, 'a.md', 'draft');
  const got = await svc.getNoteStatus(readPath, 'a.md');
  return got;
}

test('A: master limpio; lectura con la misma ruta que la escritura', async () => {
  assert.equal(
    await scenario('Master/Libro', 'Master/Libro', 'Master/Libro'),
    'draft'
  );
});

test('B (regresión): bookRootPath con / final; currentPath crudo del ajuste', async () => {
  // Antes de la corrección: '' (los estados se partían en dos
  // cubetas: global vs folders). Ahora: 'draft'.
  assert.equal(
    await scenario('Master/Libro/', 'Master/Libro', 'Master/Libro/'),
    'draft'
  );
});

test('C (regresión): Todas las notas lee por parent.path con Master sucio', async () => {
  assert.equal(
    await scenario('Master/Libro/', 'Master/Libro', 'Master/Libro'),
    'draft'
  );
});

test('D (regresión): bookRootPath limpio pero lectura con / inicial', async () => {
  assert.equal(
    await scenario('Master/Libro', 'Master/Libro', '/Master/Libro'),
    'draft'
  );
});

test('E: barra inicial en el Master de ajustes', async () => {
  assert.equal(
    await scenario('/Master/Libro', 'Master/Libro', 'Master/Libro'),
    'draft'
  );
});

test('F: getFolderOrder converge con Master sucio (árbol anidado)', async () => {
  const { FolderRepository } = await bundle('src/storage/FolderRepository.ts');
  const TFolder = globalThis.__TFolder;
  const adapter = new FakeAdapter();
  const masterFolder = new TFolder();
  masterFolder.path = 'Master/Libro';
  masterFolder.name = 'Libro';
  masterFolder.children = [];
  const app = {
    vault: {
      adapter,
      getRoot: () => masterFolder,
      getAbstractFileByPath: (p) =>
        p === 'Master/Libro' || p === 'Master/Libro/' ? masterFolder : null
    }
  };
  const repo = new FolderRepository(app);
  await repo.loadGlobalOrder('Master/Libro/');
  // Contrato: sin orden global no se escribe; se inicializa primero.
  await repo.initGlobalOrder('Master/Libro/', []);
  // Orden de la subcarpeta Capitulo con master sucio.
  await repo.updateFolderOrder('Master/Libro/Capitulo', 'Master/Libro/', [
    'Gamma.md'
  ]);
  const order = await repo.getFolderOrder('Master/Libro/Capitulo', 'Master/Libro/');
  assert.deepEqual(order, ['Gamma.md']);
  // Y con el nombre limpio también.
  const order2 = await repo.getFolderOrder('Master/Libro/Capitulo', 'Master/Libro');
  assert.deepEqual(order2, ['Gamma.md']);
});
