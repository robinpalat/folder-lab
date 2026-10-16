// ============================================================
// PRUEBAS: INTEGRIDAD FUNCIONAL TRAS LA MIGRACIÓN i18n
// ============================================================
// Ejecutar con: npm test
//
// Verifica por fuente que la internacionalización no alteró
// identificadores persistidos, claves de configuración, formatos
// de datos ni contratos funcionales (etapa 8: cierre).
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ============================================================
// 1. IDENTIFICADORES PERSISTIDOS
// ============================================================

test('estados: unión NoteStatus e ids intactos', () => {
  const source = read('src/constants/statuses.ts');

  for (const id of [
    "'draft'", "'inProgress'", "'completed'", "'pending'", "'review'",
    "'approved'", "'discarded'", "'questions'", "'highPriority'",
    "'mediumPriority'", "'bookmark'", "'thumb-down'"
  ]) {
    assert.ok(source.includes(`${id}`) || source.includes(`'${id}'`) || source.includes(`${id},`), id);
  }
  // Los ids no pasan por i18n.
  assert.ok(!source.includes("i18n.t('draft") && !source.includes("t(`${"));
});

test('configuración: claves persistidas intactas (bookWordGoal, mapeo Jekyll)', () => {
  const settings = read('src/config/settings.ts');
  assert.ok(settings.includes('bookWordGoal: number'));
  assert.ok(settings.includes('bookWordGoal: 0'));
  assert.ok(!settings.includes('folderWordGoals'));

  const main = read('src/main.ts');
  // Placeholders técnicos de propiedades sin traducir.
  for (const key of ["'title'", "'parent'", "'nav_order'", "'has_children'", "'permalink'"]) {
    assert.ok(main.includes(`|| ${key}`), key);
  }
});

test('carpeta interna y filtros: identificadores intactos', () => {
  const viewTypes = read('src/constants/view-types.ts');
  assert.ok(viewTypes.includes("'.folder-lab'"));

  const filterService = read('src/services/FilterService.ts');
  assert.ok(filterService.includes("'_empty'"));
  assert.ok(filterService.includes("'_no-status'"));
});

test('comandos e IA: ids y valores de proveedor intactos', () => {
  const main = read('src/main.ts');
  for (const id of ['open-folder-lab', 'refresh-folder-lab', 'toggle-focus-mode', 'test-context-resolver']) {
    assert.ok(main.includes(`id: '${id}'`), id);
  }
  // Modelos por defecto de proveedores sin tocar.
  assert.ok(main.includes("'gpt-4o-mini'"));
  assert.ok(main.includes("'gemini-1.5-flash'"));
  assert.ok(main.includes("'claude-3-5-haiku-20241022'"));
});

test('widget-definitions: ids y estructura intactos', () => {
  const data = JSON.parse(read('src/focus/widget-definitions.json'));
  // Los ids originales se conservan en orden; issues/objectives se
  // añadieron como widgets de contexto nuevos.
  assert.deepEqual(
    Object.keys(data.widgets),
    ['snips', 'collections', 'restrictions', 'candidates', 'tasks',
      'issues', 'objectives']
  );
});

// ============================================================
// 2. FORMATOS Y FLUJOS FUNCIONALES
// ============================================================

test('exportación: formatos de nombre de archivo intactos', () => {
  const source = read('src/services/ExportService.ts');
  assert.ok(source.includes('`indice-${folderPath.replace(/\\//g, \'-\')}.${ext}`'));
  assert.ok(source.includes('`${folderPath}/${folder.name}.md`'));
  assert.ok(source.includes('`seleccion-${folderPath.replace(/\\//g, \'-\')}.md`'));
});

test('creación: un solo escritor de orden y envío único en InputModal', () => {
  const noteService = read('src/services/NoteService.ts');
  const createSection = noteService.slice(
    noteService.indexOf('async createNote'),
    noteService.indexOf('async loadGeneralNote')
  );
  assert.ok(!createSection.includes('updateFolderOrder'));

  const modal = read('src/utils/ModalUtils.ts');
  assert.ok(modal.includes('if (this.submitted) return'));
});

test('nombres de instancia: defaults traducibles solo al crear; storage intacto', () => {
  const manager = read('src/focus/WidgetManager.ts');
  assert.equal((manager.match(/name: name\?\.trim\(\) \|\|/g) || []).length, 2);
  assert.ok(!manager.includes("'Asistente'"));
  // La persistencia de instancias no referencia i18n.
  const store = manager.slice(manager.indexOf('async renameInstance'));
  assert.ok(!store.slice(0, 500).includes('i18n'));
});

test('conteo de palabras: única invocación de countWordsInBook (caché intacta)', () => {
  const controller = read('src/core/FolderLabController.ts');
  const calls = controller.split('countWordsInBook()').length - 1;
  assert.equal(calls, 1);
  assert.ok(controller.includes('class SingleFlightCache') || controller.includes('SingleFlightCache'));
});

test('encabezado: modelos por vista sin inferencia (sin getStats en HeaderComponent)', () => {
  const header = read('src/layout/HeaderComponent.ts');
  // El encabezado no deduce la carpeta actual para las stats.
  assert.ok(!header.includes('controller.getStats()'));
  assert.ok(!header.includes('countWordsInBook'));
});

test('pluralización: contrato one/other documentado (es/en)', () => {
  const service = read('src/i18n/I18nService.ts');
  assert.ok(service.includes('LIMITACIÓN CONOCIDA'));
  assert.ok(service.includes("form === 'one' ? value.one : value.other"));
});
