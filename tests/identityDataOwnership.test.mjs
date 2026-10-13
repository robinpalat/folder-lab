// ============================================================
// PRUEBAS: Propiedad de datos por identidad (Corrección A)
// ============================================================
// Ejecutar con: npm test
//
// Reproduce los fallos observados:
// - Nota A con Board/contexto/borradores; borrado; nota B nueva en
//   la MISMA ruta: B NO recibe los datos de A (ni store legado, ni
//   espejo LS, ni archivo de entidad).
// - Entidad inexistente para un id activo: no se adopta el store
//   legado por ruta cuando la propiedad es ambigua (pendientes).
// - Datos legítimos: recuperados desde el archivo propio y desde
//   el espejo de la MISMA identidad; reclamación explícita
//   rehabilita la adopción del legado.
// - Renombrar: el espejo por id no necesita re-clavado.
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

class FakeHidden {
  files = new Map();
  async readJSON(folder, name) {
    const key = `${folder}/${name}`;
    return this.files.has(key) ? structuredClone(this.files.get(key)) : null;
  }
  async writeJSON(folder, name, data) {
    this.files.set(`${folder}/${name}`, structuredClone(data));
  }
}

class FakeAdapter {
  files = new Map();
  dirs = new Set();
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
  async list(p) {
    const pre = p.endsWith('/') ? p : p + '/';
    return {
      files: [...this.files.keys()].filter((k) => k.startsWith(pre)),
      folders: []
    };
  }
}

class FakeLS {
  map = new Map();
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, v);
  }
}

const { NoteIdentityRegistry } = await bundle(
  'src/storage/NoteIdentityRegistry.ts'
);
const { LocalMirror, mirrorKey, legacyMirrorKey } = await bundle(
  'src/storage/localMirror.ts'
);
const { BoardRepository } = await bundle('src/storage/BoardRepository.ts');
const { NoteRepository } = await bundle('src/storage/NoteRepository.ts');

const MASTER = 'Master';

function makeRegistry(hidden = new FakeHidden()) {
  const registry = new NoteIdentityRegistry({}, () => MASTER, hidden);
  return { registry, hidden };
}

function makeMirror(registry, storage = new FakeLS()) {
  const mirror = new LocalMirror({
    storage,
    vaultId: 'vid',
    getNoteId: (p) => registry.getId(p),
    hasSafeOwnership: (p) =>
      registry.getPendingFor(p).then((c) => c.length === 0)
  });
  return { mirror, storage };
}

// ------------------------------------------------------------
// 1. LocalMirror: aislamiento por identidad
// ------------------------------------------------------------
test('A-mirror: dos identidades en la misma ruta no comparten espejo', async () => {
  const { registry } = makeRegistry();
  const { mirror, storage } = makeMirror(registry);

  // Datos legados de A por ruta (formato histórico).
  storage.setItem(legacyMirrorKey('focus-notes-draft', 'vid', 'n.md'), 'borrador de A');
  await registry.getId('n.md');
  await registry.onDeleted('n.md');
  // Nota B nueva en la misma ruta: id nuevo; espejo propio.
  const idB = await registry.getId('n.md');
  const readB = await mirror.read('focus-notes-draft', 'n.md');
  // Con pendientes: NADA de A para B.
  assert.equal(readB.value, null);
  await mirror.write('focus-notes-draft', 'n.md', 'borrador de B');
  assert.equal(
    storage.getItem(mirrorKey('focus-notes-draft', 'vid', idB)),
    'borrador de B'
  );
  // El legado de A sigue intacto en su clave histórica.
  assert.equal(
    storage.getItem(legacyMirrorKey('focus-notes-draft', 'vid', 'n.md')),
    'borrador de A'
  );
});

test('A-mirror: adopción del legado SOLO con propiedad segura', async () => {
  const { registry } = makeRegistry();
  const { mirror, storage } = makeMirror(registry);
  storage.setItem(legacyMirrorKey('focus-notes-draft', 'vid', 'ok.md'), 'v');
  const id = await registry.getId('ok.md');
  const r = await mirror.read('focus-notes-draft', 'ok.md');
  assert.equal(r.value, 'v');
  assert.equal(r.adopted, true);
  // Copiado al espejo del id; legado intacto.
  assert.equal(storage.getItem(mirrorKey('focus-notes-draft', 'vid', id)), 'v');
});

