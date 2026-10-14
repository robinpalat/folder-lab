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
globalThis.__TFile = TFile;
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
