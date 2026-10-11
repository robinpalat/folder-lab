// ============================================================
// PRUEBAS: ETAPA 4 i18n — creación de notas y carpetas
// ============================================================
// Ejecutar con: npm test
//
// Verifica el RESULTADO resuelto (es/en + interpolaciones) de las
// claves que consumen FolderLabController, NoteService y los
// métodos vivos de ExportService. Los módulos importan Obsidian,
// por lo que se comprueba el catálogo vía el servicio
// empaquetado: es la misma resolución que ejecutan en runtime.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

function inEnglish(fn) {
  i18n.setLocale('en');
  try {
    return fn();
  } finally {
    i18n.setLocale('es');
  }
}

// ============================================================
// 1. CREACIÓN DE NOTAS
// ============================================================

test('notas: prompt, nombre por defecto y opción de menú', () => {
  assert.equal(i18n.t('notes.create.prompt'), 'Nombre de la nueva nota:');
  assert.equal(i18n.t('notes.create.defaultName'), 'Nueva nota');
  assert.equal(i18n.t('notes.create.menuItem'), 'Nueva nota');

  assert.equal(inEnglish(() => i18n.t('notes.create.prompt')), 'Name of the new note:');
  assert.equal(inEnglish(() => i18n.t('notes.create.menuItem')), 'New note');
});

test('notas: interpolación de nombre en creado/eliminado', () => {
  assert.equal(
    i18n.t('notes.created', { name: 'Capítulo 1.md' }),
    'Nota creada: Capítulo 1.md'
  );
  assert.equal(
    i18n.t('notes.deleted', { name: 'Borrador viejo.md' }),
    'Nota eliminada: Borrador viejo.md'
  );

  assert.equal(
    inEnglish(() => i18n.t('notes.created', { name: 'Capítulo 1.md' })),
    'Note created: Capítulo 1.md'
  );
});

test('notas: errores de validación y duplicado', () => {
  assert.equal(i18n.t('errors.note.emptyName'), 'El nombre no puede estar vacío');
  assert.equal(
    i18n.t('errors.note.duplicateName', { name: 'Intro.md' }),
    'Ya existe una nota con el nombre "Intro.md"'
  );
  assert.equal(i18n.t('errors.note.invalidFile'), '❌ Archivo no válido');
  assert.equal(i18n.t('errors.note.deleteFailed'), '❌ Error al eliminar la nota');

  assert.equal(
    inEnglish(() => i18n.t('errors.note.duplicateName', { name: 'Intro.md' })),
    'A note named "Intro.md" already exists'
  );
});

// ============================================================
// 2. CREACIÓN DE CARPETAS
// ============================================================

test('carpetas: prompt, opción de menú, validación y avisos', () => {
  assert.equal(i18n.t('folders.create.prompt'), 'Nombre de la nueva carpeta:');
  assert.equal(i18n.t('folders.create.menuItem'), 'Nueva carpeta');
  assert.equal(
    i18n.t('errors.folder.invalidName'),
    '❌ El nombre no puede contener barras ni segmentos de ruta'
  );
  assert.equal(
    i18n.t('errors.folder.alreadyExists', { name: 'Apéndice' }),
    'Ya existe una carpeta con el nombre "Apéndice"'
  );
  assert.equal(i18n.t('errors.folder.createFailed'), '❌ No se pudo crear la carpeta');
  assert.equal(
    i18n.t('folders.created', { name: 'Apéndice' }),
    'Carpeta creada: Apéndice'
  );

  assert.equal(inEnglish(() => i18n.t('folders.create.menuItem')), 'New folder');
  assert.equal(
    inEnglish(() => i18n.t('folders.created', { name: 'Apéndice' })),
    'Folder created: Apéndice'
  );
});

// ============================================================
// 3. AVISOS DEL CONTROLADOR (carpeta actual, raíz, orden, foco)
// ============================================================

test('controlador: avisos de navegación y selección', () => {
  assert.equal(i18n.t('errors.noFolderSelected'), 'No hay carpeta seleccionada');
  assert.equal(i18n.t('errors.noFolderSelectedMarked'), '❌ No hay carpeta seleccionada');
  assert.equal(i18n.t('errors.noFolderOrFileSelected'), 'No hay carpeta o archivo seleccionado');
  assert.equal(i18n.t('errors.noCurrentFolder'), 'No hay carpeta actual');
  assert.equal(i18n.t('errors.alreadyAtRoot'), 'Ya estás en la carpeta raíz');
  assert.equal(i18n.t('notices.orderUpdated'), 'Orden actualizado');

  assert.equal(inEnglish(() => i18n.t('errors.alreadyAtRoot')), 'You are already at the root folder');
  assert.equal(inEnglish(() => i18n.t('notices.orderUpdated')), 'Order updated');
});

test('controlador: inicialización y conteo de palabras', () => {
  assert.equal(
    i18n.t('errors.noRootConfigured'),
    '❌ No hay carpeta raíz configurada. Ve a Ajustes → Folder Lab'
  );
  assert.equal(
    i18n.t('errors.initFailed'),
    '❌ No fue posible inicializar el proyecto Folder Lab.'
  );
  assert.equal(
    i18n.t('errors.wordCount.noRootConfigured'),
    '❌ Configura la carpeta raíz en Ajustes → Folder Lab'
  );
  assert.equal(i18n.t('errors.wordCount.failed'), '❌ Error al contar palabras');
});

