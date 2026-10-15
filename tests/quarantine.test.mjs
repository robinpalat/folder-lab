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

function makeSystem(opts = {}) {
  const adapter = new FakeAdapter();
  const app = { vault: { adapter } };
  const manager = new QuarantineManager(
    app,
    () => 'Master',
    opts.stillOrphan
  );
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

// ------------------------------------------------------------
// M1: revalidación en vivo
// ------------------------------------------------------------

test('M1: identidad ya no huérfana al empezar → skipped, sin copia', async () => {
  const { adapter, manager } = makeSystem({ stillOrphan: async () => false });
  await seed(adapter);
  const result = await manager.quarantine(candidate());
  assert.equal(result.status, 'skipped');
  assert.ok(result.reason.includes('revalidación'));
  assert.equal(adapter.files.get('Master/Folder Lab/boards/id-huerfano.json'), CONTENT, 'original intacto');
  const copies = [...adapter.files.keys()].filter((k) => k.includes('/quarantine/'));
  assert.equal(copies.length, 0, 'sin copia');
});

test('M1: identidad reclamada ENTRE copia y retiro → skipped, copia retirada, original intacto', async () => {
  // Primer check (inicio) true; segundo check (pre-retiro) false.
  let calls = 0;
  const { adapter, manager } = makeSystem({
    stillOrphan: async () => {
      calls += 1;
      return calls <= 1;
    }
  });
  await seed(adapter);
  const result = await manager.quarantine(candidate());
  assert.equal(result.status, 'skipped');
  assert.ok(result.reason.includes('revalidación final'));
  assert.equal(adapter.files.get('Master/Folder Lab/boards/id-huerfano.json'), CONTENT, 'original intacto');
  const copies = [...adapter.files.keys()].filter(
    (k) => k.includes('/quarantine/') && k.endsWith('.json') && !k.endsWith('manifest.json')
  );
  assert.equal(copies.length, 0, 'copia retirada tras el aborto');
  // Sin entrada en el manifiesto.
  const manifest = await manager.readManifest();
  assert.equal(manifest.entries.length, 0);
});

test('M1: error en la revalidación → failed, original conservado', async () => {
  const { adapter, manager } = makeSystem({
    stillOrphan: async () => {
      throw new Error('registry EIO');
    }
  });
  await seed(adapter);
  const result = await manager.quarantine(candidate());
  assert.equal(result.status, 'failed');
  assert.ok(result.error.includes('revalidación'));
  assert.equal(adapter.files.get('Master/Folder Lab/boards/id-huerfano.json'), CONTENT);
});

// ------------------------------------------------------------
// M2: copias parciales
// ------------------------------------------------------------

test('M2: escritura parcial + fallo de limpieza → residual informado, original intacto', async () => {
  const { adapter, manager } = makeSystem();
  await seed(adapter);
  // La escritura de cuarentena deja un archivo parcial y la
  // limpieza también falla.
  const originalWrite = adapter.write.bind(adapter);
  adapter.write = async (p, c) => {
    if (p.includes('/quarantine/') && p.endsWith('.json')) {
      adapter.files.set(p, c.slice(0, 5)); // parcial
      throw new Error('EIO simulado');
    }
    return originalWrite(p, c);
  };
  adapter.failRemove = true;

  const result = await manager.quarantine(candidate());
  assert.equal(result.status, 'failed');
  assert.ok(result.error.includes('residual'), 'informa del archivo residual');
  assert.equal(adapter.files.get('Master/Folder Lab/boards/id-huerfano.json'), CONTENT, 'original intacto');
});

// ------------------------------------------------------------
// M3: serialización de operaciones locales
// ------------------------------------------------------------

test('M3: dos cuarentenas concurrentes no pierden entradas del manifiesto', async () => {
  const { adapter, manager } = makeSystem();
  adapter.files.set('Master/Folder Lab/boards/id-a.json', '{"a":1}');
  adapter.files.set('Master/Folder Lab/drafts/id-b.json', '{"b":2}');

  const [r1, r2] = await Promise.all([
    manager.quarantine(candidate({ path: 'Master/Folder Lab/boards/id-a.json', noteId: 'id-a', subfolder: 'boards' })),
    manager.quarantine(candidate({ path: 'Master/Folder Lab/drafts/id-b.json', noteId: 'id-b', subfolder: 'drafts' }))
  ]);
  assert.equal(r1.status, 'quarantined');
  assert.equal(r2.status, 'quarantined');
  const manifest = await manager.readManifest();
  assert.equal(manifest.entries.length, 2, 'ambas entradas presentes (sin pérdida)');
  const ids = manifest.entries.map((e) => e.noteId).sort();
  assert.deepEqual(ids, ['id-a', 'id-b']);
});

// ------------------------------------------------------------
// Extras solicitados
// ------------------------------------------------------------

test('extra: manifiesto escrito corrupto → operación conservadora', async () => {
  const { adapter, manager } = makeSystem();
  await seed(adapter);
  // Simular corrupción previa del manifiesto.
  await adapter.mkdir('Master/Folder Lab/quarantine');
  await adapter.write('Master/Folder Lab/quarantine/manifest.json', '{ roto');

  const result = await manager.quarantine(candidate());
  assert.equal(result.status, 'failed');
  assert.ok(result.error.includes('manifiesto'));
  assert.equal(adapter.files.get('Master/Folder Lab/boards/id-huerfano.json'), CONTENT, 'original intacto');
});

test('extra: fallo intermedio entre dos cuarentenas → la segunda conserva el original', async () => {
  const { adapter, manager } = makeSystem();
  adapter.files.set('Master/Folder Lab/boards/id-a.json', '{"a":1}');
  adapter.files.set('Master/Folder Lab/drafts/id-b.json', '{"b":2}');

  const r1 = await manager.quarantine(
    candidate({ path: 'Master/Folder Lab/boards/id-a.json', noteId: 'id-a', subfolder: 'boards' })
  );
  assert.equal(r1.status, 'quarantined');

  // Segunda operación con copia fallida.
  adapter.failWritePrefix = 'Master/Folder Lab/quarantine/';
  const r2 = await manager.quarantine(
    candidate({ path: 'Master/Folder Lab/drafts/id-b.json', noteId: 'id-b', subfolder: 'drafts' })
  );
  assert.equal(r2.status, 'failed');
  assert.equal(adapter.files.get('Master/Folder Lab/drafts/id-b.json'), '{"b":2}', 'original B intacto');

  // La entrada de A en el manifiesto no se perdió.
  adapter.failWritePrefix = null;
  const manifest = await manager.readManifest();
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0].noteId, 'id-a');
});

test('extra: restauración con el archivo de cuarentena ausente → failed', async () => {
  const { adapter, manager } = makeSystem();
  await seed(adapter);
  const q = await manager.quarantine(candidate());
  assert.equal(q.status, 'quarantined');

  // Alguien borró el archivo de cuarentena.
  adapter.files.delete(q.entry.quarantinePath);
  const restored = await manager.restore(q.entry.entryId);
  assert.equal(restored.status, 'failed');
  assert.ok(restored.error.includes('ya no existe'));
});

test('extra: reintentos preservan los originales ante errores repetidos', async () => {
  const { adapter, manager } = makeSystem();
  await seed(adapter);
  adapter.failWritePrefix = 'Master/Folder Lab/quarantine/';
  for (let i = 0; i < 3; i++) {
    const r = await manager.quarantine(candidate());
    assert.equal(r.status, 'failed');
    assert.equal(adapter.files.get('Master/Folder Lab/boards/id-huerfano.json'), CONTENT);
  }
  // Tras reparar el entorno, el primer intento tiene éxito.
  adapter.failWritePrefix = null;
  const ok = await manager.quarantine(candidate());
  assert.equal(ok.status, 'quarantined');
});
