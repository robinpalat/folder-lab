// ============================================================
// PRUEBAS: Cuarentena reversible de huérfanos (E4b)
// ============================================================
// Ejecutar con: npm test
//
// Fixtures únicamente (sin datos reales). Cubre:
// - Éxito: copia, verificación, manifiesto y retiro del original.
// - Copia incompleta / fallo de manifiesto: original intacto.
// - Restauración con destino cambiado: rechazo sin sobrescritura.
// - Idempotencia de cuarentena y restauración.
// - Manifiesto inconsistente.
// - Elegibilidad (solo JSON de las cuatro subcarpetas).
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

const { QuarantineManager, contentHash } = await bundle(
  'src/storage/quarantine.ts'
);

class FakeAdapter {
  files = new Map();
  dirs = new Set();
  failWritePrefix = null;
  failRemove = false;
  failWriteManifest = false;
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
    if (this.failWritePrefix && p.startsWith(this.failWritePrefix)) {
      throw new Error('EIO simulado');
    }
    if (this.failWriteManifest && p.endsWith('manifest.json')) {
      throw new Error('EIO manifiesto');
    }
    this.files.set(p, c);
  }
  async remove(p) {
    if (this.failRemove) throw new Error('EIO remove');
    this.files.delete(p);
  }
}

function makeSystem() {
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  const manager = new QuarantineManager(app, () => 'Master');
  return { adapter, manager };
}

function candidate(overrides = {}) {
  return {
    path: 'Master/Folder Lab/boards/id-huerfano.json',
    noteId: 'id-huerfano',
    subfolder: 'boards',
    reason: 'id ausente de ids.json',
    mtime: Date.now() - 48 * 60 * 60 * 1000,
    ...overrides
  };
}

const CONTENT = JSON.stringify({ version: 1, notePath: 'nadie.md', data: {} });

async function seed(adapter) {
  adapter.files.set('Master/Folder Lab/boards/id-huerfano.json', CONTENT);
}

test('E4b-1: cuarentena exitosa (copia + manifiesto + retiro del original)', async () => {
  const { adapter, manager } = makeSystem();
  await seed(adapter);

  const result = await manager.quarantine(candidate());
  assert.equal(result.status, 'quarantined');
  const entry = result.entry;
  assert.equal(entry.originPath, 'Master/Folder Lab/boards/id-huerfano.json');
  assert.equal(entry.noteId, 'id-huerfano');
  assert.equal(entry.subfolder, 'boards');
  assert.ok(entry.reason.length > 0);
  assert.equal(entry.size, CONTENT.length);
  assert.equal(entry.contentHash, contentHash(CONTENT));
  assert.ok(entry.quarantinedAt > 0);

  // Original retirado; copia presente y verificada.
  assert.equal(adapter.files.has(entry.originPath), false);
  assert.equal(adapter.files.get(entry.quarantinePath), CONTENT);

  // Manifiesto persistido con todos los campos.
  const manifest = await manager.readManifest();
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0].entryId, entry.entryId);
  assert.equal(manifest.entries[0].restoredAt, undefined);
});

test('E4b-2: fallo en la copia → original intacto y sin manifiesto', async () => {
  const { adapter, manager } = makeSystem();
  await seed(adapter);
  adapter.failWritePrefix = 'Master/Folder Lab/quarantine/';

  const result = await manager.quarantine(candidate());
  assert.equal(result.status, 'failed');
  assert.equal(adapter.files.get('Master/Folder Lab/boards/id-huerfano.json'), CONTENT, 'original intacto');
  assert.equal(adapter.files.has('Master/Folder Lab/quarantine/manifest.json'), false);
});

test('E4b-3: fallo al escribir el manifiesto → copia retirada, original intacto', async () => {
  const { adapter, manager } = makeSystem();
  await seed(adapter);
  adapter.failWriteManifest = true;

  const result = await manager.quarantine(candidate());
  assert.equal(result.status, 'failed');
  assert.equal(adapter.files.get('Master/Folder Lab/boards/id-huerfano.json'), CONTENT, 'original intacto');
  const copies = [...adapter.files.keys()].filter((k) => k.includes('/quarantine/') && k.endsWith('.json'));
  assert.equal(copies.length, 0, 'copia suelta retirada');
});

