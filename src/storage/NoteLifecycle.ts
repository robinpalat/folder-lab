// src/storage/NoteLifecycle.ts
//
// Ciclo de vida de los datos persistentes por nota (Etapa 1).
//
// Reglas (diseño de almacenamiento, apartado 7):
// - Renombrar/mover una nota: migrar las entradas de Board y
//   Contexto (escritura de destino ANTES de retirar el origen) y
//   copiar las claves de localStorage a la nueva ruta SIN borrar el
//   original (recuperable).
// - Renombrar una carpeta: re-clavar entradas bajo el prefijo en
//   ambos stores y en el registro de identidad; copiar claves de
//   localStorage correspondientes.
// - Borrar: solo tombstone en el registro de identidad (nunca se
//   eliminan originales del usuario ni datos recuperables).
// - Restaurar/crear: recuperar el id desde el tombstone si existe.
//
// Sin obsidian en las importaciones: todas las dependencias se
// inyectan para permitir pruebas unitarias en Node.

import type { NoteIdentityRegistry } from './NoteIdentityRegistry';

/** Subconjunto de BoardRepository usado por el ciclo de vida. */
export interface BoardEntryMigrator {
  migrateEntry(oldPath: string, newPath: string): Promise<void>;
  migrateFolderPrefix(oldPrefix: string, newPrefix: string): Promise<void>;
}

/** Subconjunto de NoteRepository usado por el ciclo de vida. */
export interface ContextEntryMigrator {
  migrateEntry(oldPath: string, newPath: string): Promise<void>;
  migrateFolderPrefix(oldPrefix: string, newPrefix: string): Promise<void>;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NoteLifecycleDeps {
  registry: NoteIdentityRegistry;
  boards: BoardEntryMigrator;
  context: ContextEntryMigrator;
  /** Id de bóveda (Fase 8D) para las claves de localStorage. */
  vaultId: string;
  storage: KeyValueStorage | null;
  /** Familias de claves de la Fase 8D/legadas que usan la ruta. */
  keyFamilies?: string[];
}

const DEFAULT_KEY_FAMILIES = [
  'focus-notes-draft',
  'focus-notes-blocks',
  'focus-notes',
  'focus-memory-results'
];

export class NoteLifecycle {
  private readonly keyFamilies: string[];

  constructor(private deps: NoteLifecycleDeps) {
    this.keyFamilies = deps.keyFamilies ?? DEFAULT_KEY_FAMILIES;
  }

  private lsKey(family: string, notePath: string): string {
    return `${family}-${this.deps.vaultId}-${notePath}`;
  }

  private legacyLsKey(family: string, notePath: string): string {
    // Formato pre-8D (sin vaultId) — solo para NO pisarlo por error.
    return `${family}-${notePath}`;
  }

  /**
   * Copia las claves de localStorage de oldPath a newPath.
   * Conservadora: solo escribe la clave destino si está vacía y
   * NUNCA borra la clave origen (los datos siguen recuperables).
   */
  private copyStorageKeys(oldPath: string, newPath: string): void {
    const storage = this.deps.storage;
    if (!storage) return;
    for (const family of this.keyFamilies) {
      const oldKey = this.lsKey(family, oldPath);
      const newKey = this.lsKey(family, newPath);
      let value: string | null = null;
      try {
        value = storage.getItem(oldKey);
      } catch {
        continue;
      }
      if (value === null) continue;
      try {
        const existing = storage.getItem(newKey);
        if (existing !== null && existing !== '') continue;
        storage.setItem(newKey, value);
      } catch (error) {
        console.error(
          '[NoteLifecycle] Error copiando borrador a la nueva ruta:',
          error
        );
      }
    }
    // Registro defensivo: si existe una clave legada pre-8D para la
    // ruta destino, no se toca (decisión 8D: datos ambiguos intactos).
    void this.legacyLsKey;
  }

  /**
   * Renombrar/mover una nota. El orden importa: stores primero
   * (escritura de destino antes de retirar origen), luego identidad,
   * luego localStorage.
   */
  async onFileRenamed(oldPath: string, newPath: string): Promise<void> {
    if (oldPath === newPath) return;

    await this.deps.boards.migrateEntry(oldPath, newPath);
    await this.deps.context.migrateEntry(oldPath, newPath);
    await this.deps.registry.onRenamed(oldPath, newPath);
    this.copyStorageKeys(oldPath, newPath);
  }

  /** Renombrar una carpeta: re-clava todo lo que usa la ruta. */
  async onFolderRenamed(
    oldPrefix: string,
    newPrefix: string
  ): Promise<void> {
    if (oldPrefix === newPrefix) return;

    await this.deps.boards.migrateFolderPrefix(oldPrefix, newPrefix);
    await this.deps.context.migrateFolderPrefix(oldPrefix, newPrefix);
    await this.deps.registry.onFolderRenamed(oldPrefix, newPrefix);

    const storage = this.deps.storage;
    if (!storage) return;
    const oldBase = oldPrefix.replace(/\/+$/, '');
    const newBase = newPrefix.replace(/\/+$/, '');
    for (const family of this.keyFamilies) {
      let keys: string[] = [];
      try {
        const raw = (storage as unknown as { key?: (i: number) => string | null })
          .key;
        if (typeof raw === 'function') {
          const store = storage as unknown as { length: number; key(i: number): string | null };
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            if (k) keys.push(k);
          }
        }
      } catch {
        keys = [];
      }
      const prefix = `${family}-${this.deps.vaultId}-`;
      for (const key of keys) {
        if (!key.startsWith(prefix)) continue;
        const notePath = key.slice(prefix.length);
        if (notePath !== oldBase && !notePath.startsWith(oldBase + '/')) {
          continue;
        }
        const moved =
          notePath === oldBase
            ? newBase
            : newBase + '/' + notePath.slice(oldBase.length + 1);
        const targetKey = `${family}-${this.deps.vaultId}-${moved}`;
        try {
          if (storage.getItem(targetKey) !== null) continue;
          const value = storage.getItem(key);
          if (value !== null) storage.setItem(targetKey, value);
        } catch (error) {
          console.error(
            '[NoteLifecycle] Error migrando claves por carpeta:',
            error
          );
        }
      }
    }
  }

  /** Borrado de nota: solo tombstone (datos intactos y recuperables). */
  async onNoteDeleted(notePath: string): Promise<void> {
    await this.deps.registry.onDeleted(notePath);
  }

  /** Creación/restauración: recupera el id si había tombstone. */
  async onNoteCreated(notePath: string): Promise<string | null> {
    return this.deps.registry.onCreated(notePath);
  }

  /** Identidad perezosa para consumidores (Board, drafts, etc.). */
  async getNoteId(notePath: string): Promise<string | null> {
    return this.deps.registry.getId(notePath);
  }
}
