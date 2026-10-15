// ============================================================
// PRUEBAS: Comando manual de cuarentena (E4b, integración)
// ============================================================
// Ejecutar con: npm test
//
// Fixtures aislados. Cubre:
// - refresh() invocado antes de la evaluación;
// - sin Master / sin candidatos / error de escaneo;
// - identidad activa o journal impiden la cuarentena (revalidación);
// - cancelación: el núcleo no se invoca sin confirmación (estático
//   en main + flujo por pasos);
// - éxito exclusivamente con fixtures;
// - el comando NO se registra ni ejecuta en el arranque.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const OBSIDIAN_STUB = `
export class App {}
export class TFile {}
export class TFolder {}
export class Notice { constructor(){} }
export class Modal { constructor(){} open(){} close(){} }
export default {};
export class FileSystemAdapter { getBasePath(){return '/s';} }
`;

async function bundle(entryRel) {
  const result = await build({
    entryPoints: [join(root, entryRel)],
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
            contents: OBSIDIAN_STUB,
            loader: 'js'
          }));
        }
      }
    ]
  });
  const code = result.outputFiles[0].text;
  const url =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(url);
}

const { prepareQuarantineCommand, quarantineCandidate } = await bundle(
  'src/storage/quarantineCommand.ts'
);
const { NoteIdentityRegistry } = await bundle(
  'src/storage/NoteIdentityRegistry.ts'
);
const { QuarantineManager } = await bundle('src/storage/quarantine.ts');

function makeHidden(adapter) {
  // Emula HiddenFolderManager(app, 'Folder Lab') sobre el MISMO
  // almacén del adapter (en el sistema real es el mismo fichero).
  return {
    async readJSON(folder, name) {
      const key = `${folder}/Folder Lab/${name}`;
      if (!adapter.files.has(key)) return null;
      const raw = adapter.files.get(key);
      return typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
    },
    async writeJSON(folder, name, data) {
      adapter.files.set(`${folder}/Folder Lab/${name}`, structuredClone(data));
    }
  };
}

class FakeAdapter {
  files = new Map();
  dirs = new Set();
  async exists(p) {
    if (this.files.has(p) || this.dirs.has(p)) return true;
    const prefix = p.endsWith('/') ? p : p + '/';
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  }
  async mkdir(p) {
    this.dirs.add(p);
  }
  async read(p) {
    if (!this.files.has(p)) throw new Error('nf ' + p);
    return this.files.get(p);
  }
  async write(p, c) {
    this.files.set(p, c);
  }
  async remove(p) {
    this.files.delete(p);
  }
  async list(p) {
    const pre = p.endsWith('/') ? p : p + '/';
    return {
      files: [...this.files.keys()].filter((k) => k.startsWith(pre)),
      folders: []
    };
  }
  async stat(p) {
    return this.files.has(p) ? { mtime: Date.now() - 48 * 60 * 60 * 1000 } : null;
  }
}

const FIXTURE_CONTENT = JSON.stringify({ version: 1, notePath: 'nadie.md', data: {} });

function makeSystem({ master = 'Master' } = {}) {
  const adapter = new FakeAdapter();
  const hidden = makeHidden(adapter);
  const registry = new NoteIdentityRegistry({}, () => master, hidden);
  const app = { vault: { adapter } };
  const getRootPath = () => (master === null ? null : master);
  // Manager COMPARTIDO (E4c-1): la cola serializa operaciones.
  const manager = new QuarantineManager(app, getRootPath);
  const deps = {
    app,
    registry,
    getRootPath,
    getExistingPaths: () => ['viva.md'],
    manager
  };
  adapter.files.set(
    `${master}/Folder Lab/boards/id-huerfano.json`,
    FIXTURE_CONTENT
  );
  return { hidden, adapter, registry, deps, manager };
}

test('C1: sin Master → no-master', async () => {
  const { deps } = makeSystem({ master: null });
  const outcome = await prepareQuarantineCommand(deps);
  assert.equal(outcome.status, 'no-master');
});

test('C2: refresh() se invoca ANTES de la evaluación', async () => {
  const { registry, deps } = makeSystem();
  let refreshed = 0;
  const original = registry.refresh.bind(registry);
  registry.refresh = () => {
    refreshed += 1;
    original();
  };
  await prepareQuarantineCommand(deps);
  assert.equal(refreshed, 1, 'refresh exactamente una vez, antes');
});

test('C3: sin candidatos → no-candidates', async () => {
  const { adapter, deps } = makeSystem();
  adapter.files.delete('Master/Folder Lab/boards/id-huerfano.json');
  const outcome = await prepareQuarantineCommand(deps);
  assert.equal(outcome.status, 'no-candidates');
  assert.equal(outcome.audit.candidates.length, 0);
});

test('C4: candidato elegible → needs-confirmation; quarantine lo mueve', async () => {
  const { adapter, deps } = makeSystem();
  const outcome = await prepareQuarantineCommand(deps);
  assert.equal(outcome.status, 'needs-confirmation');
  assert.equal(outcome.candidates.length, 1);

  // Confirmación (la UI llamaría tras el «Cuarentenar»).
  const result = await quarantineCandidate(deps, outcome.candidates[0]);
  assert.equal(result.status, 'quarantined');
  assert.equal(
    adapter.files.has('Master/Folder Lab/boards/id-huerfano.json'),
    false
  );
});

test('C5: identidad activa impide la cuarentena (protección en dos niveles)', async () => {
  const { adapter, registry, deps } = makeSystem();
  // El id pasa a estar activo (reclamo u otro dispositivo + refresh).
  const idsPath = 'Master/Folder Lab/ids.json';
  adapter.files.set(
    idsPath,
    JSON.stringify({ version: 1, ids: { 'nadie.md': 'id-huerfano' }, tombstones: {}, pending: {}, archived: {} })
  );
  registry.refresh();

  // Nivel 1: la propia auditoría E4a ya excluye el archivo (id activo
  // coincide con el noteId del sobre) → ni candidato ni confirmación.
  const outcome = await prepareQuarantineCommand(deps);
  assert.equal(outcome.status, 'no-candidates');
  assert.equal(outcome.audit.identityOrphans.length, 1, 'identidad huérfana reportada');
  assert.equal(adapter.files.has('Master/Folder Lab/boards/id-huerfano.json'), true, 'original intacto');
});

test('C5b: si un candidato llega a confirmarse, stillOrphan rechaza con identidad activa', async () => {
  const { adapter, registry, deps, manager } = makeSystem();
  const idsPath = 'Master/Folder Lab/ids.json';
  adapter.files.set(
    idsPath,
    JSON.stringify({ version: 1, ids: { 'nadie.md': 'id-huerfano' }, tombstones: {}, pending: {}, archived: {} })
  );
  registry.refresh();

  // Nivel 2: el núcleo rechaza aunque la UI pase un candidato.
  // (Como en main.ts: manager compartido con predicado stillOrphan
  // construido con el registro real.)
  const { createStillOrphanPredicate } = await bundle(
    'src/storage/stillOrphan.ts'
  );
  const guarded = new QuarantineManager(
    deps.app,
    deps.getRootPath,
    createStillOrphanPredicate(deps.app, registry, deps.getRootPath)
  );
  const result = await guarded.quarantine({
    path: 'Master/Folder Lab/boards/id-huerfano.json',
    noteId: 'id-huerfano',
    subfolder: 'boards',
    reason: 'fixture',
    mtime: Date.now()
  });
  assert.equal(result.status, 'skipped');
  assert.ok(result.reason.includes('revalidación'));
  assert.equal(adapter.files.has('Master/Folder Lab/boards/id-huerfano.json'), true, 'original intacto');
});

test('C6: journal ilegible → la auditoría se reserva y no ofrece candidatos', async () => {
  const { adapter, deps } = makeSystem();
  await adapter.mkdir('Master/Folder Lab');
  await adapter.write('Master/Folder Lab/lifecycle-journal.json', '{ roto');

  // Política conservadora de E4a: journal ilegible → no se clasifica.
  const outcome = await prepareQuarantineCommand(deps);
  assert.equal(outcome.status, 'no-candidates');
  assert.equal(adapter.files.has('Master/Folder Lab/boards/id-huerfano.json'), true, 'original intacto');
});

test('C7: cancelación = el núcleo simplemente no se invoca (flujo por pasos)', async () => {
  const { adapter, deps } = makeSystem();
  const outcome = await prepareQuarantineCommand(deps);
  assert.equal(outcome.status, 'needs-confirmation');
  // El usuario pulsa «Cancelar»: quarantineCandidate NO se llama.
  assert.equal(adapter.files.has('Master/Folder Lab/boards/id-huerfano.json'), true, 'original intacto');
});

test('C8: el comando NO se ejecuta en el arranque (estático en main)', () => {
  const main = readFileSync(join(root, 'src/main.ts'), 'utf8');
  // Registrado como comando…
  assert.ok(main.includes("'quarantine-orphan-data'"));
  // …el núcleo solo aparece en main (callback), nunca en el
  // mantenimiento de arranque.
  const maintenance = readFileSync(
    join(root, 'src/storage/startupMaintenance.ts'),
    'utf8'
  );
  assert.ok(!maintenance.includes('Quarantine'));
  assert.ok(!maintenance.includes('quarantineCandidate'));
  // El registro del comando está fuera del callback de onLayoutReady
  // del mantenimiento (bloque que empieza con runStartupMaintenance).
  const maintCall = main.indexOf('runStartupMaintenance(');
  const cmdId = main.indexOf("id: 'quarantine-orphan-data'");
  assert.ok(cmdId > 0 && cmdId < maintCall, 'el comando se registra antes del mantenimiento de arranque');
});

// ------------------------------------------------------------
// Regresión QA manual (bug 2): el modal debe ofrecer la acción
// «Cuarentenar» POR CANDIDATO y dejar constancia del resultado
// en la propia fila (antes la fila se borraba sin dejar rastro
// y solo quedaba «Cancelar»).
// ------------------------------------------------------------
test('C9 (regresión QA): modal con acción de confirmación por candidato y constancia de resultado', () => {
  const src = readFileSync(
    join(root, 'src/modals/QuarantineCandidateModal.ts'),
    'utf8'
  );
  // Una fila por candidato con su propio botón «Cuarentenar».
  assert.ok(/for \(const candidate of this\.candidates\)/.test(src));
  assert.ok(src.includes("text: 'Cuarentenar'"));
  // Botón «Cancelar» global que cierra sin operar.
  assert.ok(src.includes("text: 'Cancelar'"));
  assert.ok(/cancelBtn\.onclick = \(\) => this\.close\(\);/.test(src));
  // La fila NO se elimina sin dejar constancia del resultado.
  assert.ok(!/\.remove\(\)/.test(src), 'la fila no debe borrarse sin dejar constancia');
  assert.ok(src.includes('resultEl.setText'));
  assert.ok(src.includes('Movido a cuarentena'));
  assert.ok(src.includes('el original se conserva'));
  // El modal se cierra solo tras procesar todos los candidatos.
  assert.ok(src.includes('this.processed'));
  assert.ok(/this\.processed\.size >= this\.candidates\.length/.test(src));
  // El resultado de cada confirmación se entrega al modal.
  assert.ok(/Promise<QuarantineResult \| void>/.test(src));
});

// ------------------------------------------------------------
// E4c-1: manager COMPARTIDO — concurrencia sin pérdida de
// entradas del manifiesto. Dos confirmaciones simultáneas del
// modal (dos filas) deben serializarse en la cola del manager.
// ------------------------------------------------------------
test('C10: dos cuarentenas concurrentes vía manager compartido conservan ambas entradas', async () => {
  const { adapter, deps } = makeSystem();
  const FIX_B = JSON.stringify({ version: 1, notePath: 'tampoco.md', data: { b: true } });
  adapter.files.set('Master/Folder Lab/boards/id-b.json', FIX_B);

  const outcome = await prepareQuarantineCommand(deps);
  assert.equal(outcome.status, 'needs-confirmation');
  assert.equal(outcome.candidates.length, 2);

  // Confirmaciones SIMULTÁNEAS (sin await intermedio), como dos
  // filas del modal pulsadas en paralelo.
  const [r1, r2] = await Promise.all([
    quarantineCandidate(deps, outcome.candidates[0]),
    quarantineCandidate(deps, outcome.candidates[1])
  ]);
  assert.equal(r1.status, 'quarantined');
  assert.equal(r2.status, 'quarantined');

  const manifest = JSON.parse(
    adapter.files.get('Master/Folder Lab/quarantine/manifest.json')
  );
  assert.equal(manifest.entries.length, 2, 'sin pérdida de entradas del manifiesto');
  const origins = manifest.entries.map((e) => e.originPath).sort();
  assert.deepEqual(origins, [
    'Master/Folder Lab/boards/id-b.json',
    'Master/Folder Lab/boards/id-huerfano.json'
  ]);
  // Ambos originales retirados; ambas copias presentes.
  assert.equal(adapter.files.has('Master/Folder Lab/boards/id-huerfano.json'), false);
  assert.equal(adapter.files.has('Master/Folder Lab/boards/id-b.json'), false);
  for (const e of manifest.entries) {
    assert.ok(adapter.files.has(e.quarantinePath), 'copia presente');
  }
});

test('C11: el comando delega en el manager INYECTADO (nunca crea uno nuevo)', () => {
  const src = readFileSync(
    join(root, 'src/storage/quarantineCommand.ts'),
    'utf8'
  );
  assert.ok(
    !src.includes('new QuarantineManager'),
    'quarantineCommand no debe instanciar QuarantineManager'
  );
  assert.ok(src.includes('deps.manager.quarantine'), 'usa deps.manager');
  // main.ts: una única instancia compartida, no por invocación.
  const main = readFileSync(join(root, 'src/main.ts'), 'utf8');
  assert.ok(main.includes('getQuarantineManager'), 'main expone el getter compartido');
  assert.equal(
    (main.match(/new QuarantineManager\(/g) || []).length,
    1,
    'una sola construcción del manager en main'
  );
});
