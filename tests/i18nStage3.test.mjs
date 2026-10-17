// ============================================================
// PRUEBAS: ETAPA 3 i18n — estadísticas y diálogos
// ============================================================
// Ejecutar con: npm test
//
// Verifica el RESULTADO resuelto (es/en, interpolaciones) de las
// claves que consumen WordCountModal, BoardPolishModal,
// ModalUtils, StatsComponent y el modal de selección de raíz.
// Los módulos de diálogo importan Obsidian, por lo que se
// comprueba el catálogo vía el servicio empaquetado: es la misma
// resolución que ejecutan los diálogos en runtime.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const buildResult = await esbuild.build({
  entryPoints: [join(root, 'src', 'i18n', 'I18nService.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent'
});

const { i18n } = await import(
  'data:text/javascript;base64,' +
  Buffer.from(buildResult.outputFiles[0].text).toString('base64')
);

// El servicio arranca en español; helper para lecturas en en.
function inEnglish(fn) {
  i18n.setLocale('en');
  try {
    return fn();
  } finally {
    i18n.setLocale('es');
  }
}

// ============================================================
// 1. WORDCOUNTMODAL — ESTADÍSTICAS DEL LIBRO
// ============================================================

test('wordCount: etiquetas de las estadísticas principales', () => {
  assert.equal(i18n.t('modal.wordCount.stat.totalWords'), 'Total palabras');
  assert.equal(i18n.t('modal.wordCount.stat.notes'), 'Notas');
  assert.equal(i18n.t('modal.wordCount.stat.avgPerNote'), 'Promedio por nota');
  assert.equal(i18n.t('modal.wordCount.detailsHeading'), 'Detalle por nota');

  assert.equal(inEnglish(() => i18n.t('modal.wordCount.stat.totalWords')), 'Total words');
  assert.equal(inEnglish(() => i18n.t('modal.wordCount.stat.notes')), 'Notes');
  assert.equal(inEnglish(() => i18n.t('modal.wordCount.stat.avgPerNote')), 'Average per note');
  assert.equal(inEnglish(() => i18n.t('modal.wordCount.detailsHeading')), 'Details per note');
});

test('wordCount: ciclo del botón Actualizar estadísticas (reposo → carga → error)', () => {
  assert.equal(i18n.t('modal.wordCount.refreshButton'), 'Actualizar estadísticas');
  assert.equal(
    i18n.t('modal.wordCount.refreshButtonAria'),
    'Actualizar estadísticas del conteo de palabras'
  );
  assert.equal(i18n.t('modal.wordCount.refreshing'), 'Actualizando…');
  assert.equal(
    i18n.t('modal.wordCount.refreshError'),
    'No se pudo actualizar; se muestran los últimos datos válidos.'
  );

  assert.equal(inEnglish(() => i18n.t('modal.wordCount.refreshButton')), 'Refresh statistics');
  assert.equal(inEnglish(() => i18n.t('modal.wordCount.refreshing')), 'Refreshing…');
  assert.equal(
    inEnglish(() => i18n.t('modal.wordCount.refreshError')),
    'Could not refresh; showing the last valid data.'
  );
});

test('wordCount: metas (establecer, mostrar, cambiar, guardar)', () => {
  assert.equal(i18n.t('modal.wordCount.setGoal'), 'Establecer meta');
  assert.equal(i18n.t('modal.wordCount.goalTitle'), 'Meta de escritura');
  assert.equal(i18n.t('modal.wordCount.changeGoal'), 'Cambiar meta');
  assert.equal(i18n.t('modal.wordCount.goalWords'), 'Meta de palabras');
  assert.equal(i18n.t('modal.wordCount.currentWords'), 'Palabras actuales');
  assert.equal(i18n.t('modal.wordCount.compliance'), 'Cumplimiento');
  assert.equal(i18n.t('modal.wordCount.goalPlaceholder'), 'p. ej. 80000');
  assert.equal(i18n.t('modal.wordCount.goalAria'), 'Meta de palabras del libro');
  assert.equal(i18n.t('modal.wordCount.saveGoal'), 'Guardar meta');

  assert.equal(inEnglish(() => i18n.t('modal.wordCount.setGoal')), 'Set goal');
  assert.equal(inEnglish(() => i18n.t('modal.wordCount.changeGoal')), 'Change goal');
  assert.equal(inEnglish(() => i18n.t('modal.wordCount.compliance')), 'Progress');
  assert.equal(inEnglish(() => i18n.t('modal.wordCount.saveGoal')), 'Save goal');
});

