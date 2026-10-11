// ============================================================
// PRUEBAS: presentación del encabezado, meta y rutas
// ============================================================
// Ejecutar con: npm test
//
// Los módulos bajo prueba son puros (sin Obsidian ni DOM): se
// transpilan con esbuild y se cargan como ESM.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import esbuild, { transformSync } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/**
 * Empaqueta headerStats + i18n en un ÚNICO módulo (mismo
 * singleton i18n) para poder cambiar de idioma en los tests.
 */
async function loadHeaderStatsModule() {
  const entry = `
export * from './src/utils/headerStats.ts';
export { i18n, I18nService } from './src/i18n/I18nService.ts';
`;
  const result = await esbuild.build({
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

  const code = result.outputFiles[0].text;
  const url =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(url);
}

async function loadModule(relativePath) {
  const source = readFileSync(join(root, relativePath), 'utf8');
  const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
  const url =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(url);
}

const {
  buildHeaderStatsDisplay,
  clampPercentage,
  parseBookGoalInput,
  shouldStartSessionWordCount,
  i18n
} = await loadHeaderStatsModule();

const { isSameFolderPath, validateNewFolderName } =
  await loadModule('src/utils/folderUtils.ts');

// ============================================================
// RAÍZ MASTER: contrato propio de cuatro valores
// ============================================================

test('raíz master: notas directas · notas totales · carpetas (+ % con meta)', () => {
  const display = buildHeaderStatsDisplay({
    kind: 'master-root',
    directNotes: 3,
    totalNotes: 128,
    totalFolders: 8,
    goal: { words: 32000, target: 80000 }
  });

  assert.equal(
    display.noteText,
    '3 notas · 128 notas totales · 8 carpetas'
  );
  assert.equal(display.suffixText, ' · 40 % completado');
  assert.equal(display.suffixTitle, '32000 / 80000 palabras');
});

test('raíz master sin meta: los tres recuentos, sin %', () => {
  const display = buildHeaderStatsDisplay({
    kind: 'master-root',
    directNotes: 3,
    totalNotes: 128,
    totalFolders: 8,
    goal: null
  });

  assert.equal(
    display.noteText,
    '3 notas · 128 notas totales · 8 carpetas'
  );
  assert.equal(display.suffixText, null);
});

test('raíz master sin notas directas: omite el cero y mantiene total y carpetas', () => {
  const display = buildHeaderStatsDisplay({
    kind: 'master-root',
    directNotes: 0,
    totalNotes: 128,
    totalFolders: 8,
    goal: { words: 72000, target: 80000 }
  });

  // La omisión de ceros no elimina el total del libro ni el %.
  assert.equal(
    display.noteText,
    '128 notas totales · 8 carpetas'
  );
  assert.equal(display.suffixText, ' · 90 % completado');
});

test('raíz master: el % solo aparece con meta Y conteo válido (goal con target > 0)', () => {
  const invalidCount = buildHeaderStatsDisplay({
    kind: 'master-root',
    directNotes: 1,
    totalNotes: 10,
    totalFolders: 2,
    goal: null
  });
  assert.equal(invalidCount.suffixText, null);

  const zeroTarget = buildHeaderStatsDisplay({
    kind: 'master-root',
    directNotes: 1,
    totalNotes: 10,
    totalFolders: 2,
    goal: { words: 100, target: 0 }
  });
  assert.equal(zeroTarget.suffixText, null);
});

test('el porcentaje lleva la etiqueta «% completado» (nunca un número sin explicar)', () => {
  const display = buildHeaderStatsDisplay({
    kind: 'master-root',
    directNotes: 3,
    totalNotes: 128,
    totalFolders: 8,
    goal: { words: 24000, target: 100000 }
  });

  assert.equal(display.suffixText, ' · 24 % completado');
  // Sin cifras extra de meta en el encabezado: la meta vive en
  // el tooltip y en el diálogo.
  assert.equal(display.noteText, '3 notas · 128 notas totales · 8 carpetas');
  assert.equal(display.suffixTitle, '24000 / 100000 palabras');
});

test('master: omite carpetas en cero pero conserva notas directas y total', () => {
  const display = buildHeaderStatsDisplay({
    kind: 'master-root',
    directNotes: 3,
    totalNotes: 128,
    totalFolders: 0
  });

  assert.equal(display.noteText, '3 notas · 128 notas totales');
});

test('master: sin directas ni carpetas queda solo el total del libro', () => {
  const display = buildHeaderStatsDisplay({
    kind: 'master-root',
    directNotes: 0,
    totalNotes: 128,
    totalFolders: 0,
    goal: { words: 72000, target: 80000 }
  });

  // El total y el % no se ocultan por la regla de ceros.
  assert.equal(display.noteText, '128 notas totales');
  assert.equal(display.suffixText, ' · 90 % completado');
});

test('master: concordancia singular/plural', () => {
  const display = buildHeaderStatsDisplay({
    kind: 'master-root',
    directNotes: 1,
    totalNotes: 1,
    totalFolders: 1
  });

  assert.equal(display.noteText, '1 nota · 1 nota total · 1 carpeta');
});

// ============================================================
// NAVEGACIÓN NORMAL (SUBCARPETA): solo conteos positivos
// ============================================================

test('tabla de presentación: notas y carpetas con omisión de ceros', () => {
  const cases = [
    // [notes, subfolders, esperado]
    [5, 3, '5 notas · 3 carpetas'],
    [0, 3, '3 carpetas'],
    [5, 0, '5 notas'],
    [0, 0, '0 notas'], // única excepción: vacío total
    [1, 0, '1 nota'],
    [0, 1, '1 carpeta']
  ];

  for (const [notes, subfolders, expected] of cases) {
    const display = buildHeaderStatsDisplay({
      kind: 'folder',
      notes,
      subfolders
    });
    assert.equal(display.noteText, expected, `notas=${notes}, carpetas=${subfolders}`);
  }
});

test('concordancia singular/plural en la navegación normal', () => {
  assert.equal(
    buildHeaderStatsDisplay({ kind: 'folder', notes: 1, subfolders: 1 }).noteText,
    '1 nota · 1 carpeta'
  );
  assert.equal(
    buildHeaderStatsDisplay({ kind: 'folder', notes: 2, subfolders: 1 }).noteText,
    '2 notas · 1 carpeta'
  );
  assert.equal(
    buildHeaderStatsDisplay({ kind: 'folder', notes: 1, subfolders: 2 }).noteText,
    '1 nota · 2 carpetas'
  );
});

test('carpeta vacía: muestra «0 notas», nunca cadena vacía', () => {
  const display = buildHeaderStatsDisplay({
    kind: 'folder',
    notes: 0,
    subfolders: 0
  });

  assert.equal(display.noteText, '0 notas');
  assert.notEqual(display.noteText, '');
});

test('sin separadores sobrantes: un solo valor no lleva « · »', () => {
  const onlyNotes = buildHeaderStatsDisplay({
    kind: 'folder',
    notes: 5,
    subfolders: 0
  });
  assert.equal(onlyNotes.noteText.includes(' · '), false);

  const onlyFolders = buildHeaderStatsDisplay({
    kind: 'folder',
    notes: 0,
    subfolders: 3
  });
  assert.equal(onlyFolders.noteText.includes(' · '), false);
});

test('la palabra «subcarpetas» nunca aparece en el encabezado', () => {
  const models = [
    { kind: 'folder', notes: 5, subfolders: 3 },
    { kind: 'folder', notes: 0, subfolders: 2 },
    { kind: 'folder', notes: 2, subfolders: 0 },
    { kind: 'folder', notes: 0, subfolders: 0 },
    {
      kind: 'master-root',
      directNotes: 3,
      totalNotes: 128,
      totalFolders: 8,
      goal: { words: 32000, target: 80000 }
    }
  ];

  for (const model of models) {
    const display = buildHeaderStatsDisplay(model);
    assert.ok(
      !display.noteText.includes('subcarpeta'),
      `no debe decir «subcarpetas»: ${display.noteText}`
    );
  }
});

test('subcarpeta: sin total del libro ni porcentaje', () => {
  const display = buildHeaderStatsDisplay({
    kind: 'folder',
    notes: 4,
    subfolders: 1
  });

  assert.equal(display.suffixText, null);
  assert.equal(display.suffixTitle, null);
});

// ============================================================
// «TODAS LAS CARPETAS»: únicamente el total de carpetas
// ============================================================

test('todas las carpetas: solo «N carpetas» (sin subcarpetas)', () => {
  const display = buildHeaderStatsDisplay({
    kind: 'folders',
    folders: 8
  });

  assert.equal(display.noteText, '8 carpetas');
  assert.equal(display.suffixText, null);
  assert.equal(display.suffixTitle, null);
});

test('todas las carpetas vacías: «0 carpetas»', () => {
  assert.equal(
    buildHeaderStatsDisplay({ kind: 'folders', folders: 0 }).noteText,
    '0 carpetas'
  );
});

// ============================================================
// «TODAS LAS NOTAS»: únicamente el total de notas de la vista
// ============================================================

test('todas las notas: solo «N notas»', () => {
  const display = buildHeaderStatsDisplay({ kind: 'notes', notes: 128 });

  assert.equal(display.noteText, '128 notas');
  assert.equal(display.suffixText, null);
  assert.equal(display.suffixTitle, null);
});

test('todas las notas vacías: «0 notas»', () => {
  assert.equal(
    buildHeaderStatsDisplay({ kind: 'notes', notes: 0 }).noteText,
    '0 notas'
  );
});

// ============================================================
// «ARCHIVOS RECIENTES»: solo los archivos de la lista
// ============================================================

test('archivos recientes: solo «N archivos recientes»', () => {
  const display = buildHeaderStatsDisplay({ kind: 'recent', files: 5 });

  assert.equal(display.noteText, '5 archivos recientes');
  assert.equal(display.suffixText, null);
});

test('archivos recientes vacíos: «0 archivos recientes»', () => {
  assert.equal(
    buildHeaderStatsDisplay({ kind: 'recent', files: 0 }).noteText,
    '0 archivos recientes'
  );
});

// ============================================================
// NINGUNA VISTA GLOBAL HEREDA EL % DE MASTER
// ============================================================

test('las vistas globales ignoran cualquier goal colado (solo master-root tiene %)', () => {
  const goal = { words: 72000, target: 80000 };

  // Propiedades extra ignoradas por el contrato discriminado.
  const folders = buildHeaderStatsDisplay({ kind: 'folders', folders: 8, goal });
  const notes = buildHeaderStatsDisplay({ kind: 'notes', notes: 128, goal });
  const recent = buildHeaderStatsDisplay({ kind: 'recent', files: 5, goal });
  const folder = buildHeaderStatsDisplay({ kind: 'folder', notes: 1, subfolders: 1, goal });

  assert.equal(folders.suffixText, null);
  assert.equal(notes.suffixText, null);
  assert.equal(recent.suffixText, null);
  assert.equal(folder.suffixText, null);
});

// ============================================================
// PORCENTAJE Y PARSEO DE LA META
// ============================================================

test('clampPercentage limita al rango [0, 100] y redondea', () => {
  assert.equal(clampPercentage(150), 100);
  assert.equal(clampPercentage(-20), 0);
  assert.equal(clampPercentage(NaN), 0);
  assert.equal(clampPercentage(33.4), 33);
});

test('meta superada al 100%: el % no excede 100', () => {
  const display = buildHeaderStatsDisplay({
    kind: 'master-root',
    directNotes: 1,
    totalNotes: 3,
    totalFolders: 1,
    goal: { words: 90000, target: 80000 }
  });

  assert.equal(display.suffixText, ' · 100 % completado');
  assert.equal(display.suffixTitle, '90000 / 80000 palabras');
});

test('cambiar la meta recalcula el % con el mismo conteo en memoria', () => {
  const words = 72000;
  const base = {
    kind: 'master-root',
    directNotes: 2,
    totalNotes: 40,
    totalFolders: 5
  };

  const before = buildHeaderStatsDisplay({
    ...base,
    goal: { words, target: 90000 }
  });
  assert.equal(before.suffixText, ' · 80 % completado');

  const after = buildHeaderStatsDisplay({
    ...base,
    goal: { words, target: 80000 }
  });
  assert.equal(after.suffixText, ' · 90 % completado');
});

test('parseBookGoalInput: entero positivo válido', () => {
  assert.deepEqual(parseBookGoalInput('80000'), {
    kind: 'valid',
    value: 80000
  });
  assert.deepEqual(parseBookGoalInput(' 42 '), {
    kind: 'valid',
    value: 42
  });
});

test('parseBookGoalInput: vacío → empty (quitar meta)', () => {
  assert.deepEqual(parseBookGoalInput(''), { kind: 'empty' });
  assert.deepEqual(parseBookGoalInput('   '), { kind: 'empty' });
});

test('parseBookGoalInput: valores inválidos rechazados', () => {
  assert.deepEqual(parseBookGoalInput('0'), { kind: 'invalid' });
  assert.deepEqual(parseBookGoalInput('-5'), { kind: 'invalid' });
  assert.deepEqual(parseBookGoalInput('1.5'), { kind: 'invalid' });
  assert.deepEqual(parseBookGoalInput('abc'), { kind: 'invalid' });
  assert.deepEqual(parseBookGoalInput('1e3'), { kind: 'invalid' });
});

// ============================================================
// INICIALIZACIÓN AUTOMÁTICA DE SESIÓN DEL CONTEO
// ============================================================

test('inicio con meta y sin caché: se inicia automáticamente un conteo', () => {
  assert.equal(
    shouldStartSessionWordCount({
      alreadyStarted: false,
      goal: 80000,
      hasCachedResult: false
    }),
    true
  );
});

test('sin meta configurada: no se inicia ningún conteo', () => {
  assert.equal(
    shouldStartSessionWordCount({
      alreadyStarted: false,
      goal: 0,
      hasCachedResult: false
    }),
    false
  );
});

test('resultado ya disponible: no se provoca otro conteo', () => {
  assert.equal(
    shouldStartSessionWordCount({
      alreadyStarted: false,
      goal: 80000,
      hasCachedResult: true
    }),
    false
  );
});

test('segunda ruta de inicialización: la bandera impide duplicar el trabajo', () => {
  assert.equal(
    shouldStartSessionWordCount({
      alreadyStarted: true,
      goal: 80000,
      hasCachedResult: false
    }),
    false
  );
});

// ============================================================
// IDENTIDAD DE RAÍZ MASTER (por ruta normalizada, no nombre)
// ============================================================

test('isSameFolderPath: rutas idénticas y con barra final', () => {
  assert.equal(isSameFolderPath('Libro', 'Libro'), true);
  assert.equal(isSameFolderPath('Libro/', 'Libro'), true);
  assert.equal(isSameFolderPath('a/Libro', 'a/Libro/'), true);
});

test('isSameFolderPath: raíz física "" es identidad propia', () => {
  assert.equal(isSameFolderPath('', ''), true);
  assert.equal(isSameFolderPath('', null), true);
  assert.equal(isSameFolderPath('', 'Libro'), false);
});

test('isSameFolderPath: rutas distintas (incl. mismo nombre en otro nivel)', () => {
  assert.equal(isSameFolderPath('Libro/cap1', 'Libro/cap2'), false);
  // El nombre visible coincide pero la identidad de ruta no.
  assert.equal(isSameFolderPath('a/Libro', 'b/Libro'), false);
});

// ============================================================
// CREACIÓN DE CARPETAS: VALIDACIÓN DE NOMBRE
// ============================================================

test('validateNewFolderName: nombre válido (recortado)', () => {
  assert.deepEqual(validateNewFolderName('  Capítulo 1  '), {
    ok: true,
    name: 'Capítulo 1'
  });
});

test('validateNewFolderName: vacío o solo espacios → empty', () => {
  assert.deepEqual(validateNewFolderName(''), {
    ok: false,
    reason: 'empty'
  });
  assert.deepEqual(validateNewFolderName('   '), {
    ok: false,
    reason: 'empty'
  });
});

test('validateNewFolderName: segmentos de ruta rechazados', () => {
  for (const bad of ['a/b', 'a\\b', '.', '..', '../fuera', 'carpeta/']) {
    assert.deepEqual(validateNewFolderName(bad), {
      ok: false,
      reason: 'path-segment'
    }, `debería rechazar: ${bad}`);
  }
});

// ============================================================
// ARQUITECTURA: encabezado sin conteos de palabras ni valores
// heredados entre vistas (verificación a nivel de fuente)
// ============================================================

test('HeaderComponent y FolderLabView no ejecutan countWordsInBook', () => {
  const headerSource = readFileSync(
    join(here, '..', 'src', 'layout', 'HeaderComponent.ts'),
    'utf8'
  );
  const viewSource = readFileSync(
    join(here, '..', 'src', 'views', 'FolderLabView.ts'),
    'utf8'
  );

  assert.ok(!headerSource.includes('countWordsInBook'));
  assert.ok(!viewSource.includes('countWordsInBook'));
});

test('el controlador solo recorre el libro en getWordCountResult', () => {
  const controllerSource = readFileSync(
    join(here, '..', 'src', 'core', 'FolderLabController.ts'),
    'utf8'
  );

  const calls = controllerSource.split('countWordsInBook()').length - 1;
  // Una única invocación: dentro de getWordCountResult (la fábrica
  // de la caché). Ni el encabezado ni el diálogo la repiten.
  assert.equal(calls, 1);
});

test('la vista de recientes fija su propio modelo en todas sus rutas', () => {
  const viewSource = readFileSync(
    join(here, '..', 'src', 'views', 'FolderLabView.ts'),
    'utf8'
  );

  // El renderizador de recientes publica kind 'recent' (también
  // en el caso vacío) y el guard de loadFolder protege el modo.
  const recentSection = viewSource.slice(
    viewSource.indexOf('private async renderRecentNotesMode'),
    viewSource.indexOf('private async renderNormalModeProperties')
  );

  assert.ok(recentSection.includes("kind: 'recent'"));
  assert.ok(recentSection.includes('files: 0'));
  assert.ok(viewSource.includes('isRecentNotesMode()'));
});

test('StatsService cuenta notas y carpetas del libro sin leer contenidos', () => {
  const statsSource = readFileSync(
    join(here, '..', 'src', 'services', 'StatsService.ts'),
    'utf8'
  );

  const fn = statsSource.slice(
    statsSource.indexOf('countBookNotesAndFolders(folderPath'),
    statsSource.indexOf('async calculateNoteStats')
  );

  // Recorrido recursivo de metadatos: sin vault.read.
  assert.ok(fn.includes('const walk'));
  assert.ok(!fn.includes('vault.read'));
  // Respeta las exclusiones de carpetas internas/ocultas.
  assert.ok(fn.includes('INTERNAL_FOLDER'));
});

test('el total de carpetas de master usa el mismo criterio que la navegación', () => {
  const statsSource = readFileSync(
    join(here, '..', 'src', 'services', 'StatsService.ts'),
    'utf8'
  );
  const subfolderViewSource = readFileSync(
    join(here, '..', 'src', 'views', 'SubfolderView.ts'),
    'utf8'
  );

  const fn = statsSource.slice(
    statsSource.indexOf('countBookNotesAndFolders(folderPath'),
    statsSource.indexOf('async calculateNoteStats')
  );

  // Ambos recorridos comparten el criterio de elegibilidad de
  // carpetas: isHiddenFolderName ('.' y '_') + carpeta interna.
  // Así el encabezado master no cuenta carpetas que la
  // navegación no muestra (p. ej. carpetas con prefijo '_').
  assert.ok(fn.includes('isHiddenFolderName(child.name)'));
  assert.ok(subfolderViewSource.includes('isHiddenFolderName(child.name)'));
});

test('la vista inicia el conteo en segundo plano y solo refresca master', () => {
  const viewSource = readFileSync(
    join(here, '..', 'src', 'views', 'FolderLabView.ts'),
    'utf8'
  );

  // onOpen lanza la inicialización sin await (segundo plano) y
  // el método está protegido por la bandera de sesión.
  const onOpenSection = viewSource.slice(
    viewSource.indexOf('async onOpen()'),
    viewSource.indexOf('private showExplorerMode')
  );
  assert.ok(
    onOpenSection.includes('this.initializeBookWordCountInBackground()')
  );

  const initSection = viewSource.slice(
    viewSource.indexOf('private initializeBookWordCountInBackground'),
    viewSource.indexOf('private showExplorerMode')
  );

  // Bandera única por sesión + decisión pura de arranque.
  assert.ok(initSection.includes('wordCountInitStarted'));
  assert.ok(initSection.includes('shouldStartSessionWordCount'));

  // Al terminar, el encabezado solo se refresca en la raíz
  // master: el modo activo manda y no se pisan otras vistas.
  assert.ok(initSection.includes('isAtMasterRoot()'));
  assert.ok(initSection.includes('refreshHeaderStatistics()'));

  // Sin temporizadores ni sondeos.
  assert.ok(!initSection.includes('setTimeout'));
  assert.ok(!initSection.includes('setInterval'));
});

// ============================================================
// BOTÓN «+»: MENÚ Y CREACIÓN SIN DUPLICADOS
// ============================================================

test('el botón «+» abre el menú contextual (no crea directamente)', () => {
  const headerSource = readFileSync(
    join(here, '..', 'src', 'layout', 'HeaderComponent.ts'),
    'utf8'
  );

  const headerSection = headerSource.slice(
    headerSource.indexOf('const newNoteBtn'),
    headerSource.indexOf('const compileBtn')
  );

  // El botón delega en el menú; ya no llama directamente a
  // createNewNote.
  assert.ok(headerSection.includes('showCreateMenu'));
  assert.ok(!headerSection.includes('createNewNote'));
});

test('el menú ofrece «Nueva nota» y «Nueva carpeta»', () => {
  const controllerSource = readFileSync(
    join(here, '..', 'src', 'core', 'FolderLabController.ts'),
    'utf8'
  );

  const menuSection = controllerSource.slice(
    controllerSource.indexOf('showCreateMenu(button'),
    controllerSource.indexOf('getBookGoal(): number')
  );

  assert.ok(menuSection.includes("i18n.t('notes.create.menuItem')"));
  assert.ok(menuSection.includes("i18n.t('folders.create.menuItem')"));
  // Menú nativo de Obsidian: cierre por Escape/clic fuera incluido.
  assert.ok(menuSection.includes('new Menu()'));
});

test('createNote no anexa al orden: un solo escritor (evento vault:create)', () => {
  const noteServiceSource = readFileSync(
    join(here, '..', 'src', 'services', 'NoteService.ts'),
    'utf8'
  );

  const createNoteSection = noteServiceSource.slice(
    noteServiceSource.indexOf('async createNote'),
    noteServiceSource.indexOf('async loadGeneralNote')
  );

  // Causa raíz de la nota duplicada: la anexión ciega al orden
  // desde createNote competía con updateOrderOnCreate y
  // duplicaba la entrada en la lista. Ahora el único escritor
  // es el handler del evento, con dedupe.
  assert.ok(!createNoteSection.includes('updateFolderOrder'));
  assert.ok(!createNoteSection.includes('getFolderOrder'));
  assert.ok(createNoteSection.includes('vault.create('));
});

test('InputModal tiene guard de envío único (Enter y clic comparten submit)', () => {
  const modalSource = readFileSync(
    join(here, '..', 'src', 'utils', 'ModalUtils.ts'),
    'utf8'
  );

  const inputModalSection = modalSource.slice(
    modalSource.indexOf('export class InputModal'),
    modalSource.indexOf('export class ConfirmModal')
  );

  // Una sola función submit() idempotente para botón y keydown.
  assert.ok(inputModalSection.includes('private submitted'));
  assert.ok(inputModalSection.includes('private submit('));
  assert.ok(inputModalSection.includes('if (this.submitted) return'));
  // El keydown de Enter pasa por submit (no una segunda vía).
  const enterHandlers = inputModalSection.split("e.key === 'Enter'").length - 1;
  assert.equal(enterHandlers, 1);
});

test('createNewFolder valida, aplica reglas de orden y refresca sin navegar', () => {
  const controllerSource = readFileSync(
    join(here, '..', 'src', 'core', 'FolderLabController.ts'),
    'utf8'
  );

  const folderSection = controllerSource.slice(
    controllerSource.indexOf('async createNewFolder'),
    controllerSource.indexOf('// ============================================================\n  // NAVEGACIÓN')
  );

  // Validación de nombre pura, duplicados con aviso, reglas de
  // orden/exclusiones existentes y refresco en su sitio.
  assert.ok(folderSection.includes('validateNewFolderName'));
  // Duplicados gestionados con el aviso localizado.
  assert.ok(folderSection.includes("i18n.t('errors.folder.alreadyExists'"));
  assert.ok(folderSection.includes('updateOrderOnFolderCreate'));
  assert.ok(folderSection.includes('this.loadFolder(path)'));
});

// ============================================================
// INTERNACIONALIZACIÓN (ETAPA 2): PRESENTACIÓN POR IDIOMA
// ============================================================

test('presentación del encabezado en inglés con las mismas reglas por vista', () => {
  i18n.setLocale('en');
  try {
    // Raíz master: cuatro valores + % con etiqueta «completed».
    const master = buildHeaderStatsDisplay({
      kind: 'master-root',
      directNotes: 3,
      totalNotes: 128,
      totalFolders: 8,
      goal: { words: 32000, target: 80000 }
    });
    assert.equal(master.noteText, '3 notes · 128 notes total · 8 folders');
    assert.equal(master.suffixText, ' · 40% completed');
    assert.equal(master.suffixTitle, '32000 / 80000 words');

    // Subcarpeta: omisión de ceros y singular/plural.
    assert.equal(
      buildHeaderStatsDisplay({ kind: 'folder', notes: 5, subfolders: 3 }).noteText,
      '5 notes · 3 folders'
    );
    assert.equal(
      buildHeaderStatsDisplay({ kind: 'folder', notes: 0, subfolders: 1 }).noteText,
      '1 folder'
    );
    assert.equal(
      buildHeaderStatsDisplay({ kind: 'folder', notes: 1, subfolders: 0 }).noteText,
      '1 note'
    );
    assert.equal(
      buildHeaderStatsDisplay({ kind: 'folder', notes: 0, subfolders: 0 }).noteText,
      '0 notes'
    );

    // Vistas globales: contratos intactos.
    assert.equal(
      buildHeaderStatsDisplay({ kind: 'folders', folders: 8 }).noteText,
      '8 folders'
    );
    assert.equal(
      buildHeaderStatsDisplay({ kind: 'notes', notes: 128 }).noteText,
      '128 notes'
    );
    assert.equal(
      buildHeaderStatsDisplay({ kind: 'recent', files: 5 }).noteText,
      '5 recent files'
    );
  } finally {
    i18n.setLocale('es');
  }
});

test('tras restaurar español, la presentación conserva los textos originales', () => {
  assert.equal(i18n.getLocale(), 'es');
  const display = buildHeaderStatsDisplay({
    kind: 'master-root',
    directNotes: 1,
    totalNotes: 40,
    totalFolders: 2,
    goal: { words: 8000, target: 10000 }
  });
  assert.equal(display.noteText, '1 nota · 40 notas totales · 2 carpetas');
  assert.equal(display.suffixText, ' · 80 % completado');
});