test('A-mirror: lectura/escritura por familia (draft, blocks, results)', async () => {
  const { registry } = makeRegistry();
  const { mirror } = makeMirror(registry);
  await registry.getId('n.md');
  for (const family of [
    'focus-notes-draft',
    'focus-notes-blocks',
    'focus-memory-results'
  ]) {
    await mirror.write(family, 'n.md', `x-${family}`);
  }
  for (const family of [
    'focus-notes-draft',
    'focus-notes-blocks',
    'focus-memory-results'
  ]) {
    const r = await mirror.read(family, 'n.md');
    assert.equal(r.value, `x-${family}`);
  }
});

// ------------------------------------------------------------
// 2. Board/Contexto: sin adopción con pendientes
// ------------------------------------------------------------

function boardData(tag) {
  return {
    blocks: [{ id: `b-${tag}`, x: 0, y: 0, w: 1, h: 1 }],
    connections: []
  };
}

function contextData() {
  return { widgets: [{ typeId: 'notes', instanceId: 'i1', name: 'n' }], layout: { top: 'i1', bottom: 'i1' } };
}

function legacyBoardPath(folder) {
  return `${folder}/.folder-lab/_board.json`;
}

function makeRepos(registry) {
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  const ownershipSafe = (p) =>
    registry.getPendingFor(p).then((c) => c.length === 0);
  const boards = new BoardRepository(app, {
    identity: (p) => registry.getId(p),
    getRootPath: () => MASTER,
    legacyOwnershipSafe: ownershipSafe
  });
  const context = new NoteRepository(app, {
    identity: (p) => registry.getId(p),
    getRootPath: () => MASTER,
    legacyOwnershipSafe: ownershipSafe
  });
  return { boards, context, adapter };
}

test('A-board: nota B en ruta de A NO hereda el board legado', async () => {
  const { registry } = makeRegistry();
  const { boards, adapter } = makeRepos(registry);
  const path = 'Notas/n.md';

  // Nota A: board en el store legado + identidad.
  await registry.getId(path);
  await adapter.mkdir('Notas/.folder-lab');
  await adapter.write(
    legacyBoardPath('Notas'),
    JSON.stringify({ [path]: boardData('A') })
  );

  // Borrado (pendiente) y nota B nueva en la misma ruta.
  await registry.onDeleted(path);
  const idB = await registry.getId(path);

  // B: carga devuelve vacío (sin herencia)…
  const loadedB = await boards.loadNote(path);
  assert.equal(loadedB, null, 'sin herencia del board de A');

  // …y NO se migra el legado a la entidad de B.
  const entityKeys = [...adapter.files.keys()].filter((k) =>
    k.startsWith(`${MASTER}/Folder Lab/boards/`)
  );
  assert.equal(entityKeys.length, 0);
  void idB;
});

test('A-board: el reclamo ANTES de cargar rehabilita la adopción del legado', async () => {
  const { registry } = makeRegistry();
  const { boards, adapter } = makeRepos(registry);
  const path = 'Notas/n.md';

  await registry.getId(path);
  await adapter.mkdir('Notas/.folder-lab');
  await adapter.write(
    legacyBoardPath('Notas'),
    JSON.stringify({ [path]: boardData('A') })
  );
  await registry.onDeleted(path);

  // Reclamo explícito (sin id activo): la identidad vuelve.
  const claim = await registry.claim(path);
  assert.equal(claim.status, 'claimed');

  // Con propiedad establecida, loadNote adopta el legado en la
  // identidad reclamada (migración perezosa legítima).
  const loaded = await boards.loadNote(path);
  assert.equal(loaded.blocks[0].id, 'b-A');
});

