// ============================================================
// PRUEBAS: Navegación con Master en la raíz (corrección walkFolder)
// ============================================================
// Ejecutar con: npm test
//
// - Árbol de filesystem (sin orden global) en Master raíz: los
//   hijos se parentan al nodo raíz → canGoBack('Canciones') = true
//   (el botón de volver aparece).
// - Folder Lab/ no aparece como carpeta del árbol.
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
export class Notice { constructor(m){ (globalThis.__notices ??= []).push(String(m)); } }
export class Menu { addItem(){return this;} showAtPosition(){} }
export class Modal { constructor(){} open(){} close(){} }
export class FuzzySuggestModal { constructor(){} open(){} close(){} setPlaceholder(){} }
globalThis.__TFolder = TFolder;
globalThis.__TFile = TFile;
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

const { FolderNavigationProvider } = await bundle(
  'src/services/navigation/FolderNavigationProvider.ts'
);
const TFolder = globalThis.__TFolder;
const TFile = globalThis.__TFile;

function makeVault() {
  // Raíz: Canciones/{a.md}, Folder Lab/order.json, nota suelta.
  const canciones = new TFolder();
  canciones.path = 'Canciones';
  canciones.name = 'Canciones';
  const a = new TFile();
  a.path = 'Canciones/a.md';
  a.name = 'a.md';
  a.extension = 'md';
  canciones.children = [a];

  const folderLab = new TFolder();
  folderLab.path = 'Folder Lab';
  folderLab.name = 'Folder Lab';

  const root = new TFolder();
  root.path = '';
  root.name = '';
  root.children = [canciones, folderLab];

  const app = {
    vault: {
      getRoot: () => root,
      getAbstractFileByPath: (p) => {
        const all = [root, canciones, folderLab, a];
        return all.find((f) => f.path === p) ?? null;
      }
    }
  };
  // Sin orden global → build() usa walkFolder (ruta de filesystem).
  const repository = {
    getMasterPath: () => '',
    getGlobalOrder: () => null
  };
  return { app, repository };
}

test('Master raíz + walkFolder: canGoBack es true dentro de Canciones', async () => {
  const { app, repository } = makeVault();
  const provider = new FolderNavigationProvider(app, repository);
  const tree = await provider.build();

  assert.ok(tree.nodeMap.get('Canciones'), 'Canciones en el árbol');
  assert.equal(
    provider.canGoBack('Canciones'),
    true,
    'los hijos del master se parentan al raíz → hay botón de volver'
  );
  // La raíz misma no puede «volver».
  assert.equal(provider.canGoBack(''), false);
});

test('Master raíz + walkFolder: Folder Lab no aparece en el árbol', async () => {
  const { app, repository } = makeVault();
  const provider = new FolderNavigationProvider(app, repository);
  const tree = await provider.build();
  assert.ok(!tree.nodeMap.get('Folder Lab'), 'carpeta técnica excluida');
  assert.ok(tree.nodeMap.get('Canciones'), 'carpeta de usuario presente');
});

// ------------------------------------------------------------
// Orden global (buildFromOrder) con Master en la raíz
// ------------------------------------------------------------

test('buildFromOrder con Master raíz: ids sin barra y canGoBack true', async () => {
  const { TFolder: TF, TFile: TFi } = {
    TFolder: globalThis.__TFolder,
    TFile: globalThis.__TFile
  };
  const canciones = new TF();
  canciones.path = 'Canciones';
  canciones.name = 'Canciones';
  const a = new TFi();
  a.path = 'Canciones/a.md';
  a.name = 'a.md';
  a.extension = 'md';
  canciones.children = [a];
  const root = new TF();
  root.path = '';
  root.name = '';
  root.children = [canciones];

  const app = {
    vault: {
      getRoot: () => root,
      getAbstractFileByPath: (p) => {
        const all = [root, canciones, a];
        return all.find((f) => f.path === p) ?? null;
      }
    }
  };
  const globalOrder = {
    root: { order: ['Canciones'], folders: { Canciones: { order: ['a.md'], folders: {} } } }
  };
  const repository = {
    getMasterPath: () => '',
    getGlobalOrder: () => globalOrder
  };
  const provider = new FolderNavigationProvider(app, repository);
  const tree = await provider.build();

  assert.ok(tree.nodeMap.get('Canciones'), 'id sin barra inicial');
  assert.ok(tree.nodeMap.get('Canciones/a.md'), 'nota anidada con ruta real');
  assert.ok(!tree.nodeMap.get('/Canciones'), 'sin id con barra inicial');
  assert.equal(provider.canGoBack('Canciones'), true, 'volver disponible');
  assert.equal(provider.canGoBack(''), false);
});

