// ============================================================
// PRUEBAS: Captura desde Apuntes + widgets Issues/Objectives
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - transfer.fromNotes es la propiedad EXPLÍCITA de elegibilidad
//   para el envío desde Apuntes (opt-in; ausente = no elegible).
// - Snips declara fromNotes=false y sigue con inputs=['text']
//   (transferencias entre widgets intactas).
// - Issues/Objectives existen, se instancian, persisten por nota
//   y se restauran sin mezclarse entre notas.
// - DeclarativeRuntime valida fromNotes (boolean y entity.content
//   requerido cuando es true).
// - NotesWidget selecciona y valida destinos SOLO por fromNotes.
// - Etiquetas i18n: Incidencias/Objetivos (es), Issues/Objectives
//   (en).
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const definitions = JSON.parse(read('src/focus/widget-definitions.json'));
const es = JSON.parse(read('src/i18n/locales/es.json'));
const en = JSON.parse(read('src/i18n/locales/en.json'));

// ------------------------------------------------------------
// 1. CONTRATO DECLARATIVO
// ------------------------------------------------------------

test('fromNotes: conjunto elegible exacto (opt-in explícito)', () => {
  const eligible = [];
  const notEligible = [];

  for (const [id, def] of Object.entries(definitions.widgets)) {
    const fromNotes = def.transfer?.fromNotes;
    if (fromNotes === true) eligible.push(id);
    else notEligible.push(id);
  }

  assert.deepEqual(
    eligible.sort(),
    ['candidates', 'collections', 'issues', 'objectives', 'restrictions', 'tasks'].sort()
  );
  // Snips NO admite envío directo desde Apuntes (decisión explícita).
  assert.ok(notEligible.includes('snips'));
  assert.equal(definitions.widgets.snips.transfer.fromNotes, false);
});

test('fromNotes: los elegibles conservan inputs de texto (drag entre widgets)', () => {
  for (const id of ['candidates', 'collections', 'issues', 'objectives', 'restrictions', 'tasks']) {
    assert.deepEqual(definitions.widgets[id].transfer.inputs, ['text'], id);
  }
  // Snips mantiene sus transferencias entre widgets.
  assert.deepEqual(definitions.widgets.snips.transfer.inputs, ['text']);
});

test('Issues/Objectives: contrato coherente con widgets de contexto', () => {
  for (const id of ['issues', 'objectives']) {
    const def = definitions.widgets[id];
    assert.equal(def.cardinality, 'multiple');
    assert.equal(def.storage?.scope, 'note-instance');
    assert.equal(def.entity?.content?.renderer, 'expandable-text');
    assert.equal(def.entity?.content?.editable, true);
    assert.equal(def.transfer?.fromNotes, true);
    assert.equal(def.state?.field, 'active');
    // Controles: selector + Nuevo + contador (sin papelera de toolbar).
    const controlIds = def.controls.map((c) => c.id ?? c.type);
    assert.deepEqual(controlIds, ['widget-selector', 'new', 'counter']);
  }
});

// ------------------------------------------------------------
// 2. I18N
// ------------------------------------------------------------

test('etiquetas: Incidencias/Objetivos (es) e Issues/Objectives (en)', () => {
  assert.equal(es.widgets.defs.issues.label, 'Incidencias');
  assert.equal(es.widgets.defs.objectives.label, 'Objetivos');
  assert.equal(en.widgets.defs.issues.label, 'Issues');
  assert.equal(en.widgets.defs.objectives.label, 'Objectives');

  for (const id of ['issues', 'objectives']) {
    for (const cat of [es, en]) {
      assert.equal(typeof cat.widgets.defs[id].description, 'string');
      assert.equal(typeof cat.widgets.defs[id].emptyState, 'string');
    }
  }
});

// ------------------------------------------------------------
// 3. FUENTES: selector/envío y validación del runtime
// ------------------------------------------------------------

test('NotesWidget: elegibilidad y envío usan transfer.fromNotes', () => {
  const source = read('src/focus/widgets/NotesWidget.ts');
  assert.ok(source.includes('definition?.transfer?.fromNotes === true'));
  // El selector de destinos delega en el contrato explícito.
  assert.ok(source.includes('this.isNoteCaptureTarget(definition)'));
  // Sin deducción indirecta por inputs/entity.content.
  assert.ok(!source.includes('transfer?.inputs?.includes("text") &&'));
});

test('DeclarativeRuntime: valida fromNotes (boolean y entity.content)', () => {
  const source = read('src/focus/DeclarativeRuntime.ts');
  assert.ok(source.includes('transfer.fromNotes inválido'));
  assert.ok(source.includes('transfer.fromNotes=true requiere entity.content'));
});

test('WidgetDefinition: fromNotes documentado en el contrato', () => {
  const source = read('src/focus/WidgetDefinition.ts');
  assert.ok(source.includes('fromNotes?: boolean'));
});

// ------------------------------------------------------------
// 4. INSTANCIACIÓN Y PERSISTENCIA POR NOTA (WidgetManager)
// ------------------------------------------------------------

