// ============================================================
// PRUEBAS: integridad de almacenes por carpeta (P0-1)
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - Un archivo ausente produce un almacén vacío (primera vez).
// - Un error de lectura o JSON inválido PROPAGA y aborta la
//   escritura: las entradas existentes de otras notas se
//   conservan intactas en disco.
// - Un error de lectura NUNCA se interpreta como almacén vacío.
// - Entradas malformadas de la nota propia se rechazan, no se
//   descartan silenciosamente.
// - Una actualización parcial conserva las entradas ajenas.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

async function loadStorageModules() {
  const result = await build({
    entryPoints: [join(root, 'src', 'storage', 'BoardRepository.ts')],
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
            contents: 'export class App {}\nexport default {};\n',
            loader: 'js'
          }));
        }
      }
    ]
  });

  const code = result.outputFiles[0].text;
  const url =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  const mod = await import(url);
  return mod;
}

const { BoardRepository } = await loadStorageModules();

// Nota: NoteRepository comparte el mismo patrón; se prueba en
// paralelo con un bundle propio para no acoplar los módulos.

async function loadNoteRepository() {
  const result = await build({
    entryPoints: [join(root, 'src', 'storage', 'NoteRepository.ts')],
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
            contents: 'export class App {}\nexport default {};\n',
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
// Adapter falso en memoria (Vault.adapter)
// ------------------------------------------------------------

function createFakeApp() {
  const files = new Map();
  const adapter = {
    failReads: false,
    /** Nº de escrituras fallidas pendientes (P2-1: recuperación). */
    failWrites: 0,
    writeCount: 0,
    async exists(path) {
      return files.has(path);
    },
    async read(path) {
      if (adapter.failReads) {
        throw new Error('EIO simulado');
      }
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT simulado: ${path}`);
      }
      return content;
    },
    async write(path, content) {
      adapter.writeCount++;
      if (adapter.failWrites > 0) {
        adapter.failWrites--;
        throw new Error('EWRITE simulado');
      }
      files.set(path, content);
    },
    async mkdir() {},
    async remove(path) {
      files.delete(path);
    },
    async list() {
      return { files: [...files.keys()], folders: [] };
    }
  };

  return {
    files,
    adapter,
    app: { vault: { adapter } }
  };
}

const BOARD_PATH = 'Libro/.folder-lab/_board.json';
const NOTE_PATH = 'Libro/.folder-lab/_note_context.json';

function boardData(marker) {
  return {
    blocks: [
      {
        id: `block-${marker}`,
        text: `contenido ${marker}`,
        sourceType: 'text',
        x: 0,
        y: 0
      }
    ],
    connections: []
  };
}

// ------------------------------------------------------------
// BoardRepository
// ------------------------------------------------------------

test('archivo ausente: loadFolder devuelve almacén vacío (primera vez)', async () => {
  const { app } = createFakeApp();
  const repo = new BoardRepository(app);

  const store = await repo.loadFolder('Libro');
  assert.deepEqual(store, {});
});

test('varias notas en el mismo almacén: una actualización parcial conserva las entradas ajenas', async () => {
  const { app } = createFakeApp();
  const repo = new BoardRepository(app);

  await repo.saveNote('Libro/A.md', boardData('A'));
  await repo.saveNote('Libro/B.md', boardData('B'));
  await repo.saveNote('Libro/C.md', boardData('C'));

  // Actualizar solo A.
  await repo.saveNote('Libro/A.md', boardData('A-v2'));

  const store = await repo.loadFolder('Libro');
  assert.equal(store['Libro/A.md'].blocks[0].id, 'block-A-v2');
  assert.equal(store['Libro/B.md'].blocks[0].id, 'block-B');
  assert.equal(store['Libro/C.md'].blocks[0].id, 'block-C');
});

test('P0-1: error de lectura al guardar NO borra las entradas existentes', async () => {
  const { app, files } = createFakeApp();
  const repo = new BoardRepository(app);

  await repo.saveNote('Libro/A.md', boardData('A'));
  await repo.saveNote('Libro/B.md', boardData('B'));

  const intactContent = files.get(BOARD_PATH);
  assert.ok(intactContent.includes('block-A'));
  assert.ok(intactContent.includes('block-B'));

  // Fallo de lectura transitorio (p. ej. disco/sync).
  app.vault.adapter.failReads = true;

  await assert.rejects(
    () => repo.saveNote('Libro/C.md', boardData('C')),
    /EIO simulado/
  );

  // El archivo en disco queda INTACTO: ni el fallo ni la
  // escritura abortada tocaron las entradas de A y B.
  assert.equal(files.get(BOARD_PATH), intactContent);
});

test('P0-1: JSON corrupto al guardar NO sustituye el almacén por una única entrada', async () => {
  const { app, files } = createFakeApp();
  const repo = new BoardRepository(app);

  await repo.saveNote('Libro/A.md', boardData('A'));
  await repo.saveNote('Libro/B.md', boardData('B'));

  // Corrupción típica de un write parcial o de un conflicto de sync.
  const corrupted = files.get(BOARD_PATH).slice(0, 40);
  files.set(BOARD_PATH, corrupted);

  await assert.rejects(
    () => repo.saveNote('Libro/A.md', boardData('A-v2')),
    /JSON inválido/
  );

  // El fichero corrupto NO fue reemplazado por un store de una
  // sola entrada (que habría borrado el board de B para siempre).
  assert.equal(files.get(BOARD_PATH), corrupted);
});

test('P0-1: JSON corrupto al cargar también propaga (loadNote)', async () => {
  const { app, files } = createFakeApp();
  const repo = new BoardRepository(app);

  await repo.saveNote('Libro/A.md', boardData('A'));
  files.set(BOARD_PATH, '{ no es json');

  await assert.rejects(
    () => repo.loadNote('Libro/A.md'),
    /JSON inválido/
  );
});

test('P0-1: almacén con forma incorrecta (no objeto) se rechaza', async () => {
  const { app, files } = createFakeApp();
  const repo = new BoardRepository(app);

  files.set(BOARD_PATH, '["un","array"]');

  await assert.rejects(
    () => repo.loadFolder('Libro'),
    /no tiene la forma esperada/
  );
  await assert.rejects(
    () => repo.saveNote('Libro/A.md', boardData('A')),
    /no tiene la forma esperada/
  );
});

test('P0-1: entrada propia malformada se rechaza al cargar, sin descartarla', async () => {
  const { app, files } = createFakeApp();
  const repo = new BoardRepository(app);

  await repo.saveNote('Libro/A.md', boardData('A'));
  await repo.saveNote('Libro/B.md', boardData('B'));

  // La entrada de A queda malformada (blocks no-array).
  const store = JSON.parse(files.get(BOARD_PATH));
  store['Libro/A.md'].blocks = 'roto';
  files.set(BOARD_PATH, JSON.stringify(store));

  await assert.rejects(
    () => repo.loadNote('Libro/A.md'),
    /malformada/
  );

  // B sigue cargando correctamente.
  const b = await repo.loadNote('Libro/B.md');
  assert.equal(b.blocks[0].id, 'block-B');

  // El fichero no fue modificado por el rechazo.
  assert.ok(files.get(BOARD_PATH).includes('"roto"'));
});

test('P0-1: guardar datos inválidos se aborta antes de tocar el disco', async () => {
  const { app, files } = createFakeApp();
  const repo = new BoardRepository(app);

  await repo.saveNote('Libro/A.md', boardData('A'));
  const intact = files.get(BOARD_PATH);

  await assert.rejects(
    () => repo.saveNote('Libro/B.md', { blocks: 'no-array', connections: [] }),
    /blocks/
  );

  assert.equal(files.get(BOARD_PATH), intact);
});

test('viewMode desconocido en una entrada se rechaza (dato malformado)', async () => {
  const { app, files } = createFakeApp();
  const repo = new BoardRepository(app);

  await repo.saveNote('Libro/A.md', boardData('A'));
  const store = JSON.parse(files.get(BOARD_PATH));
  store['Libro/A.md'].viewMode = 'modo-inventado';
  files.set(BOARD_PATH, JSON.stringify(store));

  await assert.rejects(
    () => repo.loadNote('Libro/A.md'),
    /viewMode/
  );
});

// ------------------------------------------------------------
// NoteRepository (mismo contrato P0-1)
// ------------------------------------------------------------

function noteContextData(marker) {
  return {
    widgets: [
      { instanceId: `inst-${marker}`, typeId: 'notes', name: marker }
    ],
    layout: { top: `inst-${marker}`, bottom: '' }
  };
}

test('NoteRepository: P0-1 error de lectura NO borra contextos existentes', async () => {
  const { NoteRepository } = await loadNoteRepository();
  const { app, files } = createFakeApp();
  const repo = new NoteRepository(app);

  await repo.saveNote('Libro/A.md', noteContextData('A'));
  await repo.saveNote('Libro/B.md', noteContextData('B'));

  const intact = files.get(NOTE_PATH);

  app.vault.adapter.failReads = true;

  await assert.rejects(
    () => repo.saveNote('Libro/C.md', noteContextData('C')),
    /EIO simulado/
  );

  assert.equal(files.get(NOTE_PATH), intact);
});

test('NoteRepository: P0-1 JSON corrupto NO sustituye el almacén', async () => {
  const { NoteRepository } = await loadNoteRepository();
  const { app, files } = createFakeApp();
  const repo = new NoteRepository(app);

  await repo.saveNote('Libro/A.md', noteContextData('A'));
  await repo.saveNote('Libro/B.md', noteContextData('B'));

  const corrupted = 'esto no es json {{{';
  files.set(NOTE_PATH, corrupted);

  await assert.rejects(
    () => repo.saveNote('Libro/A.md', noteContextData('A-v2')),
    /JSON inválido/
  );

  assert.equal(files.get(NOTE_PATH), corrupted);
});

test('NoteRepository: deleteNote con almacén ilegible aborta sin tocar el disco', async () => {
  const { NoteRepository } = await loadNoteRepository();
  const { app, files } = createFakeApp();
  const repo = new NoteRepository(app);

  await repo.saveNote('Libro/A.md', noteContextData('A'));
  await repo.saveNote('Libro/B.md', noteContextData('B'));

  files.set(NOTE_PATH, 'corrupto');

  await assert.rejects(
    () => repo.deleteNote('Libro/A.md'),
    /JSON inválido/
  );

  // El delete abortado no reescribe el almacén ilegible.
  assert.equal(files.get(NOTE_PATH), 'corrupto');
});

test('NoteRepository: actualización parcial conserva el contexto de otras notas', async () => {
  const { NoteRepository } = await loadNoteRepository();
  const { app } = createFakeApp();
  const repo = new NoteRepository(app);

  await repo.saveNote('Libro/A.md', noteContextData('A'));
  await repo.saveNote('Libro/B.md', noteContextData('B'));

  await repo.saveNote('Libro/A.md', noteContextData('A-v2'));

  const store = await repo.loadFolder('Libro');
  assert.equal(store['Libro/A.md'].widgets[0].name, 'A-v2');
  assert.equal(store['Libro/B.md'].widgets[0].name, 'B');
});

// ------------------------------------------------------------
// P2-1: serialización de escrituras a nivel de repositorio
// ------------------------------------------------------------

test('BoardRepository: dos RMW concurrentes sobre notas distintas conservan ambas entradas', async () => {
  const { app } = createFakeApp();
  const repo = new BoardRepository(app);

  // Sin cola, ambas lecturas podían leer el mismo store previo y
  // la última escritura borraba la entrada de la otra nota.
  await Promise.all([
    repo.saveNote('Libro/A.md', boardData('A')),
    repo.saveNote('Libro/B.md', boardData('B'))
  ]);

  const store = await repo.loadFolder('Libro');
  assert.equal(store['Libro/A.md'].blocks[0].id, 'block-A');
  assert.equal(store['Libro/B.md'].blocks[0].id, 'block-B');
});

test('BoardRepository: una escritura fallida no bloquea las siguientes', async () => {
  const { app, adapter } = createFakeApp();
  const repo = new BoardRepository(app);

  await repo.saveNote('Libro/A.md', boardData('A'));

  adapter.failWrites = 1;
  await assert.rejects(
    () => repo.saveNote('Libro/B.md', boardData('B')),
    /EWRITE simulado/
  );

  // La cola sigue viva: la siguiente operación funciona.
  await repo.saveNote('Libro/B.md', boardData('B'));
  await repo.saveNote('Libro/C.md', boardData('C'));

  const store = await repo.loadFolder('Libro');
  assert.equal(store['Libro/A.md'].blocks[0].id, 'block-A');
  assert.equal(store['Libro/B.md'].blocks[0].id, 'block-B');
  assert.equal(store['Libro/C.md'].blocks[0].id, 'block-C');
});

test('NoteRepository: dos RMW concurrentes conservan ambas entradas', async () => {
  const { NoteRepository } = await loadNoteRepository();
  const { app } = createFakeApp();
  const repo = new NoteRepository(app);

  await Promise.all([
    repo.saveNote('Libro/A.md', noteContextData('A')),
    repo.saveNote('Libro/B.md', noteContextData('B'))
  ]);

  const store = await repo.loadFolder('Libro');
  assert.equal(store['Libro/A.md'].widgets[0].name, 'A');
  assert.equal(store['Libro/B.md'].widgets[0].name, 'B');
});

test('NoteRepository: una escritura fallida no bloquea las siguientes', async () => {
  const { NoteRepository } = await loadNoteRepository();
  const { app, adapter } = createFakeApp();
  const repo = new NoteRepository(app);

  await repo.saveNote('Libro/A.md', noteContextData('A'));

  adapter.failWrites = 1;
  await assert.rejects(
    () => repo.saveNote('Libro/B.md', noteContextData('B')),
    /EWRITE simulado/
  );

  await repo.saveNote('Libro/B.md', noteContextData('B'));

  const store = await repo.loadFolder('Libro');
  assert.equal(store['Libro/A.md'].widgets[0].name, 'A');
  assert.equal(store['Libro/B.md'].widgets[0].name, 'B');
});
