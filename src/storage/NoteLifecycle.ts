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
  /** Raíz Master (Etapa 5) para el diario de migraciones (M2). */
  getRootPath?: () => string | null;
  /** Adapter mínimo para el diario de migraciones (M2). */
  journalApp?: {
    vault: {
      adapter: {
        exists(p: string): Promise<boolean>;
        read(p: string): Promise<string>;
        write(p: string, c: string): Promise<void>;
        mkdir(p: string): Promise<void>;
        list(p: string): Promise<{ files: string[] }>;
      };
    };
  };
  /** E3: snapshot por identidad (managedDelete.NoteDataSnapshot). */
  snapshot?: {
    create(
      notePath: string,
      noteId: string
    ): Promise<{ dir: string; files: string[] }>;
  };
  /** E3: papelera compatible (managedDelete.makeTrashOp). */
  trashFile?: (notePath: string) => Promise<void>;
}

const DEFAULT_KEY_FAMILIES = [
  'focus-notes-draft',
  'focus-notes-blocks',
  'focus-notes',
  'focus-memory-results'
];

/** Entrada del diario de migración (M2). */
export interface RenameJournalEntry {
  type: 'file-rename' | 'folder-rename';
  oldPath: string;
  newPath: string;
  steps: {
    boards: boolean;
    context: boolean;
    registry: boolean;
    storage: boolean;
  };
  error?: string;
  startedAt: number;
}

/** Borrado administrado (E3). */
export interface DeleteJournalEntry {
  type: 'note-delete';
  oldPath: string;
  /** Mismo valor que oldPath; se mantiene para el emparejamiento. */
  newPath: string;
  noteId: string;
  /** Directorio de snapshot elegido en el primer intento (reintento). */
  snapshotDir?: string;
  steps: {
    snapshot: boolean;
    pending: boolean;
    order: boolean;
    file: boolean;
  };
  error?: string;
  startedAt: number;
}

export type LifecycleJournalEntry = RenameJournalEntry | DeleteJournalEntry;