test('controlador: modo enfoque con estado interpolado anidado', () => {
  const enabled = i18n.t('notices.focusModeToggled', {
    state: i18n.t('notices.focusMode.enabled')
  });
  const disabled = i18n.t('notices.focusModeToggled', {
    state: i18n.t('notices.focusMode.disabled')
  });

  assert.equal(enabled, 'Modo enfoque activado');
  assert.equal(disabled, 'Modo enfoque desactivado');

  const enabledEn = inEnglish(() =>
    i18n.t('notices.focusModeToggled', {
      state: i18n.t('notices.focusMode.enabled')
    })
  );
  assert.equal(enabledEn, 'Focus mode enabled');
});

// ============================================================
// 4. EXPORTACIÓN (métodos vivos)
// ============================================================

test('exportación: menú y avisos de lista/índice', () => {
  assert.equal(i18n.t('export.copyListTxt'), 'Copiar lista (TXT)');
  assert.equal(i18n.t('export.exportAllNotes'), 'Exportar todas las notas');
  assert.equal(i18n.t('export.listCopiedToClipboard'), 'Lista copiada al portapapeles');
  assert.equal(
    i18n.t('export.indexFileCreated', { fileName: 'indice-Libro.txt' }),
    'indice-Libro.txt creado'
  );

  assert.equal(inEnglish(() => i18n.t('export.copyListTxt')), 'Copy list (TXT)');
  assert.equal(
    inEnglish(() => i18n.t('export.indexFileCreated', { fileName: 'indice-Libro.txt' })),
    'indice-Libro.txt created'
  );
});

test('exportación: compilado con nombre de archivo interpolado', () => {
  assert.equal(i18n.t('export.generatingCompile'), '📚 Generando compilado...');
  assert.equal(
    i18n.t('export.compiledUpdated', { name: 'Libro.md' }),
    'Compilado actualizado: Libro.md'
  );
  assert.equal(
    i18n.t('export.compiledCreated', { name: 'Libro.md' }),
    'Compilado creado: Libro.md'
  );
  assert.equal(i18n.t('errors.folderNotFound'), 'Carpeta no encontrada');

  assert.equal(
    inEnglish(() => i18n.t('export.compiledCreated', { name: 'Book.md' })),
    'Compiled note created: Book.md'
  );
});

test('exportación: plantillas del documento generado', () => {
  assert.equal(i18n.t('export.document.pendingContent'), '*[Contenido pendiente]*');
  assert.equal(i18n.t('export.document.noNotes'), '*No hay notas para compilar*');
  assert.equal(
    i18n.t('export.document.selectionHeading', { folder: 'Capítulos' }),
    '# Capítulos (selección)'
  );

  assert.equal(
    inEnglish(() => i18n.t('export.document.pendingContent')),
    '*[Content pending]*'
  );
});

test('exportación: error genérico con mensaje interpolado y fallback', () => {
  assert.equal(
    i18n.t('errors.withMessage', { message: 'disk full' }),
    'Error: disk full'
  );
  // El fallback «Error desconocido» se localiza por separado.
  assert.equal(
    i18n.t('errors.withMessage', { message: i18n.t('common.unknownError') }),
    'Error: Error desconocido'
  );

  assert.equal(
    inEnglish(() => i18n.t('errors.withMessage', { message: 'disk full' })),
    'Error: disk full'
  );
  assert.equal(
    inEnglish(() => i18n.t('errors.withMessage', { message: i18n.t('common.unknownError') })),
    'Error: Unknown error'
  );
});

// ============================================================
// 5. CONTRATOS FUNCIONALES (fuente)
// ============================================================

test('createNote sigue con un único escritor de orden (evento vault:create)', () => {
  const noteServiceSource = readFileSync(
    join(root, 'src', 'services', 'NoteService.ts'),
    'utf8'
  );

  const createNoteSection = noteServiceSource.slice(
    noteServiceSource.indexOf('async createNote'),
    noteServiceSource.indexOf('async loadGeneralNote')
  );

  // Regresión de la etapa de duplicación: createNote NO anexa al
  // orden (lo hace updateOrderOnCreate con dedupe). La migración
  // i18n no debe reintroducir esa ruta.
  assert.ok(!createNoteSection.includes('updateFolderOrder'));
  assert.ok(!createNoteSection.includes('getFolderOrder'));
  assert.ok(createNoteSection.includes('vault.create('));
  // Las validaciones siguen existiendo antes de crear.
  assert.ok(createNoteSection.includes('getFileByPath(filePath)'));
});

test('InputModal conserva el guard de envío único', () => {
  const modalSource = readFileSync(
    join(root, 'src', 'utils', 'ModalUtils.ts'),
    'utf8'
  );

  const inputModalSection = modalSource.slice(
    modalSource.indexOf('export class InputModal'),
    modalSource.indexOf('export class ConfirmModal')
  );

  assert.ok(inputModalSection.includes('private submitted'));
  assert.ok(inputModalSection.includes('if (this.submitted) return'));
});

test('los ids internos de exportación no cambian (nombres de archivo)', () => {
  const exportSource = readFileSync(
    join(root, 'src', 'services', 'ExportService.ts'),
    'utf8'
  );

  // Formatos de nombre de archivo persistidos/funcionales: no se
  // traducen ni se alteran.
  assert.ok(exportSource.includes('`indice-${folderPath.replace(/\\//g, \'-\')}.${ext}`'));
  assert.ok(exportSource.includes('`${folderPath}/${folder.name}.md`'));
});
