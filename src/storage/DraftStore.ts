// src/storage/DraftStore.ts
//
// Borradores recuperables en la bóveda (Etapa 2 de la reforma).
//
// Decisión: un archivo JSON por nota en
//   `<Master>/Folder Lab/drafts/<noteId>.json`
// usando el id estable del NoteIdentityRegistry (Etapa 1), por lo
// que renombrar la nota NO requiere migrar este archivo.
//
// Política de fuentes de verdad:
// - El ARCHIVO es la verdad sincronizable.
// - localStorage (claves 8D) permanece como espejo de emergencia
//   por instalación; se escribe junto al archivo y se usa como
//   fallback si el archivo falta o es ilegible.
// - Al leer con archivo presente, el espejo local se «sana» con el
//   contenido del archivo.
// - No se depende de marcas temporales para resolver conflictos.
//
// Recuperación: JSON ilegible → se propaga el error y el fallback
// a espejo local sigue disponible; nunca se borra el archivo
// ilegible automáticamente.

import { App } from 'obsidian';
import type { NoteIdentityRegistry } from './NoteIdentityRegistry';

export interface DraftData {
  draft: string;
  blocks: Array<{ text: string; active: boolean }>;
}

export interface DraftFile extends DraftData {
  version: 1;
  notePath: string;
  savedAt: number;
}

const ROOT_FOLDER = 'Folder Lab';
const DRAFTS_FOLDER = 'drafts';

function isValidBlockArray(value: unknown): value is DraftData['blocks'] {
  return (
    Array.isArray(value) &&
    value.every(
      (b) =>
        !!b &&
        typeof b === 'object' &&
        typeof (b as { text?: unknown }).text === 'string' &&
        typeof (b as { active?: unknown }).active === 'boolean'
    )
  );
}

export class DraftStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private app: App,
    private getMasterPath: () => string | null,
    private registry: NoteIdentityRegistry
  ) {}

  private get masterPath(): string | null {
    const p = this.getMasterPath();
    return p && p.trim() ? p : null;
  }

  private async enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.tail.then(op, op);
    this.tail = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  private dirPath(): string | null {
    const master = this.masterPath;
    return master ? `${master}/${ROOT_FOLDER}/${DRAFTS_FOLDER}` : null;
  }

  private async filePathFor(notePath: string): Promise<string | null> {
    const dir = this.dirPath();
    if (!dir) return null;
    const id = await this.registry.getId(notePath);
    if (!id) return null;
    return `${dir}/${id}.json`;
  }

  private async ensureDir(): Promise<void> {
    const dir = this.dirPath();
    if (!dir) return;
    const adapter = this.app.vault.adapter;
    const prefix = dir.startsWith('/') ? '/' : '';
    const parts = dir.split('/').filter((p) => p !== '');
    let current = prefix;
    for (const part of parts) {
      current =
        current === '' || current === '/'
          ? current + part
          : `${current}/${part}`;
      if (!(await adapter.exists(current))) {
        await adapter.mkdir(current);
      }
    }
  }

  /** Lee el archivo de la nota; null si no existe. */
  async read(notePath: string): Promise<DraftFile | null> {
    const path = await this.filePathFor(notePath);
    if (!path) return null;
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(path))) return null;
    const raw = await adapter.read(path);
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as DraftFile).draft !== 'string' ||
      !isValidBlockArray((parsed as DraftFile).blocks)
    ) {
      throw new Error(
        `[DraftStore] Archivo de borrador inválido en "${path}"`
      );
    }
    return parsed as DraftFile;
  }

  /**
   * Escritura en modo parche: solo las claves provistas se
   * actualizan; el resto del archivo se conserva. Si no hay
   * archivo, se crea. Idempotente.
   */
  async write(
    notePath: string,
    patch: Partial<DraftData>
  ): Promise<void> {
    return this.enqueue(async () => {
      const path = await this.filePathFor(notePath);
      if (!path) return;
      await this.ensureDir();

      let current: DraftFile;
      const existing = await this.read(notePath).catch(() => null);
      if (existing) {
        current = existing;
      } else {
        current = {
          version: 1,
          notePath,
          savedAt: Date.now(),
          draft: '',
          blocks: []
        };
      }

      if (patch.draft !== undefined) current.draft = patch.draft;
      if (patch.blocks !== undefined) current.blocks = patch.blocks;
      current.notePath = notePath;
      current.savedAt = Date.now();

      await this.app.vault.adapter.write(
        path,
        JSON.stringify(current, null, 2)
      );
    });
  }
}
