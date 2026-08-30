// ============================================================
// SERVICE: NoteService
// ============================================================
// Gestiona todas las operaciones relacionadas con notas
// ============================================================

import { App, TFile, TFolder, Notice } from 'obsidian';
import { FolderRepository } from '../storage/FolderRepository';
import { FolderOrderSettings } from '../config/settings';
import { InputModal, ConfirmModal } from '../utils/ModalUtils';
import { INTERNAL_FOLDER } from '../constants/view-types';
import { isNoteEmpty as isNoteEmptyUtil } from '../utils/string-utils';
import { HiddenFolderManager } from '../storage/HiddenFolderManager';

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
      new Notice('No hay carpeta seleccionada');
      return null;
    }

    if (!name || name.trim() === '') {
      new Notice('El nombre no puede estar vacío');
      return null;
    }

    const fileName = name.endsWith('.md') ? name.trim() : `${name.trim()}.md`;
    const filePath = `${folderPath}/${fileName}`;

    if (this.app.vault.getFileByPath(filePath)) {
      new Notice(`Ya existe una nota con el nombre "${fileName}"`);
      return null;
    }

    const content = `# ${name.trim()}\n\n`;
    const file = await this.app.vault.create(filePath, content);
    
    const masterPath = this.settings.bookRootPath;
    if (masterPath) {
      const currentOrder = await this.repository.getFolderOrder(folderPath, masterPath);
      if (currentOrder) {
        const newOrder = [...currentOrder, fileName];
        await this.repository.updateFolderOrder(folderPath, masterPath, newOrder);
      } else {
        await this.repository.updateFolderOrder(folderPath, masterPath, [fileName]);
      }
    }

    new Notice(`Nota creada: ${fileName}`);
    return file;
  }

  // ============================================================
  // NOTA GENERAL
  // ============================================================

  /**
   * Carga la Nota General de una carpeta
   */
  async loadGeneralNote(folderPath: string): Promise<string> {
    try {
      // Usar HiddenFolderManager para leer _nota_general.txt
      const hiddenManager = new HiddenFolderManager(this.app, INTERNAL_FOLDER);
      const content = await hiddenManager.getFileContent(folderPath, '_nota_general.txt');
      return content || '';
    } catch {
      return '';
    }
  }

  /**
   * Guarda la Nota General de una carpeta
   */
  async saveGeneralNote(folderPath: string, content: string): Promise<void> {
    const hiddenManager = new HiddenFolderManager(this.app, INTERNAL_FOLDER);
    await hiddenManager.writeFile(folderPath, '_nota_general.txt', content);
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
   * Guarda la nota particular de un archivo
   */
  async saveNoteContent(
    folderPath: string,
    fileName: string,
    content: string,
    status?: string
  ): Promise<void> {
    const orderData = await this.repository.loadFolderLab(folderPath) || { order: [], notes: {} };
    
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
    await this.repository.saveFolderLab(folderPath, orderData);
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
   * Guarda el estado de una nota
   */
  async setNoteStatus(folderPath: string, fileName: string, status: string): Promise<void> {
    const orderData = await this.repository.loadFolderLab(folderPath) || { order: [], notes: {} };
    
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
    
    await this.repository.saveFolderLab(folderPath, orderData);
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
      new Notice('No hay carpeta o archivo seleccionado');
      return false;
    }

    const orderData = await this.repository.loadFolderLab(folderPath);
    if (orderData?.order) {
      orderData.order = orderData.order.filter((name: string) => name !== file.name);
      await this.repository.saveFolderLab(folderPath, orderData);
    }

    await this.app.vault.delete(file);
    new Notice(`Nota eliminada: ${file.name}`);
    return true;
  }
}
