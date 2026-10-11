// ============================================================
// ORDER SERVICE
// ============================================================
// Gestiona el orden de notas. Consulta el árbol a través de FolderRepository.
// NO mantiene estado del árbol.
// ============================================================

import { App, TFolder, TFile } from 'obsidian';
import { INTERNAL_FOLDER, ORDER_FILE } from '../constants/view-types';
import { FolderRepository, FolderOrderData, GlobalOrderData } from '../storage/FolderRepository';
import { FolderOrderSettings } from '../config/settings';
import { isHiddenFolderName, isIgnoredFolderName } from '../utils/folderUtils';

export class OrderService {
  private app: App;
  private repository: FolderRepository;
  private settings: FolderOrderSettings;

  constructor(app: App, repository: FolderRepository, settings: FolderOrderSettings) {
    this.app = app;
    this.repository = repository;
    this.settings = settings;
  }

  // ============================================================
  // NOTIFICACIÓN DE CAMBIOS
  // ============================================================

  /**
   * Emite un evento cuando el modelo persistente de orden cambia.
   * Solo se emite si la operación de persistencia fue exitosa.
   */
  private async notifyOrderChanged(): Promise<void> {
    (this.app.workspace as any).trigger('folder-lab:order-changed');
  }

  // ============================================================
  // CONSULTAS
  // ============================================================

  async getOrderForFolder(folderPath: string): Promise<string[]> {
    const masterPath = this.settings.bookRootPath;
    if (!masterPath) return [];

    const globalOrder = await this.repository.getFolderOrder(folderPath, masterPath);
    if (globalOrder) {
      return globalOrder;
    }

    const localData = await this.repository.loadFolderLab(folderPath);
    if (localData?.order && localData.order.length > 0) {
      await this.repository.updateFolderOrder(folderPath, masterPath, localData.order);
      return localData.order;
    }

    return [];
  }

  async updateFolderOrder(folderPath: string, order: string[]): Promise<void> {
    const masterPath = this.settings.bookRootPath;
    if (!masterPath) return;
    await this.repository.updateFolderOrder(folderPath, masterPath, order);
  }

  // ============================================================
  // UTILIDADES PRIVADAS
  // ============================================================

  /**
   * Lista configurable de carpetas ignoradas (nombres exactos).
   */
  private ignoredFolders(): string[] {
    return (
      this.settings.navigationPropertyMapping?.ignoredFolders ?? []
    );
  }

  private async addToFolderOrder(folderPath: string, name: string): Promise<void> {
    const currentOrder = await this.getOrderForFolder(folderPath);
    if (!currentOrder.includes(name)) {
      currentOrder.push(name);
      await this.updateFolderOrder(folderPath, currentOrder);
    }
  }

  private async addFolderToOrder(parentPath: string, folderName: string): Promise<void> {
    const masterPath = this.settings.bookRootPath;
    if (!masterPath) return;

    // Las carpetas ignoradas nunca entran al orden (creación,
    // renombrados entrantes). La eliminación de una clave ausente
    // ya es un no-op seguro.
    const ignoredFolders = this.ignoredFolders();

    if (isIgnoredFolderName(folderName, ignoredFolders)) return;

    const currentOrder = await this.getOrderForFolder(parentPath);
    if (!currentOrder.includes(folderName)) {
      currentOrder.push(folderName);
      await this.updateFolderOrder(parentPath, currentOrder);
    }

    const globalOrder = await this.repository.getGlobalOrder();
    if (globalOrder) {
      const parentData = this.repository.getFolderData(parentPath);
      if (parentData) {
        if (!parentData.folders) parentData.folders = {};
        if (!parentData.folders[folderName]) {
          parentData.folders[folderName] = { order: [], folders: {} };
          await this.repository.saveGlobalOrder(masterPath, globalOrder);
        }
      }
    }
  }

  private async removeFolderFromStructure(parentPath: string, folderName: string): Promise<void> {
    const masterPath = this.settings.bookRootPath;
    if (!masterPath) return;

    const globalOrder = await this.repository.getGlobalOrder();
    if (globalOrder) {
      const parentData = this.repository.getFolderData(parentPath);
      if (parentData?.folders) {
        delete parentData.folders[folderName];
        await this.repository.saveGlobalOrder(masterPath, globalOrder);
      }
    }
  }

