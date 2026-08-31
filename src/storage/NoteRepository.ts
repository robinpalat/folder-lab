import { App } from 'obsidian';
import { HiddenFolderManager } from './HiddenFolderManager';
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

export class NoteRepository {

  private readonly hiddenManager: HiddenFolderManager;

  constructor(private readonly app: App) {
    this.hiddenManager = new HiddenFolderManager(
      app,
      INTERNAL_FOLDER
    );
  }

  /**
   * Carga toda la configuración de Contexto de una carpeta.
   *
   * La clave del store es la ruta completa de la nota.
   */
  async loadFolder(folderPath: string): Promise<NoteContextStore> {
    const data = await this.hiddenManager.readJSON<NoteContextStore>(
      folderPath,
      NOTE_CONTEXT_FILE
    );

    return data ?? {};
  }

  /**
   * Guarda toda la configuración de Contexto de una carpeta.
   */
  async saveFolder(
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
   * Obtiene la configuración de una nota concreta.
   */
  async loadNote(notePath: string): Promise<NoteContextData | null> {
    const folderPath = this.getParentFolderPath(notePath);

    if (folderPath === null) {
      return null;
    }

    const store = await this.loadFolder(folderPath);

    return store[notePath] ?? null;
  }

  /**
   * Guarda la configuración de una nota concreta.
   */
  async saveNote(
    notePath: string,
    data: NoteContextData
  ): Promise<void> {
    const folderPath = this.getParentFolderPath(notePath);

    if (folderPath === null) {
      throw new Error(
        `[NoteContextRepository] No se pudo determinar la carpeta padre de "${notePath}"`
      );
    }

    const store = await this.loadFolder(folderPath);

    store[notePath] = data;

    await this.saveFolder(folderPath, store);
  }

  /**
   * Elimina la configuración asociada a una nota.
   */
  async deleteNote(notePath: string): Promise<void> {
    const folderPath = this.getParentFolderPath(notePath);

    if (folderPath === null) {
      return;
    }

    const store = await this.loadFolder(folderPath);

    if (!(notePath in store)) {
      return;
    }

    delete store[notePath];

    await this.saveFolder(folderPath, store);
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
