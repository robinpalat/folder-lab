// ============================================================
// STORAGE: FolderRepository
// ============================================================
// Propietario único del árbol JSON.
// ============================================================

import { App, TFolder, TFile } from 'obsidian';
import { HiddenFolderManager } from './HiddenFolderManager';
import { INTERNAL_FOLDER, ORDER_FILE } from '../constants/view-types';
import { isHiddenFolderName } from '../utils/folderUtils';


export interface FolderOrderData {
  order: string[];
  folders?: Record<string, FolderOrderData>;
}

export interface GlobalOrderData {
  root: FolderOrderData;
  version?: number;
}

export class FolderRepository {
  private app: App;
  private hiddenManager: HiddenFolderManager;
  private globalOrderData: GlobalOrderData | null = null;
  private parentIndex: Map<string, string> | null = null;
  private masterPath: string | null = null;

  constructor(app: App) {
    this.app = app;
    this.hiddenManager = new HiddenFolderManager(app, INTERNAL_FOLDER);
  }

  // ============================================================
  // CARGA Y GUARDADO
  // ============================================================

  async loadGlobalOrder(masterPath: string): Promise<GlobalOrderData | null> {
    this.masterPath = masterPath;
    if (this.globalOrderData) return this.globalOrderData;

    const data = await this.hiddenManager.readJSON<GlobalOrderData>(masterPath, ORDER_FILE);

    if (data) {
      this.globalOrderData = data;
      this.buildParentIndex();
    }
    return data || null;
    console.log("No se encontró _folder_order.json");
  }




  async saveGlobalOrder(masterPath: string, data: GlobalOrderData): Promise<void> {
    this.globalOrderData = data;
    await this.hiddenManager.writeJSON(masterPath, ORDER_FILE, data);
    this.buildParentIndex();
  }

  async initGlobalOrder(masterPath: string): Promise<void> {
    this.masterPath = masterPath;
    const existing = await this.loadGlobalOrder(masterPath);
    if (existing) return;

    let rootOrder: FolderOrderData;

    if (masterPath === '') {
      // El propio vault es un master válido.
      rootOrder = await this.buildOrderFromFolder(this.app.vault.getRoot());
    } else {
      const masterFolder = this.app.vault.getAbstractFileByPath(masterPath);
      if (!(masterFolder instanceof TFolder)) return;
      rootOrder = await this.buildOrderFromFolder(masterFolder);
    }
    this.globalOrderData = { root: rootOrder, version: 1 };
    await this.saveGlobalOrder(masterPath, this.globalOrderData);
  }

  private async buildOrderFromFolder(folder: TFolder): Promise<FolderOrderData> {
    const orderData: FolderOrderData = { order: [], folders: {} };

    const subfolders: TFolder[] = [];
    const notes: TFile[] = [];

    for (const child of folder.children) {
      if (child instanceof TFolder) {
        // Excluir carpetas ocultas
        if (!isHiddenFolderName(child.name)) {
          subfolders.push(child);
        }
      } else if (child instanceof TFile && child.extension === 'md') {
        // Excluir archivos ocultos
        if (!isHiddenFolderName(child.name) && child.name !== `${folder.name}.md`) {
          notes.push(child);
        }
      }
    }

    subfolders.sort((a, b) => a.name.localeCompare(b.name));
    notes.sort((a, b) => a.name.localeCompare(b.name));

    for (const subfolder of subfolders) {
      orderData.order.push(subfolder.name);
      orderData.folders![subfolder.name] = await this.buildOrderFromFolder(subfolder);
    }

    for (const note of notes) {
      orderData.order.push(note.name);
    }

    return orderData;
  }

  // ============================================================
  // COMPATIBILIDAD CON SERVICIOS EXISTENTES
  // ============================================================

  async loadFolderLab(folderPath: string): Promise<{ order: string[]; notes?: Record<string, string> } | null> {
    try {
      const data = await this.hiddenManager.readJSON<{ order: string[]; notes?: Record<string, string> }>(
        folderPath,
        ORDER_FILE
      );
      return data || { order: [] };
    } catch {
      return { order: [] };
    }
  }

  async saveFolderLab(folderPath: string, data: { order: string[]; notes?: Record<string, string> }): Promise<void> {
    await this.hiddenManager.writeJSON(folderPath, ORDER_FILE, data);
  }

  // ============================================================
  // CONSULTAS DE ORDEN
  // ============================================================

  async getFolderOrder(folderPath: string, masterPath: string): Promise<string[] | null> {
    if (!this.globalOrderData) {
      await this.loadGlobalOrder(masterPath);
      if (!this.globalOrderData) return null;
    }

    if (folderPath === masterPath) {
      return this.globalOrderData.root.order || [];
    }

    const relativePath = folderPath.replace(masterPath, '').split('/').filter(Boolean);
    let current: FolderOrderData = this.globalOrderData.root;

    for (const segment of relativePath) {
      if (!current.folders || !current.folders[segment]) {
        return null;
      }
      current = current.folders[segment];
    }

    return current.order?.filter(name => !isHiddenFolderName(name)) || [];
  }

  async updateFolderOrder(folderPath: string, masterPath: string, order: string[]): Promise<void> {
    if (!this.globalOrderData) {
      await this.loadGlobalOrder(masterPath);
      if (!this.globalOrderData) return;
    }

    if (folderPath === masterPath) {
      this.globalOrderData.root.order = order;
      await this.saveGlobalOrder(masterPath, this.globalOrderData);
      return;
    }

    const relativePath = folderPath.replace(masterPath, '').split('/').filter(Boolean);
    let current: FolderOrderData = this.globalOrderData.root;

    for (let i = 0; i < relativePath.length; i++) {
      const segment = relativePath[i];

      if (!current.folders) current.folders = {};
      if (!current.folders[segment]) {
        current.folders[segment] = { order: [], folders: {} };
      }

      if (i === relativePath.length - 1) {
        current.folders[segment].order = order;
      } else {
        current = current.folders[segment];
      }
    }

    await this.saveGlobalOrder(masterPath, this.globalOrderData);
  }

