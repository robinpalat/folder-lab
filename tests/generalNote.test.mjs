// ============================================================
// PRUEBAS: Nota General única en Folder Lab/
// ============================================================
// Ejecutar con: npm test
//
// - La Nota General se almacena en Folder Lab/_nota_general.txt
// - No se crean Notas Generales en subcarpetas
// - Lectura/escritura siempre van a la misma ubicación central
// - Compatibilidad de lectura con ubicación legada del master
// - Contenido del master se conserva íntegro
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

const MASTER = 'Libro';
const CENTRAL = `${MASTER}/Folder Lab/_nota_general.txt`;
const LEGACY_MASTER = `${MASTER}/.folder-lab/_nota_general.txt`;

const { NoteService } = await bundle('src/services/NoteService.ts');
const { FolderRepository } = await bundle('src/storage/FolderRepository.ts');

function makeService({ adapter, master = MASTER }) {
  const app = {
    vault: {
      adapter,
      getAbstractFileByPath: () => null
    }
  };
  const repo = new FolderRepository(app);
  const svc = new NoteService(app, repo, { bookRootPath: master });
  return { svc, adapter };
}

test('Nota General se almacena en Folder Lab/_nota_general.txt', async () => {
  const { svc, adapter } = makeService({ adapter: new FakeAdapter() });

  await svc.saveGeneralNote('Contenido de prueba');

  assert.ok(adapter.files.has(CENTRAL), 'existe en Folder Lab/');
  assert.equal(adapter.files.get(CENTRAL), 'Contenido de prueba');
});

test('no se crean Notas Generales en subcarpetas', async () => {
  const { svc, adapter } = makeService({ adapter: new FakeAdapter() });

  await svc.saveGeneralNote('Contenido');

  // Solo existe la central, ninguna en subcarpeta
  const files = [...adapter.files.keys()];
  const subfolderGenerals = files.filter(
    (f) => f.includes('.folder-lab') && f.includes('_nota_general')
  );
  assert.equal(subfolderGenerals.length, 0, 'sin notas en .folder-lab/');

  const centralFiles = files.filter(
    (f) => f.includes('Folder Lab') && f.includes('_nota_general')
  );
  assert.equal(centralFiles.length, 1, 'solo una central');
});

test('lectura siempre devuelve la misma ubicación central', async () => {
  const { svc, adapter } = makeService({ adapter: new FakeAdapter() });

  await svc.saveGeneralNote('Valor central');

  const content = await svc.loadGeneralNote();
  assert.equal(content, 'Valor central');
});

test('compatibilidad de lectura con ubicación legada del master', async () => {
  const adapter = new FakeAdapter();
  // Solo existe la legada del master (sin central)
  adapter.files.set(LEGACY_MASTER, 'Contenido legado');

  const { svc } = makeService({ adapter });
  const content = await svc.loadGeneralNote();

  assert.equal(content, 'Contenido legado', 'lee del legado del master');
});

test('centralizada prevalece sobre legada si ambas existen', async () => {
  const adapter = new FakeAdapter();
  adapter.files.set(LEGACY_MASTER, 'Legado');
  adapter.files.set(CENTRAL, 'Central');

  const { svc } = makeService({ adapter });
  const content = await svc.loadGeneralNote();

  assert.equal(content, 'Central', 'gana la central');
});

test('contenido del master se conserva íntegro', async () => {
  const adapter = new FakeAdapter();
  const original = 'dfgfgdffg';
  adapter.files.set(LEGACY_MASTER, original);

  const { svc } = makeService({ adapter });
  const content = await svc.loadGeneralNote();

  assert.equal(content, original, 'contenido intacto');
});

test('sin master configurado: loadGeneralNote devuelve vacío', async () => {
  const { svc } = makeService({ adapter: new FakeAdapter(), master: '' });
  const content = await svc.loadGeneralNote();
  assert.equal(content, '');
});

test('sin master configurado: saveGeneralNote lanza error', async () => {
  const { svc } = makeService({ adapter: new FakeAdapter(), master: '' });
  await assert.rejects(
    () => svc.saveGeneralNote('x'),
    /Sin carpeta master configurada/
  );
});

test('segunda escritura no duplica archivos', async () => {
  const { svc, adapter } = makeService({ adapter: new FakeAdapter() });

  await svc.saveGeneralNote('Primero');
  await svc.saveGeneralNote('Segundo');

  const files = [...adapter.files.keys()];
  const generals = files.filter((f) => f.includes('_nota_general'));
  assert.equal(generals.length, 1, 'solo un archivo');
  assert.equal(generals[0], CENTRAL);
  assert.equal(adapter.files.get(CENTRAL), 'Segundo');
});
