// ============================================================
// PRUEBAS: ETAPA 6 i18n — Focus, Board y Biblioteca
// ============================================================
// Ejecutar con: npm test
//
// Verifica: resolutor de dominios/capacidades de IA (catálogo con
// fallback), resultados resueltos es/en de Board/Focus/Biblioteca/
// Recursos, interpolaciones y contratos (selectores estables,
// resolutores compartidos, plurales del panel de contexto).
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const entry = `
export * from './src/focus/widgets/definitionTexts.ts';
export * from './src/ai/capabilities/capabilityTexts.ts';
export { i18n } from './src/i18n/I18nService.ts';
`;

const buildResult = await esbuild.build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'entry.ts', loader: 'ts' },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent'
});

const {
  getDomainLabel,
  getDomainDescription,
  getCapabilityLabel,
  getCapabilityDescription,
  getWidgetDefinitionLabel,
  i18n
} = await import(
  'data:text/javascript;base64,' +
  Buffer.from(buildResult.outputFiles[0].text).toString('base64')
);

function inEnglish(fn) {
  i18n.setLocale('en');
  try {
    return fn();
  } finally {
    i18n.setLocale('es');
  }
}

// ============================================================
// 1. RESOLUTOR DE DOMINIOS Y CAPACIDADES DE IA
// ============================================================

test('dominios IA: etiquetas y descripciones es/en por id estable', () => {
  assert.equal(getDomainLabel('investigacion', 'fallback'), 'Investigación');
  assert.equal(getDomainLabel('revision', 'fallback'), 'Revisión');
  assert.equal(getDomainLabel('transformacion', 'fallback'), 'Transformación');
  assert.ok(getDomainDescription('investigacion', '').startsWith('Capacidades para explorar'));

  assert.equal(inEnglish(() => getDomainLabel('investigacion', 'fallback')), 'Research');
  assert.equal(inEnglish(() => getDomainLabel('revision', 'fallback')), 'Review');
});

test('capacidades IA: las9 capacidades se resuelven en es/en', () => {
  const cases = [
    ['research-questions', 'Preguntas', 'Questions'],
    ['research-references', 'Referencias', 'References'],
    ['research-concepts', 'Conceptos clave', 'Key concepts'],
    ['research-thesis', 'Tesis', 'Thesis'],
    ['review-clarity', 'Claridad', 'Clarity'],
    ['review-coherence', 'Coherencia', 'Coherence'],
    ['transform-outline', 'Esquema', 'Outline'],
    ['transform-mindmap', 'Mapa mental', 'Mind map'],
    ['transform-study-questions', 'Preguntas de estudio', 'Study questions']
  ];

  for (const [id, es, en] of cases) {
    assert.equal(getCapabilityLabel(id, 'fallback'), es, id);
    assert.equal(inEnglish(() => getCapabilityLabel(id, 'fallback')), en, id);
    assert.ok(getCapabilityDescription(id, '').length > 0, `desc ${id}`);
  }
});

test('ids de dominio/capacidad desconervidos conservan el fallback', () => {
  assert.equal(getDomainLabel('otro-dominio', 'Etiqueta heredada'), 'Etiqueta heredada');
  assert.equal(getCapabilityLabel('otra-capacidad', 'Cap heredada'), 'Cap heredada');
  assert.equal(getCapabilityDescription('otra-capacidad', ''), '');
});

// ============================================================
// 2. BOARD (modos, contexto con plurales, tarjetas, arquitectura)
// ============================================================

test('board: modos, estado vacío y panel de contexto', () => {
  assert.equal(i18n.t('board.modes.explore'), 'Explorar');
  assert.equal(i18n.t('board.modes.architecture'), 'Arquitectura');
  assert.equal(i18n.t('board.modes.document'), 'Documento');
  assert.equal(
    i18n.t('board.explore.emptyHint'),
    'Arrastra aquí elementos del panel para crear bloques'
  );
  assert.equal(i18n.t('board.context.title'), 'Contexto');
  assert.equal(i18n.t('board.context.noLists'), 'Sin listas');
  assert.equal(i18n.t('board.context.group.restrictions'), 'Restricciones');
  assert.equal(i18n.t('board.context.group.candidates'), 'Candidatos');
  assert.equal(i18n.t('board.context.group.tasks'), 'Tareas');

  // Plurales del contexto (misma composición que el plural() del Board).
  assert.equal(`2 ${i18n.tn('board.context.counts.activeFeminine', 2)}`, '2 activas');
  assert.equal(`1 ${i18n.tn('board.context.counts.activeFeminine', 1)}`, '1 activa');
  assert.equal(`3 ${i18n.tn('board.context.counts.pending', 3)}`, '3 pendientes');
  assert.equal(
    inEnglish(() => i18n.tn('board.context.counts.pending', 3)),
    'pending'
  );
});

