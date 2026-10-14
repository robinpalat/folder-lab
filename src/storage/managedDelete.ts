// src/storage/managedDelete.ts
//
// Borrado administrado de notas (E3).
//
// - `makeTrashOp`: respeta la preferencia de papelera del usuario
//   (`fileManager.trashFile`, @since 1.6.6) con fallback a
//   `vault.delete` SOLO cuando la API no existe (minAppVersion
//   1.4.4). Si `trashFile` existe y falla, NO se ejecuta el fallback
//   destructivo: el error propaga y la operación queda recuperable.
//
// - `NoteDataSnapshot`: copia los datos del plugin asociados a la
//   identidad de una nota a
//   `<Master>/Folder Lab/trash/<fecha>-<noteId>/` y VERIFICA cada
//   archivo escrito (lectura + parseo) antes de dar por buena la
//   copia. Solo se copian JSON por identidad (nunca `_resources/`,
//   otras notas ni `ids.json` completo).

import { App } from 'obsidian';
import { joinVaultRoot } from '../utils/rootPath';

export interface TrashOp {
  (notePath: string): Promise<void>;
}

/**
 * Operación de papelera compatible (E3, sección 3).
 */
export function makeTrashOp(app: App): TrashOp {
  return async (notePath: string): Promise<void> => {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!file) {
      // La nota ya no existe: nada que enviar a la papelera.
      return;
    }
    const fileManager = app.fileManager as unknown as {
      trashFile?: (f: unknown) => Promise<void>;
    };
    if (typeof fileManager.trashFile === 'function') {
      try {
        await fileManager.trashFile(file);
      } catch (error) {
        // Sin fallback destructivo (E3 §3).
        throw error;
      }
      return;
    }
    // Compatibilidad 1.4.4: trashFile no existe.
    await app.vault.delete(file);
  };
}

export interface SnapshotResult {
  dir: string;
  files: string[];
}

export class NoteDataSnapshot {
  constructor(
    private app: App,
    private getRootPath: () => string | null
  ) {}

  private root(): string | null {
    // Contrato del sistema (ya normalizado): null = sin Master;
    // '' = raíz del vault.
    const r = this.getRootPath();
    if (r === null || r === undefined) return null;
    return r.replace(/^\/+|\/+$/g, "");
  }

  /**
   * Crea (o re-crea de forma idempotente) el snapshot de la nota.
   * Lanza si la escritura o la verificación fallan.
   */
  async create(notePath: string, noteId: string): Promise<SnapshotResult> {
    const root = this.root();
    if (!root) {
      throw new Error(
        '[NoteDataSnapshot] Sin Master configurado: no hay snapshot posible'
      );
    }
    const adapter = this.app.vault.adapter;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = joinVaultRoot(root, 'Folder Lab', 'trash', `${stamp}-${noteId}`);

    // Directorios.
    for (const part of [
      joinVaultRoot(root, 'Folder Lab'),
      joinVaultRoot(root, 'Folder Lab', 'trash'),
      dir
    ]) {
      if (!(await adapter.exists(part))) {
        await adapter.mkdir(part);
      }
    }

    const written: string[] = [];

    // 1) Identidad mínima (necesaria para reclamo/recuperación).
    await this.writeVerified(dir, "identity.json", {
      version: 1,
      notePath,
      noteId,
      savedAt: Date.now()
    });
    written.push("identity.json");

    // 2) Archivos de entidad por id (fuente de verdad).
    for (const [name, sub] of [
      ["board.json", "boards"],
      ["context.json", "context"],
      ["draft.json", "drafts"],
      ["polish.json", "polish"]
    ] as const) {
      const src = joinVaultRoot(root, 'Folder Lab', sub, `${noteId}.json`);
      if (await adapter.exists(src)) {
        const raw = await adapter.read(src);
        JSON.parse(raw); // valida antes de copiar
        await this.writeVerified(dir, name, raw, /*raw*/ true);
        written.push(name);
      }
    }

    // 3) Entradas legadas por ruta (solo la de esta nota).
    const parent = notePath.includes("/")
      ? notePath.slice(0, notePath.lastIndexOf("/"))
      : "";
    const legacyFiles: Array<[string, string]> = [
      ["_board.json", "legacy-board.json"],
      ["_note_context.json", "legacy-context.json"]
    ];
    for (const [legacyName, copyName] of legacyFiles) {
      const src = `${parent}/.folder-lab/${legacyName}`;
      if (!(await adapter.exists(src))) continue;
      try {
        const parsed: unknown = JSON.parse(await adapter.read(src));
        if (parsed && typeof parsed === "object") {
          const entry = (parsed as Record<string, unknown>)[notePath];
          if (entry !== undefined) {
            await this.writeVerified(dir, copyName, entry);
            written.push(copyName);
          }
        }
      } catch (error) {
        console.warn(
          "[NoteDataSnapshot] Store legado ilegible; se omite en el snapshot:",
          src,
          error
        );
      }
    }

    // 4) Verificación global: releer y parsear todo lo escrito.
    for (const name of written) {
      const raw = await adapter.read(`${dir}/${name}`);
      JSON.parse(raw);
    }

    return { dir, files: written };
  }

  private async writeVerified(
    dir: string,
    name: string,
    data: unknown,
    raw = false
  ): Promise<void> {
    const adapter = this.app.vault.adapter;
    const text = raw
      ? String(data)
      : JSON.stringify(data, null, 2);
    await adapter.write(`${dir}/${name}`, text);
  }
}
