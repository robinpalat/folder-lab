// src/storage/localMirror.ts
//
// Espejo de emergencia de localStorage AISLADO POR IDENTIDAD
// (Corrección A).
//
// Claves nuevas: `<family>-<vaultId>-id-<noteId>` — dos notas en la
// misma ruta (identidades distintas) jamás comparten espejo.
//
// Claves históricas por ruta (`<family>-<vaultId>-<notePath>`) se
// conservan intactas; su contenido se COPIA al espejo del id solo
// cuando la propiedad es segura (la ruta NO tiene datos pendientes
// de una identidad anterior). Si hay pendientes, el legado no se
// lee ni se migra (recuperable vía reclamación explícita).
//
// Nunca se borran claves legadas automáticamente.

export interface MirrorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocalMirrorDeps {
  storage: MirrorStorage | null;
  vaultId: string;
  /** Id estable de la nota (registry vía NoteLifecycle). */
  getNoteId: (notePath: string) => Promise<string | null>;
  /** true si la ruta NO tiene datos pendientes de otra identidad. */
  hasSafeOwnership: (notePath: string) => Promise<boolean>;
}

/** Clave del espejo por identidad (formato nuevo). */
export function mirrorKey(
  family: string,
  vaultId: string,
  noteId: string
): string {
  return `${family}-${vaultId}-id-${noteId}`;
}

/** Clave histórica por ruta (formato 8D, solo lectura/adopción). */
export function legacyMirrorKey(
  family: string,
  vaultId: string,
  notePath: string
): string {
  return `${family}-${vaultId}-${notePath}`;
}

export class LocalMirror {
  constructor(private deps: LocalMirrorDeps) {}

  /**
   * Lectura con adopción conservadora del legado:
   * 1. Espejo del id (formato nuevo).
   * 2. Legado por ruta SOLO si la propiedad es segura (sin
   *    pendientes); se COPIA al espejo del id (legado intacto).
   * 3. Con pendientes → null (sin herencia).
   */
  async read(
    family: string,
    notePath: string
  ): Promise<{ value: string | null; adopted: boolean }> {
    const storage = this.deps.storage;
    if (!storage) return { value: null, adopted: false };
    const id = await this.deps.getNoteId(notePath);
    if (!id) return { value: null, adopted: false };

    const own = storage.getItem(mirrorKey(family, this.deps.vaultId, id));
    if (own !== null) return { value: own, adopted: false };

    const legacy = storage.getItem(
      legacyMirrorKey(family, this.deps.vaultId, notePath)
    );
    if (legacy === null) return { value: null, adopted: false };

    if (!(await this.deps.hasSafeOwnership(notePath))) {
      // Propiedad ambigua (pendientes): NO se hereda.
      return { value: null, adopted: false };
    }

    storage.setItem(mirrorKey(family, this.deps.vaultId, id), legacy);
    return { value: legacy, adopted: true };
  }

  /** Escritura SOLO en el espejo del id (formato nuevo). */
  async write(
    family: string,
    notePath: string,
    value: string
  ): Promise<void> {
    const storage = this.deps.storage;
    if (!storage) return;
    const id = await this.deps.getNoteId(notePath);
    if (!id) return;
    storage.setItem(mirrorKey(family, this.deps.vaultId, id), value);
  }

  /** Borrado del espejo del id (no toca claves legadas). */
  async remove(family: string, notePath: string): Promise<void> {
    const storage = this.deps.storage;
    if (!storage) return;
    const id = await this.deps.getNoteId(notePath);
    if (!id) return;
    // localStorage no tiene delete síncrono portable: escribir ''
    // deja el espejo vacío (la lectura trata '' como ausente donde
    // el consumidor lo verifique con trim()).
    storage.setItem(mirrorKey(family, this.deps.vaultId, id), '');
  }
}
