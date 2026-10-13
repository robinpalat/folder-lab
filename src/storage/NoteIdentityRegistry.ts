// src/storage/NoteIdentityRegistry.ts
//
// Identidad estable de notas (Etapa 1 de la reforma de almacenamiento).
//
// Decisión (documentada en el diseño de almacenamiento): registro
// lateral en `<master>/.folder-lab/ids.json` — NO se modifica el
// frontmatter de las notas del usuario.
//
// - `ids`:        ruta de nota → id estable (se conserva al renombrar).
// - `tombstones`: ruta borrada → { id, deletedAt } (permite recuperar
//                 la identidad al restaurar la nota en la misma ruta).
//
// Sin Master configurado el registro no persiste y `getId` devuelve
// `null`: los consumidores deben caer a la ruta como identidad
// (comportamiento previo a la reforma).

import { App } from 'obsidian';
import { HiddenFolderManager } from './HiddenFolderManager';

export const IDS_FILE = 'ids.json';

export interface IdentityTombstone {
  id: string;
  deletedAt: number;
}

export interface IdentityStore {
  version: 1;
  ids: Record<string, string>;
  tombstones: Record<string, IdentityTombstone>;
}

export interface ReconcileReport {
  /** Rutas con id cuya nota no existe y no está en tombstone. */
  orphans: string[];
  /** Tombstones restaurados (la nota volvió a existir). */
  restored: string[];
  /** Ids duplicados detectados (invariante rota; solo reporte). */
  duplicateIds: string[];
}

function emptyStore(): IdentityStore {
  return { version: 1, ids: {}, tombstones: {} };
}

function generateId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

