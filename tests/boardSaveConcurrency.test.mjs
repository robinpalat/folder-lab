// ============================================================
// CONCURRENCIA del guardado de Board (P2-1 — corregido)
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - Las escrituras de un mismo almacén se aplican en FIFO:
//   dos saveNote no terminan aplicadas en orden inverso.
// - El estado final en disco es el MÁS RECIENTE.
// - El cierre await-ea las escrituras en cola: no queda
//   ninguna escritura antigua capaz de sobrescribir después.
// - Una escritura fallida no bloquea las siguientes.
// - Sin cambios pendientes no hay escrituras adicionales.
//
// Los gates controlan cuándo termina cada escritura del repo
// falso: el orden de finalización es exacto, sin carreras.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

globalThis.window = {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args)
};
globalThis.__notices = [];

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const OBSIDIAN_STUB = `
export class Notice {
  constructor(message) {
    globalThis.__notices.push(String(message));
  }
}
export class Menu {
  addItem() { return this; }
  showAtPosition() {}
}
export class Modal {
  constructor() {}
  open() {}
  close() {}
}
export class ButtonComponent {}
export class Component {}
export function setIcon() {}
export class App {}
export class TFile {}
export class WorkspaceLeaf {}
export class TextFileView {
  constructor(leaf) {
    this.leaf = leaf;
    this.app = leaf && leaf.app;
    this.file = leaf && leaf.file;
    this.contentEl = { empty() {}, createEl() { return this.contentEl; } };
  }
}
export default {};
`;

