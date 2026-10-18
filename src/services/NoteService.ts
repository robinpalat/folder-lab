// ============================================================
// SERVICE: NoteService
// ============================================================
// Gestiona todas las operaciones relacionadas con notas
// ============================================================

import { App, TFile, Notice } from 'obsidian';
import { FolderRepository } from '../storage/FolderRepository';
import { makeTrashOp } from '../storage/managedDelete';
import { FolderOrderSettings } from '../config/settings';
import { INTERNAL_FOLDER } from '../constants/view-types';
import { isNoteEmpty as isNoteEmptyUtil } from '../utils/string-utils';
import { HiddenFolderManager } from '../storage/HiddenFolderManager';
import { i18n } from '../i18n/I18nService';

export class NoteService {
  private app: App;
  private repository: FolderRepository;
  private settings: FolderOrderSettings;

  constructor(app: App, repository: FolderRepository, settings: FolderOrderSettings) {
    this.app = app;
    this.repository = repository;
    this.settings = settings;
  }

  // ============================================================
  // CREAR NOTA
  // ============================================================

  /**
   * Crea una nueva nota en la carpeta especificada
   */
  async createNote(folderPath: string, name: string): Promise<TFile | null> {
    if (!folderPath) {
      new Notice(i18n.t('errors.noFolderSelected'));
      return null;
    }

    if (!name || name.trim() === '') {
      new Notice(i18n.t('errors.note.emptyName'));
      return null;
    }

    const fileName = name.endsWith('.md') ? name.trim() : `${name.trim()}.md`;
    const filePath = `${folderPath}/${fileName}`;

    if (this.app.vault.getAbstractFileByPath(filePath) instanceof TFile) {
      new Notice(i18n.t('errors.note.duplicateName', { name: fileName }));
      return null;
    }

    const content = `# ${name.trim()}\n\n`;
    const file = await this.app.vault.create(filePath, content);

    /*
     * El registro en el orden lo realiza EXCLUSIVAMENTE el
     * evento vault:create → OrderService.updateOrderOnCreate
     * (que ya aplica dedupe, exclusiones de carpetas ocultas y
     * la nota compilada). Anexar aquí el nombre —como se hacía—
     * escribía la entrada DOS veces en el orden manual (carrera
     * entre este método y el handler del evento) y la nota
     * aparecía duplicada en la lista.
     */

    new Notice(i18n.t('notes.created', { name: fileName }));
    return file;
  }

  // ============================================================
  // NOTA GENERAL
  // ============================================================
  // La Nota General es ÚNICA y pertenece exclusivamente a la carpeta
  // master del libro. Se almacena directamente en la carpeta técnica
  // visible `Folder Lab/`, no en subcarpetas ni en `.folder-lab/`.

  private static readonly GENERAL_NOTE_FILE = '_nota_general.txt';

  /**
   * Resuelve la ruta única de la Nota General (carpeta master).
   */
  private generalNoteFolderPath(): string {
    return this.settings.bookRootPath || '';
  }

  /**
   * Carga la Nota General única de la carpeta master.
   * Compatibilidad de lectura: si no existe la centralizada,
   * intenta leer desde la ubicación legada del master.
   */
  async loadGeneralNote(): Promise<string> {
    const masterPath = this.generalNoteFolderPath();
    if (!masterPath) return '';

    try {
      const visibleManager = new HiddenFolderManager(this.app, 'Folder Lab');
      const content = await visibleManager.getFileContent(
        masterPath,
        NoteService.GENERAL_NOTE_FILE
      );
      if (content !== null) return content;
    } catch {
      // Fallback a ubicación legada
    }

    try {
      const legacyManager = new HiddenFolderManager(this.app, INTERNAL_FOLDER);
      const content = await legacyManager.getFileContent(
        masterPath,
        NoteService.GENERAL_NOTE_FILE
      );
      return content || '';
    } catch {
      return '';
    }
  }

  /**
   * Guarda la Nota General única en la carpeta master.
   * Siempre escribe en la ubicación centralizada `Folder Lab/`.
   */
  async saveGeneralNote(content: string): Promise<void> {
    const masterPath = this.generalNoteFolderPath();
    if (!masterPath) {
      throw new Error('[NoteService] Sin carpeta master configurada');
    }

    const visibleManager = new HiddenFolderManager(this.app, 'Folder Lab');
    await visibleManager.writeFile(
      masterPath,
      NoteService.GENERAL_NOTE_FILE,
      content
    );
  }