  // ============================================================
  // CONSULTAS DE DATOS (métodos movidos desde OrderService)
  // ============================================================

  getFolderData(folderPath: string): FolderOrderData | null {
    if (!this.globalOrderData || this.masterPath === null) return null;

    if (folderPath === this.masterPath) {
      return this.globalOrderData.root;
    }

    const relativePath = folderPath.replace(this.masterPath, '').split('/').filter(Boolean);
    let current: FolderOrderData = this.globalOrderData.root;

    for (const segment of relativePath) {
      if (!current.folders || !current.folders[segment]) {
        return null;
      }
      current = current.folders[segment];
    }

    return current;
  }

  getFolderNode(folderPath: string): FolderOrderData | null {
    return this.getFolderData(folderPath);
  }

  getNotesFromSubtree(folderNode: FolderOrderData, folderPath: string): { name: string; path: string }[] {
    const result: { name: string; path: string }[] = [];

    for (const itemName of folderNode.order) {
      // Excluir elementos ocultos
      if (isHiddenFolderName(itemName)) continue;

      if (folderNode.folders && folderNode.folders[itemName]) {
        const subFolderPath = `${folderPath}/${itemName}`;
        const subNotes = this.getNotesFromSubtree(folderNode.folders[itemName], subFolderPath);
        result.push(...subNotes);
      } else {
        const filePath = `${folderPath}/${itemName}`;
        const file = this.app.vault.getFileByPath(filePath);
        if (file instanceof TFile) {
          // Excluir archivos ocultos
          if (!isHiddenFolderName(file.name)) {
            result.push({ name: file.name, path: file.path });
          }
        }
      }
    }

    return result;
  }

  getFoldersFromSubtree(folderNode: FolderOrderData, folderPath: string): string[] {
    const result: string[] = [];

    for (const itemName of folderNode.order) {
      // Excluir carpetas ocultas
      if (isHiddenFolderName(itemName)) continue;

      if (folderNode.folders && folderNode.folders[itemName]) {
        result.push(itemName);
        const subNode = folderNode.folders[itemName];
        const subFolders = this.getFoldersFromSubtree(subNode, `${folderPath}/${itemName}`);
        result.push(...subFolders);
      }
    }

    return result;
  }

  // ============================================================
  // ÍNDICE JERÁRQUICO
  // ============================================================

  private buildParentIndex(): void {
    this.parentIndex = new Map();
    if (!this.globalOrderData || this.masterPath === null) return;

    this.buildParentIndexRecursive(
      this.globalOrderData.root,
      this.masterPath,
      this.masterPath
    );
  }

  private buildParentIndexRecursive(
    node: FolderOrderData,
    currentPath: string,
    parentPath: string
  ): void {
    if (!node.folders) return;

    for (const [folderName, childNode] of Object.entries(node.folders)) {
      // Excluir carpetas ocultas del índice
      if (isHiddenFolderName(folderName)) continue;

      const childPath = currentPath
        ? `${currentPath}/${folderName}`
        : folderName;

      const actualParentPath = currentPath;
      this.parentIndex!.set(childPath, actualParentPath);
      this.buildParentIndexRecursive(childNode, childPath, actualParentPath);
    }
  }

  // ============================================================
  // CONSULTAS JERÁRQUICAS
  // ============================================================

  getParent(folderPath: string): string | null {

    if (!this.parentIndex) {
      if (this.globalOrderData && this.masterPath !== null) {
        this.buildParentIndex();
      } else {
        return null;
      }
    }

    if (folderPath === this.masterPath) return null;
    return this.parentIndex?.get(folderPath) ?? null;
  }

  exists(folderPath: string): boolean {
    if (folderPath === this.masterPath) return true;
    return this.parentIndex?.has(folderPath) || false;
  }

  // ============================================================
  // CONSULTAS JERÁRQUICAS DESDE EL JSON
  // ============================================================

  /**
   * Obtiene la carpeta padre de una carpeta desde el JSON maestro
   * @param folderPath Ruta de la carpeta actual
   * @returns Ruta de la carpeta padre o null si es la raíz
   */
  getParentFolderFromJson(folderPath: string): string | null {
    if (!this.globalOrderData || !this.masterPath) {
      console.warn(' No hay datos globales para obtener el padre');
      return null;
    }

    // Si es la carpeta raíz, no tiene padre
    if (folderPath === this.masterPath) {
      return null;
    }

    // Obtener la ruta padre
    const parentPath = folderPath.split('/').slice(0, -1).join('/');

    // Verificar que el padre existe en el JSON
    const parentNode = this.getFolderData(parentPath);
    if (parentNode) {
      return parentPath;
    }

    // Si no existe en el JSON, verificar si es la raíz
    if (parentPath === this.masterPath) {
      return parentPath;
    }

    return null;
  }

  /**
   * Verifica si una carpeta tiene padre en el JSON
   */
  hasParentInJson(folderPath: string): boolean {
    return this.getParentFolderFromJson(folderPath) !== null;
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

getMasterPath(): string | null {
  return this.masterPath;
}

  getGlobalOrder(): GlobalOrderData | null {
    return this.globalOrderData;
  }
}
