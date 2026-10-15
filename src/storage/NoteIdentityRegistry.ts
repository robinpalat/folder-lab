// src/storage/NoteIdentityRegistry.ts
//
// Identidad estable de notas (Etapa 1 + E2 «identidad pendiente»).
//
// Registro lateral en `<master>/Folder Lab/ids.json` (Etapa 5) — NO
// se modifica el frontmatter de las notas del usuario.
//
// Buckets (E2 — sustituye la ventana temporal de 15 min):
// - `ids`:      ruta activa → id estable (se conserva al renombrar).
// - `pending`:  ruta borrada → { id, deletedAt, detectedAt }; los
//               datos por id permanecen intactos y la ruta queda
//               DESVINCULADA: una nota nueva en esa ruta recibe un
//               id nuevo y NO hereda el contexto. La recuperación es
//               EXPLÍCITA vía `claim()` (comando del plugin).
// - `archived`: entradas históricas (A3) — también reclamables con
//               `claim(..., 'archived')`; nunca se purgan aquí.
// - `tombstones`: legado v1 — en cada carga se MIGRA a `pending`
//               (conservando id y fechas); no se borran datos.
//
// Sin Master configurado el registro no persiste y `getId` devuelve
// `null`: los consumidores caen a la ruta como identidad.

import { App } from 'obsidian';
import { HiddenFolderManager } from './HiddenFolderManager';

export const IDS_FILE = 'ids.json';

export interface IdentityTombstone {
  id: string;
  deletedAt: number;
}

/** Entrada pendiente de reclamación (E2). */
export interface PendingEntry extends IdentityTombstone {
  /** Momento en que se detectó/creó la pendencia (retención futura). */
  detectedAt: number;
}

export interface PendingClaim {
  path: string;
  id: string;
  deletedAt: number;
  detectedAt: number;
  bucket: 'pending' | 'archived';
}

export interface IdentityStore {
  version: 1;
  ids: Record<string, string>;
  /** Legado v1; se migra a `pending` en la carga. */
  tombstones: Record<string, IdentityTombstone>;
  pending: Record<string, PendingEntry>;
  archived: Record<string, IdentityTombstone>;
}

export interface ReconcileReport {
  /** Rutas con id activo cuya nota no existe. */
  orphans: string[];
  /** Rutas con datos pendientes cuya nota YA existe (reclamar). */
  pendingExisting: string[];
  /** Ids duplicados detectados (invariante rota; solo reporte). */
  duplicateIds: string[];
}

export type ClaimResult =
  | { status: 'claimed'; id: string }
  | { status: 'none' }
  | { status: 'ambiguous'; candidates: PendingClaim[] }
  | {
      status: 'conflict';
      existingId: string;
      candidates: PendingClaim[];
    };

function emptyStore(): IdentityStore {
  return {
    version: 1,
    ids: {},
    tombstones: {},
    pending: {},
    archived: {}
  };
}

/** Hidrata desde datos crudos (v1 o v2) sin perder ningún bucket. */
function hydrate(data: {
  ids: Record<string, string>;
  tombstones?: Record<string, IdentityTombstone>;
  pending?: Record<string, PendingEntry>;
  archived?: Record<string, IdentityTombstone>;
}): IdentityStore {
  return {
    version: 1,
    ids: data.ids,
    tombstones:
      data.tombstones && typeof data.tombstones === 'object'
        ? data.tombstones
        : {},
    pending:
      data.pending && typeof data.pending === 'object' ? data.pending : {},
    archived:
      data.archived && typeof data.archived === 'object'
        ? data.archived
        : {}
  };
}

/**
 * Migra `tombstones` (v1) a `pending` conservando id y fechas.
 * Devuelve true si hubo cambios (persistir).
 */
function migrateTombstonesToPending(store: IdentityStore): boolean {
  let changed = false;
  for (const [path, tomb] of Object.entries(store.tombstones)) {
    if (!store.pending[path]) {
      store.pending[path] = {
        id: tomb.id,
        deletedAt: tomb.deletedAt,
        detectedAt: tomb.deletedAt
      };
      changed = true;
    }
    delete store.tombstones[path];
    changed = true;
  }
  return changed;
}

/**
 * Genera ids con entropía suficiente (crypto cuando existe; doble
 * Math.random como respaldo). M3: no se confía en Date.now solo.
 */
