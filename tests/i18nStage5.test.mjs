// ============================================================
// PRUEBAS: ETAPA 5 i18n — widgets y controles
// ============================================================
// Ejecutar con: npm test
//
// Verifica: resolución de textos de definiciones (catálogo con
// fallback al JSON), etiquetas/descripciones de widgets en es/en,
// interpolaciones de avisos, y contratos de.persistencia de
// nombres de instancias y selects por identificador estable.
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
  getWidgetDefinitionLabel,
  getWidgetDefinitionDescription,
  getWidgetDefinitionEmptyState,
  getWidgetDefinitionPlaceholder,
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

// Definición de prueba con valores heredados (JSON) para fallback.
const tasksDefinition = {
  id: 'tasks',
  identity: { label: 'Tareas (JSON)', description: 'Descripción JSON' },
  emptyState: { message: 'Mensaje JSON' },
  input: { text: { placeholder: 'Placeholder JSON' } }
};

// ============================================================
// 1. TEXTOS DE DEFINICIONES (catálogo con fallback al JSON)
// ============================================================

test('definiciones: label/description/emptyState/placeholder desde el catálogo', () => {
  assert.equal(getWidgetDefinitionLabel(tasksDefinition), 'Tareas');
  assert.equal(getWidgetDefinitionDescription(tasksDefinition), 'Lista de tareas');
  assert.equal(getWidgetDefinitionEmptyState(tasksDefinition), 'Crea una tarea o arrastra aquí un texto');
  assert.equal(getWidgetDefinitionPlaceholder(tasksDefinition), 'Nueva tarea...');

  assert.equal(inEnglish(() => getWidgetDefinitionLabel(tasksDefinition)), 'Tasks');
  assert.equal(
    inEnglish(() => getWidgetDefinitionEmptyState(tasksDefinition)),
    'Create a task or drag text here'
  );
});

test('definiciones: ids sin clave en catálogo conservan el valor del JSON', () => {
  const custom = {
    id: 'custom-widget',
    identity: { label: 'Widget propio' },
    emptyState: { message: 'Vacío propio' }
  };

  assert.equal(getWidgetDefinitionLabel(custom), 'Widget propio');
  assert.equal(getWidgetDefinitionEmptyState(custom), 'Vacío propio');
  assert.equal(getWidgetDefinitionDescription(custom), '');
  assert.equal(getWidgetDefinitionPlaceholder(custom), '');
});

// ============================================================
// 2. WIDGETS REGISTRADOS Y NOMBRES POR DEFECTO
// ============================================================

test('widgets registrados: etiquetas y descripciones es/en', () => {
  assert.equal(i18n.t('widgets.registered.activeNote.label'), 'Nota activa');
  assert.equal(i18n.t('widgets.registered.notes.label'), 'Apuntes');
  assert.equal(i18n.t('widgets.registered.resources.label'), 'Archivos compartidos de la carpeta');
  assert.equal(i18n.t('widgets.registered.memory.label'), 'Asistente');
  assert.ok(i18n.t('widgets.registered.memory.description').startsWith('Utiliza inteligencia artificial'));

  assert.equal(inEnglish(() => i18n.t('widgets.registered.activeNote.label')), 'Active note');
  assert.equal(inEnglish(() => i18n.t('widgets.registered.memory.label')), 'Assistant');
});

test('nombres por defecto de instancia (solo al crear)', () => {
  assert.equal(i18n.t('widgets.managerDefaultName.assistant'), 'Asistente');
  assert.equal(i18n.t('widgets.managerDefaultName.notes'), 'Apuntes');
  assert.equal(inEnglish(() => i18n.t('widgets.managerDefaultName.assistant')), 'Assistant');
});

// ============================================================
// 3. ESTADOS VACÍOS, PLACEHOLDERS Y ACCIONES DE WIDGETS
// ============================================================

test('widget nota activa: etiqueta, aria interpolado y estados', () => {
  assert.equal(i18n.t('widgets.activeNote.label'), 'Nota');
  assert.equal(
    i18n.t('widgets.activeNote.editorAria', { name: 'Capítulo 1' }),
    'Editar Capítulo 1'
  );
  assert.equal(i18n.t('widgets.activeNote.placeholder'), 'Escribe en la nota activa…');
  assert.equal(
    i18n.t('widgets.activeNote.empty.noteRequired'),
    'Abre una nota Markdown para editarla aquí'
  );
  assert.equal(inEnglish(() => i18n.t('widgets.activeNote.label')), 'Note');
});

