// src/storage/PolishHistory.ts
//
// Historial de versiones de Pulir (Etapa 4).
//
// El estado VIGENTE de los overrides sigue viviendo en el BoardData
// (fuente de verdad operativa). Este historial guarda copias
// sucesivas para recuperación, con ciclo de vida propio:
//
// - Ubicación: `<Master>/Folder Lab/polish/<noteId>.json`
// - Retención: TODAS las versiones se conservan (política explícita;
//   la pérdida de versiones antiguas no se considera aceptable).
//   La eliminación es manual (borrar el archivo).
// - Idempotencia: no se apila un snapshot idéntico al anterior.

import { App } from 'obsidian';
import type { BoardFragmentOverride } from './BoardRepository';
import { EntityFileStore } from './EntityFileStore';

export interface PolishSnapshot {
  savedAt: number;
  overrides: BoardFragmentOverride[];
}

interface PolishData {
  versions: PolishSnapshot[];
}

function sameOverrides(
  a: BoardFragmentOverride[],
  b: BoardFragmentOverride[]
): boolean {
  if (a.length !== b.length) return false;
  const norm = (list: BoardFragmentOverride[]) =>
    [...list]
      .sort((x, y) => x.blockId.localeCompare(y.blockId))
      .map(
        (o) =>
          `${o.blockId}|${o.useOverride ? 1 : 0}|${o.overrideText}`
      )
      .join('\n');
  return norm(a) === norm(b);
}

export class PolishHistory {
  private readonly store: EntityFileStore<PolishData>;

  constructor(
    app: App,
    getRootPath: () => string | null
  ) {
    this.store = new EntityFileStore<PolishData>(app, {
      subfolder: 'polish',
      getRootPath,
      validate: (data, context) => {
        if (
          !data ||
          typeof data !== 'object' ||
          !Array.isArray((data as PolishData).versions)
        ) {
          throw new Error(
            `[PolishHistory] Forma inválida en ${context}`
          );
        }
      }
    });
  }

  async append(
    noteId: string,
    notePath: string,
    overrides: BoardFragmentOverride[]
  ): Promise<void> {
    const existing = await this.store.read(noteId).catch(() => null);
    const versions: PolishSnapshot[] = existing?.data.versions ?? [];
    const last = versions[versions.length - 1];
    if (last && sameOverrides(last.overrides, overrides)) {
      return;
    }
    versions.push({ savedAt: Date.now(), overrides });
    await this.store.write(noteId, notePath, { versions });
  }

  async list(noteId: string): Promise<PolishSnapshot[]> {
    const envelope = await this.store.read(noteId).catch(() => null);
    return envelope?.data.versions ?? [];
  }
}
