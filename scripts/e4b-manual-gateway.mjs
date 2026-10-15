#!/usr/bin/env node
// ============================================================
// Pasarela manual de prueba de E4b (cuarentena) — NO conectada
// al arranque del plugin. Requiere una bóveda de prueba aislada.
//
// Uso:
//   node scripts/e4b-manual-gateway.mjs <ruta-de-la-bóveda> [--yes]
//
// Flujo (con confirmación antes de tocar nada):
//   1) Crea un JSON desechable en Folder Lab/boards/ (fixture).
//   2) Caso NO elegible: id activo en ids.json → cuarentena rechazada.
//   3) Caso elegible: se retira el id activo → cuarentena + manifiesto
//      + verificación de que el original desapareció.
//   4) Restauración → contenido idéntico al fixture.
//   5) Limpieza de SOLO los archivos creados por la prueba.
// ============================================================

import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(repoRoot, 'package.json'));
const { build } = require('esbuild');

const vaultPath = process.argv[2];
const autoYes = process.argv.includes('--yes');
if (!vaultPath) {
  console.error('Uso: node scripts/e4b-manual-gateway.mjs <vault> [--yes]');
  process.exit(1);
}

const OBSIDIAN_STUB = `export class App {} export class TFile {} export class TFolder {} export default {}; export class FileSystemAdapter { getBasePath(){return '/s';} }`;

async function bundle(entryRel) {
  const r = await build({
    entryPoints: [join(repoRoot, entryRel)],
    bundle: true, write: false, format: 'esm', platform: 'neutral',
    plugins: [{ name: 's', setup(b) {
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'n' }));
      b.onLoad({ filter: /.*/, namespace: 'n' }, () => ({ contents: OBSIDIAN_STUB, loader: 'js' }));
    }}]
  });
  const url = 'data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64');
  return import(url);
}

const { QuarantineManager } = await bundle('src/storage/quarantine.ts');
const { NoteIdentityRegistry } = await bundle('src/storage/NoteIdentityRegistry.ts');
const { createStillOrphanPredicate } = await bundle('src/storage/stillOrphan.ts');
const { normalizeRootPath } = await bundle('src/utils/rootPath.ts');

// Adaptador fs de la bóveda (la pasarela SÍ escribe: es su propósito).
const adapter = {
  async exists(p) { try { await fs.access(join(vaultPath, p)); return true; } catch { return false; } },
  async read(p) { return fs.readFile(join(vaultPath, p), 'utf8'); },
  async write(p, c) { await fs.mkdir(dirname(join(vaultPath, p)), { recursive: true }); await fs.writeFile(join(vaultPath, p), c); },
  async mkdir(p) { await fs.mkdir(join(vaultPath, p), { recursive: true }); },
  async remove(p) { await fs.unlink(join(vaultPath, p)); }
};

let bookRoot = '';
try {
  bookRoot = JSON.parse(await fs.readFile(join(vaultPath, '.obsidian/plugins/folder-lab/data.json'), 'utf8')).bookRootPath ?? '';
} catch { bookRoot = ''; }
const root = normalizeRootPath(bookRoot) ?? '';
console.log('Bóveda:', vaultPath);
console.log('Raíz normalizada:', JSON.stringify(root));

// Confirmación explícita.
if (!autoYes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    'Esta pasarela CREARÁ y MOVERÁ archivos de prueba en la bóveda indicada. ¿Continuar? (escribir "si"): '
  );
  rl.close();
  if (answer.trim().toLowerCase() !== 'si') {
    console.log('Abortado por el usuario. Nada se tocó.');
    process.exit(0);
  }
}

const FIXTURE_ID = 'id-e4btest';
const FIXTURE_PATH = `${root}/Folder Lab/boards/${FIXTURE_ID}.json`;
const FIXTURE_CONTENT = JSON.stringify({ version: 1, notePath: 'nota-de-prueba.md', data: { prueba: true } }, null, 2);
const IDS_PATH = `${root}/Folder Lab/ids.json`;
const MANIFEST_PATH = `${root}/Folder Lab/quarantine/manifest.json`;

const hidden = {
  async readJSON(folder, name) {
    const p = join(folder === root ? '' : '', name); // no usado: registry recibe adapter real abajo
    void p;
    return null;
  },
  async writeJSON() {}
};
void hidden;

// Registro real sobre fs (para stillOrphan).
class FsHidden {
  constructor(base) { this.base = base; }
  async readJSON(folder, name) {
    // HiddenFolderManager escribe <master>/<folder>/<name> vía adapter;
    // aquí el "folder" del registry es '' (raíz) + 'Folder Lab'.
    const p = join(this.base, 'Folder Lab', name);
    try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
  }
  async writeJSON(folder, name, data) {
    const p = join(this.base, 'Folder Lab', name);
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(data, null, 2));
  }
}

const registry = new NoteIdentityRegistry({ vault: { adapter } }, () => root, new FsHidden(vaultPath));
const app = { vault: { adapter } };
const stillOrphan = createStillOrphanPredicate(app, registry, () => root);
const manager = new QuarantineManager(app, () => root, stillOrphan);

