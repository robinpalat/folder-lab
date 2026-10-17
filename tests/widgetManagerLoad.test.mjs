// ============================================================
// PRUEBAS: WidgetManager.loadForNote — token de generación (P2-B)
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - Carga normal: instancias y layout de la nota solicitada.
// - Bootstrap de primera visita: instancias por defecto + guardado.
// - Dos cargas superpuestas con resolución en orden inverso: la
//   carga antigua NO sustituye las instancias de la más reciente.
// - Ningún orden de resolución deja instancias de una nota
//   distintas de las de currentNotePath.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

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
            contents: 'export class TFile {}\nexport class App {}\nexport default {};\n',
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

// ------------------------------------------------------------
// Dobles de prueba
// ------------------------------------------------------------

/** Repo con loadNote controlado por gates (orden de resolución exacto). */
function createGatedRepo() {
  const repo = {
    loads: [],
    saves: [],
    loadNote(path) {
      return new Promise((resolve) => {
        repo.loads.push({ path, resolve });
      });
    },
    async saveNote(path, data) {
      repo.saves.push({ path, data: JSON.parse(JSON.stringify(data)) });
    }
  };
  return repo;
}

function createRegistry() {
  return {
    getDefinition(typeId) {
      return {
        id: typeId,
        cardinality: 'multiple',
        identity: { label: typeId }
      };
    }
  };
}

function contextData(marker) {
  return {
    widgets: [
      { instanceId: `inst-${marker}`, typeId: 'notes', name: marker }
    ],
    layout: { top: `inst-${marker}`, bottom: '' }
  };
}

function file(path) {
  return { path };
}

// ------------------------------------------------------------
// Pruebas
// ------------------------------------------------------------

test('P2-B: carga normal — instancias y layout de la nota solicitada', async () => {
  const repo = createGatedRepo();
  const wm = new WidgetManager(createRegistry(), repo);

  const pending = wm.loadForNote(file('Libro/A.md'));
  assert.equal(repo.loads.length, 1);
  assert.equal(repo.loads[0].path, 'Libro/A.md');

  repo.loads[0].resolve(contextData('A'));
  await pending;

  assert.equal(wm.getCurrentNotePath(), 'Libro/A.md');
  assert.equal(wm.getInstances().length, 1);
  assert.equal(wm.getInstances()[0].name, 'A');
  assert.equal(wm.getLayout().top, 'inst-A');
  assert.ok(wm.getInstance('inst-A'));
});

test('P2-B: bootstrap de primera visita — instancias por defecto y un guardado', async () => {
  const repo = createGatedRepo();
  const wm = new WidgetManager(createRegistry(), repo);

  const pending = wm.loadForNote(file('Libro/Nueva.md'));
  repo.loads[0].resolve(null); // sin datos previos
  await pending;

  const instances = wm.getInstances();
  assert.equal(instances.length, 3);
  assert.deepEqual(
    instances.map((i) => i.typeId).sort(),
    ['active-note', 'memory', 'notes']
  );
  assert.equal(wm.getLayout().top, instances[1].instanceId);
  assert.equal(wm.getLayout().bottom, instances[0].instanceId);

  assert.equal(repo.saves.length, 1);
  assert.equal(repo.saves[0].path, 'Libro/Nueva.md');
  assert.equal(repo.saves[0].data.widgets.length, 3);
});

test('P2-B: superposición con resolución antigua la última — la carga vieja se descarta', async () => {
  const repo = createGatedRepo();
  const wm = new WidgetManager(createRegistry(), repo);

  const pA = wm.loadForNote(file('Libro/A.md')); // carga 1 (antigua)
  const pB = wm.loadForNote(file('Libro/B.md')); // carga 2 (reciente)

  // La reciente resuelve PRIMERO.
  repo.loads[1].resolve(contextData('B'));
  await pB;

  assert.equal(wm.getCurrentNotePath(), 'Libro/B.md');
  assert.equal(wm.getInstances()[0].name, 'B');

  // La antigua resuelve DESPUÉS con datos de A: debe descartarse.
  repo.loads[0].resolve(contextData('A'));
  await pA;

  assert.equal(wm.getCurrentNotePath(), 'Libro/B.md');
  assert.equal(wm.getInstances().length, 1);
  assert.equal(
    wm.getInstances()[0].name,
    'B',
    'las instancias de la carga antigua (A) no deben sustituir a las de B'
  );
  assert.ok(wm.getInstance('inst-B'));
  assert.equal(wm.getInstance('inst-A'), undefined);
});

test('P2-B: superposición con resolución antigua la primera — A nunca llega a aplicarse', async () => {
  const repo = createGatedRepo();
  const wm = new WidgetManager(createRegistry(), repo);

  const pA = wm.loadForNote(file('Libro/A.md'));
  const pB = wm.loadForNote(file('Libro/B.md'));

  // La antigua resuelve primero, pero B ya tomó el relevo: A es
  // obsoleta aunque haya llegado antes.
  repo.loads[0].resolve(contextData('A'));
  await pA;

  assert.equal(
    wm.getInstances().length,
    0,
    'la carga obsoleta de A no debe aplicarse si B sigue en curso'
  );

  repo.loads[1].resolve(contextData('B'));
  await pB;

  assert.equal(wm.getCurrentNotePath(), 'Libro/B.md');
  assert.equal(wm.getInstances()[0].name, 'B');
});

test('P2-B: tras una carga superseded, las operaciones normales siguen funcionando', async () => {
  const repo = createGatedRepo();
  const wm = new WidgetManager(createRegistry(), repo);

  const pA = wm.loadForNote(file('Libro/A.md'));
  const pB = wm.loadForNote(file('Libro/B.md'));
  repo.loads[1].resolve(contextData('B'));
  await pB;
  repo.loads[0].resolve(contextData('A'));
  await pA;

  // setLayout / getInstance coherentes con la nota vigente.
  wm.setLayout('inst-B', '');
  assert.equal(wm.getLayout().top, 'inst-B');
  assert.ok(wm.getInstance('inst-B'));

  // saveForCurrentNote escribe bajo la nota vigente (B).
  await wm.saveForCurrentNote();
  assert.equal(repo.saves.length, 1);
  assert.equal(repo.saves[0].path, 'Libro/B.md');
  assert.equal(repo.saves[0].data.widgets[0].name, 'B');
});