function defaultGenerateId(): string {
  const g = globalThis as {
    crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array };
  };
  const c = g.crypto;
  if (c?.getRandomValues) {
    const vals = c.getRandomValues(new Uint32Array(2));
    return (
      Date.now().toString(36) +
      vals[0].toString(36) +
      vals[1].toString(36)
    );
  }
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}${rand()}${rand()}`;
}

export class NoteIdentityRegistry {
  private hidden: HiddenFolderManager;
  private hiddenLegacy: HiddenFolderManager;
  private cache: IdentityStore | null = null;
  private lastMaster: string | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private app: App,
    private getMasterPath: () => string | null,
    hidden?: HiddenFolderManager,
    hiddenLegacy?: HiddenFolderManager,
    private readonly idGenerator: () => string = defaultGenerateId
  ) {
    // Raíz visible (Etapa 5): <master>/Folder Lab/ids.json
    this.hidden = hidden ?? new HiddenFolderManager(app, 'Folder Lab');
    // Ubicación legada (Etapa 1): <master>/.folder-lab/ids.json
    this.hiddenLegacy = hiddenLegacy ?? new HiddenFolderManager(app);
  }

  private get masterPath(): string | null {
    // Contrato del sistema (ya normalizado): null = sin Master;
    // '' = raíz del vault; 'X' = subcarpeta.
    const p = this.getMasterPath();
    if (p === null || p === undefined) return null;
    return p.replace(/^\/+|\/+$/g, "");
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
    if (master === null) return null;
    // B1: si el Master cambia en caliente, invalidar la caché.
    if (this.cache && this.lastMaster === master) return this.cache;
    this.lastMaster = master;

    // 1) Ubicación actual (Folder Lab/ids.json).
    let data: IdentityStore | null = null;
    try {
      data = await this.hidden.readJSON<IdentityStore>(master, IDS_FILE);
    } catch {
      console.error(
        '[NoteIdentityRegistry] ids.json ilegible; operación omitida'
      );
      return null;
    }

    // 2) Respaldo legado (.folder-lab/ids.json): si existe y el
    //    actual no, se usa y se copia al nuevo (sin borrar origen).
    if (data === null) {
      try {
        const legacy = await this.hiddenLegacy.readJSON<IdentityStore>(
          master,
          IDS_FILE
        );
        if (
          legacy &&
          typeof legacy === 'object' &&
          typeof legacy.ids === 'object' &&
          legacy.ids !== null
        ) {
          data = legacy;
          this.cache = hydrate(legacy);
          if (migrateTombstonesToPending(this.cache)) {
            await this.persist();
          }
          return this.cache;
        }
      } catch {
        // Respaldo ilegible: continuar como sin datos.
      }
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
    this.cache = hydrate(data);
    // E2: migración conservadora de tombstones v1 → pending.
    if (migrateTombstonesToPending(this.cache)) {
      await this.persist();
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    const master = this.masterPath;
    if (master === null || !this.cache) return;
    await this.hidden.writeJSON(master, IDS_FILE, this.cache);
  }

  /**
   * Invalida la caché en memoria (próxima lectura relee disco).
   * Uso: antes de una sesión de cuarentena (E4b) o tras cambios
   * EXTERNOS de ids.json (sincronización entre dispositivos).
   * Las operaciones internas del registro siempre actualizan la
   * caché; esta invalidación cubre solo escrituras ajenas.
   */
  refresh(): void {
    this.cache = null;
    this.lastMaster = null;
  }

  /** Id estable de la nota; la crea y persiste si no existe. */
  async getId(notePath: string): Promise<string | null> {
    return this.enqueue(async () => {
      const store = await this.load();
      if (!store) return null;
      const existing = store.ids[notePath];
      if (existing) return existing;

      // M3: unicidad verificada contra el registro existente antes
      // de asignar (dos notas jamás comparten archivo de entidad).
      const taken = new Set(Object.values(store.ids));
      let id = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = this.idGenerator();
        if (!taken.has(candidate)) {
          id = candidate;
          break;
        }
      }
      if (!id) {
        throw new Error(
          `[NoteIdentityRegistry] No se pudo generar un id único para "${notePath}"`
        );
      }
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
      const hasPending = !!store.pending[oldPath];
      const hasArchived = !!store.archived[oldPath];
      if (id === undefined && !hasPending && !hasArchived) return;
      if (id !== undefined) {
        delete store.ids[oldPath];
        store.ids[newPath] = id;
      }
      if (store.pending[oldPath]) {
        store.pending[newPath] = store.pending[oldPath];
        delete store.pending[oldPath];
      }
      if (store.archived[oldPath]) {
        store.archived[newPath] = store.archived[oldPath];
        delete store.archived[oldPath];
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
      const rekey = <T>(record: Record<string, T>): boolean => {
        let changedLocal = false;
        for (const key of Object.keys(record)) {
          if (key === oldBase || key.startsWith(oldBase + '/')) {
            const next =
              key === oldBase
                ? newBase
                : newBase + '/' + key.slice(oldBase.length + 1);
            record[next] = record[key];
            delete record[key];
            changedLocal = true;
          }
        }
        return changedLocal;
      };
      let changed = false;
      changed = rekey(store.ids) || changed;
      changed = rekey(store.pending) || changed;
      changed = rekey(store.archived) || changed;
      changed = rekey(store.tombstones) || changed;
      if (changed) await this.persist();
    });
  }

  /**
   * Borrado (E2 + Corrección A): el id pasa a `pending`; la ruta
   * queda desvinculada (una nota nueva NO lo heredará) y los datos
   * por id se conservan. Si la ruta ya tiene un pendiente AJENO,
   * ese pendiente pasa a `archived` (sigue reclamable) y el nuevo
   * ocupa `pending`; si ambos buckets están ocupados, se conserva
   * el pendiente previo y el id queda como huérfano reportable
   * (datos intactos — nunca se borra nada).
   */
  async onDeleted(notePath: string): Promise<void> {
    return this.enqueue(async () => {
      const store = await this.load();
      if (!store) return;
      const id = store.ids[notePath];
      if (id === undefined) return;
      delete store.ids[notePath];
      const now = Date.now();
      const existing = store.pending[notePath];
      if (existing && existing.id !== id) {
        if (!store.archived[notePath]) {
          store.archived[notePath] = {
            id: existing.id,
            deletedAt: existing.deletedAt
          };
          store.pending[notePath] = {
            id,
            deletedAt: now,
            detectedAt: now
          };
        } else {
          console.warn(
            '[NoteIdentityRegistry] Ruta con pendiente y archivado ' +
              'ocupados; el id borrado queda como huérfano:',
            notePath
          );
        }
      } else {
        store.pending[notePath] = {
          id,
          deletedAt: now,
          detectedAt: now
        };
      }
      await this.persist();
    });
  }

  /**
   * Creación (E2): NO se decide por coincidencia de ruta ni por
   * ventana temporal. La nota nueva recibe un id nuevo (perezoso);
   * los datos pendientes/archivados se conservan hasta un `claim()`
   * explícito del usuario.
   */
  async onCreated(_notePath: string): Promise<null> {
    // La carga migra tombstones v1 → pending si los hubiera.
    await this.load();
    return null;
  }

  /** Candidatas pendientes/archivadas para una ruta concreta. */
  async getPendingFor(notePath: string): Promise<PendingClaim[]> {
    return this.enqueue(async () => {
      const store = await this.load();
      if (!store) return [];
      const out: PendingClaim[] = [];
      const p = store.pending[notePath];
      if (p) {
        out.push({
          path: notePath,
          id: p.id,
          deletedAt: p.deletedAt,
          detectedAt: p.detectedAt,
          bucket: 'pending'
        });
      }
      const a = store.archived[notePath];
      if (a) {
        out.push({
          path: notePath,
          id: a.id,
          deletedAt: a.deletedAt,
          detectedAt: a.deletedAt,
          bucket: 'archived'
        });
      }
      return out;
    });
  }

  /** Todas las candidatas (para el comando de reclamación). */
  async listAllPending(): Promise<PendingClaim[]> {
    return this.enqueue(async () => {
      const store = await this.load();
      if (!store) return [];
      const out: PendingClaim[] = [];
      for (const [path, p] of Object.entries(store.pending)) {
        out.push({
          path,
          id: p.id,
          deletedAt: p.deletedAt,
          detectedAt: p.detectedAt,
          bucket: 'pending'
        });
      }
      for (const [path, a] of Object.entries(store.archived)) {
        out.push({
          path,
          id: a.id,
          deletedAt: a.deletedAt,
          detectedAt: a.deletedAt,
          bucket: 'archived'
        });
      }
      return out;
    });
  }

  /**
   * Reclamación EXPLÍCITA (E2).
   * - Sin candidatas → 'none'.
   * - La ruta ya tiene un id activo DISTINTO → 'conflict' (no se
   *   pisa; los candidatos se conservan para resolución manual).
   * - Varias candidatas y sin `bucket` → 'ambiguous' (no se elige
   *   arbitrariamente; el llamante presenta las opciones).
   * - Un solo candidato (o `bucket` explícito) → se asocia el id y
   *   se retira SOLO el bucket reclamado (el otro se conserva).
   * Idempotente: reclamar dos veces la misma entrada es un no-op.
   */
  async claim(
    notePath: string,
    bucket?: 'pending' | 'archived'
  ): Promise<ClaimResult> {
    return this.enqueue(async () => {
      const store = await this.load();
      if (!store) return { status: 'none' };

      const candidates = this.collectCandidates(store, notePath);
      const active = store.ids[notePath];

      if (active !== undefined) {
        if (candidates.length === 0) {
          // Ya reclamada y sin candidatas: idempotente.
          return { status: 'claimed', id: active };
        }
        if (candidates.some((c) => c.id === active)) {
          // Reclamada; retira el bucket restante con el mismo id.
          this.removeClaimedBucket(store, notePath, active);
          await this.persist();
          return { status: 'claimed', id: active };
        }
        return { status: 'conflict', existingId: active, candidates };
      }

      if (candidates.length === 0) return { status: 'none' };

      let chosen: PendingClaim | null = null;
      if (bucket) {
        chosen = candidates.find((c) => c.bucket === bucket) ?? null;
        if (!chosen) return { status: 'none' };
      } else if (candidates.length === 1) {
        chosen = candidates[0];
      } else {
        return { status: 'ambiguous', candidates };
      }

      store.ids[notePath] = chosen.id;
      // Retira solo el bucket reclamado; conserva el resto.
      if (chosen.bucket === 'pending') {
        delete store.pending[notePath];
      } else {
        delete store.archived[notePath];
      }
      await this.persist();
      return { status: 'claimed', id: chosen.id };
    });
  }

  private collectCandidates(
    store: IdentityStore,
    notePath: string
  ): PendingClaim[] {
    const out: PendingClaim[] = [];
    const p = store.pending[notePath];
    if (p) {
      out.push({
        path: notePath,
        id: p.id,
        deletedAt: p.deletedAt,
        detectedAt: p.detectedAt,
        bucket: 'pending'
      });
    }
    const a = store.archived[notePath];
    if (a) {
      out.push({
        path: notePath,
        id: a.id,
        deletedAt: a.deletedAt,
        detectedAt: a.deletedAt,
        bucket: 'archived'
      });
    }
    return out;
  }

  /** Tras un reclamo idempotente: retira buckets con el id activo. */
  private removeClaimedBucket(
    store: IdentityStore,
    notePath: string,
    activeId: string
  ): boolean {
    let changed = false;
    if (store.pending[notePath]?.id === activeId) {
      delete store.pending[notePath];
      changed = true;
    }
    if (store.archived[notePath]?.id === activeId) {
      delete store.archived[notePath];
      changed = true;
    }
    return changed;
  }

  /**
   * Detección de inconsistencias (no destructiva, E2):
   * - NO restaura automáticamente (reclamo explícito);
   * - reporta rutas pendientes cuya nota ya existe;
   * - reporta ids huérfanos y duplicados.
   */
  async reconcile(existingPaths: string[]): Promise<ReconcileReport> {
    return this.enqueue(async () => {
      const report: ReconcileReport = {
        orphans: [],
        pendingExisting: [],
        duplicateIds: []
      };
      const store = await this.load();
      if (!store) return report;
      const existing = new Set(existingPaths);

      for (const path of Object.keys(store.pending)) {
        if (existing.has(path) && store.ids[path] === undefined) {
          report.pendingExisting.push(path);
        }
      }
      for (const path of Object.keys(store.archived)) {
        if (
          existing.has(path) &&
          store.ids[path] === undefined &&
          !report.pendingExisting.includes(path)
        ) {
          report.pendingExisting.push(path);
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
      return report;
    });
  }
}