test('board: tarjetas, grupos y conexión', () => {
  assert.equal(i18n.t('board.card.fallbackTitle'), 'Texto');
  assert.equal(i18n.t('board.card.action.activate'), 'Activar bloque');
  assert.equal(i18n.t('board.card.action.deactivate'), 'Desactivar bloque');
  assert.equal(i18n.t('board.card.action.showMore'), 'Ver más');
  assert.equal(i18n.t('board.card.action.showLess'), 'Ver menos');
  assert.equal(i18n.t('board.card.action.remove'), 'Eliminar bloque');
  assert.equal(i18n.t('board.card.connect.aria'), 'Conectar este bloque');
  assert.equal(i18n.t('board.connectTooltip'), 'Conectar');
  assert.equal(i18n.t('board.connection.dot.aria'), 'Punto de conexión');
  assert.equal(i18n.t('board.group.placeholderName'), 'Nombrar grupo');
  assert.equal(i18n.t('board.group.tooltip'), 'Arrastrar grupo · Clic: editar nombre');
  assert.equal(i18n.t('board.group.action.remove'), 'Eliminar contenedor');
  assert.equal(i18n.t('board.group.renameInput'), 'Nombre del grupo');

  assert.equal(inEnglish(() => i18n.t('board.card.action.showMore')), 'Show more');
  assert.equal(inEnglish(() => i18n.t('board.connectTooltip')), 'Connect');
});

test('board: arquitectura con interpolación de nivel', () => {
  assert.equal(i18n.t('board.architecture.title'), 'Arquitectura del documento');
  assert.equal(i18n.t('board.architecture.invitation.mainTopic'), 'Define el título o tema principal');
  assert.equal(i18n.t('board.architecture.level.title'), 'Título');
  assert.equal(i18n.t('board.architecture.level.numbered', { level: 2 }), 'Nivel 2');
  assert.equal(i18n.t('board.architecture.action.moveUp'), 'Mover arriba');
  assert.equal(i18n.t('board.architecture.badge.inactive'), 'Desactivada');
  assert.equal(i18n.t('board.architecture.tray.title'), 'Material sin asignar');
  assert.equal(i18n.t('board.architecture.add.subsection'), 'Añadir subsección');
  assert.equal(i18n.t('board.architecture.menu.untitled'), 'Sin título');

  assert.equal(
    inEnglish(() => i18n.t('board.architecture.level.numbered', { level: 2 })),
    'Level 2'
  );
});

test('board: documento y pulido', () => {
  assert.equal(i18n.t('board.document.empty.title'), 'El documento aún no tiene contenido');
  assert.equal(i18n.t('board.document.heading.untitled'), 'Sin título');
  assert.equal(i18n.t('board.document.badge.original'), 'Original');
  assert.equal(i18n.t('board.document.version.personal'), 'Personal');
  assert.equal(i18n.t('board.document.action.toggleVersion'), 'Alternar versión del fragmento');
  assert.equal(i18n.t('modal.polish.buttonShort'), 'Pulir');
  assert.equal(i18n.t('modal.polish.title'), 'Pulir fragmento');
});

// ============================================================
// 3. FOCUS (workspace, título, panel, fuentes)
// ============================================================

test('focus: workspace, título y cierre', () => {
  assert.equal(i18n.t('focus.workspace.board'), 'Board');
  assert.equal(i18n.t('focus.workspace.close'), 'Cerrar');
  assert.equal(i18n.t('focus.workspace.library'), 'Biblioteca');
  assert.equal(i18n.t('focus.workspace.note'), 'Nota');
  assert.equal(i18n.t('focus.workspace.backToNote'), 'Volver a la nota');
  assert.equal(i18n.t('focus.workspace.openBoard'), 'Abrir Board');
  assert.equal(i18n.t('focus.title.noActiveNote'), 'Sin nota activa');
  assert.equal(i18n.t('focus.closeAria'), 'Cerrar modo Focus');
  assert.equal(i18n.t('focus.dragdrop.dropFailed'), 'No se pudo procesar el elemento soltado');

  assert.equal(inEnglish(() => i18n.t('focus.workspace.library')), 'Library');
});

test('focus: errores del panel con interpolación', () => {
  assert.equal(
    i18n.t('focus.pane.error.instanceNotFound', { instanceId: 'abc123' }),
    'Instancia de widget "abc123" no encontrada'
  );
  assert.equal(
    i18n.t('focus.pane.error.widgetNotFound', { typeId: 'tasks' }),
    'Widget "tasks" no encontrado'
  );
  assert.equal(
    inEnglish(() => i18n.t('focus.pane.error.widgetNotFound', { typeId: 'tasks' })),
    'Widget "tasks" not found'
  );
});

// ============================================================
// 4. BIBLIOTECA Y NAVEGADOR DE CAPACIDADES
// ============================================================