test('buildFromOrder con Master en subcarpeta: sin regresiones', async () => {
  const { TFolder: TF, TFile: TFi } = {
    TFolder: globalThis.__TFolder,
    TFile: globalThis.__TFile
  };
  const capitulo = new TF();
  capitulo.path = 'Libro/Capitulo';
  capitulo.name = 'Capitulo';
  const a = new TFi();
  a.path = 'Libro/Capitulo/a.md';
  a.name = 'a.md';
  a.extension = 'md';
  capitulo.children = [a];
  const libro = new TF();
  libro.path = 'Libro';
  libro.name = 'Libro';
  libro.children = [capitulo];

  const app = {
    vault: {
      getAbstractFileByPath: (p) => {
        const all = [libro, capitulo, a];
        return all.find((f) => f.path === p) ?? null;
      }
    }
  };
  const globalOrder = {
    root: {
      order: ['Capitulo'],
      folders: { Capitulo: { order: ['a.md'], folders: {} } }
    }
  };
  const repository = {
    getMasterPath: () => 'Libro',
    getGlobalOrder: () => globalOrder
  };
  const provider = new FolderNavigationProvider(app, repository);
  const tree = await provider.build();
  assert.ok(tree.nodeMap.get('Libro/Capitulo'));
  assert.ok(tree.nodeMap.get('Libro/Capitulo/a.md'));
  assert.equal(provider.canGoBack('Libro/Capitulo'), true);
});

// ------------------------------------------------------------
// Estadísticas con Master en la raíz
// ------------------------------------------------------------

test('StatsService con Master raíz: 0 directas, 8 totales, 1 carpeta (Folder Lab excluida)', async () => {
  const { StatsService } = await bundle('src/services/StatsService.ts');
  const TFolder = globalThis.__TFolder;
  const TFile = globalThis.__TFile;

  const canciones = new TFolder();
  canciones.path = 'Canciones';
  canciones.name = 'Canciones';
  canciones.children = [];
  for (let i = 0; i < 8; i++) {
    const n = new TFile();
    n.path = `Canciones/n${i}.md`;
    n.name = `n${i}.md`;
    n.extension = 'md';
    canciones.children.push(n);
  }
  // Carpeta técnica con un .md (exportación) que NO debe contarse.
  const folderLab = new TFolder();
  folderLab.path = 'Folder Lab';
  folderLab.name = 'Folder Lab';
  const exported = new TFile();
  exported.path = 'Folder Lab/exports/indice.md';
  exported.name = 'indice.md';
  exported.extension = 'md';
  const exportsFolder = new TFolder();
  exportsFolder.path = 'Folder Lab/exports';
  exportsFolder.name = 'exports';
  exportsFolder.children = [exported];
  folderLab.children = [exportsFolder];

  const root = new TFolder();
  root.path = '';
  root.name = '';
  root.children = [canciones, folderLab];

  const app = {
    vault: {
      getRoot: () => root,
      getAbstractFileByPath: () => null
    }
  };
  const service = new StatsService(app, '');
  const direct = service.countDirectNotesAndSubfolders('');
  assert.equal(direct.totalNotes, 0, 'sin notas directas en la raíz');
  assert.equal(direct.totalSubfolders, 1, 'Folder Lab no cuenta como subcarpeta');
  const book = service.countBookNotesAndFolders('');
  assert.equal(book.totalNotes, 8, 'las exportaciones no cuentan como notas');
  assert.equal(book.totalFolders, 1, 'Folder Lab no cuenta como carpeta del libro');
});