test('A-contexto: nota B nueva NO hereda el contexto legado de A', async () => {
  const { registry } = makeRegistry();
  const { context, adapter } = makeRepos(registry);
  const path = 'Notas/n.md';

  await registry.getId(path);
  await adapter.mkdir('Notas/.folder-lab');
  await adapter.write(
    'Notas/.folder-lab/_note_context.json',
    JSON.stringify({ [path]: contextData() })
  );
  await registry.onDeleted(path);
  await registry.getId(path); // id nuevo de B

  const loaded = await context.loadNote(path);
  assert.equal(loaded, null, 'sin herencia del contexto de A');
});

test('A-board: sin identidad (legacy puro) el store por ruta sigue funcionando', async () => {
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  // Repositorio SIN opciones (modo legacy, como las suites previas).
  const boards = new BoardRepository(app);
  await adapter.mkdir('Libro/.folder-lab');
  await adapter.write(
    legacyBoardPath('Libro'),
    JSON.stringify({ 'Libro/a.md': boardData('legacy') })
  );
  const loaded = await boards.loadNote('Libro/a.md');
  assert.equal(loaded.blocks[0].id, 'b-legacy');
});

// ------------------------------------------------------------
// 3. Reclamación y espejo: recuperación de la identidad correcta
// ------------------------------------------------------------
test('A-claim: reclamo explícito rehabilita la adopción del espejo legado', async () => {
  const { registry } = makeRegistry();
  const { mirror, storage } = makeMirror(registry);
  const oldId = await registry.getId('n.md');
  storage.setItem(
    legacyMirrorKey('focus-notes-draft', 'vid', 'n.md'),
    'borrador de A'
  );

  // A se borra → pendiente.
  await registry.onDeleted('n.md');

  // Reclamo explícito ANTES de cualquier lectura (sin id activo).
  const claim = await registry.claim('n.md', 'pending');
  assert.equal(claim.status, 'claimed');
  assert.equal(await registry.findIdByPath('n.md'), oldId);

  // Con la pendiente resuelta, el espejo legado se adopta al id A.
  const r = await mirror.read('focus-notes-draft', 'n.md');
  assert.equal(r.value, 'borrador de A');
  assert.equal(r.adopted, true);

  // Y mientras existía pendiente, la lectura no heredaba.
  void mirror;
});

test('A-rename: el espejo por identidad NO requiere re-clavado', async () => {
  const { registry } = makeRegistry();
  const { mirror } = makeMirror(registry);
  await registry.getId('viejo.md');
  await mirror.write('focus-memory-results', 'viejo.md', '[1]');
  await registry.onRenamed('viejo.md', 'nuevo.md');
  // Misma identidad → misma clave de espejo.
  const r = await mirror.read('focus-memory-results', 'nuevo.md');
  assert.equal(r.value, '[1]');
});

// ------------------------------------------------------------
// 4. Compatibilidad: datos legados intactos tras las operaciones
// ------------------------------------------------------------
test('A-compat: nada se borra de las claves legadas ni del store legado', async () => {
  const { registry, hidden } = makeRegistry();
  const { mirror, storage } = makeMirror(registry);
  const { boards, adapter } = makeRepos(registry);

  const legacyKey = legacyMirrorKey('focus-notes-draft', 'vid', 'n.md');
  storage.setItem(legacyKey, 'dato viejo');
  await adapter.mkdir('Notas/.folder-lab');
  await adapter.write(
    legacyBoardPath('Notas'),
    JSON.stringify({ 'Notas/n.md': boardData('A') })
  );

  await registry.getId('n.md');
  await registry.onDeleted('n.md');
  await registry.getId('n.md'); // B
  await boards.loadNote('Notas/n.md');
  await mirror.read('focus-notes-draft', 'n.md');

  // Originales intactos.
  assert.equal(storage.getItem(legacyKey), 'dato viejo');
  assert.ok(
    adapter.files.get(legacyBoardPath('Notas')).includes('b-A'),
    'store legado intacto'
  );
  // El registro conserva la pendiente de A (recuperable).
  const pending = await registry.getPendingFor('n.md');
  assert.equal(pending.length, 1);
  void hidden;
});
