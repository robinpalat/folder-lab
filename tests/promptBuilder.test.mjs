// ============================================================
// PRUEBAS: PromptBuilder — fuentes Snips/Tareas (Fase 3A)
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - El contenido de Snips llega al prompt desde los items de los
//   envoltorios por instancia (forma real de resolveWidgetSource).
// - El contenido de Tareas ídem, con `title` como alternativa.
// - Una fuente vacía no introduce contenido ficticio ni falla.
// - Se conservan: caso nota por defecto, prioridad de la
//   selección, fuente Apuntes (string) y sustituciones de
//   placeholders.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

async function loadPromptBuilder() {
  const result = await build({
    entryPoints: [join(root, 'src', 'ai', 'prompt', 'PromptBuilder.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral'
  });
  const url =
    'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(url);
}

const { PromptBuilder } = await loadPromptBuilder();

function makeContext(overrides = {}) {
  return {
    note: {
      path: 'Libro/Nota.md',
      name: 'Nota',
      content: 'CONTENIDO DE LA NOTA',
      metadata: {}
    },
    folder: { path: 'Libro', name: 'Libro' },
    contextType: 'note',
    session: { id: 's1', history: [] },
    execution: { temperature: 0.3, maxTokens: 500 },
    ...overrides
  };
}

function makeTemplate() {
  return { system: 'SYSTEM {noteName}', user: 'USER {noteName} en {folderName}' };
}

function buildUser(context) {
  return new PromptBuilder(context, makeTemplate()).buildUser();
}

// ------------------------------------------------------------
// Snips
// ------------------------------------------------------------

test('3A: los textos de Snips aparecen en el prompt (envoltorios por instancia)', () => {
  const user = buildUser(makeContext({
    contextType: 'snips',
    additional: {
      snips: [
        {
          instanceId: 'snips-1',
          name: 'Snips',
          items: [
            { text: 'primer snip' },
            { text: 'segundo snip' }
          ]
        }
      ]
    }
  }));

  assert.ok(user.includes('Snips seleccionados:'));
  assert.ok(user.includes('primer snip'));
  assert.ok(user.includes('segundo snip'));
  assert.ok(user.includes('\n\n---\n\n'), 'los snips se unen con el separador');
});

test('3A: snips con items sin texto no rompen y se omiten', () => {
  const user = buildUser(makeContext({
    contextType: 'snips',
    additional: {
      snips: [{ instanceId: 's', name: 'S', items: [{ title: 'sin text' }, { text: '   ' }] }]
    }
  }));

  assert.ok(!user.includes('Snips seleccionados:'), 'sin texto válido no se añade sección');
  assert.ok(!user.includes('undefined'));
});

// ------------------------------------------------------------
// Tareas
// ------------------------------------------------------------

test('3A: el contenido de Tareas aparece en el prompt (text y title)', () => {
  const user = buildUser(makeContext({
    contextType: 'tasks',
    additional: {
      tasks: [
        {
          instanceId: 'tasks-1',
          name: 'Tareas',
          items: [
            { text: 'tarea con text' },
            { title: 'tarea con title' }
          ]
        }
      ]
    }
  }));

  assert.ok(user.includes('Tareas:'));
  assert.ok(user.includes('tarea con text'));
  assert.ok(user.includes('tarea con title'));
});

test('3A: fuente de Tareas vacía no introduce contenido ficticio', () => {
  const user = buildUser(makeContext({
    contextType: 'tasks',
    additional: { tasks: [{ instanceId: 't', name: 'T', items: [] }] }
  }));

  assert.ok(!user.includes('Tareas:'));
  assert.ok(!user.includes('undefined'));
});

// ------------------------------------------------------------
// Conservación del comportamiento previo
// ------------------------------------------------------------

test('3A: sin fuente seleccionada se usa el contenido de la nota (caso por defecto)', () => {
  // Comportamiento previo conservado: el caso por defecto rige
  // cuando contextType es 'note' o no está definido; no existe
  // fallback a nota desde los casos snips/tasks.
  const user = buildUser(makeContext({ contextType: 'note' }));

  assert.ok(user.includes('CONTENIDO DE LA NOTA'));
  assert.ok(user.includes('Contenido de "Nota":'));
});

test('3A: contextType snips sin fuente no introduce contenido (comportamiento previo)', () => {
  const user = buildUser(makeContext({ contextType: 'snips' }));

  assert.ok(!user.includes('Snips seleccionados:'), 'sin items no hay sección');
  assert.ok(!user.includes('undefined'));
});

test('3A: la selección explícita tiene prioridad sobre la fuente', () => {
  const user = buildUser(makeContext({
    contextType: 'snips',
    selection: 'texto seleccionado',
    additional: {
      snips: [{ instanceId: 's', name: 'S', items: [{ text: 'snip oculto' }] }]
    }
  }));

  assert.ok(user.includes('Selección del usuario:'));
  assert.ok(user.includes('texto seleccionado'));
  assert.ok(!user.includes('snip oculto'));
});

test('3A: la fuente Apuntes (string) y los placeholders siguen funcionando', () => {
  const user = buildUser(makeContext({
    contextType: 'notes',
    additional: { notes: 'mis apuntes' }
  }));

  assert.ok(user.includes('Apuntes:'));
  assert.ok(user.includes('mis apuntes'));
  assert.ok(user.includes('USER Nota en Libro'), 'placeholders {noteName}/{folderName}');
});
