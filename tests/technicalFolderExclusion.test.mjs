// ============================================================
// PRUEBAS: Exclusión de la carpeta técnica Folder Lab/ (E1)
// ============================================================
// Ejecutar con: npm test
//
// Cubre:
// - Normalización de rutas (barras iniciales/finales).
// - Raíz configurada vs ausente (sin Master → sin exclusión).
// - Descendientes de la raíz técnica excluidos.
// - Falsos positivos: "Folder Lab" en otra ubicación NO se excluye.
// - FolderNavigationProvider: la carpeta técnica no aparece en el
//   árbol (walkFolder y orden explícito).
// - WordCountService: no cuenta exportaciones de Folder Lab/exports.
// - StatsService: ceros para la carpeta técnica.
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
export class TFile {
  constructor(path) {
    this.path = path;
    this.extension = path.split('.').pop();
    this.name = path.split('/').pop();
  }
}
export class TFolder {
  constructor(path) {
    this.path = path;
    this.name = path.split('/').pop();
    this.children = [];
  }
}
globalThis.__TFolder = TFolder;
globalThis.__TFile = TFile;
export default {};
export class FileSystemAdapter { getBasePath() { return '/stub'; } }
`;

function obsidianClasses() {
  return {
    TFolder: globalThis.__TFolder,
    TFile: globalThis.__TFile
  };
}

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

// ------------------------------------------------------------
// 1. dataPath (unit)
// ------------------------------------------------------------

test('technicalDataRoot: normaliza el Master configurado', async () => {
  const { technicalDataRoot } = await bundle('src/utils/dataPath.ts');
  assert.equal(technicalDataRoot('Master'), 'Master/Folder Lab');
  assert.equal(technicalDataRoot('Master/'), 'Master/Folder Lab');
  assert.equal(technicalDataRoot('/Master'), 'Master/Folder Lab');
  assert.equal(technicalDataRoot('  /Master/  '), 'Master/Folder Lab');
  assert.equal(technicalDataRoot('Libros/Mi Libro'), 'Libros/Mi Libro/Folder Lab');
  // '' ahora significa RAÍZ DEL VAULT (configuración válida '/').
  assert.equal(technicalDataRoot(''), 'Folder Lab');
  // null = sin configurar.
  assert.equal(technicalDataRoot(null), null);
  assert.equal(technicalDataRoot(undefined), null);
});

test('isTechnicalDataPath: raíz y descendientes; falsos positivos', async () => {
  const { isTechnicalDataPath } = await bundle('src/utils/dataPath.ts');
  // La raíz y sus hijos SÍ son técnicos.
  assert.equal(isTechnicalDataPath('Master/Folder Lab', 'Master'), true);
  assert.equal(isTechnicalDataPath('Master/Folder Lab/exports', 'Master'), true);
  assert.equal(isTechnicalDataPath('Master/Folder Lab/exports/indice-a.md', 'Master'), true);
  assert.equal(isTechnicalDataPath('Master/Folder Lab/drafts/id1.json', 'Master/'), true);
  // Falsos positivos: otras ubicaciones con el mismo nombre.
  assert.equal(isTechnicalDataPath('Notas/Folder Lab', 'Master'), false);
  assert.equal(isTechnicalDataPath('Folder Lab', 'Master'), false);
  assert.equal(isTechnicalDataPath('Master/Folder Labues', 'Master'), false);
  assert.equal(isTechnicalDataPath('Master/Folder', 'Master'), false);
  // Sin Master: nada es técnico (no se oculta nada a ciegas).
  assert.equal(isTechnicalDataPath('Master/Folder Lab', ''), false);
  assert.equal(isTechnicalDataPath('Master/Folder Lab', null), false);
  // Rutas normales del usuario.
  assert.equal(isTechnicalDataPath('Master/Notas/a.md', 'Master'), false);
});

// ------------------------------------------------------------
// 2. FolderNavigationProvider (integración)
// ------------------------------------------------------------

test('FolderNavigationProvider: excluye Folder Lab del árbol (walkFolder)', async () => {
  const mod = await bundle('src/services/navigation/FolderNavigationProvider.ts');
  const { FolderNavigationProvider } = mod;
  const { TFolder, TFile } = obsidianClasses();

  const master = new TFolder('Master');
  const notas = new TFolder('Master/Notas');
  const tecnica = new TFolder('Master/Folder Lab');
  const exports_ = new TFolder('Master/Folder Lab/exports');
  const exportFile = new TFile('Master/Folder Lab/exports/indice-a.md');
  const note = new TFile('Master/Notas/a.md');
  exports_.children.push(exportFile);
  tecnica.children.push(exports_);
  master.children.push(notas, tecnica, note);

  const app = {
    vault: {
      getAbstractFileByPath: (p) => {
        const all = [master, notas, tecnica, exports_, exportFile, note];
        return all.find((f) => f.path === p) ?? null;
      }
    }
  };
  const repository = {
    getMasterPath: () => 'Master',
    getGlobalOrder: () => null
  };
  const provider = new FolderNavigationProvider(app, repository);
  const tree = await provider.build();
  const paths = tree.flatNodes.map((n) => n.path);
  assert.ok(paths.includes('Master/Notas'), 'carpeta de usuario presente');
  assert.ok(paths.includes('Master/Notas/a.md'), 'nota presente');
  assert.ok(
    !paths.some((p) => p.startsWith('Master/Folder Lab')),
    'carpeta técnica ausente del árbol'
  );
});

test('FolderNavigationProvider: excluye Folder Lab del orden explícito', async () => {
  const mod = await bundle('src/services/navigation/FolderNavigationProvider.ts');
  const { FolderNavigationProvider } = mod;
  const { TFolder, TFile } = obsidianClasses();

  const master = new TFolder('Master');
  const tecnica = new TFolder('Master/Folder Lab');
  const note = new TFile('Master/a.md');
  master.children.push(tecnica, note);

  const app = {
    vault: {
      getAbstractFileByPath: (p) => {
        const all = [master, tecnica, note];
        return all.find((f) => f.path === p) ?? null;
      }
    }
  };
  const globalOrder = {
    root: {
      order: ['a.md', 'Folder Lab'],
      folders: { 'Folder Lab': { order: [] } }
    }
  };
  const repository = {
    getMasterPath: () => 'Master',
    getGlobalOrder: () => globalOrder
  };
  const provider = new FolderNavigationProvider(app, repository);
  const tree = await provider.build();
  const paths = tree.flatNodes.map((n) => n.path);
  assert.ok(paths.includes('Master/a.md'));
  assert.ok(!paths.includes('Master/Folder Lab'));
});

// ------------------------------------------------------------
// 3. WordCountService (integración)
// ------------------------------------------------------------

test('WordCountService: no cuenta exportaciones de Folder Lab/exports', async () => {
  const { WordCountService } = await bundle('src/services/WordCountService.ts');
  const { TFolder, TFile } = obsidianClasses();

  const master = new TFolder('Master');
  const nota = new TFile('Master/a.md');
  const tecnica = new TFolder('Master/Folder Lab');
  const exports_ = new TFolder('Master/Folder Lab/exports');
  const exportFile = new TFile('Master/Folder Lab/exports/indice-a.md');
  exports_.children.push(exportFile);
  tecnica.children.push(exports_);
  master.children.push(nota, tecnica);

  const app = {
    vault: {
      getAbstractFileByPath: (p) => {
        const all = [master, nota, tecnica, exports_, exportFile];
        return all.find((f) => f.path === p) ?? null;
      },
      read: async (f) => (f.path.endsWith('.md') ? 'uno dos tres palabras' : '')
    }
  };
  const service = new WordCountService(app, 'Master');
  const result = await service.countWordsInFolder('Master');
  // Solo la nota del usuario (3 palabras); el export NO cuenta.
  assert.equal(result.totalNotes, 1);
  assert.ok(!result.details.some((d) => d.name.includes('indice-')));
});

// ------------------------------------------------------------
// 4. StatsService (integración)
// ------------------------------------------------------------

test('StatsService: la carpeta técnica devuelve ceros y sus .md no cuentan', async () => {
  const { StatsService } = await bundle('src/services/StatsService.ts');
  const { TFolder, TFile } = obsidianClasses();

  const master = new TFolder('Master');
  const nota = new TFile('Master/a.md');
  const tecnica = new TFolder('Master/Folder Lab');
  const mdTecnico = new TFile('Master/Folder Lab/exports/x.md');
  master.children.push(nota, tecnica);

  const app = {
    vault: {
      getAbstractFileByPath: (p) => {
        const all = [master, nota, tecnica, mdTecnico];
        return all.find((f) => f.path === p) ?? null;
      },
      read: async () => 'contenido'
    }
  };
  const service = new StatsService(app, 'Master');

  const tec = await service.calculateStats('Master/Folder Lab');
  assert.equal(tec.totalNotes, 0);

  const masterStats = await service.calculateStats('Master');
  assert.equal(masterStats.totalNotes, 1, 'solo la nota del usuario');
});

// ------------------------------------------------------------
// shouldReloadFolderOnModify (Corrección del render innecesario)
// ------------------------------------------------------------

test('modify del log de actividad NO recarga la lista (causa del parpadeo)', async () => {
  const { shouldReloadFolderOnModify } = await bundle('src/utils/dataPath.ts');
  // Escenario reproducido: vista en master (Todas las notas/Recientes);
  // abrir una nota dispara record() → append de activity.log →
  // vault modify → antes reconstruía la lista.
  assert.equal(
    shouldReloadFolderOnModify(
      'Master/Folder Lab/activity.log',
      'Master',
      'Master'
    ),
    false
  );
});

test('modify de datos técnicos (borradores/ids/entidades) NO recarga', async () => {
  const { shouldReloadFolderOnModify } = await bundle('src/utils/dataPath.ts');
  for (const path of [
    'Master/Folder Lab/drafts/id1.json',
    'Master/Folder Lab/ids.json',
    'Master/Folder Lab/boards/id2.json',
    'Master/.folder-lab/_folder_order.json'
  ]) {
    assert.equal(shouldReloadFolderOnModify(path, 'Master', 'Master'), false, path);
  }
});

test('modify de una nota REAL bajo la carpeta actual SÍ recarga', async () => {
  const { shouldReloadFolderOnModify } = await bundle('src/utils/dataPath.ts');
  assert.equal(
    shouldReloadFolderOnModify('Master/Notas/a.md', 'Master/Notas', 'Master'),
    true
  );
  // Fuera de la carpeta actual: no recarga.
  assert.equal(
    shouldReloadFolderOnModify('Otra/b.md', 'Master/Notas', 'Master'),
    false
  );
});