test('widget asistente: estados, placeholders, acciones y avisos', () => {
  assert.equal(
    i18n.t('widgets.memory.empty.apiKeyRequired'),
    'Configura tu API Key en Ajustes → Folder Lab'
  );
  assert.equal(i18n.t('widgets.memory.empty.noteRequired'), 'Abre una nota para usar el Asistente');
  assert.equal(i18n.t('widgets.memory.empty.noSavedResponses'), 'No hay respuestas guardadas.');
  assert.equal(i18n.t('widgets.memory.capability.placeholder'), 'Seleccionar');
  assert.equal(i18n.t('widgets.memory.action.apply'), 'Aplicar');
  assert.equal(i18n.t('widgets.common.session'), 'Sesión');
  assert.equal(i18n.t('widgets.common.sessionToday'), 'Hoy');
  assert.equal(i18n.t('widgets.memory.placeholder.result'), 'El resultado aparecerá aquí.');
  assert.equal(i18n.t('widgets.memory.notice.selectCapability'), 'Selecciona una capacidad');
  assert.equal(i18n.t('widgets.memory.status.processing'), 'Procesando');
  assert.equal(
    i18n.t('widgets.memory.error.sourceLoadFailed', { source: 'Apuntes' }),
    'No se pudo cargar la fuente "Apuntes".'
  );
  assert.equal(
    i18n.t('widgets.common.errorWithMessage', { message: 'timeout' }),
    'Error: timeout'
  );
  assert.equal(i18n.t('widgets.memory.error.unknown'), 'Error desconocido');

  assert.equal(inEnglish(() => i18n.t('widgets.memory.status.processing')), 'Processing');
  assert.equal(
    inEnglish(() => i18n.t('widgets.memory.error.sourceLoadFailed', { source: 'Notes' })),
    'Could not load the source "Notes".'
  );
});

test('widget apuntes: acciones, estados y avisos', () => {
  assert.equal(i18n.t('widgets.registered.notes.label'), 'Apuntes');
  assert.equal(i18n.t('widgets.notesWidget.action.save'), 'Guardar');
  assert.equal(i18n.t('widgets.notesWidget.action.copy'), 'Copiar apuntes');
  assert.equal(i18n.t('widgets.notesWidget.action.activate'), 'Activar apunte');
  assert.equal(i18n.t('widgets.notesWidget.action.deactivate'), 'Desactivar apunte');
  assert.equal(i18n.t('widgets.notesWidget.action.delete'), 'Eliminar apunte');
  assert.equal(i18n.t('widgets.notesWidget.empty.noteRequired'), 'Abre una nota para escribir apuntes');
  assert.equal(i18n.t('widgets.notesWidget.placeholder.draft'), 'Escribe tus apuntes...');
  assert.equal(i18n.t('widgets.notesWidget.notice.created'), 'Apunte creado');
  assert.equal(i18n.t('widgets.notesWidget.notice.saved'), 'Apunte guardado');

  assert.equal(inEnglish(() => i18n.t('widgets.notesWidget.action.save')), 'Save');
  assert.equal(inEnglish(() => i18n.t('widgets.notesWidget.notice.saved')), 'Note saved');
});

test('widget recursos: etiqueta, estados, acciones y avisos reutilizados', () => {
  assert.equal(i18n.t('widgets.resourcesWidget.label'), 'Recursos');
  assert.equal(i18n.t('widgets.resourcesWidget.empty.noteRequired'), 'Abre una nota para ver sus recursos');
  assert.equal(i18n.t('widgets.resourcesWidget.empty.noResources'), 'Sin recursos');
  assert.equal(
    i18n.t('widgets.resourcesWidget.action.addTooltip'),
    'Agregar recurso'
  );
  assert.equal(i18n.t('widgets.resourcesWidget.action.delete'), 'Eliminar recurso');
  // Reutilización del dominio resources (avisos compartidos).
  assert.equal(i18n.t('resources.notice.added'), 'Recurso agregado');
  assert.equal(i18n.t('resources.notice.deleted'), 'Recurso eliminado');
  assert.equal(i18n.t('resources.notice.fileNotFound'), 'Archivo no encontrado');

  assert.equal(inEnglish(() => i18n.t('widgets.resourcesWidget.label')), 'Resources');
  assert.equal(inEnglish(() => i18n.t('resources.notice.added')), 'Resource added');
});

test('widget declarativo: interpolación del label de instancia', () => {
  assert.equal(
    i18n.t('widgets.declarative.empty.noteRequired', { label: 'Tareas' }),
    'Abre una nota para usar Tareas'
  );
  assert.equal(
    i18n.t('widgets.declarative.notice.cleared', { label: 'Tareas' }),
    'Tareas vaciadas'
  );
  assert.equal(
    i18n.t('widgets.declarative.notice.movedTo', { label: 'Snips' }),
    'Elemento movido a Snips'
  );
  assert.equal(
    i18n.t('widgets.declarative.notice.addedTo', { label: 'Snips' }),
    'Elemento añadido a Snips'
  );
  assert.equal(i18n.t('widgets.declarative.notice.completedCleared'), 'Tareas completadas eliminadas');
  assert.equal(i18n.t('widgets.declarative.action.selectCandidate'), 'Seleccionar candidato');
  assert.equal(i18n.t('actions.deleteElement'), 'Eliminar elemento');
  assert.equal(i18n.t('widgets.common.expand'), 'Expandir');
  assert.equal(i18n.t('widgets.common.collapse'), 'Contraer');
  assert.equal(i18n.t('widgets.controls.sourceFallbackLabel'), 'Fuente');
  assert.equal(i18n.t('focus.dragdrop.dropFailed'), 'No se pudo procesar el elemento soltado');
  assert.equal(i18n.t('notices.noActiveNote'), 'No hay nota activa');

  assert.equal(
    inEnglish(() => i18n.t('widgets.declarative.notice.cleared', { label: 'Tasks' })),
    'Tasks cleared'
  );
});