  // ============================================================
  // NOTAS PARTICULARES
  // ============================================================

  /**
   * Carga la nota particular de un archivo
   */
  async loadNoteContent(folderPath: string, fileName: string): Promise<string> {
    const orderData = await this.repository.loadFolderLab(folderPath);
    if (!orderData?.notes?.[fileName]) return '';
    
    const noteData = orderData.notes[fileName];
    if (noteData.startsWith('|STATUS|')) {
      const parts = noteData.split('|');
      if (parts.length > 3) {
        return parts.slice(3).join('|');
      }
      return '';
    }
    return noteData;
  }

  /**
   * Guarda la nota particular de un archivo.
   *
   * 3A: RMW completo vía transactFolderLab (lectura fresca +
   * cola compartida con el orden global): no puede pisar datos
   * del mismo fichero escritos por otra ruta.
   */
  async saveNoteContent(
    folderPath: string,
    fileName: string,
    content: string,
    status?: string
  ): Promise<void> {
    await this.repository.transactFolderLab(folderPath, (orderData) => {
      if (!orderData.notes) orderData.notes = {};

      let noteData = '';
      if (status) {
        noteData = `|STATUS|${status}|${content}`;
      } else {
        const currentData = orderData.notes[fileName] || '';
        if (currentData.startsWith('|STATUS|')) {
          const parts = currentData.split('|');
          const oldStatus = parts.length > 2 ? parts[2] : '';
          noteData = `|STATUS|${oldStatus}|${content}`;
        } else {
          noteData = content;
        }
      }

      orderData.notes[fileName] = noteData;
    });
  }

  // ============================================================
  // ESTADO DE NOTAS
  // ============================================================

  /**
   * Obtiene el estado de una nota
   */
  async getNoteStatus(folderPath: string, fileName: string): Promise<string> {
    const orderData = await this.repository.loadFolderLab(folderPath);
    const noteData = orderData?.notes?.[fileName];
    if (noteData?.startsWith('|STATUS|')) {
      const parts = noteData.split('|');
      if (parts.length > 2) return parts[2];
    }
    return '';
  }
  
  async getNoteStatusByFile(file: TFile): Promise<string> {
  if (!file.parent) {
    return '';
  }

  return this.getNoteStatus(
    file.parent.path,
    file.name
  );
}
  
  
  
  async setNoteStatusByFile(
  file: TFile,
  status: string
): Promise<void> {
  if (!file.parent) {
    return;
  }

  await this.setNoteStatus(
    file.parent.path,
    file.name,
    status
  );
}

  /**
   * Guarda el estado de una nota (RMW serializado, 3A).
   */
  async setNoteStatus(folderPath: string, fileName: string, status: string): Promise<void> {
    await this.repository.transactFolderLab(folderPath, (orderData) => {
      if (!orderData.notes) orderData.notes = {};

      const currentData = orderData.notes[fileName] || '';
      let content = '';

      if (currentData.startsWith('|STATUS|')) {
        const parts = currentData.split('|');
        if (parts.length > 3) {
          content = parts.slice(3).join('|');
        }
      } else {
        content = currentData;
      }

      if (status) {
        orderData.notes[fileName] = `|STATUS|${status}|${content}`;
      } else {
        orderData.notes[fileName] = content;
      }
    });
  }

  // ============================================================
  // VALIDACIÓN DE NOTAS
  // ============================================================

  /**
   * Detecta si una nota está vacía
   */
  async isNoteEmpty(file: TFile): Promise<boolean> {
    const content = await this.app.vault.read(file);
    return isNoteEmptyUtil(content);
  }

  // ============================================================
  // ELIMINAR NOTA
  // ============================================================

  /**
   * Elimina una nota del vault y del orden
   */
  async deleteNote(folderPath: string, file: TFile): Promise<boolean> {
    if (!folderPath || !file) {
      new Notice(i18n.t('errors.noFolderOrFileSelected'));
      return false;
    }

    // RMW serializado (3A): solo se escribe si hay orden que
    // actualizar en el formato de la carpeta.
    await this.repository.transactFolderLab(folderPath, (orderData) => {
      if (!Array.isArray(orderData.order)) {
        return false;
      }
      orderData.order = orderData.order.filter((name: string) => name !== file.name);
      return true;
    });

    // Respeta la preferencia de papelera del usuario (trashFile
    // cuando existe; vault.delete solo como compat 1.4.4).
    await makeTrashOp(this.app)(file.path);
    new Notice(i18n.t('notes.deleted', { name: file.name }));
    return true;
  }
}
