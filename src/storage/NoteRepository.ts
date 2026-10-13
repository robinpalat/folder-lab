import { App } from 'obsidian';
import { HiddenFolderManager } from './HiddenFolderManager';
import { EntityFileStore } from './EntityFileStore';
import { INTERNAL_FOLDER } from '../constants/view-types';
import { WidgetInstance } from '../focus/WidgetDefinition';

const NOTE_CONTEXT_FILE = '_note_context.json';

export interface NoteContextLayout {
  top: string;
  bottom: string;
}

export interface NoteContextData {
  widgets: WidgetInstance[];
  layout: NoteContextLayout;
}

export interface NoteContextStore {
  [notePath: string]: NoteContextData;
}

/**
 * Comprueba que un valor es un objeto simple (no array, no null).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Valida una entrada de contexto al CARGAR (P0-1).
 *
 * Tolerancia a datos antiguos: campos opcionales pueden ausentarse.
 * Un campo presente con forma incorrecta es dato malformado: se
 * rechaza, no se descarta ni se utiliza.
 */
function assertStoredNoteContext(
  value: unknown,
  context: string
): asserts value is NoteContextData {
  if (!isPlainObject(value)) {
    throw new Error(
      `[NoteRepository] Entrada malformada en ${context}: se esperaba un objeto`
    );
  }

  if (
    value.widgets !== undefined &&
    (!Array.isArray(value.widgets) ||
      !value.widgets.every(isPlainObject))
  ) {
    throw new Error(
      `[NoteRepository] Entrada malformada en ${context}: "widgets" debe ser un array de objetos`
    );
  }

  if (
    value.layout !== undefined &&
    (!isPlainObject(value.layout) ||
      (value.layout.top !== undefined &&
        typeof value.layout.top !== 'string') ||
      (value.layout.bottom !== undefined &&
        typeof value.layout.bottom !== 'string'))
  ) {
    throw new Error(
      `[NoteRepository] Entrada malformada en ${context}: "layout" debe ser un objeto con cadenas`
    );
  }
}

/**
 * Valida un NoteContextData antes de ESCRIBIRLO (P0-1).
 */
function assertNoteContextForSave(
  value: unknown,
  context: string
): asserts value is NoteContextData {
  if (!isPlainObject(value)) {
    throw new Error(
      `[NoteRepository] Datos a guardar inválidos en ${context}: se esperaba un objeto`
    );
  }

  if (!Array.isArray(value.widgets)) {
    throw new Error(
      `[NoteRepository] Datos a guardar inválidos en ${context}: "widgets" debe ser un array`
    );
  }

  assertStoredNoteContext(value, context);
}

export class NoteRepository {

  private readonly hiddenManager: HiddenFolderManager;
  private readonly identity?: (notePath: string) => Promise<string | null>;
  private readonly getRootPath?: () => string | null;
  private readonly entities: EntityFileStore<NoteContextData> | null;

