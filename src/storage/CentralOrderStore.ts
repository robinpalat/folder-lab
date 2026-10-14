// src/storage/CentralOrderStore.ts
//
// Almacén central del orden (migración de `.folder-lab/_folder_order.json`).
//
// Archivo único: `<Master>/Folder Lab/order.json`
//   { version: 1, global: GlobalOrderData | null, folders: {...} }
//
// - `global`: el orden global del master (árbol + claves extra como
//   `notes` de la carpeta master — el fichero legado del master era
//   compartido entre orden y notes; se preserva ese contrato).
// - `folders`: entrada por carpeta (formato legado {order, notes}).
//
// Reglas:
// - Nunca escribe en `.folder-lab` (los legados solo se LEE N y se
//   copian a la central; jamás se borran).
// - Sin Master válido: carga/guardado degradan a no-op (sin crear
//   `.folder-lab`, sin perder datos de forma silenciosa: los writes
//   emiten aviso en consola).
// - Escrituras serializadas con cola propia; validación de forma.

import type { GlobalOrderData, FolderLabFileData } from './FolderRepository';

export interface CentralOrderData {
  version: 1;
  global: GlobalOrderData | null;
  folders: Record<string, FolderLabFileData>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class CentralOrderStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private app: { vault: { adapter: AdapterLike } },
    private getMasterPath: () => string | null
  ) {}

  private master(): string | null {
    const m = this.getMasterPath();
    return m && m.trim() ? m.replace(/^\/+|\/+$/g, '') : null;
  }

  path(): string | null {
    const master = this.master();
    return master ? `${master}/Folder Lab/order.json` : null;
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.tail.then(op, op);
    this.tail = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  /**
   * Carga el almacén central.
   * - null: sin Master o sin archivo (ausente legítimo).
   * - THROW: JSON ilegible o forma inválida (contrato P0-1: nunca
   *   se trata un error como «almacén vacío»).
   */
  async load(): Promise<CentralOrderData | null> {
    const path = this.path();
    if (!path) return null;
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(path))) return null;
    const raw = await adapter.read(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`[CentralOrderStore] JSON inválido en "${path}"`);
    }
    if (
      !isPlainObject(parsed) ||
      typeof parsed.version !== 'number' ||
      !isPlainObject((parsed as unknown as CentralOrderData).folders) ||
      !('global' in parsed)
    ) {
      throw new Error(
        `[CentralOrderStore] Forma inválida en "${path}"`
      );
    }
    return parsed as unknown as CentralOrderData;
  }

  /** Guarda (o re-crea) el almacén central completo. */
  async save(data: CentralOrderData): Promise<void> {
    return this.enqueue(async () => {
      const path = this.path();
      if (!path) {
        console.warn(
          '[CentralOrderStore] Sin Master configurado: escritura omitida'
        );
        return;
      }
      const adapter = this.app.vault.adapter;
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (!(await adapter.exists(dir))) {
        await adapter.mkdir(dir);
      }
      const text = JSON.stringify(data, null, 2);
      await adapter.write(path, text);
      // Verificación: releer y validar (migración verificable).
      const check = await adapter.read(path);
      JSON.parse(check);
    });
  }

  /** Modifica el almacén bajo la cola (RMW). */
  async mutate(
    mutator: (data: CentralOrderData) => void | false
  ): Promise<boolean> {
    return this.enqueue(async () => {
      let data = await this.load();
      if (data === null) {
        data = { version: 1, global: null, folders: {} };
      }
      const result = mutator(data);
      if (result === false) return false;
      const path = this.path();
      if (!path) {
        console.warn(
          '[CentralOrderStore] Sin Master configurado: escritura omitida'
        );
        return false;
      }
      const adapter = this.app.vault.adapter;
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (!(await adapter.exists(dir))) {
        await adapter.mkdir(dir);
      }
      await adapter.write(path, JSON.stringify(data, null, 2));
      const check = await adapter.read(path);
      JSON.parse(check);
      return true;
    });
  }
}

/** Mínimo del adapter de Obsidian usado por el store. */
interface AdapterLike {
  exists(p: string): Promise<boolean>;
  read(p: string): Promise<string>;
  write(p: string, c: string): Promise<void>;
  mkdir(p: string): Promise<void>;
}