test('E4b-4: idempotencia — reintentar la cuarentena no duplica', async () => {
  const { adapter, manager } = makeSystem();
  await seed(adapter);
  const first = await manager.quarantine(candidate());
  assert.equal(first.status, 'quarantined');

  // Reintento con el original ya retirado.
  const second = await manager.quarantine(candidate());
  assert.equal(second.status, 'skipped');
  const manifest = await manager.readManifest();
  assert.equal(manifest.entries.length, 1, 'sin entradas duplicadas');
});

test('E4b-5: restauración exitosa con verificación de destino', async () => {
  const { adapter, manager } = makeSystem();
  await seed(adapter);
  const q = await manager.quarantine(candidate());

  const restored = await manager.restore(q.entry.entryId);
  assert.equal(restored.status, 'restored');
  assert.equal(adapter.files.get('Master/Folder Lab/boards/id-huerfano.json'), CONTENT);
  const manifest = await manager.readManifest();
  assert.ok(manifest.entries[0].restoredAt, 'manifiesto actualizado');

  // Restauración repetida: idempotente (mismo contenido).
  const again = await manager.restore(q.entry.entryId);
  assert.equal(again.status, 'restored');
  assert.equal(adapter.files.get('Master/Folder Lab/boards/id-huerfano.json'), CONTENT);
});

test('E4b-6: destino cambiado → rechazo sin sobrescritura', async () => {
  const { adapter, manager } = makeSystem();
  await seed(adapter);
  const q = await manager.quarantine(candidate());

  // Aparece un archivo nuevo en el origen (contenido distinto).
  const nuevo = JSON.stringify({ version: 1, notePath: 'nadie.md', data: { nuevo: true } });
  adapter.files.set(q.entry.originPath, nuevo);

  const restored = await manager.restore(q.entry.entryId);
  assert.equal(restored.status, 'destination-changed');
  assert.equal(adapter.files.get(q.entry.originPath), nuevo, 'destino sin tocar');
  assert.equal(adapter.files.get(q.entry.quarantinePath), CONTENT, 'cuarentena conservada');
});

test('E4b-7: manifiesto inconsistente (hash alterado) → fallo limpio', async () => {
  const { adapter, manager } = makeSystem();
  await seed(adapter);
  const q = await manager.quarantine(candidate());

  const manifest = await manager.readManifest();
  manifest.entries[0].contentHash = 'alterado';
  await adapter.write('Master/Folder Lab/quarantine/manifest.json', JSON.stringify(manifest));

  const restored = await manager.restore(q.entry.entryId);
  assert.equal(restored.status, 'failed');
  assert.ok(restored.error.includes('manifiesto'));
  assert.equal(adapter.files.get(q.entry.quarantinePath), CONTENT, 'cuarentena intacta');
});

test('E4b-8: elegibilidad — solo JSON de las cuatro subcarpetas', async () => {
  assert.equal(QuarantineManager.isEligible(candidate()), true);
  assert.equal(
    QuarantineManager.isEligible(candidate({ path: 'Master/Folder Lab/exports/indice.md', subfolder: 'exports' })),
    false
  );
  assert.equal(
    QuarantineManager.isEligible(candidate({ path: 'Notas/a.md', subfolder: 'boards' })),
    false,
    'extensión .md nunca elegible'
  );
  assert.equal(
    QuarantineManager.isEligible(candidate({ path: 'Master/Folder Lab/trash/x.json', subfolder: 'trash' })),
    false
  );

  // La cuarentena rechaza explícitamente un candidato no elegible.
  const { manager } = makeSystem();
  const result = await manager.quarantine(
    candidate({ path: 'Master/Folder Lab/exports/indice.md', subfolder: 'exports' })
  );
  assert.equal(result.status, 'skipped');
});