  /*
   * P2-1: cola FIFO sobre el almacén de la carpeta (mismo
   * mecanismo que BoardRepository/PluginDataStore). Cada RMW se
   * ejecuta completo antes de que empiece el siguiente: dos
   * escrituras no se aplican en orden inverso y un RMW
   * concurrente no pierde las entradas de otras notas.
   */
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly app: App,
    options?: {
      identity?: (notePath: string) => Promise<string | null>;
      getRootPath?: () => string | null;
    }
  ) {
    this.hiddenManager = new HiddenFolderManager(
      app,
      INTERNAL_FOLDER
    );
    this.identity = options?.identity;
    this.getRootPath = options?.getRootPath;
    this.entities =
      this.identity && this.getRootPath
        ? new EntityFileStore<NoteContextData>(app, {
            subfolder: 'context',
            getRootPath: this.getRootPath,
            validate: (data, context) => {
              assertStoredNoteContext(data, context);
            }
          })
        : null;
  }

  private async entityId(notePath: string): Promise<string | null> {
    if (!this.identity || !this.getRootPath?.()) return null;
    return this.identity(notePath);
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.tail.then(op, op);

    // La cadena continúa aunque la operación falle.
    this.tail = result.then(() => {}, () => {});

    return result;
  }

  /** Lectura validada SIN cola: solo dentro de una operación encolada. */
  private async readStoreRaw(folderPath: string): Promise<NoteContextStore> {
    const data = await this.hiddenManager.readJSON<NoteContextStore>(
      folderPath,
      NOTE_CONTEXT_FILE
    );

    if (data === null) {
      return {};
    }

    if (!isPlainObject(data)) {
      throw new Error(
        `[NoteRepository] El almacén "${folderPath}/${NOTE_CONTEXT_FILE}" no tiene la forma esperada`
      );
    }

    return data;
  }

  private async writeStoreRaw(
    folderPath: string,
    data: NoteContextStore
  ): Promise<void> {
    await this.hiddenManager.writeJSON(
      folderPath,
      NOTE_CONTEXT_FILE,
      data
    );
  }

  /**
   * Carga toda la configuración de Contexto de una carpeta.
   *
   * La clave del store es la ruta completa de la nota.
   *
   * P0-1: archivo ausente → `{}` (primera vez). Error de lectura
   * o JSON inválido → PROPAGA: nunca `{}` en su lugar, para no
   * borrar los contextos de las demás notas en el siguiente save.
   */
  loadFolder(folderPath: string): Promise<NoteContextStore> {
    return this.enqueue(async () => {
      const legacy = await this.readStoreRaw(folderPath);
      if (!this.entities) return legacy;

      const merged: NoteContextStore = { ...legacy };
      const items = await this.entities.list();
      const prefix =
        folderPath === '' ? '' : folderPath.replace(/\/+$/, '') + '/';
      for (const { envelope } of items) {
        const notePath = envelope.notePath;
        const inFolder =
          folderPath === ''
            ? !notePath.includes('/')
            : notePath.startsWith(prefix);
        if (inFolder) {
          merged[notePath] = envelope.data;
        }
      }
      return merged;
    });
  }

  /**
   * Guarda toda la configuración de Contexto de una carpeta.
   */
  saveFolder(
    folderPath: string,
    data: NoteContextStore
  ): Promise<void> {
    return this.enqueue(() => this.writeStoreRaw(folderPath, data));
  }

  /**
   * Migra la entrada de una nota al renombrarla/moverla (Etapa 1).
   * Mismo invariante que BoardRepository: destino antes que origen.
   */
  migrateEntry(oldPath: string, newPath: string): Promise<void> {
    return this.enqueue(async () => {
      const oldFolder = this.getParentFolderPath(oldPath);
      const newFolder = this.getParentFolderPath(newPath);

      if (oldFolder === null || newFolder === null) return;

      if (oldFolder === newFolder) {
        const store = await this.readStoreRaw(oldFolder);
        if (oldPath in store) {
          store[newPath] = store[oldPath];
          delete store[oldPath];
          await this.writeStoreRaw(oldFolder, store);
        }
      } else {
        const source = await this.readStoreRaw(oldFolder);
        if (oldPath in source) {
          const entry = source[oldPath];
          const target = await this.readStoreRaw(newFolder);
          target[newPath] = entry;
          await this.writeStoreRaw(newFolder, target);
          delete source[oldPath];
          await this.writeStoreRaw(oldFolder, source);
        }
      }

      if (this.entities) {
        await this.entities.rekeyNotePath(
          (p) => p === oldPath,
          () => newPath
        );
      }
    });
  }

  /**
   * Re-clava todas las entradas bajo un prefijo al renombrar una
   * carpeta (padre invariante).
   */
  migrateFolderPrefix(
    oldPrefix: string,
    newPrefix: string
  ): Promise<void> {
    return this.enqueue(async () => {
      const oldBase = oldPrefix.replace(/\/+$/, '');
      const newBase = newPrefix.replace(/\/+$/, '');
      // Tras el evento rename, el store vive en la carpeta nueva.
      const folderPath = newBase;

      const store = await this.readStoreRaw(folderPath);
      let changed = false;
      for (const key of Object.keys(store)) {
        if (key === oldBase || key.startsWith(oldBase + '/')) {
          const next =
            key === oldBase
              ? newBase
              : newBase + '/' + key.slice(oldBase.length + 1);
          store[next] = store[key];
          delete store[key];
          changed = true;
        }
      }
      if (changed) await this.writeStoreRaw(folderPath, store);
      if (this.entities) {
        await this.entities.rekeyNotePath(
          (p) => p === oldBase || p.startsWith(oldBase + '/'),
          (p) =>
            p === oldBase
              ? newBase
              : newBase + '/' + p.slice(oldBase.length + 1)
        );
      }
    });
  }

  /**
   * Obtiene la configuración de una nota concreta.
   */
  loadNote(notePath: string): Promise<NoteContextData | null> {
    return this.enqueue(async () => {
      const folderPath = this.getParentFolderPath(notePath);

      if (folderPath === null) {
        return null;
      }

      // 1) Archivo por entidad (verdad única, Etapa 3).
      const id = await this.entityId(notePath);
      if (id && this.entities) {
        const envelope = await this.entities.read(id);
        if (envelope !== null) {
          return envelope.data;
        }
      }

      // 2) Fallback legado (+ migración perezosa).
      const store = await this.readStoreRaw(folderPath);

      const entry = store[notePath];

      if (entry === undefined) {
        return null;
      }

      // Entrada propia malformada: se rechaza en lugar de
      // descartarla silenciosamente.
      assertStoredNoteContext(entry, `"${notePath}"`);

      if (id && this.entities) {
        await this.entities.write(id, notePath, entry).catch((error) => {
          console.error(
            '[NoteRepository] Migración perezosa fallida:',
            error
          );
        });
      }

      return entry;
    });
  }

  /**
   * Guarda la configuración de una nota concreta.
   */
  saveNote(
    notePath: string,
    data: NoteContextData
  ): Promise<void> {
    return this.enqueue(async () => {
      assertNoteContextForSave(data, `"${notePath}"`);

      // Ruta por entidad (Etapa 3): lectura protectora + escritura.
      const id = await this.entityId(notePath);
      if (id && this.entities) {
        await this.entities.read(id);
        await this.entities.write(id, notePath, data);
        return;
      }

      const folderPath = this.getParentFolderPath(notePath);

      if (folderPath === null) {
        throw new Error(
          `[NoteContextRepository] No se pudo determinar la carpeta padre de "${notePath}"`
        );
      }

      // Si la lectura del almacén falla o el JSON está corrupto,
      // readStoreRaw lanza y la escritura queda ABORTADA.
      const store = await this.readStoreRaw(folderPath);

      store[notePath] = data;

      await this.writeStoreRaw(folderPath, store);
    });
  }

  /**
   * Elimina la configuración asociada a una nota.
   */
  deleteNote(notePath: string): Promise<void> {
    return this.enqueue(async () => {
      const folderPath = this.getParentFolderPath(notePath);

      if (folderPath === null) {
        return;
      }

      // La lectura propaga errores: ante un almacén ilegible no se
      // elimina nada (abortar es más seguro que asumir vacío).
      const store = await this.readStoreRaw(folderPath);

      if (!(notePath in store)) {
        return;
      }

      delete store[notePath];

      await this.writeStoreRaw(folderPath, store);
    });
  }

  /**
   * Determina la carpeta que contiene la nota.
   *
   * Ejemplo:
   *
   * LIBRO/Capitulo 1/Introduccion.md
   *
   * → LIBRO/Capitulo 1
   */
  private getParentFolderPath(notePath: string): string | null {
    const separatorIndex = notePath.lastIndexOf('/');

    if (separatorIndex === -1) {
      // Una nota directamente en el vault pertenece al root lógico.
      // Su ruta física de almacenamiento es la cadena vacía.
      return '';
    }

    return notePath.substring(0, separatorIndex);
  }
}