test('StatsService con Master en subcarpeta: la carpeta técnica hermana no cuenta', async () => {
  const { StatsService } = await bundle('src/services/StatsService.ts');
  const TFolder = globalThis.__TFolder;
  const TFile = globalThis.__TFile;

  const nota = new TFile();
  nota.path = 'Libro/a.md';
  nota.name = 'a.md';
  nota.extension = 'md';
  const folderLab = new TFolder();
  folderLab.path = 'Libro/Folder Lab';
  folderLab.name = 'Folder Lab';
  const libro = new TFolder();
  libro.path = 'Libro';
  libro.name = 'Libro';
  libro.children = [nota, folderLab];

  const app = {
    vault: {
      getRoot: () => libro,
      getAbstractFileByPath: (p) => (p === 'Libro' ? libro : null)
    }
  };
  const service = new StatsService(app, 'Libro');
  const direct = service.countDirectNotesAndSubfolders('Libro');
  assert.equal(direct.totalSubfolders, 0, 'Folder Lab hermana excluida');
  assert.equal(direct.totalNotes, 1);
});

// ------------------------------------------------------------
// Inicio con Master en la raíz: controller.loadFolder('') carga
// (no es no-op) y emite folderChanged (base de las estadísticas).
// ------------------------------------------------------------

test('controller.loadFolder("") construye el modelo y notifica folderChanged', async () => {
  const { FolderLabController } = await bundle(
    'src/core/FolderLabController.ts'
  );
  const TFolder = globalThis.__TFolder;
  const TFile = globalThis.__TFile;

  const root = new TFolder();
  root.path = '';
  root.name = '';
  const canciones = new TFolder();
  canciones.path = 'Canciones';
  canciones.name = 'Canciones';
  const nota = new TFile();
  nota.path = 'Canciones/n.md';
  nota.name = 'n.md';
  nota.extension = 'md';
  canciones.children = [nota];
  root.children = [canciones];

  const app = {
    vault: {
      getRoot: () => root,
      getAbstractFileByPath: (p) => (p === '' ? root : null),
      on: () => ({}),
      getFileByPath: () => null,
      getMarkdownFiles: () => [nota]
    },
    workspace: { on: () => ({}) }
  };
  const repository = {
    getGlobalOrder: () => null,
    getMasterPath: () => '',
    getFolderOrder: async () => null,
    loadFolderLab: async () => ({ order: [] }),
    transactFolderLab: async (_p, mut) => mut({ order: [] }),
    updateFolderOrder: async () => {}
  };
  const controller = new FolderLabController(app, {}, repository);

  const events = [];
  controller.onStateChange((e) => events.push(e.type));

  await controller.loadFolder('');

  assert.ok(
    events.includes('folderChanged'),
    'folderChanged emitido (antes: no-op con Master raíz)'
  );
  assert.deepEqual(controller.state.items, [], 'sin notas directas en la raíz');
});

// ------------------------------------------------------------
// Raíz: currentPath debe quedar en '' (no null) tras la carga
// ------------------------------------------------------------

test('tras controller.loadFolder("") el currentPath es "" (botones de vista operativos)', async () => {
  const { FolderLabController } = await bundle(
    'src/core/FolderLabController.ts'
  );
  const TFolder = globalThis.__TFolder;
  const root = new TFolder();
  root.path = '';
  root.name = '';
  root.children = [];

  const app = {
    vault: {
      getRoot: () => root,
      getAbstractFileByPath: (p) => (p === '' ? root : null),
      on: () => ({}),
      getFileByPath: () => null,
      getMarkdownFiles: () => []
    },
    workspace: { on: () => ({}) }
  };
  const repository = {
    getGlobalOrder: () => null,
    getMasterPath: () => '',
    getFolderOrder: async () => null,
    loadFolderLab: async () => ({ order: [] }),
    transactFolderLab: async (_p, mut) => mut({ order: [] }),
    updateFolderOrder: async () => {}
  };
  const controller = new FolderLabController(app, {}, repository);
  await controller.loadFolder('');
  assert.equal(
    controller.getCurrentPath(),
    '',
    'currentPath en la raíz: "" y no null (los botones de vista lo comprueban con !== null)'
  );
});

test('NavigationService.navigateTo acepta la raíz ("")', async () => {
  const { NavigationService } = await bundle(
    'src/services/NavigationService.ts'
  );
  const app = { vault: { on: () => ({}) }, workspace: { on: () => ({}) } };
  const repo = {};
  const svc = new NavigationService(app, repo, {});
  svc.navigateTo('');
  assert.equal(svc.getCurrentPath(), '', 'raíz registrada');
  svc.navigateTo('Notas');
  assert.equal(svc.getCurrentPath(), 'Notas');
  svc.navigateTo(null);
  assert.equal(svc.getCurrentPath(), 'Notas', 'null no cambia el estado');
});
