// ============================================================
// PRUEBAS: ETAPA 2 i18n — estados y filtros
// ============================================================
// Ejecutar con: npm test
//
// Verifica que las etiquetas de estado y de filtro se traducen
// (es/en) mientras los IDENTIFICADORES PERSISTIDOS, iconos y
// reglas de filtrado permanecen intactos.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Un único bundle → un único singleton i18n para todos los
// módulos bajo prueba.
const entry = `
export { STATUSES, STATUS_ICONS, getStatusIcon, getStatusLabel } from './src/constants/statuses.ts';
export { FilterService } from './src/services/FilterService.ts';
export { i18n } from './src/i18n/I18nService.ts';
`;

const buildResult = await esbuild.build({
  stdin: {
    contents: entry,
    resolveDir: root,
    sourcefile: 'entry.ts',
    loader: 'ts'
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent'
});

const bundleUrl =
  'data:text/javascript;base64,' +
  Buffer.from(buildResult.outputFiles[0].text).toString('base64');

const {
  STATUSES,
  STATUS_ICONS,
  getStatusIcon,
  getStatusLabel,
  FilterService,
  i18n
} = await import(bundleUrl);

// Identificadores persistidos: orden y valores exactos.
const EXPECTED_IDS = [
  'draft', 'inProgress', 'completed', 'pending', 'review', 'approved',
  'discarded', 'questions', 'highPriority', 'mediumPriority', 'bookmark',
  'thumb-down'
];

// ============================================================
// 1. IDENTIFICADORES E ICONOS (persistencia intacta)
// ============================================================

test('los id de estado se conservan exactamente (datos persistidos)', () => {
  assert.deepEqual(STATUSES.map((s) => s.id), EXPECTED_IDS);
});

test('el mapa de iconos no cambia (identificadores internos)', () => {
  assert.equal(STATUS_ICONS.draft, 'pencil');
  assert.equal(STATUS_ICONS['thumb-down'], 'thumb-down');
  assert.equal(getStatusIcon(null), 'more-vertical');
  assert.equal(getStatusIcon('unknown-id'), 'more-vertical');
  assert.equal(getStatusIcon('completed'), 'check-circle');
});

// ============================================================
// 2. ETIQUETAS DE ESTADO EN ESPAÑOL E INGLÉS
// ============================================================

test('etiquetas de estado en español (textos originales)', () => {
  const byId = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));

  assert.equal(byId.draft, 'Borrador');
  assert.equal(byId.inProgress, 'En progreso');
  assert.equal(byId.completed, 'Completado');
  assert.equal(byId.pending, 'Pendiente');
  assert.equal(byId.review, 'Revisar');
  assert.equal(byId.approved, 'Aprobado');
  assert.equal(byId.discarded, 'Descartado');
  assert.equal(byId.questions, 'Dudas');
  assert.equal(byId.highPriority, 'Prioridad alta');
  assert.equal(byId.mediumPriority, 'Prioridad media');
  assert.equal(byId.bookmark, 'Guardado');
  // Dosis semántica preservada: dos estados, mismo texto.
  assert.equal(byId['thumb-down'], 'Revisar');

  assert.equal(getStatusLabel('draft'), 'Borrador');
  assert.equal(getStatusLabel(null), 'Sin estado');
  // Estado desconocido → se devuelve el id (no se inventa texto).
  assert.equal(getStatusLabel('id-desconocido'), 'id-desconocido');
});

test('etiquetas de estado en inglés al activar el locale en', () => {
  i18n.setLocale('en');
  try {
    const byId = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));

    assert.equal(byId.draft, 'Draft');
    assert.equal(byId.inProgress, 'In progress');
    assert.equal(byId.completed, 'Completed');
    assert.equal(byId.pending, 'Pending');
    assert.equal(byId.review, 'Review');
    assert.equal(byId.approved, 'Approved');
    assert.equal(byId.discarded, 'Discarded');
    assert.equal(byId.questions, 'Questions');
    assert.equal(byId.highPriority, 'High priority');
    assert.equal(byId.mediumPriority, 'Medium priority');
    assert.equal(byId.bookmark, 'Saved');
    assert.equal(byId['thumb-down'], 'Review');

    assert.equal(getStatusLabel(null), 'No status');
  } finally {
    i18n.setLocale('es');
  }
});

