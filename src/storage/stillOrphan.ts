// src/storage/stillOrphan.ts
//
// Revalidación EN VIVO de huérfanos (E4b-M1, integración con las
// fuentes reales de identidad y diario).
//
// Política conservadora: el candidato SOLO es huérfano si:
// - su id no está activo en ids.json (findPathById),
// - no aparece en pending ni archived (listAllPending),
// - ninguna entrada del lifecycle-journal lo referencia.
// Cualquier error de lectura PROPAGA (quarantine aborta y conserva
// el original). La clasificación histórica de E4a no basta.

import { App } from 'obsidian';
import type { NoteIdentityRegistry } from './NoteIdentityRegistry';
import { joinVaultRoot } from '../utils/rootPath';

interface RawJournalEntry {
  noteId?: string;
  snapshotDir?: string;
}

function extractNoteIdFromSnapshotDir(dir: string): string | null {
  const name = dir.slice(dir.lastIndexOf('/') + 1);
  const match = matchSnapshotSuffix(name);
  return match ? name.slice(0, name.length - match[0].length) : null;
}

function matchSnapshotSuffix(name: string): RegExpMatchArray | null {
  return name.match(/-[a-z0-9]+$/);
}

/**
 * Construye el predicado `stillOrphan` para QuarantineManager a
 * partir del registro de identidad y el diario reales.
 */
export function createStillOrphanPredicate(
  app: { vault: { adapter: {
    exists(p: string): Promise<boolean>;
    read(p: string): Promise<string>;
  } } },
  registry: NoteIdentityRegistry,
  getRootPath: () => string | null
): (noteId: string) => Promise<boolean> {
  return async (noteId: string): Promise<boolean> => {
    // 1) Identidad activa.
    const activePath = await registry.findPathById(noteId);
    if (activePath !== null) {
      return false;
    }

    // 2) Pending o archived.
    const pending = await registry.listAllPending();
    if (pending.some((c) => c.id === noteId)) {
      return false;
    }

    // 3) Referencia en el diario de ciclo de vida.
    const rootRaw = getRootPath();
    if (rootRaw === null || rootRaw === undefined) {
      // Sin Master no hay diario central: conservador → no huérfano.
      return false;
    }
    const root = rootRaw.replace(/^\/+|\/+$/g, '');
    const journalPath = joinVaultRoot(
      root,
      'Folder Lab',
      'lifecycle-journal.json'
    );
    const adapter = app.vault.adapter;
    if (await adapter.exists(journalPath)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await adapter.read(journalPath));
      } catch (error) {
        // Diario ilegible: conservador; el error propaga.
        throw new Error(
          `[stillOrphan] journal ilegible: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      if (Array.isArray(parsed)) {
        for (const raw of parsed as RawJournalEntry[]) {
          if (raw.noteId === noteId) return false;
          if (raw.snapshotDir) {
            const fromDir = extractNoteIdFromSnapshotDir(raw.snapshotDir);
            if (fromDir === noteId) return false;
          }
        }
      }
    }

    // Nada lo referencia: sigue siendo huérfano.
    return true;
  };
}