test('etiquetas de fuentes (compartidas con el navegador de capacidades)', () => {
  assert.equal(i18n.t('focus.sources.note'), 'Nota');
  assert.equal(i18n.t('focus.sources.notes'), 'Apuntes');
  assert.equal(i18n.t('focus.sources.snips'), 'Snips');
  assert.equal(i18n.t('focus.sources.tasks'), 'Tareas');
  assert.equal(inEnglish(() => i18n.t('focus.sources.tasks')), 'Tasks');
});

// ============================================================
// 4. CONTRATOS: NOMBRES PERSISTIDOS Y SELECTORES ESTABLES
// ============================================================

test('WidgetManager: defaults traducidos al crear; nombres persistidos intactos', () => {
  const source = readFileSync(join(root, 'src', 'focus', 'WidgetManager.ts'), 'utf8');

  // Sin nombres hardcodeados: se usan claves i18n.
  assert.ok(!source.includes("'Asistente'"));
  assert.ok(!source.includes("'Apuntes'"));
  assert.ok(source.includes("i18n.t('widgets.managerDefaultName.assistant')"));
  assert.ok(source.includes("i18n.t('widgets.managerDefaultName.notes')"));

  // El fallback del nombre es la etiqueta traducible de la definición…
  assert.ok(source.includes('getWidgetDefinitionLabel(definition)'));
  // …pero un nombre provisto (persistido o del llamante) tiene
  // prioridad: `name?.trim() ||` sigue en el mismo orden.
  assert.equal(
    (source.match(/name: name\?\.trim\(\) \|\|/g) || []).length,
    2
  );

  // renameInstance escribe el nombre del usuario directamente:
  // no pasa por i18n ni reescribe nombres guardados.
  const renameSection = source.slice(
    source.indexOf('async renameInstance'),
    source.indexOf('async renameInstance') + 600
  );
  assert.ok(!renameSection.includes('i18n'));
});

test('NotesWidget: la visibilidad de «Guardar» usa data-control-id, no el texto', () => {
  const source = readFileSync(
    join(root, 'src', 'focus', 'widgets', 'NotesWidget.ts'),
    'utf8'
  );

  const section = source.slice(
    source.indexOf('updateSaveActionVisibility'),
    source.indexOf('enterCaptureView')
  );

  // La comparación por texto visible se eliminó (rompería con la
  // traducción); queda solo el identificador estable.
  assert.ok(!section.includes('Guardar'));
  assert.ok(section.includes(`controlId === "save"`));
  assert.ok(section.includes(`getAttribute('data-control-id')`));
});

test('valores funcionales no traducidos: WEB/ARCHIVO, nombre de archivo y dominio', () => {
  const resources = readFileSync(
    join(root, 'src', 'focus', 'widgets', 'ResourcesWidget.ts'),
    'utf8'
  );
  const utils = readFileSync(
    join(root, 'src', 'focus', 'FocusWidgetsUtils.ts'),
    'utf8'
  );
  const memory = readFileSync(
    join(root, 'src', 'focus', 'widgets', 'MemoryWidget.ts'),
    'utf8'
  );

  // Etiquetas técnicas de tipo (decisiones de fase 1).
  assert.ok(resources.includes(`'WEB'`));
  assert.ok(resources.includes(`'ARCHIVO'`));
  // Nombre por defecto de archivo importado: es un dato de vault.
  assert.ok(utils.includes(`'recurso'`));
  // Id interno de dominio (no etiqueta visible garantizada).
  assert.ok(memory.includes(`'Memoria'`));
});

test('widget-definitions.json: identidad y textos heredados intactos', () => {
  const data = JSON.parse(
    readFileSync(join(root, 'src', 'focus', 'widget-definitions.json'), 'utf8')
  );

  // Estructura real: { widgets: { <id>: definición } } — ids como
  // claves, sin cambios.
  const ids = Object.keys(data.widgets);
  assert.deepEqual(ids, ['snips', 'collections', 'restrictions', 'candidates', 'tasks']);

  const tasks = data.widgets.tasks;
  assert.equal(tasks.id, 'tasks');
  // Campos funcionales presentes y sin tocar.
  assert.ok(tasks.semantic || tasks.storage || tasks.entity);
  // Los textos heredados quedan como fallback del catálogo.
  assert.equal(tasks.identity.label, 'Tareas');
  assert.equal(tasks.emptyState.message, 'Crea una tarea o arrastra aquí un texto');
});