  /**
   * Elimina una nota del order[] sin emitir evento (para uso interno)
   */
  private async deleteNoteFromOrderInternal(filePath: string): Promise<void> {
    const masterPath = this.settings.bookRootPath;
    if (!masterPath) return;
    if (!filePath.startsWith(masterPath)) return;

    const fileName = filePath.split('/').pop() || '';
    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));

    if (isHiddenFolderName(fileName)) return;

    const currentOrder = await this.getOrderForFolder(folderPath);
    const index = currentOrder.indexOf(fileName);
    if (index === -1) return;

    currentOrder.splice(index, 1);
    await this.updateFolderOrder(folderPath, currentOrder);
  }

  // ============================================================
  // ACTUALIZACIONES POR EVENTOS DEL SISTEMA DE ARCHIVOS
  // ============================================================

  async updateOrderOnRename(oldPath: string, newPath: string): Promise<void> {
    const masterPath = this.settings.bookRootPath;
    if (!masterPath) return;
    if (!oldPath.startsWith(masterPath) || !newPath.startsWith(masterPath)) return;

    const oldName = oldPath.split('/').pop() || '';
    const newName = newPath.split('/').pop() || '';
    const oldFolderPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newFolderPath = newPath.substring(0, newPath.lastIndexOf('/'));

    const wasVisible = !isHiddenFolderName(oldName);
    const isVisible = !isHiddenFolderName(newName);

    // Caso 1: visible → oculto → eliminar (sin doble notificación)
    if (wasVisible && !isVisible) {
      await this.deleteNoteFromOrderInternal(oldPath);
      await this.notifyOrderChanged();
      return;
    }

    // Caso 2: oculto → visible → añadir al final
    if (!wasVisible && isVisible) {
      await this.addToFolderOrder(newFolderPath, newName);
      await this.notifyOrderChanged();
      return;
    }

    // Caso 3: ambos ocultos → ignorar
    if (!wasVisible && !isVisible) {
      return;
    }

    // Caso 4: ambos visibles
    if (oldFolderPath !== newFolderPath) {
      const oldOrder = await this.getOrderForFolder(oldFolderPath);
      const oldIndex = oldOrder.indexOf(oldName);
      if (oldIndex !== -1) {
        oldOrder.splice(oldIndex, 1);
        await this.updateFolderOrder(oldFolderPath, oldOrder);
      }

      await this.addToFolderOrder(newFolderPath, newName);
      await this.notifyOrderChanged();
      return;
    }

    const currentOrder = await this.getOrderForFolder(oldFolderPath);
    const index = currentOrder.indexOf(oldName);
    if (index === -1) return;

    currentOrder[index] = newName;
    await this.updateFolderOrder(oldFolderPath, currentOrder);
    await this.notifyOrderChanged();
  }

  async updateOrderOnFolderRename(oldPath: string, newPath: string): Promise<void> {
    const masterPath = this.settings.bookRootPath;
    if (!masterPath) return;
    if (!oldPath.startsWith(masterPath) || !newPath.startsWith(masterPath)) return;

    const oldName = oldPath.split('/').pop() || '';
    const newName = newPath.split('/').pop() || '';
    const oldParentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newParentPath = newPath.substring(0, newPath.lastIndexOf('/'));

    const wasVisible = !isHiddenFolderName(oldName);
    const isVisible = !isHiddenFolderName(newName);

    // Caso 1: visible → oculto
    if (wasVisible && !isVisible) {
      const currentOrder = await this.getOrderForFolder(oldParentPath);
      const index = currentOrder.indexOf(oldName);
      if (index !== -1) {
        currentOrder.splice(index, 1);
        await this.updateFolderOrder(oldParentPath, currentOrder);
      }
      await this.removeFolderFromStructure(oldParentPath, oldName);
      await this.notifyOrderChanged();
      return;
    }

    // Caso 2: oculto → visible
    if (!wasVisible && isVisible) {
      await this.addFolderToOrder(newParentPath, newName);
      await this.notifyOrderChanged();
      return;
    }

    // Caso 3: ambos ocultos
    if (!wasVisible && !isVisible) {
      return;
    }

    //  Caso 4: ambos visibles
    // Si cambió de padre
    if (oldParentPath !== newParentPath) {
      // Eliminar del padre origen
      const oldOrder = await this.getOrderForFolder(oldParentPath);
      const oldIndex = oldOrder.indexOf(oldName);
      if (oldIndex !== -1) {
        oldOrder.splice(oldIndex, 1);
        await this.updateFolderOrder(oldParentPath, oldOrder);
      }
      await this.removeFolderFromStructure(oldParentPath, oldName);

      // Añadir al nuevo padre
      await this.addFolderToOrder(newParentPath, newName);
      await this.notifyOrderChanged();
      return;
    }

    // Mismo padre: solo renombrar
    const currentOrder = await this.getOrderForFolder(oldParentPath);
    const index = currentOrder.indexOf(oldName);
    if (index === -1) return;

    // Renombrar hacia un nombre ignorado: se retira sin reincorporar
    // (ni en el orden ni en la estructura), igual que al eliminar.
    if (isIgnoredFolderName(newName, this.ignoredFolders())) {
      currentOrder.splice(index, 1);
      await this.updateFolderOrder(oldParentPath, currentOrder);

      const globalOrder = await this.repository.getGlobalOrder();
      if (globalOrder) {
        const parentData = this.repository.getFolderData(oldParentPath);
        if (parentData?.folders) {
          delete parentData.folders[oldName];
          await this.repository.saveGlobalOrder(masterPath, globalOrder);
        }
      }
      await this.notifyOrderChanged();
      return;
    }

    currentOrder[index] = newName;
    await this.updateFolderOrder(oldParentPath, currentOrder);

    const globalOrder = await this.repository.getGlobalOrder();
    if (globalOrder) {
      const parentData = this.repository.getFolderData(oldParentPath);
      if (parentData?.folders) {
        const folderContent = parentData.folders[oldName];
        delete parentData.folders[oldName];
        parentData.folders[newName] = folderContent;
        await this.repository.saveGlobalOrder(masterPath, globalOrder);
      }
    }
    await this.notifyOrderChanged();
  }

  async updateOrderOnDelete(filePath: string): Promise<void> {
    const masterPath = this.settings.bookRootPath;
    if (!masterPath) return;
    if (!filePath.startsWith(masterPath)) return;

    const fileName = filePath.split('/').pop() || '';
    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));

    if (isHiddenFolderName(fileName)) return;

    const currentOrder = await this.getOrderForFolder(folderPath);
    const index = currentOrder.indexOf(fileName);
    if (index === -1) return;

    currentOrder.splice(index, 1);
    await this.updateFolderOrder(folderPath, currentOrder);
    await this.notifyOrderChanged();
  }

  async updateOrderOnFolderDelete(folderPath: string): Promise<void> {
    const masterPath = this.settings.bookRootPath;
    if (!masterPath) return;
    if (!folderPath.startsWith(masterPath)) return;

    const folderName = folderPath.split('/').pop() || '';
    const parentPath = folderPath.substring(0, folderPath.lastIndexOf('/'));

    if (isHiddenFolderName(folderName)) return;

    const currentOrder = await this.getOrderForFolder(parentPath);
    const index = currentOrder.indexOf(folderName);
    if (index !== -1) {
      currentOrder.splice(index, 1);
      await this.updateFolderOrder(parentPath, currentOrder);
    }

    await this.removeFolderFromStructure(parentPath, folderName);
    await this.notifyOrderChanged();
  }

  async updateOrderOnCreate(filePath: string): Promise<void> {
    const masterPath = this.settings.bookRootPath;
    if (!masterPath) return;
    if (!filePath.startsWith(masterPath)) return;

    const fileName = filePath.split('/').pop() || '';
    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));

    if (isHiddenFolderName(fileName)) return;

    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder && fileName === `${folder.name}.md`) return;

    const currentOrder = await this.getOrderForFolder(folderPath);
    if (!currentOrder.includes(fileName)) {
      currentOrder.push(fileName);
      await this.updateFolderOrder(folderPath, currentOrder);
    }
    await this.notifyOrderChanged();
  }

  async updateOrderOnFolderCreate(folderPath: string): Promise<void> {
    const masterPath = this.settings.bookRootPath;
    if (!masterPath) return;
    if (!folderPath.startsWith(masterPath)) return;

    const folderName = folderPath.split('/').pop() || '';
    const parentPath = folderPath.substring(0, folderPath.lastIndexOf('/'));

    if (isHiddenFolderName(folderName)) return;

    await this.addFolderToOrder(parentPath, folderName);
    await this.notifyOrderChanged();
  }
}