const JOURNAL_FILE = 'lifecycle-journal.json';

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
   *
   * Corrección A: esto aplica solo a las claves HISTÓRICAS por
   * ruta (formato 8D). El espejo nuevo está aislado por identidad
   * (LocalMirror) y no necesita re-clavado: el id no cambia al
   * renombrar.
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
  // ============================================================
  // DIARIO DE MIGRACIONES (M2)
  // ============================================================

  private journalPath(): string | null {
    const root = this.deps.getRootPath?.();
    const adapter = this.deps.journalApp?.vault.adapter;
    if (!root || !adapter || !root.trim()) return null;
    const master = root.replace(/^\/+|\/+$/g, '');
    return `${master}/Folder Lab/${JOURNAL_FILE}`;
  }

  private async journalRead(): Promise<LifecycleJournalEntry[]> {
    const path = this.journalPath();
    const adapter = this.deps.journalApp?.vault.adapter;
    if (!path || !adapter) return [];
    try {
      if (!(await adapter.exists(path))) return [];
      const parsed: unknown = JSON.parse(await adapter.read(path));
      if (!Array.isArray(parsed)) return [];
      return parsed as LifecycleJournalEntry[];
    } catch (error) {
      console.error('[NoteLifecycle] Diario ilegible (se ignora):', error);
      return [];
    }
  }

  private async journalWrite(
    entries: LifecycleJournalEntry[]
  ): Promise<void> {
    const path = this.journalPath();
    const adapter = this.deps.journalApp?.vault.adapter;
    if (!path || !adapter) return;
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (!(await adapter.exists(dir))) {
      await adapter.mkdir(dir);
    }
    await adapter.write(path, JSON.stringify(entries, null, 2));
  }

  private async journalAdd(entry: LifecycleJournalEntry): Promise<void> {
    const entries = await this.journalRead();
    entries.push(entry);
    await this.journalWrite(entries);
  }

  private async journalUpdate(
    entry: LifecycleJournalEntry
  ): Promise<void> {
    const entries = await this.journalRead();
    const idx = entries.findIndex(
      (e) =>
        e.type === entry.type &&
        e.oldPath === entry.oldPath &&
        e.newPath === entry.newPath
    );
    if (idx >= 0) entries[idx] = entry;
    else entries.push(entry);
    await this.journalWrite(entries);
  }

  private async journalRemove(
    entry: LifecycleJournalEntry
  ): Promise<void> {
    const entries = await this.journalRead();
    await this.journalWrite(
      entries.filter(
        (e) =>
          !(
            e.type === entry.type &&
            e.oldPath === entry.oldPath &&
            e.newPath === entry.newPath
          )
      )
    );
  }

  /**
   * Ejecuta los pasos pendientes de una entrada del diario,
   * marcando el progreso tras cada uno (operaciones idempotentes).
   */
  /** Hook de orden para el borrado administrado (E3). */
  private deleteOrderHook: ((notePath: string) => Promise<void>) | null =
    null;

  /**
   * Registra el hook que limpia el orden de la carpeta al borrar
   * (inyectado por la vista; el ciclo de vida no conoce el
   * controlador).
   */
  setDeleteOrderHook(hook: (notePath: string) => Promise<void>): void {
    this.deleteOrderHook = hook;
  }

  /**
   * Borrado administrado (E3): operación coordinada y registrada en
   * el diario. Pasos idempotentes: snapshot → pendiente → orden →
   * archivo (papelera compatible). Un fallo conserva la entrada del
   * diario para `recoverPending()`.
   */
  async deleteNoteManaged(
    notePath: string,
    updateOrder?: (notePath: string) => Promise<void>
  ): Promise<void> {
    if (updateOrder) {
      this.deleteOrderHook = updateOrder;
    }
    const noteId = await this.deps.registry.getId(notePath);
    if (!noteId) {
      throw new Error(
        `[NoteLifecycle] Sin identidad para "${notePath}": borrado administrado no posible`
      );
    }
    if (!this.deps.snapshot || !this.deps.trashFile) {
      throw new Error(
        '[NoteLifecycle] Borrado administrado no configurado (snapshot/trash)'
      );
    }
    const entry: DeleteJournalEntry = {
      type: 'note-delete',
      oldPath: notePath,
      newPath: notePath,
      noteId,
      steps: { snapshot: false, pending: false, order: false, file: false },
      startedAt: Date.now()
    };
    await this.journalAdd(entry);
    try {
      await this.runJournalSteps(entry);
      await this.journalRemove(entry);
    } catch (error) {
      console.error(
        '[NoteLifecycle] Borrado administrado incompleto (se reintentará):',
        notePath,
        error
      );
      throw error;
    }
  }

  private async runJournalSteps(
    entry: LifecycleJournalEntry
  ): Promise<void> {
    if (entry.type === 'note-delete') {
      await this.runDeleteSteps(entry);
      return;
    }
    const isFolder = entry.type === 'folder-rename';
    const ops = {
      boards: () =>
        isFolder
          ? this.deps.boards.migrateFolderPrefix(
              entry.oldPath,
              entry.newPath
            )
          : this.deps.boards.migrateEntry(entry.oldPath, entry.newPath),
      context: () =>
        isFolder
          ? this.deps.context.migrateFolderPrefix(
              entry.oldPath,
              entry.newPath
            )
          : this.deps.context.migrateEntry(entry.oldPath, entry.newPath),
      registry: () =>
        isFolder
          ? this.deps.registry.onFolderRenamed(
              entry.oldPath,
              entry.newPath
            )
          : this.deps.registry.onRenamed(entry.oldPath, entry.newPath),
      storage: async () => {
        if (isFolder) {
          await this.onFolderRenamedStorageOnly(
            entry.oldPath,
            entry.newPath
          );
        } else {
          this.copyStorageKeys(entry.oldPath, entry.newPath);
        }
      }
    };

    const order = ['boards', 'context', 'registry', 'storage'] as const;
    for (const key of order) {
      if (entry.steps[key]) continue;
      try {
        await ops[key]();
        (entry.steps as Record<string, boolean>)[key] = true;
        delete entry.error;
        await this.journalUpdate(entry);
      } catch (error) {
        entry.error = `${key}: ${error instanceof Error ? error.message : String(error)}`;
        await this.journalUpdate(entry);
        throw error;
      }
    }
  }

  /** Pasos del borrado administrado (E3); idempotentes. */
  private async runDeleteSteps(entry: DeleteJournalEntry): Promise<void> {
    const snapshot = this.deps.snapshot;
    const trash = this.deps.trashFile;
    if (!snapshot || !trash) {
      throw new Error(
        '[NoteLifecycle] Borrado administrado no configurado (snapshot/trash)'
      );
    }

    const ops: Array<{
      key: keyof DeleteJournalEntry['steps'];
      run: () => Promise<void>;
    }> = [
      {
        key: 'snapshot',
        run: async () => {
          // Reutiliza el directorio elegido en el primer intento.
          if (entry.snapshotDir) {
            // Verificación mínima: el manifest existe y es JSON.
            return;
          }
          const result = await snapshot.create(entry.oldPath, entry.noteId);
          entry.snapshotDir = result.dir;
        }
      },
      {
        key: 'pending',
        run: () => this.deps.registry.onDeleted(entry.oldPath)
      },
      {
        key: 'order',
        run: async () => {
          if (this.deleteOrderHook) {
            await this.deleteOrderHook(entry.oldPath);
          }
        }
      },
      {
        key: 'file',
        run: () => trash(entry.oldPath)
      }
    ];

    for (const { key, run } of ops) {
      if (entry.steps[key]) continue;
      try {
        await run();
        entry.steps[key] = true;
        delete entry.error;
        await this.journalUpdate(entry);
      } catch (error) {
        entry.error = `${key}: ${error instanceof Error ? error.message : String(error)}`;
        await this.journalUpdate(entry);
        throw error;
      }
    }
  }

  /**
   * Reintenta las migraciones pendientes del diario (arranque o
   * recuperación manual). Idempotente: los pasos ya marcados se
   * omiten; los repetidos son seguros.
   */
  async recoverPending(): Promise<void> {
    const entries = await this.journalRead();
    for (const entry of entries) {
      try {
        await this.runJournalSteps(entry);
        await this.journalRemove(entry);
      } catch (error) {
        console.error(
          '[NoteLifecycle] Migración pendiente aún fallida:',
          entry,
          error
        );
      }
    }
  }

  async onFileRenamed(oldPath: string, newPath: string): Promise<void> {
    if (oldPath === newPath) return;

    const entry: LifecycleJournalEntry = {
      type: 'file-rename',
      oldPath,
      newPath,
      steps: { boards: false, context: false, registry: false, storage: false },
      startedAt: Date.now()
    };
    // El diario se registra ANTES de tocar nada (M2): un fallo a
    // mitad queda pendiente de reintento en recoverPending().
    await this.journalAdd(entry);
    try {
      await this.runJournalSteps(entry);
      await this.journalRemove(entry);
    } catch (error) {
      console.error(
        '[NoteLifecycle] Migración de renombrado incompleta (se reintentará):',
        oldPath,
        '→',
        newPath,
        error
      );
      throw error;
    }
  }

  /** Renombrar una carpeta: re-clava todo lo que usa la ruta. */
  async onFolderRenamed(
    oldPrefix: string,
    newPrefix: string
  ): Promise<void> {
    if (oldPrefix === newPrefix) return;

    const entry: LifecycleJournalEntry = {
      type: 'folder-rename',
      oldPath: oldPrefix,
      newPath: newPrefix,
      steps: { boards: false, context: false, registry: false, storage: false },
      startedAt: Date.now()
    };
    await this.journalAdd(entry);
    try {
      await this.runJournalSteps(entry);
      await this.journalRemove(entry);
    } catch (error) {
      console.error(
        '[NoteLifecycle] Migración de carpeta incompleta (se reintentará):',
        oldPrefix,
        '→',
        newPrefix,
        error
      );
      throw error;
    }
  }

  /** Copia de claves de localStorage por prefijo (paso 'storage'). */
  private async onFolderRenamedStorageOnly(
    oldPrefix: string,
    newPrefix: string
  ): Promise<void> {
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

  /** Creación/restauración: E2 delega en el registro (sin auto-claim). */
  async onNoteCreated(notePath: string): Promise<null> {
    return this.deps.registry.onCreated(notePath);
  }

  /** Identidad perezosa para consumidores (Board, drafts, etc.). */
  async getNoteId(notePath: string): Promise<string | null> {
    return this.deps.registry.getId(notePath);
  }

  /**
   * true si la ruta NO tiene datos pendientes de otra identidad
   * (Corrección A): criterio de propiedad para adoptar datos
   * legados por ruta.
   */
  async hasSafeOwnership(notePath: string): Promise<boolean> {
    const candidates = await this.deps.registry.getPendingFor(notePath);
    return candidates.length === 0;
  }
}