test('wordCount: el fallback del nombre del libro se localiza', () => {
  assert.equal(i18n.t('modal.wordCount.fallbackBookName'), 'Libro');
  assert.equal(inEnglish(() => i18n.t('modal.wordCount.fallbackBookName')), 'Book');
});

// ============================================================
// 2. BOARDPOLISHMODAL
// ============================================================

test('polish: título, secciones y botones', () => {
  assert.equal(i18n.t('modal.polish.title'), 'Pulir fragmento');
  assert.equal(i18n.t('modal.polish.originalLabel'), 'Original (solo lectura)');
  assert.equal(i18n.t('modal.polish.personalLabel'), 'Versión personal');
  assert.equal(i18n.t('modal.polish.discard'), 'Descartar versión personal');
  assert.equal(i18n.t('modal.polish.save'), 'Guardar versión');
  assert.equal(i18n.t('common.cancel'), 'Cancelar');

  assert.equal(inEnglish(() => i18n.t('modal.polish.title')), 'Polish fragment');
  assert.equal(inEnglish(() => i18n.t('modal.polish.originalLabel')), 'Original (read-only)');
  assert.equal(inEnglish(() => i18n.t('modal.polish.discard')), 'Discard personal version');
  assert.equal(inEnglish(() => i18n.t('common.cancel')), 'Cancel');
});

// ============================================================
// 3. MODALUTILS (InputModal / ConfirmModal)
// ============================================================

test('modal genérico: Cancelar / Aceptar / Confirmar', () => {
  assert.equal(i18n.t('common.cancel'), 'Cancelar');
  assert.equal(i18n.t('common.accept'), 'Aceptar');
  assert.equal(i18n.t('common.confirm'), 'Confirmar');

  assert.equal(inEnglish(() => i18n.t('common.accept')), 'OK');
  assert.equal(inEnglish(() => i18n.t('common.confirm')), 'Confirm');
});

// ============================================================
// 4. STATSCOMPONENT — PROGRESO COMPACTO
// ============================================================

test('stats compactas: interpolación con doble espacio (formato histórico)', () => {
  assert.equal(
    i18n.t('stats.compactProgress', { notes: 12, percentage: 80 }),
    '12 notas  ·  80% completado'
  );
  assert.equal(
    i18n.t('stats.compactProgress', { notes: 1, percentage: 0 }),
    '1 notas  ·  0% completado'
  );
  assert.equal(i18n.t('stats.compactEmpty'), '0 notas  ·  0% completado');

  assert.equal(
    inEnglish(() =>
      i18n.t('stats.compactProgress', { notes: 12, percentage: 80 })
    ),
    '12 notes · 80% completed'
  );
  assert.equal(inEnglish(() => i18n.t('stats.compactEmpty')), '0 notes · 0% completed');
});

// ============================================================
// 5. MODAL DE SELECCIÓN DE RAÍZ
// ============================================================

test('selección de raíz: título, descripción y estado vacío', () => {
  assert.equal(
    i18n.t('modal.selectRoot.title'),
    'Seleccionar la carpeta maestra'
  );
  assert.equal(
    i18n.t('modal.selectRoot.description'),
    'Elige la carpeta principal que contiene todo el libro.'
  );
  assert.equal(
    i18n.t('empty.noRootFolders'),
    'No hay carpetas en la raíz del vault'
  );

  assert.equal(
    inEnglish(() => i18n.t('modal.selectRoot.title')),
    "Select the master folder"
  );
  assert.equal(
    inEnglish(() => i18n.t('empty.noRootFolders')),
    'There are no folders in the vault root'
  );
});

// ============================================================
// 6. COMPORTAMIENTO DEL SERVICIO CON ESTAS CLAVES
// ============================================================

test('parámetros extra no alteran la plantilla y los ausentes quedan literales', () => {
  // Parámetro adicional ignorado.
  assert.equal(
    i18n.t('stats.compactProgress', { notes: 3, percentage: 50, extra: 'x' }),
    '3 notas  ·  50% completado'
  );
  // Parámetro ausente → placeholder literal (señal visible).
  assert.equal(
    i18n.t('stats.compactProgress', { notes: 3 }),
    '3 notas  ·  {percentage}% completado'
  );
});