const candidate = {
  path: FIXTURE_PATH,
  noteId: FIXTURE_ID,
  subfolder: 'boards',
  reason: 'prueba manual E4b (fixture desechable)',
  mtime: Date.now()
};

const created = [];
try {
  // ----------------------------------------------------------
  // Paso 1: fixture
  // ----------------------------------------------------------
  await adapter.write(FIXTURE_PATH, FIXTURE_CONTENT);
  created.push(FIXTURE_PATH);
  console.log('[1] fixture creado:', FIXTURE_PATH);

  // ----------------------------------------------------------
  // Paso 2: caso NO elegible (id activo en ids.json)
  // ----------------------------------------------------------
  const idsExisting = await adapter.exists(IDS_PATH)
    ? JSON.parse(await adapter.read(IDS_PATH))
    : { version: 1, ids: {}, tombstones: {}, pending: {}, archived: {} };
  const idsBackup = JSON.stringify(idsExisting);
  idsExisting.ids = idsExisting.ids || {};
  idsExisting.ids['nota-de-prueba.md'] = FIXTURE_ID;
  await adapter.write(IDS_PATH, JSON.stringify(idsExisting, null, 2));
  created.push(IDS_PATH);

  const rejected = await manager.quarantine(candidate);
  console.log('[2] con id activo →', rejected.status, '-', rejected.reason ?? '');
  if (rejected.status !== 'skipped') throw new Error('se esperaba skipped');
  if (!(await adapter.exists(FIXTURE_PATH))) throw new Error('el original se movió sin deber');
  console.log('    original intacto ✓');

  // ----------------------------------------------------------
  // Paso 3: elegible (retirar el id activo) → cuarentena
  // (nuevas instancias = «reinicio» de sesión; la caché del
  // registro no debe enmascarar el cambio.)
  // ----------------------------------------------------------
  delete idsExisting.ids['nota-de-prueba.md'];
  await adapter.write(IDS_PATH, JSON.stringify(idsExisting, null, 2));

  const registry2 = new NoteIdentityRegistry({ vault: { adapter } }, () => root, new FsHidden(vaultPath));
  const stillOrphan2 = createStillOrphanPredicate(app, registry2, () => root);
  const manager2 = new QuarantineManager(app, () => root, stillOrphan2);

  const q = await manager2.quarantine(candidate);
  console.log('[3] elegible →', q.status);
  if (q.status !== 'quarantined') throw new Error('se esperaba quarantined');
  if (await adapter.exists(FIXTURE_PATH)) throw new Error('el original no se retiró');
  if (!(await adapter.exists(q.entry.quarantinePath))) throw new Error('falta la copia');
  const manifest = JSON.parse(await adapter.read(MANIFEST_PATH));
  if (!manifest.entries.some((e) => e.entryId === q.entry.entryId)) {
    throw new Error('entrada ausente del manifiesto');
  }
  console.log('    copia + manifiesto verificados; original retirado ✓');

  // ----------------------------------------------------------
  // Paso 4: restauración
  // ----------------------------------------------------------
  const r = await manager2.restore(q.entry.entryId);
  console.log('[4] restauración →', r.status);
  if (r.status !== 'restored') throw new Error('se esperaba restored');
  const restored = await adapter.read(FIXTURE_PATH);
  if (restored !== FIXTURE_CONTENT) throw new Error('el contenido restaurado no coincide');
  console.log('    contenido idéntico al fixture ✓');

  // ----------------------------------------------------------
  // Paso 5: limpieza (solo lo creado/alterado por la prueba)
  // ----------------------------------------------------------
  // Usar las rutas EXACTAS registradas en el manifiesto.
  const finalManifest = await adapter.exists(MANIFEST_PATH)
    ? JSON.parse(await adapter.read(MANIFEST_PATH))
    : { entries: [] };
  console.log('[5] limpieza de:', created, MANIFEST_PATH, 'y copias del manifiesto…');
  for (const entry of finalManifest.entries) {
    const qp = entry.quarantinePath.replace(/^\//, '');
    if (await adapter.exists(qp)) {
      await adapter.remove(qp);
      await fs.rmdir(dirname(join(vaultPath, qp))).catch(() => {});
      await fs.rmdir(dirname(dirname(join(vaultPath, qp)))).catch(() => {});
      await fs.rmdir(dirname(dirname(dirname(join(vaultPath, qp))))).catch(() => {});
    }
  }
  for (const p of created) {
    const rel = p.replace(/^\//, '');
    if (await adapter.exists(rel)) await adapter.remove(rel);
  }
  if (await adapter.exists(MANIFEST_PATH.replace(/^\//, ''))) {
    await adapter.remove(MANIFEST_PATH.replace(/^\//, ''));
  }
  // Directorio de cuarentena si quedó vacío.
  await fs.rmdir(join(vaultPath, root, 'Folder Lab', 'quarantine')).catch(() => {});
  void idsBackup;
  console.log('PRUEBA E4B COMPLETADA CORRECTAMENTE');
} catch (error) {
  console.error('FALLO DE LA PASARELA:', error.message ?? error);
  console.error('Archivos creados que conviene revisar manualmente:', created);
  process.exitCode = 1;
}