async function loadModule(entry) {
  const result = await build({
    entryPoints: [join(root, entry)],
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
  const url =
    'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(url);
}

const { Board } = await loadModule('src/focus/Board.ts');

// ------------------------------------------------------------
// Repo controlado con gates y medidor de concurrencia.
//
// Modela el CONTRATO del BoardRepository real (P2-1): FIFO por
// instancia — el cuerpo del segundo saveNote no empieza hasta
// que el primero termina, y un fallo no bloquea la cola. La
// garantía de orden se prueba con el repositorio REAL en
// storageIntegrity.test.mjs; aquí se verifica el comportamiento
// del Board sobre ese contrato.
// ------------------------------------------------------------

function createGatedRepo() {
  const repo = {
    pending: [],
    calls: [],
    disk: null,
    active: 0,
    maxActive: 0,
    failNext: 0,
    tail: Promise.resolve(),
    async loadNote() {
      return null;
    },
    saveNote(path, data) {
      const run = async () => {
        repo.active++;
        repo.maxActive = Math.max(repo.maxActive, repo.active);

        const snapshot = JSON.parse(JSON.stringify(data));
        repo.calls.push(snapshot);

        await new Promise((resolve, reject) => {
          repo.pending.push({
            path,
            data: snapshot,
            resolve() {
              repo.active--;
              if (repo.failNext > 0) {
                repo.failNext--;
                reject(new Error('EIO simulado'));
                return;
              }
              repo.disk = snapshot;
              resolve();
            }
          });
        });
      };

      // FIFO, como BoardRepository.enqueue.
      const result = repo.tail.then(run, run);
      repo.tail = result.then(() => {}, () => {});
      return result;
    }
  };
  return repo;
}

function createBoard(repo, notePath = 'Libro/A.md') {
  return new Board({
    app: {},
    widgetManager: { onChange: () => () => {} },
    repository: repo,
    notePath
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label) {
  for (let i = 0; i < 150 && !predicate(); i++) {
    await sleep(20);
  }
  assert.ok(predicate(), `timeout esperando: ${label}`);
}

function overrideIds(boardData) {
  return (boardData?.fragmentOverrides ?? [])
    .map((o) => o.blockId)
    .sort();
}

// ------------------------------------------------------------
// Orden de escrituras
// ------------------------------------------------------------

test('P2-1: escritura A (antigua) y B (nueva) se aplican en FIFO: el disco conserva el estado más reciente', async () => {
  const repo = createGatedRepo();
  const board = createBoard(repo);
  await board.load();

  // Escritura A (estado antiguo) en vuelo.
  board.setFragmentOverride('block-antiguo', 'versión antigua');
  await waitFor(() => repo.pending.length === 1, 'escritura A en vuelo');
  assert.equal(repo.calls[0].fragmentOverrides.length, 1);

  // Segunda mutación; el debounce dispara la escritura B, que
  // se ENCOLA: su cuerpo no empieza mientras A siga activa.
  board.setFragmentOverride('block-nuevo', 'versión nueva');
  await sleep(300);

  assert.equal(
    repo.pending.length,
    1,
    'B no debe empezar mientras A siga en vuelo (serialización)'
  );
  assert.equal(repo.maxActive, 1, 'nunca dos escrituras a la vez');

  // A termina primero → B arranca con el estado más reciente.
  repo.pending[0].resolve();
  await waitFor(() => repo.pending.length === 2, 'escritura B en vuelo');
  assert.equal(repo.calls[1].fragmentOverrides.length, 2);

  repo.pending[1].resolve();
  await sleep(10);

  assert.deepEqual(
    overrideIds(repo.disk),
    ['block-antiguo', 'block-nuevo'],
    'el disco debe conservar el estado más reciente'
  );
  assert.equal(repo.maxActive, 1);
});

test('P2-1: intento de finalización en orden inverso es imposible: B no puede completar antes que A', async () => {
  const repo = createGatedRepo();
  const board = createBoard(repo);
  await board.load();

  board.setFragmentOverride('block-antiguo', 'a');
  await waitFor(() => repo.pending.length === 1, 'A en vuelo');

  board.setFragmentOverride('block-nuevo', 'b');
  await sleep(300); // B encolada

  // "Intentar" terminar B primero no es posible: su cuerpo ni
  // siquiera ha arrancado. Solo existe la gate de A.
  assert.equal(repo.pending.length, 1);

  repo.pending[0].resolve(); // A
  await waitFor(() => repo.pending.length === 2, 'B arranca al terminar A');
  repo.pending[1].resolve(); // B
  await sleep(10);

  assert.deepEqual(overrideIds(repo.disk), ['block-antiguo', 'block-nuevo']);
  assert.equal(repo.maxActive, 1);
});

// ------------------------------------------------------------
// Cierre con escrituras pendientes
// ------------------------------------------------------------

test('P2-1: el cierre await-ea la escritura en cola: no queda write antiguo que sobrescriba después', async () => {
  const repo = createGatedRepo();
  const board = createBoard(repo);
  await board.load();

  board.setFragmentOverride('block-antiguo', 'a');
  await waitFor(() => repo.pending.length === 1, 'A en vuelo');

  // Mutación nueva + cierre: flush encola B y destroy await-ea
  // la cadena completa (A antes que B, por FIFO).
  board.setFragmentOverride('block-nuevo', 'b');
  let closed = false;
  const closePromise = board.destroy().then(() => {
    closed = true;
  });

  await sleep(50);
  assert.equal(closed, false, 'el cierre no puede completarse con A y B pendientes');

  repo.pending[0].resolve(); // A
  await waitFor(() => repo.pending.length === 2, 'B en cola/inicio');
  assert.equal(closed, false, 'el cierre sigue esperando a B');

  repo.pending[1].resolve(); // B (estado nuevo)
  await closePromise;

  assert.equal(closed, true);
  assert.deepEqual(
    overrideIds(repo.disk),
    ['block-antiguo', 'block-nuevo'],
    'el estado más reciente queda persistido y nada puede sobrescribirlo después del cierre'
  );
  assert.equal(repo.maxActive, 1);
});

// ------------------------------------------------------------
// Fallos y recuperación de la cola
// ------------------------------------------------------------

test('P2-1: una escritura fallida no bloquea las siguientes (cola opera)', async () => {
  const repo = createGatedRepo();
  const board = createBoard(repo);
  await board.load();

  board.setFragmentOverride('block-1', 'intento fallido');
  await waitFor(() => repo.pending.length === 1, 'primera escritura en vuelo');
  repo.failNext = 1;
  repo.pending[0].resolve(); // rechaza
  await sleep(300); // el save termina con error (Notice + dirty)

  // Siguiente mutación: la cola sigue viva.
  board.setFragmentOverride('block-2', 'intento correcto');
  await waitFor(() => repo.pending.length === 2, 'segunda escritura en vuelo');
  repo.pending[1].resolve();

  await board.destroy(); // limpia resto si lo hubiera
  await sleep(50);

  assert.ok(repo.disk, 'la cola se recuperó y hubo escritura correcta');
  assert.deepEqual(
    overrideIds(repo.disk).sort(),
    ['block-1', 'block-2'],
    'el estado acumulado (ambas mutaciones) queda persistido'
  );
});

test('P2-1: sin cambios pendientes no hay escrituras adicionales', async () => {
  const repo = createGatedRepo();
  const board = createBoard(repo);
  await board.load();

  board.setFragmentOverride('block-1', 'único cambio');
  await waitFor(() => repo.pending.length === 1, 'escritura en vuelo');
  repo.pending[0].resolve();
  await sleep(50);

  const callsBefore = repo.calls.length;
  await board.destroy();
  await sleep(300);

  assert.equal(repo.calls.length, callsBefore, 'sin dirty no hay escrituras extra');
  assert.equal(repo.maxActive, 1);
});