test('el getter de label se resuelve en cada acceso (sin congelar el idioma)', () => {
  // La traducción no se captura en la carga del módulo: al volver
  // a español, las etiquetas vuelven a los textos originales.
  assert.equal(STATUSES.find((s) => s.id === 'draft').label, 'Borrador');
});

// ============================================================
// 3. OPCIONES DE FILTRO: IDs INTACTOS + ETIQUETAS LOCALIZADAS
// ============================================================

test('las opciones de filtro conservan sus ids e iconos exactos', () => {
  const service = new FilterService();
  const options = service.getFilterOptions();

  assert.deepEqual(
    options.map((o) => o.id),
    [null, ...EXPECTED_IDS, '_empty', '_no-status']
  );

  const byId = Object.fromEntries(
    options.map((o) => [String(o.id), o])
  );
  assert.equal(byId['null'].icon, 'list');
  assert.equal(byId['_empty'].icon, 'alert-circle');
  assert.equal(byId['_no-status'].icon, 'more-vertical');
  assert.equal(byId.draft.icon, 'pencil');
});

test('etiquetas de filtro en español', () => {
  const service = new FilterService();
  const options = service.getFilterOptions();
  const byId = Object.fromEntries(options.map((o) => [String(o.id), o]));

  assert.equal(byId['null'].label, 'Todas las notas');
  assert.equal(byId['_empty'].label, 'Notas vacías');
  assert.equal(byId['_no-status'].label, 'Sin estado');
  assert.equal(byId.draft.label, 'Borrador');

  assert.equal(service.getFilterLabel(null), 'Todas las notas');
  assert.equal(service.getFilterLabel('_empty'), 'Notas vacías');
  assert.equal(service.getFilterLabel('_no-status'), 'Sin estado');
  assert.equal(service.getFilterLabel('draft'), 'Borrador');
  assert.equal(service.getFilterLabel('desconocido'), 'desconocido');
});

test('etiquetas de filtro en inglés', () => {
  i18n.setLocale('en');
  try {
    const service = new FilterService();
    const byId = Object.fromEntries(
      service.getFilterOptions().map((o) => [String(o.id), o])
    );

    assert.equal(byId['null'].label, 'All notes');
    assert.equal(byId['_empty'].label, 'Empty notes');
    assert.equal(byId['_no-status'].label, 'No status');
    assert.equal(byId.draft.label, 'Draft');

    assert.equal(service.getFilterLabel(null), 'All notes');
  } finally {
    i18n.setLocale('es');
  }
});

// ============================================================
// 4. REGLAS FUNCIONALES DE FILTRADO (sin cambios)
// ============================================================

test('applyFilter conserva las reglas puras de filtrado', () => {
  const service = new FilterService();
  const items = [
    { name: 'a.md', isEmpty: false, status: 'draft' },
    { name: 'b.md', isEmpty: true, status: '' },
    { name: 'c.md', isEmpty: false, status: '' },
    { name: 'd.md', isEmpty: false, status: 'completed' }
  ];

  // Sin filtro → todo.
  assert.equal(service.applyFilter(items, null).length, 4);
  // _empty → solo vacías.
  assert.deepEqual(
    service.applyFilter(items, '_empty').map((i) => i.name),
    ['b.md']
  );
  // _no-status → sin estado y no vacías.
  assert.deepEqual(
    service.applyFilter(items, '_no-status').map((i) => i.name),
    ['c.md']
  );
  // Estado concreto → coincidencia exacta.
  assert.deepEqual(
    service.applyFilter(items, 'draft').map((i) => i.name),
    ['a.md']
  );
});
