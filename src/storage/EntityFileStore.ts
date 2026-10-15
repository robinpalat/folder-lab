// src/storage/EntityFileStore.ts
//
// Archivos por entidad (Etapa 3 de la reforma).
//
// Un archivo JSON por identidad en `<root>/Folder Lab/<subfolder>/<id>.json`.
// Verdad única: los stores multipath legados dejan de escribirse para
// las notas con identidad; `loadFolder` fusiona ambos orígenes
// (entidad gana) para mantener la vista por carpeta.
//
// Recuperación: JSON ilegible → la lectura PROPAGA (nunca se pisa
// un archivo corrupto sin que el error llegue al llamante).

import { App } from 'obsidian';

export interface EntityEnvelope<T> {
  version: 1;
  notePath: string;
  savedAt: number;
  data: T;
}

export interface EntityFileStoreOptions {
  /** Carpeta bajo `<root>/Folder Lab/` (p. ej. 'boards', 'context'). */
  subfolder: string;
  /** Validador de `data` al leer; lanza si la forma es incorrecta. */
  validate: (data: unknown, context: string) => void;
  getRootPath: () => string | null;
}

export class EntityFileStore<T> {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private app: App,
    private options: EntityFileStoreOptions
  ) {}

  private root(): string | null {
    const r = this.options.getRootPath();
    return r && r.trim() ? r : null;
  }

  private dir(): string | null {
    const root = this.root();
    return root ? `${root}/Folder Lab/${this.options.subfolder}` : null;
  }

  pathFor(id: string): string | null {
    const dir = this.dir();
    return dir ? `${dir}/${id}.json` : null;
  }

  private enqueue<X>(op: () => Promise<X>): Promise<X> {
    const result = this.tail.then(op, op);
    this.tail = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  private async ensureDir(): Promise<void> {
    const dir = this.dir();
    if (!dir) return;
    const adapter = this.app.vault.adapter;
    // Conserva un prefijo '/' inicial si lo hubiera.
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

  /**
   * Lee la entidad; null si no existe. JSON inválido o data con
   * forma incorrecta → PROPAGA (protección anti-pisado).
   */
  async read(id: string): Promise<EntityEnvelope<T> | null> {
    const path = this.pathFor(id);
    if (!path) return null;
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(path))) return null;
    const raw = await adapter.read(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `[EntityFileStore] JSON inválido en "${path}"`
      );
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as EntityEnvelope<T>).notePath !== 'string'
    ) {
      throw new Error(
        `[EntityFileStore] Sobre con forma incorrecta en "${path}"`
      );
    }
    const envelope = parsed as EntityEnvelope<T>;
    this.options.validate(
      envelope.data,
      `"${envelope.notePath}" (${path})`
    );
    return envelope;
  }

  /** Escritura SIN pasar por la cola (uso interno encolado). */
  private async writeEnvelope(
    id: string,
    notePath: string,
    data: T
  ): Promise<void> {
    const path = this.pathFor(id);
    if (!path) return;
    await this.ensureDir();
    const envelope: EntityEnvelope<T> = {
      version: 1,
      notePath,
      savedAt: Date.now(),
      data
    };
    await this.app.vault.adapter.write(
      path,
      JSON.stringify(envelope, null, 2)
    );
  }

  async write(id: string, notePath: string, data: T): Promise<void> {
    return this.enqueue(() => this.writeEnvelope(id, notePath, data));
  }

  /** Re-clava notePath en envelopes (renombrar); el id no cambia. */
  async rekeyNotePath(
    match: (notePath: string) => boolean,
    mapPath: (notePath: string) => string
  ): Promise<void> {
    return this.enqueue(async () => {
      const items = await this.list();
      for (const item of items) {
        if (!match(item.envelope.notePath)) continue;
        const next = mapPath(item.envelope.notePath);
        await this.writeEnvelope(item.id, next, item.envelope.data);
      }
    });
  }

  /** Lista todos los envelopes (para fusión por carpeta). */
  async list(): Promise<
    Array<{ id: string; envelope: EntityEnvelope<T> }>
  > {
    const dir = this.dir();
    if (!dir) return [];
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(dir))) return [];
    const result = await adapter.list(dir);
    const out: Array<{ id: string; envelope: EntityEnvelope<T> }> = [];
    for (const filePath of result.files || []) {
      if (!filePath.endsWith('.json')) continue;
      const id = filePath.slice(dir.length + 1, -'.json'.length);
      try {
        const envelope = await this.read(id);
        if (envelope) out.push({ id, envelope });
      } catch (error) {
        // Un archivo corrupto no impide la vista del resto.
        console.error(
          '[EntityFileStore] Archivo de entidad ilegible omitido en list():',
          filePath,
          error
        );
      }
    }
    return out;
  }
}
