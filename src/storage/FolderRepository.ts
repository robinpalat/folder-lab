// ============================================================
// STORAGE: FolderRepository
// ============================================================
// Propietario único del árbol JSON.
// ============================================================

import { App, Notice, TFolder, TFile } from 'obsidian';
import { HiddenFolderManager } from './HiddenFolderManager';
import { INTERNAL_FOLDER, ORDER_FILE } from '../constants/view-types';
import { isHiddenFolderName, isIgnoredFolderName } from '../utils/folderUtils';
import { i18n } from '../i18n/I18nService';


export interface FolderOrderData {
  order: string[];
  folders?: Record<string, FolderOrderData>;
}

export interface GlobalOrderData {
  root: FolderOrderData;
  version?: number;
}

/**
 * Forma del archivo vista por el mutador de notas particulares.
 * En la carpeta master el fichero es el orden global (con sus
 * claves extra: root, version, notes…); en subcarpetas es el
 * formato legado { order, notes }.
 */
export interface FolderLabFileData {
  order?: string[];
  notes?: Record<string, string>;
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class FolderRepository {
  private app: App;
  private hiddenManager: HiddenFolderManager;
  private globalOrderData: GlobalOrderData | null = null;
  private parentIndex: Map<string, string> | null = null;
  private masterPath: string | null = null;

  /*
   * 3A: cola FIFO única por instancia sobre TODAS las
   * escrituras del archivo _folder_order.json (orden global y
   * notas particulares). Mismo mecanismo que PluginDataStore:
   * cada lectura-modificación-escritura se ejecuta completa
   * antes de que empiece la siguiente, y un fallo no bloquea la
   * cola. Ambos escritores (orden y notes) comparten esta cola:
   * es lo que impide que una reordenación pise notas escritas
   * en el mismo fichero y viceversa.
   */
  private tail: Promise<void> = Promise.resolve();

  constructor(app: App) {
    this.app = app;
    this.hiddenManager = new HiddenFolderManager(app, INTERNAL_FOLDER);
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.tail.then(op, op);

    // La cadena continúa aunque la operación falle.
    this.tail = result.then(() => {}, () => {});

    return result;
  }

  // ============================================================
  // LECTURA/ESCRITURA RAW DEL FICHERO (solo dentro de la cola)
  // ============================================================

  /**
   * Lee el orden global DISTRIBUYENDO los fallos (3A):
   * - Ausente → null (regeneración legítima).
   * - Error de lectura o JSON inválido → lanza (NUNCA null:
   *   null ya no significa «ilegible»).
   * - Forma incorrecta (root/order ausentes o inválidos) → lanza.
   */
  private async readGlobalFile(
    masterPath: string
  ): Promise<GlobalOrderData | null> {
    const data = await this.hiddenManager.readJSON<unknown>(
      masterPath,
      ORDER_FILE
    );

    if (data === null) {
      return null;
    }

    if (
      !isPlainObject(data) ||
      !isPlainObject(data.root) ||
      !Array.isArray(data.root.order)
    ) {
      throw new Error(
        `[FolderRepository] _folder_order.json de "${masterPath || '/'}" no tiene la forma esperada`
      );
    }

    return data as unknown as GlobalOrderData;
  }

  private async writeGlobalFile(
    masterPath: string,
    data: GlobalOrderData
  ): Promise<void> {
    await this.hiddenManager.writeJSON(masterPath, ORDER_FILE, data);
  }

  private commitGlobal(data: GlobalOrderData): void {
    this.globalOrderData = data;
    this.buildParentIndex();
  }

  // ============================================================
  // CARGA Y GUARDADO
  // ============================================================

  async loadGlobalOrder(masterPath: string): Promise<GlobalOrderData | null> {
    this.masterPath = masterPath;
    if (this.globalOrderData) return this.globalOrderData;

    return this.enqueue(async () => {
      // Otra operación encolada pudo cargar mientras esperábamos.
      if (this.globalOrderData) return this.globalOrderData;

      const data = await this.readGlobalFile(masterPath);

      if (data) {
        this.commitGlobal(data);
      }

      return data;
    });
  }

  /**
   * Guarda el orden global COINCIDIENDO con el contenido actual
   * del fichero: las claves ajenas al árbol (p. ej. `notes`
   * escritas por NoteService sobre la misma ruta) se preservan
   * desde la lectura fresca; solo root/version se reemplazan.
   */
  saveGlobalOrder(masterPath: string, data: GlobalOrderData): Promise<void> {
    return this.enqueue(async () => {
      this.masterPath = masterPath;

      let fresh: GlobalOrderData | null = null;
      try {
        fresh = await this.readGlobalFile(masterPath);
      } catch (error) {
        // Fichero ilegible: escribir la caché encima destruiría
        // datos no recuperables. Abortar de forma visible.
        console.error(
          '[FolderRepository] No se pudo leer _folder_order.json; guardado abortado:',
          error
        );
        new Notice(i18n.t('errors.folderOrderCorrupt'));
        return;
      }

      /*
       * Solo root/version provienen del objeto guardado; el
       * resto de claves (notes y cualesquiera otras) se toman
       * del contenido FRESCO del disco para no pisar datos
       * escritos por otra ruta después de la carga en caché.
       */
      const merged = {
        ...(fresh ?? {}),
        root: data.root,
        version: data.version ?? fresh?.version
      } as GlobalOrderData;

      await this.writeGlobalFile(masterPath, merged);
      this.commitGlobal(merged);
    });
  }

  /**
   * Inicializa el orden global SOLO si el archivo no existe.
   * Error de lectura/JSON inválido/forma incorrecta → propaga y
   * NO escribe (3A: la regeneración jamás sobrescribe datos).
   */
  initGlobalOrder(masterPath: string, ignoredFolders: string[] = []): Promise<void> {
    return this.enqueue(() => this.initGlobalOrderRaw(masterPath, ignoredFolders));
  }

  private async initGlobalOrderRaw(
    masterPath: string,
    ignoredFolders: string[]
  ): Promise<void> {
    this.masterPath = masterPath;

    const existing = await this.readGlobalFile(masterPath);
    if (existing) {
      this.commitGlobal(existing);
      return;
    }

    let rootOrder: FolderOrderData;

    if (masterPath === '') {
      // El propio vault es un master válido.
      rootOrder = await this.buildOrderFromFolder(this.app.vault.getRoot(), ignoredFolders);
    } else {
      const masterFolder = this.app.vault.getAbstractFileByPath(masterPath);
      if (!(masterFolder instanceof TFolder)) return;
      rootOrder = await this.buildOrderFromFolder(masterFolder, ignoredFolders);
    }

    const data: GlobalOrderData = { root: rootOrder, version: 1 };
    await this.writeGlobalFile(masterPath, data);
    this.commitGlobal(data);
  }

  /**
   * Reconcilia el orden global existente con el filesystem actual
   * aplicando una lista de carpetas ignoradas (p. ej. tras cambiar
   * la configuración), SIN regenerar desde cero:
   *
   * - conserva el orden relativo de notas y carpetas supervivientes;
   * - elimina las ramas que ahora están ignoradas (con todos sus
   *   descendientes) o que ya no existen en disco;
   * - incorpora los elementos elegibles nuevos al final, sin
   *   reordenar los existentes;
   * - conserva la clave `notes` y cualquier otro dato del archivo.
   *
   * Archivo ausente → inicializa. Error de lectura → propaga sin
   * escribir. Devuelve true si el archivo cambió (y se guardó).
   */
  reconcileGlobalOrder(
    masterPath: string,
    ignoredFolders: string[] = []
  ): Promise<boolean> {
    return this.enqueue(() =>
      this.reconcileGlobalOrderRaw(masterPath, ignoredFolders)
    );
  }

  private async reconcileGlobalOrderRaw(
    masterPath: string,
    ignoredFolders: string[]
  ): Promise<boolean> {
    const existing = await this.readGlobalFile(masterPath);

    if (!existing) {
      await this.initGlobalOrderRaw(masterPath, ignoredFolders);
      return true;
    }

    let freshRoot: FolderOrderData;

    if (masterPath === '') {
      freshRoot = await this.buildOrderFromFolder(
        this.app.vault.getRoot(),
        ignoredFolders
      );
    } else {
      const masterFolder =
        this.app.vault.getAbstractFileByPath(masterPath);

      if (!(masterFolder instanceof TFolder)) return false;

      freshRoot = await this.buildOrderFromFolder(
        masterFolder,
        ignoredFolders
      );
    }

    const merged = this.mergeOrderNode(existing.root, freshRoot);

    if (
      JSON.stringify(merged) ===
      JSON.stringify(existing.root)
    ) {
      this.commitGlobal(existing);
      return false;
    }

    existing.root = merged;
    await this.writeGlobalFile(masterPath, existing);
    this.commitGlobal(existing);
    return true;
  }

  private mergeOrderNode(
    existing: FolderOrderData | undefined,
    fresh: FolderOrderData
  ): FolderOrderData {
    const freshOrder: string[] = Array.isArray(fresh.order)
      ? fresh.order
      : [];

    const freshSet = new Set(freshOrder);

    const existingOrder: string[] = Array.isArray(existing?.order)
      ? existing.order
      : [];

    // Supervivientes en su orden relativo (caen ignoradas y ausentes)
    const merged: string[] = existingOrder.filter((name) =>
      freshSet.has(name)
    );

    // Elegibles nuevos al final, en el orden del recorrido fresco
    for (const name of freshOrder) {
      if (!merged.includes(name)) {
        merged.push(name);
      }
    }

    const freshFolders: Record<string, FolderOrderData> =
      fresh.folders ?? {};
    const existingFolders: Record<string, FolderOrderData> =
      existing?.folders ?? {};

    const mergedFolders: Record<string, FolderOrderData> = {};

    for (const name of Object.keys(freshFolders)) {
      mergedFolders[name] = this.mergeOrderNode(
        existingFolders[name],
        freshFolders[name]
      );
    }

    return { order: merged, folders: mergedFolders };
  }

  private async buildOrderFromFolder(folder: TFolder, ignoredFolders: string[] = []): Promise<FolderOrderData> {
    const orderData: FolderOrderData = { order: [], folders: {} };

    const subfolders: TFolder[] = [];
    const notes: TFile[] = [];

    for (const child of folder.children) {
      if (child instanceof TFolder) {
        // Excluir carpetas ocultas y las de la lista configurable
        // (estas últimas, con todos sus descendientes).
        if (!isIgnoredFolderName(child.name, ignoredFolders)) {
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
      orderData.folders![subfolder.name] = await this.buildOrderFromFolder(subfolder, ignoredFolders);
    }

    for (const note of notes) {
      orderData.order.push(note.name);
    }

    return orderData;
  }

  // ============================================================
  // COMPATIBILIDAD CON SERVICIOS EXISTENTES
  // ============================================================

  /**
   * Lectura del fichero de una carpeta (formato legado o global).
   * Solo para consultas: ausente → { order: [] }; error → también
   * degradación a { order: [] } (lectura sin escrituras, contrato
   * histórico de UI). Las ESCRITURAS deben usar transactFolderLab.
   */
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

  /**
   * 3A: RMW completo y serializado sobre el fichero de una
   * carpeta (única vía de escritura del formato legado/notas).
   * El mutador recibe el contenido FRESCO del disco —incluida la
   * subclave `notes` y, en la carpeta master, el árbol global— y
   * puede modificarlo; la escritura se produce al terminar. Si el
   * mutador devuelve `false`, no se escribe. Error de lectura o
   * forma inválida → propaga y NO se escribe.
   *
   * Comparte la cola con el orden global: una reordenación no
   * puede pisar notas escritas por esta vía ni al revés.
   */
  transactFolderLab<T>(
    folderPath: string,
    mutator: (data: FolderLabFileData) => T
  ): Promise<T> {
    return this.enqueue(async () => {
      let data: FolderLabFileData | null = null;

      try {
        data = await this.hiddenManager.readJSON<FolderLabFileData>(
          folderPath,
          ORDER_FILE
        );
      } catch (error) {
        // JSON corrupto o ilegible: abortar la escritura para no
        // sustituir el fichero por un estado inventado.
        console.error(
          `[FolderRepository] No se pudo leer _folder_order.json de "${folderPath}"; escritura abortada:`,
          error
        );
        throw error;
      }

      if (data === null) {
        data = { order: [] };
      }

      if (!isPlainObject(data)) {
        throw new Error(
          `[FolderRepository] _folder_order.json de "${folderPath || '/'}" no tiene la forma esperada`
        );
      }

      const result = mutator(data);

      if (result !== false) {
        await this.hiddenManager.writeJSON(folderPath, ORDER_FILE, data);

        // Si el fichero tocado ES el maestro, refrescar la caché
        // del orden global (el mutador pudo alterar notes u otras
        // claves, nunca el árbol de forma controlada).
        if (folderPath === this.masterPath) {
          this.globalOrderData = data as unknown as GlobalOrderData;
          this.buildParentIndex();
        }
      }

      return result;
    });
  }

  // ============================================================
  // CONSULTAS DE ORDEN
  // ============================================================

  async getFolderOrder(folderPath: string, masterPath: string): Promise<string[] | null> {
    if (!this.globalOrderData) {
      // Solo lectura: un fichero ilegible degrada a «sin orden»
      // sin escribir nada (la escritura fallida ya es visible en
      // updateFolderOrder/transactFolderLab).
      try {
        await this.loadGlobalOrder(masterPath);
      } catch (error) {
        console.error(
          '[FolderRepository] No se pudo cargar el orden global:',
          error
        );
        return null;
      }
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

  /**
   * 3A: RMW serializado con lectura FRESCA del fichero. La
   * reordenación se aplica sobre el contenido actual de disco
   * (incluida `notes` escrita por NoteService), nunca sobre una
   * caché obsoleta. Archivo ilegible → visible y SIN escritura;
   * archivo ausente → no-op (contrato histórico).
   */
  updateFolderOrder(folderPath: string, masterPath: string, order: string[]): Promise<void> {
    return this.enqueue(async () => {
      this.masterPath = masterPath;

      let current: GlobalOrderData | null;
      try {
        current = await this.readGlobalFile(masterPath);
      } catch (error) {
        console.error(
          '[FolderRepository] No se pudo leer _folder_order.json; reordenación abortada:',
          error
        );
        new Notice(i18n.t('errors.folderOrderCorrupt'));
        return;
      }

      if (!current) {
        return;
      }

      if (folderPath === masterPath) {
        current.root.order = order;
      } else {
        const relativePath = folderPath.replace(masterPath, '').split('/').filter(Boolean);
        let node: FolderOrderData = current.root;

        for (let i = 0; i < relativePath.length; i++) {
          const segment = relativePath[i];

          if (!node.folders) node.folders = {};
          if (!node.folders[segment]) {
            node.folders[segment] = { order: [], folders: {} };
          }

          if (i === relativePath.length - 1) {
            node.folders[segment].order = order;
          } else {
            node = node.folders[segment];
          }
        }
      }

      await this.writeGlobalFile(masterPath, current);
      this.commitGlobal(current);
    });
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
        const file = this.app.vault.getAbstractFileByPath(filePath);
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
