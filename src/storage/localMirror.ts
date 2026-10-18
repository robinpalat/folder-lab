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

// ============================================================
// VALIDACIÓN DE ESPEJOS POR FAMILIA (Corrección del bloqueo)
// ============================================================
// Un espejo inválido (JSON corrupto o estructura incompatible) se
// DESCARTA y se comporta como ausente: nunca debe bloquear la
// interfaz ni impedir la carga normal de la nota.
//
// Verificación de dependencia estructural (obligatoria antes de
// aplicar una regla común): NINGUNA familia referencia
// identificadores de widgets ni layout de la entidad de contexto:
// - focus-memory-results: [{id (id de RESULTADO memory-<ts>-<rand>),
//   content, active}] — contenido de análisis de la NOTA.
// - focus-notes-blocks:  [{text, active}] (o legado string[]) —
//   fronteras de captura de la NOTA.
// - focus-notes / focus-notes-draft: texto plano.
// Por tanto NO se invalidan por cambios en el conjunto de widgets:
// siguen siendo válidos cuando cambia la estructura del contexto.

type MirrorValidator = (raw: string) => boolean;

function isMemoryResultsValue(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    return parsed.every((value) => {
      if (!value || typeof value !== 'object') return false;
      const candidate = value as {
        id?: unknown;
        content?: unknown;
        active?: unknown;
      };
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.content === 'string' &&
        typeof candidate.active === 'boolean'
      );
    });
  } catch {
    return false;
  }
}

function isBlocksValue(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    if (parsed.length === 0) return true;
    const asObjects = parsed.every(
      (value) =>
        !!value &&
        typeof value === 'object' &&
        typeof (value as { text?: unknown }).text === 'string' &&
        typeof (value as { active?: unknown }).active === 'boolean'
    );
    if (asObjects) return true;
    // Formato legado string[].
    return parsed.every((value) => typeof value === 'string');
  } catch {
    return false;
  }
}

/**
 * Validadores por familia. Familias SIN entrada (texto plano como
 * focus-notes/focus-notes-draft) se consideran siempre válidas:
 * no se invalida nada sin evidencia de incompatibilidad.
 */
const MIRROR_VALIDATORS: Record<string, MirrorValidator> = {
  'focus-memory-results': isMemoryResultsValue,
  'focus-notes-blocks': isBlocksValue
};

function isValidMirrorValue(family: string, raw: string): boolean {
  const validator = MIRROR_VALIDATORS[family];
  if (!validator) return true;
  return validator(raw);
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
   *
   * Validación por familia: un valor inválido (JSON corrupto o
   * estructura incompatible) se DESCARTA (clave limpiada) y se
   * comporta como ausente — nunca propaga errores ni bloquea.
   */
  async read(
    family: string,
    notePath: string
  ): Promise<{ value: string | null; adopted: boolean }> {
    const storage = this.deps.storage;
    if (!storage) return { value: null, adopted: false };
    const id = await this.deps.getNoteId(notePath);
    if (!id) return { value: null, adopted: false };

    const ownKey = mirrorKey(family, this.deps.vaultId, id);
    const own = storage.getItem(ownKey);
    if (own !== null) {
      if (!isValidMirrorValue(family, own)) {
        // Inválido o no verificable: descartar (clave limpiada)
        // y servir el comportamiento normal sin espejo.
        storage.setItem(ownKey, '');
        return { value: null, adopted: false };
      }
      return { value: own, adopted: false };
    }

    const legacy = storage.getItem(
      legacyMirrorKey(family, this.deps.vaultId, notePath)
    );
    if (legacy === null) return { value: null, adopted: false };

    if (!(await this.deps.hasSafeOwnership(notePath))) {
      // Propiedad ambigua (pendientes): NO se hereda.
      return { value: null, adopted: false };
    }

    if (!isValidMirrorValue(family, legacy)) {
      // Legado inválido: no se adopta ni se copia.
      return { value: null, adopted: false };
    }

    storage.setItem(ownKey, legacy);
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
