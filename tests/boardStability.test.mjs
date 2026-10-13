// ============================================================
// PRUEBAS: Estabilidad del Board (Corrección B)
// ============================================================
// Ejecutar con: npm test
//
// Reproduce los fallos observados:
// - Clic en nota del panel con Board abierto y modo NORMAL: el
//   Board NO se cierra (no había modo global que desactivar).
// - Navegación por carpetas en modo NORMAL: el Board permanece.
// - Salida REAL de un modo global (foco/recientes): el cierre
//   previsto se conserva.
// - Abrir una nota con el Board como leaf activo: pestaña nueva
//   (la vista del Board no se reemplaza).
// - Abrir una nota sin Board activo: reutiliza el leaf activo
//   (comportamiento previo).
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
export class ItemView {}
export class MarkdownView {}
export class WorkspaceLeaf {}
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

const { boardMustCloseOnExit, pickLeafStrategy } = await bundle(
  'src/utils/boardStability.ts'
);

const NORMAL = 'normal';

// ------------------------------------------------------------
// 1. exitGlobalModes: el Board solo se cierra con modo activo
// ------------------------------------------------------------

test('B1: clic/nota en modo NORMAL con Board abierto NO cierra el Board', () => {
  // Escenario reproducido: seleccionar una nota del panel ejecuta
  // exitGlobalModes(); con navigationMode NORMAL y foco apagado no
  // debe pedirse el cierre del Board.
  const mustClose = boardMustCloseOnExit({
    isFocusMode: false,
    navigationMode: NORMAL,
    normalMode: NORMAL
  });
  assert.equal(mustClose, false);
});

test('B2: navegación por carpetas en modo NORMAL conserva el Board', () => {
  // Cambio de carpeta → exitGlobalModes(); mismo análisis que B1.
  const mustClose = boardMustCloseOnExit({
    isFocusMode: false,
    navigationMode: NORMAL,
    normalMode: NORMAL
  });
  assert.equal(mustClose, false);
});

test('B3: salir del modo Foco sí cierra el Board (comportamiento previsto)', () => {
  const mustClose = boardMustCloseOnExit({
    isFocusMode: true,
    navigationMode: NORMAL,
    normalMode: NORMAL
  });
  assert.equal(mustClose, true);
});

test('B4: salir de Recientes/Notas sí cierra el Board', () => {
  const mustClose = boardMustCloseOnExit({
    isFocusMode: false,
    navigationMode: 'recent_notes',
    normalMode: NORMAL
  });
  assert.equal(mustClose, true);
});

test('B5: foco + modo de navegación activo: se cierra (ambos son globales)', () => {
  const mustClose = boardMustCloseOnExit({
    isFocusMode: true,
    navigationMode: 'all_notes',
    normalMode: NORMAL
  });
  assert.equal(mustClose, true);
});

// ------------------------------------------------------------
// 2. Selección de pestañas al abrir notas
// ------------------------------------------------------------

test('B6: leaf activo = Board → abrir nota en pestaña NUEVA', () => {
  const boardLeaf = { id: 'board-leaf' };
  const otherLeaf = { id: 'markdown-leaf' };
  const strategy = pickLeafStrategy(boardLeaf, [boardLeaf, otherLeaf]);
  assert.equal(strategy, 'new-tab');
});

test('B7: leaf activo distinto del Board → reutilizar (comportamiento previo)', () => {
  const boardLeaf = { id: 'board-leaf' };
  const active = { id: 'markdown-leaf' };
  assert.equal(pickLeafStrategy(active, [boardLeaf]), 'reuse-active');
});

test('B8: sin leaf activo o sin Board → reutilizar', () => {
  assert.equal(pickLeafStrategy(null, []), 'reuse-active');
  assert.equal(pickLeafStrategy(undefined, [{ id: 'b' }]), 'reuse-active');
});

// ------------------------------------------------------------
// 3. Secuencia estilo real (apertura/cierre repetido)
// ------------------------------------------------------------

test('B9: abrir y cerrar el Board repetidamente no altera las decisiones', () => {
  const boardLeaf = { id: 'leaf' };
  for (let i = 0; i < 5; i++) {
    // Abrir: el leaf pasa a ser Board → estrategia protegida.
    assert.equal(pickLeafStrategy(boardLeaf, [boardLeaf]), 'new-tab');
    // Cierre explícito (botón Board/Nota): modo normal, decisión
    // de UI explícita — el helper no interviene (closeBoardView).
    // Reabrir: sigue protegido.
    assert.equal(pickLeafStrategy(boardLeaf, [boardLeaf]), 'new-tab');
  }
});

test('B10: interacción en modo normal tras abrir Board no pide cierre', () => {
  // Secuencia: abrir Board (modo normal) → varias interacciones
  // del panel → cada una llama exitGlobalModes().
  const state = { isFocusMode: false, navigationMode: NORMAL, normalMode: NORMAL };
  for (let i = 0; i < 4; i++) {
    assert.equal(boardMustCloseOnExit(state), false);
  }
  // Salida explícita del modo recientes (estado distinto).
  assert.equal(
    boardMustCloseOnExit({ ...state, navigationMode: 'recent_notes' }),
    true
  );
});