export class NoteIdentityRegistry {
  private hidden: HiddenFolderManager;
  private cache: IdentityStore | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private app: App,
    private getMasterPath: () => string | null,
    hidden?: HiddenFolderManager
  ) {
    this.hidden = hidden ?? new HiddenFolderManager(app);
  }

  private get masterPath(): string | null {
    const path = this.getMasterPath();
    return path && path.trim() ? path : null;
  }

  /** Serializa operaciones de lectura-modificación-escritura. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.tail.then(op, op);
    this.tail = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  private async load(): Promise<IdentityStore | null> {
    const master = this.masterPath;
    if (!master) return null;
    if (this.cache) return this.cache;
    let data: IdentityStore | null = null;
    try {
      data = await this.hidden.readJSON<IdentityStore>(master, IDS_FILE);
    } catch {
      // JSON inválido: no pisar; comportarse como vacío pero sin
      // persistir por encima hasta que el usuario resuelva.
      console.error(
        '[NoteIdentityRegistry] ids.json ilegible; operación omitida'
      );
      return null;
    }
    if (data === null) {
      this.cache = emptyStore();
      return this.cache;
    }
    if (
      typeof data !== 'object' ||
      typeof data.ids !== 'object' ||
      data.ids === null
    ) {
      // Forma inválida: no cachear y NO persistir por encima.
      console.error(
        '[NoteIdentityRegistry] ids.json con forma inválida; operación omitida'
      );
      return null;
    }
    this.cache = {
      version: 1,
      ids: data.ids,
      tombstones:
        data.tombstones && typeof data.tombstones === 'object'
          ? data.tombstones
          : {}
    };
    return this.cache;
  }

  private async persist(): Promise<void> {
    const master = this.masterPath;
    if (!master || !this.cache) return;
    await this.hidden.writeJSON(master, IDS_FILE, this.cache);
  }

  /** Id estable de la nota; la crea y persiste si no existe. */
  async getId(notePath: string): Promise<string | null> {
    return this.enqueue(async () => {
      const store = await this.load();
      if (!store) return null;
      const existing = store.ids[notePath];
      if (existing) return existing;
      const id = generateId();
      store.ids[notePath] = id;
      await this.persist();
      return id;
    });
  }

  async findIdByPath(notePath: string): Promise<string | null> {
    return this.enqueue(async () => {
      const store = await this.load();
      return store?.ids[notePath] ?? null;
    });
  }

  async findPathById(id: string): Promise<string | null> {
    return this.enqueue(async () => {
      const store = await this.load();
      if (!store) return null;
      for (const [path, mapped] of Object.entries(store.ids)) {
        if (mapped === id) return path;
      }
      return null;
    });
  }

  /** Renombrar/mover: conserva el id, re-clava la ruta. */
  async onRenamed(oldPath: string, newPath: string): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.load();
      if (!store) return;
      const id = store.ids[oldPath];
      if (id === undefined) return;
      delete store.ids[oldPath];
      store.ids[newPath] = id;
      if (store.tombstones[oldPath]) {
        const tomb = store.tombstones[oldPath];
        delete store.tombstones[oldPath];
        store.tombstones[newPath] = { ...tomb, deletedAt: Date.now() };
      }
      await this.persist();
    });
  }

  /** Renombrar una CARPETA: re-clava todos los ids bajo el prefijo. */
  async onFolderRenamed(
    oldPrefix: string,
    newPrefix: string
  ): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.load();
      if (!store) return;
      const oldBase = oldPrefix.replace(/\/+$/, '');
      const newBase = newPrefix.replace(/\/+$/, '');
      let changed = false;
      for (const key of Object.keys(store.ids)) {
        if (key === oldBase || key.startsWith(oldBase + '/')) {
          const next =
            key === oldBase
              ? newBase
              : newBase + '/' + key.slice(oldBase.length + 1);
          store.ids[next] = store.ids[key];
          delete store.ids[key];
          changed = true;
        }
      }
      for (const key of Object.keys(store.tombstones)) {
        if (key === oldBase || key.startsWith(oldBase + '/')) {
          const next =
            key === oldBase
              ? newBase
              : newBase + '/' + key.slice(oldBase.length + 1);
          store.tombstones[next] = store.tombstones[key];
          delete store.tombstones[key];
          changed = true;
        }
      }
      if (changed) await this.persist();
    });
  }

  /** Borrado: conserva el id como tombstone (recuperable). */
  async onDeleted(notePath: string): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.load();
      if (!store) return;
      const id = store.ids[notePath];
      if (id === undefined) return;
      delete store.ids[notePath];
      store.tombstones[notePath] = { id, deletedAt: Date.now() };
      await this.persist();
    });
  }

  /**
   * Creación/restauración: si hay tombstone para la ruta, restaura
   * el id original. Notas nuevas (sin tombstone) no reciben id aquí
   * (se asigna de forma perezosa en getId).
   */
  async onCreated(notePath: string): Promise<string | null> {
    return this.enqueue(async () => {
      const store = await this.load();
      if (!store) return null;
      const tomb = store.tombstones[notePath];
      if (!tomb) return null;
      delete store.tombstones[notePath];
      if (store.ids[notePath] === undefined) {
        store.ids[notePath] = tomb.id;
      }
      await this.persist();
      return store.ids[notePath] ?? tomb.id;
    });
  }

  /**
   * Detección de inconsistencias (no destructiva):
   * - restaura tombstones cuya nota volvió a existir sin evento;
   * - reporta ids huérfanos e ids duplicados.
   */
  async reconcile(existingPaths: string[]): Promise<ReconcileReport> {
    return this.enqueue(async () => {
      const report: ReconcileReport = {
        orphans: [],
        restored: [],
        duplicateIds: []
      };
      const store = await this.load();
      if (!store) return report;
      const existing = new Set(existingPaths);

      for (const [path, tomb] of Object.entries(store.tombstones)) {
        if (existing.has(path) && store.ids[path] === undefined) {
          store.ids[path] = tomb.id;
          delete store.tombstones[path];
          report.restored.push(path);
        }
      }

      const seen = new Map<string, string>();
      for (const [path, id] of Object.entries(store.ids)) {
        if (!existing.has(path)) {
          report.orphans.push(path);
        }
        const prev = seen.get(id);
        if (prev !== undefined) {
          report.duplicateIds.push(id);
        } else {
          seen.set(id, path);
        }
      }

      if (report.restored.length > 0) await this.persist();
      return report;
    });
  }
}