async function loadWidgetManager() {
  const result = await build({
    entryPoints: [join(root, 'src', 'focus', 'WidgetManager.ts')],
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
            contents:
              'export class TFile {}\nexport class App {}\nexport default {};\n',
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

const { WidgetManager } = await loadWidgetManager();

test('Issues/Objectives: instanciación, guardado y restauración por nota', async () => {
  // Repo con datos por ruta (simula _note_context.json).
  const store = new Map();
  const repo = {
    async loadNote(path) {
      const data = store.get(path);
      return data ? JSON.parse(JSON.stringify(data)) : null;
    },
    async saveNote(path, data) {
      store.set(path, JSON.parse(JSON.stringify(data)));
    }
  };

  // Registry mínimo: las definiciones reales del JSON para los ids
  // usados (memory/notes pueden registrar mínimos).
  const registry = {
    getDefinition(typeId) {
      if (definitions.widgets[typeId]) {
        return definitions.widgets[typeId];
      }
      return {
        id: typeId,
        cardinality: typeId === 'memory' || typeId === 'notes'
          ? 'singleton'
          : 'multiple',
        identity: { label: typeId }
      };
    }
  };

  const manager = new WidgetManager(registry, repo);

  // Nota A: bootstrap + nuevos widgets.
  await manager.loadForNote({ path: 'Notas/A.md' });
  const issuesA = await manager.createInstance('issues', 'Incidencias de A');
  const objectivesA = await manager.createInstance('objectives', 'Objetivos de A');
  assert.ok(issuesA && objectivesA);
  assert.ok(issuesA.instanceId.startsWith('issues-'));
  assert.ok(objectivesA.instanceId.startsWith('objectives-'));

  const savedA = store.get('Notas/A.md');
  const typeIdsA = savedA.widgets.map((w) => w.typeId);
  assert.ok(typeIdsA.includes('issues'));
  assert.ok(typeIdsA.includes('objectives'));

  // Nota B: NO hereda las instancias de A (sin mezcla).
  await manager.loadForNote({ path: 'Notas/B.md' });
  const typeIdsB = manager.getInstances().map((w) => w.typeId);
  assert.ok(!typeIdsB.includes('issues'));
  assert.ok(!typeIdsB.includes('objectives'));

  // Vuelta a A: restauración de las mismas instancias (ids estables).
  await manager.loadForNote({ path: 'Notas/A.md' });
  const restoredA = manager.getInstances();
  const restoredIssues = restoredA.find((w) => w.typeId === 'issues');
  const restoredObjectives = restoredA.find((w) => w.typeId === 'objectives');
  assert.equal(restoredIssues.instanceId, issuesA.instanceId);
  assert.equal(restoredIssues.name, 'Incidencias de A');
  assert.equal(restoredObjectives.instanceId, objectivesA.instanceId);
});

// ------------------------------------------------------------
// 5. DATOS POR INSTANCIA Y NOTA (WidgetController.storage)
// ------------------------------------------------------------

async function loadWidgetController() {
  const result = await build({
    entryPoints: [join(root, 'src', 'focus', 'controllers', 'WidgetController.ts')],
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
            contents: 'export class Plugin {}\nexport default {};\n',
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

const { WidgetController } = await loadWidgetController();

test('Issues/Objectives: datos por instancia y aislamiento entre notas', async () => {
  let disk = {};
  const plugin = {
    async loadData() {
      return JSON.parse(JSON.stringify(disk));
    },
    async saveData(data) {
      disk = JSON.parse(JSON.stringify(data));
    }
  };

  const controller = new WidgetController(plugin);

  // Nota A, instancia issues-1: dos incidencias.
  await controller.storage.add('issues', 'Notas/A.md', 'issues-1', {
    text: 'Fallo en la exportación'
  });
  await controller.storage.add('issues', 'Notas/A.md', 'issues-1', {
    text: 'Enlace roto'
  });

  // Nota B, misma instancia: dato independiente.
  await controller.storage.add('issues', 'Notas/B.md', 'issues-1', {
    text: 'Otra incidencia (nota B)'
  });

  const recordA = await controller.storage.get('issues', 'Notas/A.md', 'issues-1');
  const recordB = await controller.storage.get('issues', 'Notas/B.md', 'issues-1');
  assert.equal(recordA.items.length, 2);
  assert.equal(recordA.items[0].text, 'Fallo en la exportación');
  assert.equal(recordB.items.length, 1);
  assert.equal(recordB.items[0].text, 'Otra incidencia (nota B)');

  // Objetivos: persistencia y normalización (id + createdAt).
  await controller.storage.add('objectives', 'Notas/A.md', 'objectives-1', {
    text: 'Reducir el tiempo de revisión'
  });
  const objectivesA = await controller.storage.get(
    'objectives', 'Notas/A.md', 'objectives-1'
  );
  assert.equal(objectivesA.items.length, 1);
  assert.equal(typeof objectivesA.items[0].id, 'string');
  assert.equal(typeof objectivesA.items[0].createdAt, 'number');

  // Actualización por id estable.
  await controller.storage.update(
    'issues', 'Notas/A.md', 'issues-1',
    recordA.items[0].id,
    { active: false }
  );
  const updated = await controller.storage.get('issues', 'Notas/A.md', 'issues-1');
  assert.equal(updated.items[0].active, false);
});
