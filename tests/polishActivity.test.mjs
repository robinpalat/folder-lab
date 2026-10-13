// ============================================================
// PRUEBAS: Pulir e historial de actividad (Etapa 4)
// ============================================================
// Ejecutar con: npm test
//
// Cubre:
// - Snapshot de Pulir al guardar el Board (archivo polish/<id>.json).
// - Sin duplicados: guardados idénticos no apilan versiones.
// - Recuperación: list() devuelve las versiones anteriores.
// - Rotación del log por tamaño: el contenido previo se conserva
//   en un archivo rotado y el vigente continúa vacío/nuevo.
// - Poda: se conservan los MAX_ROTATED_LOGS más recientes.
// - Fallo de rotación: el append continúa (aviso, sin pérdida).
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const OBSIDIAN_STUB = `
export class App {}
export class TFile {}
export class TFolder {}
export default {};
export class FileSystemAdapter { getBasePath() { return '/stub'; } }
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

class FakeAdapter {
  files = new Map();
  dirs = new Set();
  failRename = false;
  async exists(p) {
    return this.files.has(p) || this.dirs.has(p);
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
  async append(p, c) {
    this.files.set(p, (this.files.get(p) ?? '') + c);
  }
  async stat(p) {
    if (!this.files.has(p)) return null;
    return { size: Buffer.byteLength(this.files.get(p)) };
  }
  async rename(from, to) {
    if (this.failRename) throw new Error('rename failure');
    if (!this.files.has(from)) throw new Error('rename nf');
    this.files.set(to, this.files.get(from));
    this.files.delete(from);
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
}

const { BoardRepository } = await bundle('src/storage/BoardRepository.ts');
const { RecentActivityService } = await bundle(
  'src/services/RecentActivityService.ts'
);

const MASTER = 'Master';

function makeBoardRepo() {
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  const ids = new Map();
  const identity = async (p) => {
    if (!ids.has(p)) ids.set(p, 'id' + ids.size);
    return ids.get(p);
  };
  const repo = new BoardRepository(app, {
    identity,
    getRootPath: () => MASTER
  });
  return { repo, adapter, ids };
}

function boardData(overrides = []) {
  return {
    blocks: [{ id: 'b1', x: 0, y: 0, w: 10, h: 10, content: 'x' }],
    connections: [],
    fragmentOverrides: overrides
  };
}

const OVERRIDE = {
  id: 'block:b1',
  blockId: 'b1',
  overrideText: 'pulido',
  useOverride: true
};

test('guardar el Board crea el snapshot de Pulir', async () => {
  const { repo, adapter } = makeBoardRepo();
  await repo.saveNote('Nota.md', boardData([OVERRIDE]));
  const polishKeys = [...adapter.files.keys()].filter((k) =>
    k.startsWith('Master/Folder Lab/polish/')
  );
  assert.equal(polishKeys.length, 1);
  const history = JSON.parse(adapter.files.get(polishKeys[0]));
  assert.equal(history.data.versions.length, 1);
  assert.equal(
    history.data.versions[0].overrides[0].overrideText,
    'pulido'
  );
});

test('guardados idénticos no apilan versiones', async () => {
  const { repo, adapter } = makeBoardRepo();
  await repo.saveNote('Nota.md', boardData([OVERRIDE]));
  await repo.saveNote('Nota.md', boardData([OVERRIDE]));
  await repo.saveNote('Nota.md', boardData([OVERRIDE]));
  const polishKey = [...adapter.files.keys()].find((k) =>
    k.startsWith('Master/Folder Lab/polish/')
  );
  const history = JSON.parse(adapter.files.get(polishKey));
  assert.equal(history.data.versions.length, 1);
});

test('recuperación: cada cambio distinto deja una versión', async () => {
  const { repo } = makeBoardRepo();
  await repo.saveNote('Nota.md', boardData([OVERRIDE]));
  await repo.saveNote(
    'Nota.md',
    boardData([{ ...OVERRIDE, overrideText: 'v2' }])
  );
  await repo.saveNote('Nota.md', boardData([]));
  // 'Nota.md' es la primera nota de este test → id0.
  const history = await repo.getPolishHistory().list('id0');
  assert.equal(history.length, 3);
  assert.equal(history[1].overrides[0].overrideText, 'v2');
  assert.equal(history[2].overrides.length, 0);
});

// ------------------------------------------------------------
// Rotación del log
// ------------------------------------------------------------

function makeActivity() {
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  const service = new RecentActivityService(app, () => MASTER);
  return { service, adapter };
}

test('rotación: al superar el umbral se conserva el contenido previo', async () => {
  const { service, adapter } = makeActivity();
  const file = { path: 'n.md', extension: 'md' };
  // Sembrar un log grande en la ubicación vigente (Etapa 5).
  const logPath = 'Master/Folder Lab/activity.log';
  await adapter.mkdir('Master/Folder Lab');
  await adapter.write(logPath, 'x'.repeat(300 * 1024));

  await service.record(file, 'open', 1);

  const rotated = [...adapter.files.keys()].filter((k) =>
    /_activity-\d{4}-\d{2}-\d{2}T.*\.log$/.test(k)
  );
  assert.equal(rotated.length, 1);
  // El contenido previo se conserva íntegro en el rotado.
  assert.equal(adapter.files.get(rotated[0]).length, 300 * 1024);
  // El log vigente solo contiene la nueva línea.
  const fresh = adapter.files.get(logPath);
  assert.ok(fresh.includes('n.md|open|'));
});

test('migración: el log legado se copia al nuevo sin borrar origen', async () => {
  const { service, adapter } = makeActivity();
  await adapter.mkdir('Master/.folder-lab');
  await adapter.write(
    'Master/.folder-lab/_activity.log',
    '1|a.md|open|1\n'
  );
  await service.record({ path: 'b.md', extension: 'md' }, 'open', 1);
  // El nuevo existe con contenido legado + nueva línea.
  const fresh = adapter.files.get('Master/Folder Lab/activity.log');
  assert.ok(fresh.includes('a.md|open|'));
  assert.ok(fresh.includes('b.md|open|'));
  // El legado queda intacto.
  assert.equal(
    adapter.files.get('Master/.folder-lab/_activity.log'),
    '1|a.md|open|1\n'
  );
});

test('poda: se conservan solo los MAX_ROTATED_LOGS más recientes', async () => {
  const { service, adapter } = makeActivity();
  const dir = 'Master/Folder Lab';
  await adapter.mkdir(dir);
  // Sembrar 30 rotados con nombres ordenables.
  for (let i = 0; i < 30; i++) {
    const stamp = `2026-01-${String(i + 1).padStart(2, '0')}T00-00-00`;
    await adapter.write(`${dir}/_activity-${stamp}.log`, 'old');
  }
  await adapter.write(`${dir}/activity.log`, 'x'.repeat(300 * 1024));
  await service.record({ path: 'n.md', extension: 'md' }, 'open', 1);

  const rotated = [...adapter.files.keys()].filter((k) =>
    /_activity-\d{4}-\d{2}-\d{2}T.*\.log$/.test(k)
  );
  assert.equal(rotated.length, 24);
  // Se conservan los más recientes (con el nuevo incluido).
  assert.ok(
    [...adapter.files.keys()].some((k) =>
      /_activity-2026-01-30T/.test(k)
    )
  );
});

test('fallo de rotación: el append continúa sin pérdida', async () => {
  const { service, adapter } = makeActivity();
  adapter.failRename = true;
  const logPath = 'Master/Folder Lab/activity.log';
  await adapter.mkdir('Master/Folder Lab');
  await adapter.write(logPath, 'x'.repeat(300 * 1024));

  await service.record({ path: 'n.md', extension: 'md' }, 'open', 1);

  // El log vigente creció con la nueva línea (rotación fallida).
  const content = adapter.files.get(logPath);
  assert.ok(content.includes('n.md|open|'));
  assert.ok(content.length > 300 * 1024);
});

// ------------------------------------------------------------
// A1: continuidad del ranking después de la rotación
// ------------------------------------------------------------

test('A1: tras rotar, readEvents sigue viendo los eventos recientes del rotado', async () => {
  const { service, adapter } = makeActivity();
  const dir = 'Master/Folder Lab';
  await adapter.mkdir(dir);
  const now = Date.now();
  // Estado post-rotación: el rotado conserva eventos recientes y
  // volumen histórico; el vigente tiene solo lo nuevo.
  const rotatedName = `${dir}/_activity-2026-10-13T00-00-00.log`;
  await adapter.write(
    rotatedName,
    `${now - 1000}|reciente.md|open|1\n` + 'x'.repeat(300 * 1024)
  );
  await adapter.write(`${dir}/activity.log`, `${now}|n.md|open|1\n`);

  const events = await service.readEvents(7);
  const paths = events.map((e) => e.path);
  assert.ok(paths.includes('reciente.md'), 'evento reciente del rotado presente');
  assert.ok(paths.includes('n.md'), 'evento del log vigente presente');
  // Orden cronológico coherente.
  const idxReciente = events.findIndex((e) => e.path === 'reciente.md');
  const idxNuevo = events.findIndex((e) => e.path === 'n.md');
  assert.ok(idxReciente < idxNuevo, 'orden por timestamp');
});

test('A1: deduplicación entre vigente y respaldo legado tras migración', async () => {
  const { service, adapter } = makeActivity();
  const now = Date.now();
  const line = `${now}|dup.md|open|1\n`;
  await adapter.mkdir('Master/Folder Lab');
  await adapter.mkdir('Master/.folder-lab');
  await adapter.write('Master/Folder Lab/activity.log', line);
  // El legado conserva la MISMA línea (transición de Etapa 5).
  await adapter.write('Master/.folder-lab/_activity.log', line);

  const events = await service.readEvents(7);
  assert.equal(events.filter((e) => e.path === 'dup.md').length, 1);
});

test('A1: rotado ilegible se omite con aviso sin ocultar el resto', async () => {
  const { service, adapter } = makeActivity();
  const dir = 'Master/Folder Lab';
  await adapter.mkdir(dir);
  const now = Date.now();
  await adapter.write(`${dir}/activity.log`, `${now}|ok.md|open|1\n`);
  // Un rotado que falla al leerse.
  await adapter.write(`${dir}/_activity-2026-10-12T00-00-00.log`, 'x');
  const originalRead = adapter.read.bind(adapter);
  adapter.read = async (p) => {
    if (p.includes('_activity-2026-10-12')) throw new Error('EIO');
    return originalRead(p);
  };

  const events = await service.readEvents(7);
  assert.ok(events.some((e) => e.path === 'ok.md'));
});

// ------------------------------------------------------------
// B2: protección del historial de Pulir corrupto
// ------------------------------------------------------------

test('B2: append con historial corrupto conserva el original en .bak', async () => {
  const { repo, adapter } = makeBoardRepo();
  await repo.saveNote('Nota.md', boardData([OVERRIDE]));
  const polishKey = [...adapter.files.keys()].find((k) =>
    k.startsWith('Master/Folder Lab/polish/')
  );
  const original = adapter.files.get(polishKey);
  adapter.files.set(polishKey, '{ corrupt');
  void original;

  await repo.saveNote(
    'Nota.md',
    boardData([{ ...OVERRIDE, overrideText: 'v2' }])
  );

  // El contenido corrupto (posiblemente parcialmente recuperable)
  // queda preservado en .bak antes de reconstruir.
  assert.equal(
    adapter.files.get(`${polishKey}.corrupt.bak`),
    '{ corrupt'
  );
  // El historial se reconstruye con la nueva versión.
  const history = JSON.parse(adapter.files.get(polishKey));
  assert.equal(history.data.versions.length, 1);
  assert.equal(history.data.versions[0].overrides[0].overrideText, 'v2');
});
