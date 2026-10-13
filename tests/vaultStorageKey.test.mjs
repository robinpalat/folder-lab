// ============================================================
// PRUEBAS: Aislamiento de localStorage por bóveda (Fase 8D)
// ============================================================
// Ejecutar con: npm test
//
// Contrato verificado:
// - Dos bóvedas con la misma ruta de nota producen claves distintas.
// - Lectura y escritura quedan aisladas (claves distintas por bóveda).
// - No existe migración automática: la construcción de la clave nueva
//   jamás devuelve el formato legado, por lo que los datos existentes
//   no se sobrescriben ni se eliminan.
// - Varias ventanas de la misma bóveda (mismo adapter/basePath o
//   mismo nombre) usan el mismo espacio lógico de datos.
// - Rutas anidadas y caracteres especiales se preservan en la clave.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Stub de obsidian: FileSystemAdapter controlable por el test.
const OBSIDIAN_STUB = `
export class FileSystemAdapter {
  constructor(basePath) { this._base = basePath; }
  getBasePath() { return this._base; }
}
globalThis.__FileSystemAdapter = FileSystemAdapter;
export class App {}
export default {};
`;

const result = await build({
  entryPoints: [join(root, 'src', 'utils', 'vault-storage.ts')],
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

const bundled = result.outputFiles[0].text;
const url =
  'data:text/javascript;base64,' + Buffer.from(bundled).toString('base64');
const mod = await import(url);
const { vaultStorageKey, hashVaultId, resolveVaultStorageId } = mod;
// Misma clase que usa el stub dentro del bundle (instanceof debe coincidir).
const FileSystemAdapter = globalThis.__FileSystemAdapter;

// ------------------------------------------------------------
// 1. Misma ruta de nota en dos bóvedas → claves distintas
// ------------------------------------------------------------
test('dos bóvedas con la misma ruta producen claves distintas', () => {
  const idA = hashVaultId('/home/user/VaultA');
  const idB = hashVaultId('/home/user/VaultB');
  const keyA = vaultStorageKey(idA, 'focus-notes-draft', 'Notas/Tarea.md');
  const keyB = vaultStorageKey(idB, 'focus-notes-draft', 'Notas/Tarea.md');
  assert.notEqual(keyA, keyB);
  assert.match(keyA, /^focus-notes-draft-[\w]+-Notas\/Tarea\.md$/);
  assert.match(keyB, /^focus-notes-draft-[\w]+-Notas\/Tarea\.md$/);
});

// ------------------------------------------------------------
// 2. Lectura y escritura aisladas (claves deterministas por bóveda)
// ------------------------------------------------------------
test('lectura y escritura quedan aisladas por bóveda', () => {
  const idA = hashVaultId('/vault/a');
  const idB = hashVaultId('/vault/b');
  // Simulación de un store compartido (localStorage global).
  const store = new Map();
  const write = (id, path, value) =>
    store.set(vaultStorageKey(id, 'focus-notes-draft', path), value);
  const read = (id, path) =>
    store.get(vaultStorageKey(id, 'focus-notes-draft', path));

  write(idA, 'Proyecto.md', 'borrador de A');
  write(idB, 'Proyecto.md', 'borrador de B');
  assert.equal(read(idA, 'Proyecto.md'), 'borrador de A');
  assert.equal(read(idB, 'Proyecto.md'), 'borrador de B');
  assert.equal(store.size, 2);
});

// ------------------------------------------------------------
// 3-4. Sin migración automática: la clave nueva nunca es la legada
// ------------------------------------------------------------
test('la construcción de claves nunca devuelve el formato legado', () => {
  const id = hashVaultId('/vault/x');
  const legacy = 'focus-notes-draft-Notas/Tarea.md';
  for (const path of ['Notas/Tarea.md', 'a.md', '']) {
    for (const family of [
      'focus-notes',
      'focus-notes-draft',
      'focus-notes-blocks',
      'focus-memory-results'
    ]) {
      const key = vaultStorageKey(id, family, path);
      assert.notEqual(key, legacy);
      // La clave legada es exactamente familia-ruta: la nueva siempre
      // inserta vaultId (no vacío) entre ambos.
      assert.ok(key.startsWith(`${family}-`));
      assert.notEqual(key, `${family}-${path}`);
    }
  }
});

test('el helper no toca localStorage (cero riesgo de borrado de origen)', () => {
  const src = readFileSync(
    join(root, 'src', 'utils', 'vault-storage.ts'),
    'utf8'
  );
  // Sin llamadas a la API (los comentarios documentales están permitidos).
  assert.ok(!src.includes('localStorage.'));
});

// ------------------------------------------------------------
// 5. Varias ventanas de la misma bóveda → mismo espacio lógico
// ------------------------------------------------------------
test('misma bóveda en varias ventanas usa la misma clave', () => {
  // Dos instancias de adapter para la MISMA basePath (dos ventanas).
  const win1 = { vault: { adapter: new FileSystemAdapter('/vault/same'), getName: () => 'Same' } };
  const win2 = { vault: { adapter: new FileSystemAdapter('/vault/same'), getName: () => 'Same' } };
  const id1 = resolveVaultStorageId(win1);
  const id2 = resolveVaultStorageId(win2);
  assert.equal(id1, id2);
  assert.equal(
    vaultStorageKey(id1, 'focus-notes', 'n.md'),
    vaultStorageKey(id2, 'focus-notes', 'n.md')
  );
});

test('dos bóvedas con el MISMO nombre pero distinto basePath no colisionan (Desktop)', () => {
  const vaultA = { vault: { adapter: new FileSystemAdapter('/data/A'), getName: () => 'Notas' } };
  const vaultB = { vault: { adapter: new FileSystemAdapter('/data/B'), getName: () => 'Notas' } };
  assert.notEqual(
    resolveVaultStorageId(vaultA),
    resolveVaultStorageId(vaultB)
  );
});

test('móvil (sin FileSystemAdapter) cae al hash del nombre', () => {
  const mobileVault = { vault: { adapter: {}, getName: () => 'MiBoveda' } };
  const id = resolveVaultStorageId(mobileVault);
  assert.equal(id, hashVaultId('MiBoveda'));
});

// ------------------------------------------------------------
// 6. Rutas anidadas y caracteres especiales
// ------------------------------------------------------------
test('rutas anidadas y caracteres especiales se preservan', () => {
  const id = hashVaultId('/v');
  const path = 'Carpetas/Sub ñ/Nota con espacios & #-final.md';
  const key = vaultStorageKey(id, 'focus-notes-blocks', path);
  assert.ok(key.endsWith(path));
  assert.equal(
    key,
    vaultStorageKey(id, 'focus-notes-blocks', path)
  );
});

test('hashVaultId es determinista y distinto para entradas distintas', () => {
  assert.equal(hashVaultId('abc'), hashVaultId('abc'));
  assert.notEqual(hashVaultId('abc'), hashVaultId('abd'));
  assert.match(hashVaultId('cualquier/ruta'), /^[0-9a-z]+$/);
});
