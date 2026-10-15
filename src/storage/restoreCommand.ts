// src/storage/restoreCommand.ts
//
// Núcleo UI-free del comando manual de restauración (E4c-3).
//
// Paralelo a quarantineCommand.ts: el plugin solo traduce estos
// resultados a modal/Notice. SIN ejecución en el arranque ni efectos
// secundarios de otras operaciones.
//
// Flujo:
// 1. Sin Master → no-master.
// 2. Leer manifest.json de cuarentena (ilegible/inválido → error
//    conservador, sin operaciones destructivas).
// 3. Clasificar entradas: forma válida + restauradas + pendientes.
//    Entradas con forma inválida NO se ofrecen (ni se tocan).
// 4. Sin pendientes → no-entries.
// 5. El llamante CONFIRMA cada entrada (la UI llama a `restoreEntry`).
// 6. Cada restauración delega en el manager COMPARTIDO (cola M3),
//    que valida rutas, hash y destino antes de escribir.
//
// ALCANCE de la restauración: devuelve el JSON de entidad a su ruta
// original. NO reactiva identidades (no toca ids.json ni el journal)
// y NO elimina la copia en cuarentena (sin purga en este alcance).

import { App } from 'obsidian';
import {
  QuarantineManager,
  type QuarantineManifestEntry,
  type RestoreResult
} from './quarantine';

export interface RestoreCommandDeps {
  app: App;
  getRootPath: () => string | null;
  /** Instancia COMPARTIDA de QuarantineManager (E4c-1). */
  manager: QuarantineManager;
}

export type RestoreCommandOutcome =
  | { status: 'no-master' }
  | { status: 'no-entries' }
  | {
      status: 'needs-confirmation';
      /** Entradas con forma válida y sin restaurar. */
      pending: QuarantineManifestEntry[];
      /** Entradas ya restauradas (solo informativo). */
      restoredCount: number;
      /** Entradas descartadas por forma inválida (no se ofrecen). */
      invalidCount: number;
    }
  | { status: 'error'; error: string };

/**
 * Paso 1 del comando: lectura y clasificación del manifiesto.
 * Solo lectura; no modifica nada.
 */
export async function prepareRestoreCommand(
  deps: RestoreCommandDeps
): Promise<RestoreCommandOutcome> {
  const root = deps.getRootPath();
  if (root === null || root === undefined) {
    return { status: 'no-master' };
  }
  const normalizedRoot = root.replace(/^\/+|\/+$/g, '');

  let entries: QuarantineManifestEntry[];
  try {
    const manifest = await deps.manager.readManifest();
    entries = manifest.entries;
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    };
  }

  const pending: QuarantineManifestEntry[] = [];
  let restoredCount = 0;
  let invalidCount = 0;
  for (const entry of entries) {
    if (QuarantineManager.validateEntryShape(normalizedRoot, entry) !== null) {
      invalidCount += 1;
      continue;
    }
    if (entry.restoredAt !== undefined) {
      restoredCount += 1;
      continue;
    }
    pending.push(entry);
  }

  if (pending.length === 0) {
    return { status: 'no-entries' };
  }
  return {
    status: 'needs-confirmation',
    pending,
    restoredCount,
    invalidCount
  };
}

/**
 * Paso 2 del comando: restauración de UNA entrada ya confirmada por
 * el usuario. Delega en el manager compartido (validaciones E4c-2).
 */
export async function restoreEntry(
  deps: RestoreCommandDeps,
  entryId: string
): Promise<RestoreResult> {
  return deps.manager.restore(entryId);
}
