// ============================================================
// PRUEBAS: guardado del Board — errores visibles y cierre que
// no pierde guardados pendientes (P1-2A / auditoría P1-1)
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - Un fallo de guardado se registra (Notice + consola) y los
//   cambios permanecen pendientes (dirty) en memoria.
// - El cierre (destroy) reintenta el guardado fallido.
// - destroy() espera (await) el guardado pendiente y el que ya
//   esté en vuelo antes de completarse.
// - Cerrar sin cambios no escribe.
// - Una mutación durante un guardado en vuelo no se pierde.
// - BoardView.onClose espera a que termine el destroy del Board.
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
    this.contentEl = {
      empty() {},
      createEl() { return this.contentEl; }
    };
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
  const code = result.outputFiles[0].text;
  const url =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(url);
}

const { Board } = await loadModule('src/focus/Board.ts');
const { BoardView } = await loadModule('src/focus/BoardView.ts');

// ------------------------------------------------------------
// Dobles de prueba
// ------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRepo() {
  const repo = {
    calls: [],
    lastSaved: null,
    failMode: 'none', // 'none' | 'once' | 'always'
    delayMs: 0,
    async loadNote() {
      return null;
    },
    async saveNote(path, data) {
      const snapshot = JSON.parse(JSON.stringify(data));
      repo.calls.push({ path, data: snapshot });
      if (repo.delayMs > 0) {
        await sleep(repo.delayMs);
      }
      if (repo.failMode === 'always') {
        throw new Error('EIO simulado');
      }
      if (repo.failMode === 'once') {
        repo.failMode = 'none';
        throw new Error('EIO simulado');
      }
      repo.lastSaved = snapshot;
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

function captureConsoleErrors() {
  const captured = [];
  const original = console.error;
  console.error = (...args) => {
    captured.push(args.map(String).join(' '));
  };
  return {
    captured,
    restore() {
      console.error = original;
    }
  };
}

function resetNotices() {
  globalThis.__notices.length = 0;
}

// ------------------------------------------------------------
// Pruebas de Board
// ------------------------------------------------------------

test('P1-2A: un guardado que falla es visible y conserva los cambios en memoria', async () => {
  resetNotices();
  const repo = createRepo();
  repo.failMode = 'always';
  const board = createBoard(repo);
  await board.load();

  board.setFragmentOverride('block-1', 'versión local');

  const errors = captureConsoleErrors();
  try {
    await sleep(300); // debounce 250 ms + margen
  } finally {
    errors.restore();
  }

  // El intento de guardado existió y falló.
  assert.equal(repo.calls.length, 1);

  // El fallo es VISIBLE: Notice + registro en consola.
  assert.equal(globalThis.__notices.length, 1);
  assert.match(globalThis.__notices[0], /Board/);
  assert.equal(errors.captured.length, 1);
  assert.match(errors.captured[0], /EIO simulado/);

  // El estado en memoria sigue intacto: el cierre lo demostrará
  // reintentando y persistiendo la misma override.

  // Cierre: reintenta (dirty) y ahora persiste.
  repo.failMode = 'none';
  await board.destroy();

  assert.equal(repo.calls.length, 2);
  assert.ok(repo.lastSaved);
  assert.equal(repo.lastSaved.fragmentOverrides.length, 1);
  assert.equal(repo.lastSaved.fragmentOverrides[0].blockId, 'block-1');
  assert.equal(repo.lastSaved.fragmentOverrides[0].overrideText, 'versión local');
});

test('P1-2A: el guardado pendiente del debounce se completa al cerrar', async () => {
  resetNotices();
  const repo = createRepo();
  const board = createBoard(repo);
  await board.load();

  board.setFragmentOverride('block-1', 'texto');

  // Cerrar ANTES de que venza el debounce de 250 ms.
  await board.destroy();

  assert.equal(repo.calls.length, 1);
  assert.equal(repo.lastSaved.fragmentOverrides[0].overrideText, 'texto');

  // El timer quedó cancelado: no llega un segundo guardado.
  await sleep(350);
  assert.equal(repo.calls.length, 1);
});

test('P1-2A: el cierre espera a que termine un guardado en vuelo', async () => {
  resetNotices();
  const repo = createRepo();
  repo.delayMs = 120;
  const board = createBoard(repo);
  await board.load();

  board.setFragmentOverride('block-1', 'lento');

  await sleep(300); // el debounce dispara el guardado (en vuelo, tarda 120 ms)

  let closed = false;
  const closePromise = board.destroy().then(() => {
    closed = true;
  });

  await sleep(30);
  assert.equal(closed, false, 'destroy no debe completarse con el guardado en vuelo');

  await closePromise;
  assert.equal(closed, true);
  assert.ok(repo.lastSaved);
  assert.equal(repo.lastSaved.fragmentOverrides[0].overrideText, 'lento');
});

test('P1-2A: cerrar sin cambios no escribe', async () => {
  resetNotices();
  const repo = createRepo();
  const board = createBoard(repo);
  await board.load();

  await board.destroy();
  await sleep(300);

  assert.equal(repo.calls.length, 0);
  assert.equal(globalThis.__notices.length, 0);
});

test('P1-2A: destroy es idempotente tras un cierre exitoso', async () => {
  resetNotices();
  const repo = createRepo();
  const board = createBoard(repo);
  await board.load();

  board.setFragmentOverride('block-1', 'una vez');
  await board.destroy();

  const callsAfterFirstClose = repo.calls.length;
  assert.equal(callsAfterFirstClose, 1);

  await board.destroy();
  await sleep(300);

  assert.equal(repo.calls.length, callsAfterFirstClose);
  assert.equal(globalThis.__notices.length, 0);
});

test('P1-2A: una mutación durante un guardado en vuelo no se pierde', async () => {
  resetNotices();
  const repo = createRepo();
  repo.delayMs = 100;
  const board = createBoard(repo);
  await board.load();

  board.setFragmentOverride('block-1', 'primera');

  // El debounce dispara el primer guardado (tarda 100 ms).
  await sleep(280);

  // Segunda mutación MIENTRAS el primer guardado sigue en vuelo.
  board.setFragmentOverride('block-2', 'segunda');

  await board.destroy();

  // El cierre debe haber persistido AMBAS overrides: el dirty
  // no se limpió con el snapshot antiguo del primer guardado.
  assert.ok(repo.lastSaved);
  const ids = repo.lastSaved.fragmentOverrides.map((o) => o.blockId).sort();
  assert.deepEqual(ids, ['block-1', 'block-2']);
});

test('P1-2A: un fallo en el primer guardado no rompe el cierre (la promesa resuelve)', async () => {
  resetNotices();
  const repo = createRepo();
  repo.failMode = 'always';
  const board = createBoard(repo);
  await board.load();

  board.setFragmentOverride('block-1', 'x');

  const errors = captureConsoleErrors();
  try {
    // destroy con el reintento también fallando: la promesa debe
    // RESOLVER (el error ya es visible vía Notice/consola) para
    // no bloquear el ciclo de vida de la vista.
    await board.destroy();
  } finally {
    errors.restore();
  }

  assert.equal(repo.calls.length, 1);
  assert.equal(globalThis.__notices.length, 1);
});

// ------------------------------------------------------------
// Prueba de BoardView.onClose
// ------------------------------------------------------------

test('P1-2A: BoardView.onClose espera a que el Board complete su destrucción', async () => {
  resetNotices();

  const leaf = { app: {}, file: null };
  const view = new BoardView(leaf, {
    widgetManager: { onChange: () => () => {} },
    repository: createRepo()
  });

  let boardDestroyed = false;
  // Sustitución directa del Board interno por un doble cuyo
  // destroy tarda (simula el flush pendiente).
  view.board = {
    async destroy() {
      await sleep(80);
      boardDestroyed = true;
    }
  };

  let closed = false;
  const closePromise = view.onClose().then(() => {
    closed = true;
  });

  await sleep(20);
  assert.equal(boardDestroyed, false);
  assert.equal(closed, false);

  await closePromise;
  assert.equal(boardDestroyed, true);
  assert.equal(closed, true);
});

// ------------------------------------------------------------
// Integridad: conexiones de grupos vacíos (P2-3)
// ------------------------------------------------------------

test('P2-3: eliminar el último bloque de un grupo retira también las conexiones del contenedor', async () => {
  resetNotices();
  const repo = createRepo();
  const board = createBoard(repo);
  await board.load();

  // Estado inyectado: dos tarjetas, un grupo con una sola
  // miembro y una conexión de grupo + otra de tarjeta.
  const b = board;
  b.blocks.push(
    { id: 'b1', text: 'uno', sourceType: 'text', x: 0, y: 0 },
    { id: 'b2', text: 'dos', sourceType: 'text', x: 10, y: 10 }
  );
  b.groups.push({
    id: 'g1',
    label: '',
    blockIds: ['b1'],
    x: 0,
    y: 0,
    w: 10,
    h: 10
  });
  b.connections.push(
    { id: 'c1', sourceGroupId: 'g1', targetBlockId: 'b2' },
    { id: 'c2', sourceBlockId: 'b1', targetBlockId: 'b2' }
  );

  b.removeBlock('b1');

  assert.deepEqual(b.groups, [], 'el grupo vacío se retira');
  assert.deepEqual(
    b.connections,
    [],
    'las conexiones del contenedor retirado y de la tarjeta eliminada no quedan huérfanas'
  );
  assert.equal(b.blocks.length, 1);
  assert.equal(b.blocks[0].id, 'b2', 'la otra tarjeta queda intacta');

  // El guardado posterior no persiste extremos de grupo inexistentes.
  await board.destroy();
  assert.ok(repo.lastSaved);
  assert.deepEqual(repo.lastSaved.connections, []);
  assert.deepEqual(repo.lastSaved.groups, []);
});
