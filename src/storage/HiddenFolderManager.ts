// ============================================================
// STORAGE: HiddenFolderManager
// ============================================================
// Gestión de carpeta oculta usando Vault.adapter
// API pública idéntica
// ============================================================

import { App } from 'obsidian';
import { INTERNAL_FOLDER } from '../constants/view-types';

export class HiddenFolderManager {
  private app: App;
  private folderName: string;

  constructor(app: App, folderName: string = INTERNAL_FOLDER) {
    this.app = app;
    this.folderName = folderName;
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

  getHiddenFolderPath(folderPath: string): string {
    // Raíz del vault ('' tras normalizar) no produce barra inicial.
    const base = (folderPath ?? '').replace(/^\/+|\/+$/g, "");
    return base ? `${base}/${this.folderName}` : this.folderName;
  }

  private getFilePath(folderPath: string, fileName: string): string {
    return `${this.getHiddenFolderPath(folderPath)}/${fileName}`;
  }

  // ============================================================
  // CARPETA OCULTA
  // ============================================================

  /**
   * Asegura que la carpeta oculta existe
   * Usa Vault.adapter para evitar TFile
   */
  async ensureHiddenFolder(folderPath: string): Promise<void> {
    const hiddenPath = this.getHiddenFolderPath(folderPath);
    const exists = await this.app.vault.adapter.exists(hiddenPath);
    if (exists) return;
    await this.app.vault.adapter.mkdir(hiddenPath);
  }

  /**
   * Verifica si un archivo existe
   * Usa Vault.adapter para evitar TFile
   */
  async exists(folderPath: string, fileName: string): Promise<boolean> {
    const filePath = this.getFilePath(folderPath, fileName);
    return await this.app.vault.adapter.exists(filePath);
  }

  /**
   * Lista los archivos en la carpeta oculta
   * Usa Vault.adapter para evitar TFile/TFolder
   */
  async list(folderPath: string): Promise<string[]> {
    const hiddenPath = this.getHiddenFolderPath(folderPath);
    try {
      const exists = await this.app.vault.adapter.exists(hiddenPath);
      if (!exists) return [];
      const result = await this.app.vault.adapter.list(hiddenPath);
      return result.files || [];
    } catch {
      return [];
    }
  }

  // ============================================================
  // LECTURA/ESCRITURA DE ARCHIVOS
  // ============================================================

  /**
   * Lee un archivo de la carpeta oculta.
   * Usa Vault.adapter para evitar TFile.
   *
   * Contrato (P0-1): `null` significa EXCLUSIVAMENTE «el archivo
   * no existe». Un fallo de lectura propaga el error: convertirlo
   * en `null` hacía que los repositorios trataran el error como
   * «almacén vacío» y el siguiente guardado sobrescribiera el
   * archivo completo, perdiendo las entradas de otras notas.
   */
  async readFile(folderPath: string, fileName: string): Promise<string | null> {
    const filePath = this.getFilePath(folderPath, fileName);
    const exists = await this.app.vault.adapter.exists(filePath);
    if (!exists) return null;
    return await this.app.vault.adapter.read(filePath);
  }

  /**
   * Escribe un archivo en la carpeta oculta
   * Usa Vault.adapter para evitar TFile
   */
  async writeFile(folderPath: string, fileName: string, content: string): Promise<void> {
    const filePath = this.getFilePath(folderPath, fileName);
    await this.ensureHiddenFolder(folderPath);
    await this.app.vault.adapter.write(filePath, content);
  }

  /**
   * Elimina un archivo de la carpeta oculta
   * Usa Vault.adapter para evitar TFile
   */
  async deleteFile(folderPath: string, fileName: string): Promise<void> {
    const filePath = this.getFilePath(folderPath, fileName);
    try {
      const exists = await this.app.vault.adapter.exists(filePath);
      if (exists) {
        await this.app.vault.adapter.remove(filePath);
      }
    } catch {
      // Silencioso
    }
  }

  /**
   * Lee un archivo y devuelve su contenido (alias de readFile)
   */
  async getFileContent(folderPath: string, fileName: string): Promise<string | null> {
    return await this.readFile(folderPath, fileName);
  }

  // ============================================================
  // LECTURA/ESCRITURA JSON
  // ============================================================

  /**
   * Lee un archivo JSON de la carpeta oculta.
   *
   * Contrato (P0-1): `null` solo cuando el archivo no existe.
   * JSON inválido o ilegible lanza error: un parse fallido no
   * equivale a un almacén vacío.
   */
  async readJSON<T>(folderPath: string, fileName: string): Promise<T | null> {
    const content = await this.readFile(folderPath, fileName);
    if (content === null) return null;
    try {
      return JSON.parse(content) as T;
    } catch {
      throw new Error(
        `[HiddenFolderManager] JSON inválido en "${this.getFilePath(folderPath, fileName)}"`
      );
    }
  }

  /**
   * Escribe un archivo JSON en la carpeta oculta
   */
  async writeJSON<T>(folderPath: string, fileName: string, data: T): Promise<void> {
    await this.writeFile(folderPath, fileName, JSON.stringify(data, null, 2));
  }
}