test('library: pestañas, columnas, acciones y estados vacíos', () => {
  assert.equal(i18n.t('library.tab.widgets'), 'WIDGETS');
  assert.equal(i18n.t('library.tab.assistant'), 'ASISTENTE');
  assert.equal(i18n.t('library.tab.recipes'), 'RECETAS');
  assert.equal(i18n.t('library.recipesEmpty'), 'Recetas');
  assert.equal(i18n.t('library.widgetsColumn.available'), 'Widgets disponibles');
  assert.equal(i18n.t('library.widgetsColumn.instances'), 'En esta nota');
  assert.equal(i18n.t('library.widgetsEmpty'), 'No hay widgets configurados.');
  assert.equal(i18n.t('library.widgetsAction.add'), 'Agregar widget');
  assert.equal(i18n.t('library.widgetsAction.delete'), 'Eliminar widget');
  assert.equal(i18n.t('library.instanceRenameTooltip'), 'Clic para renombrar');
  assert.equal(i18n.t('library.section.sources'), 'FUENTES');
  assert.equal(i18n.t('library.section.domains'), 'DOMINIOS');
  assert.equal(i18n.t('library.section.capabilities'), 'CAPACIDADES');
  assert.equal(
    i18n.t('library.capabilitiesEmpty'),
    'No hay capacidades disponibles en este dominio.'
  );
  assert.equal(i18n.t('ai.browser.title'), 'Trabajo');

  assert.equal(inEnglish(() => i18n.t('library.tab.assistant')), 'ASSISTANT');
  assert.equal(inEnglish(() => i18n.t('ai.browser.title')), 'Work');
});

// ============================================================
// 5. RECURSOS (modal de agregación)
// ============================================================

test('resources: modal, campos, placeholders y validaciones', () => {
  assert.equal(i18n.t('resources.modal.title'), 'Agregar recurso');
  assert.equal(i18n.t('resources.field.type'), 'Tipo');
  assert.equal(i18n.t('resources.type.file'), 'Archivo');
  assert.equal(i18n.t('resources.type.link'), 'Enlace');
  assert.equal(i18n.t('resources.placeholder.name'), 'Nombre del recurso');
  assert.equal(i18n.t('resources.placeholder.description'), 'Breve descripción...');
  assert.equal(i18n.t('resources.placeholder.file'), 'Selecciona un archivo...');
  assert.equal(i18n.t('resources.placeholder.tags'), 'ciencia, sistemas, referencia');
  assert.equal(i18n.t('resources.action.add'), 'Agregar');
  assert.equal(i18n.t('resources.action.browse'), 'Seleccionar');
  assert.equal(i18n.t('resources.validation.selectFile'), 'Selecciona un archivo');
  assert.equal(i18n.t('resources.validation.enterUrl'), 'Introduce una URL');
  assert.equal(i18n.t('resources.filePickerPlaceholder'), 'Buscar archivo...');

  assert.equal(inEnglish(() => i18n.t('resources.modal.title')), 'Add resource');
  assert.equal(inEnglish(() => i18n.t('resources.validation.enterUrl')), 'Enter a URL');
});

// ============================================================
// 6. CONTRATOS (fuente)
// ============================================================

test('AddResourceModal: selector por placeholder sustituido por referencia estable', () => {
  const source = readFileSync(
    join(root, 'src', 'focus', 'resources', 'AddResourceModal.ts'),
    'utf8'
  );

  assert.ok(!source.includes('querySelector(\'input[placeholder='));
  assert.ok(source.includes('private titleInput'));
  assert.ok(source.includes('this.titleInput = text.inputEl'));
  assert.ok(source.includes('this.titleInput.value = file.basename'));
  // Placeholder técnico conservado (no traducible).
  assert.ok(source.includes("'https://...'"));
});

test('navegadores usan resolutores compartidos (sin vía que ignore el idioma)', () => {
  const library = readFileSync(join(root, 'src', 'focus', 'LibraryBrowser.ts'), 'utf8');
  const browser = readFileSync(join(root, 'src', 'ai', 'capabilities', 'browser.ts'), 'utf8');

  for (const source of [library, browser]) {
    assert.ok(source.includes('getDomainLabel('));
    assert.ok(source.includes('getCapabilityLabel('));
    assert.ok(source.includes('getCapabilityDescription('));
    // Sin renderizado directo de labels heredados del registro.
    assert.ok(!source.includes('textContent = group.label'));
    assert.ok(!source.includes('textContent =\n      capability.label'));
  }

  // LibraryBrowser además resuelve definiciones de widgets con el
  // resolutor de la etapa 5 (no identity.label en bruto).
  assert.ok(library.includes('getWidgetDefinitionLabel(definition)'));
  assert.ok(!library.includes('text: definition.identity.label'));
});

test('Board: plurales del contexto vía claves i18n (sin formas hardcodeadas)', () => {
  const source = readFileSync(join(root, 'src', 'focus', 'Board.ts'), 'utf8');

  assert.ok(source.includes("i18n.tn(pluralKey, count)"));
  assert.ok(source.includes("'board.context.counts.activeFeminine'"));
  assert.ok(source.includes("'board.context.counts.pending'"));
  // Sin formas de plural literales en las llamadas.
  assert.ok(!source.includes("'activas'"));
  assert.ok(!source.includes("'pendientes'"));
});
