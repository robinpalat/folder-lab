// ============================================================
// SERVICES: NavigationService
// ============================================================

import { App, Events } from 'obsidian';
import { FolderRepository } from '../storage/FolderRepository';
import { normalizeRootPath } from '../utils/rootPath';
import { NavigationTree, NavigationNode, NavigationProvider, NavigationType } from '../models/Navigation';
import { FolderNavigationProvider } from './navigation/FolderNavigationProvider';
import { PropertyNavigationProvider } from './navigation/PropertyNavigationProvider';
import { FolderOrderSettings } from '../config/settings';

export class NavigationService {
  private app: App;
  private repository: FolderRepository;
  private settings: FolderOrderSettings;
  private masterPath: string | null = null;
  private currentPath: string | null = null;
  private provider: NavigationProvider | null = null;
  private currentTree: NavigationTree | null = null;
  private isBuilding: boolean = false;
  private isInitialized: boolean = false;

  private boundHandleOrderChanged = this.handleOrderChanged.bind(this);

  constructor(app: App, repository: FolderRepository, settings: FolderOrderSettings) {
    this.app = app;
    this.repository = repository;
    this.settings = settings;
  }

  // ============================================================
  // CONFIGURACIÓN
  // ============================================================

  setMasterPath(path: string): void {
    // Normalización (corrección de iconos de estado): la ruta del
    // Master se compara con file.parent.path (siempre limpia); una
    // barra inicial/final en los ajustes partía los estados en dos
    // cubetas del almacén central.
    this.masterPath = normalizeRootPath(path);
  }

  getMasterPath(): string | null {
    return this.masterPath;
  }

  // ============================================================
  // INICIALIZACIÓN
  // ============================================================

  async initialize(): Promise<void> {
    const navType = this.settings.navigationType || 'folders';
    this.provider = this.selectProvider(navType);
    
    if (this.provider) {
      await this.build();
    }
    
    this.isInitialized = true;
    
    (this.app.workspace as unknown as Events).on('folder-lab:order-changed', this.boundHandleOrderChanged);
  }

  private selectProvider(type: NavigationType): NavigationProvider {
    switch (type) {
      case 'properties':
        return new PropertyNavigationProvider(this.app, this.settings.navigationPropertyMapping);
      case 'folders':
      default:
        return new FolderNavigationProvider(this.app, this.repository);
    }
  }

  // ============================================================
  // MANEJADOR DE EVENTOS
  // ============================================================

  private async handleOrderChanged(): Promise<void> {
    if (!this.isInitialized || !this.provider) {
            return;
    }
    
    try {
      await this.refresh();
      (this.app.workspace as unknown as Events).trigger('folder-lab:navigation-tree-changed');
    } catch (error) {
      console.error('[NAVIGATION] Error al refrescar árbol:', error);
    }
  }

  // ============================================================
  // NAVEGACIÓN — MÉTODOS UNIFICADOS
  // ============================================================

  /**
   * Obtiene el padre de un nodo por su identificador (path o ID)
   * @param path Identificador del nodo (path físico para folders, ID virtual para properties)
   * @returns Path/ID del padre o null si no tiene
   */
  getParent(path: string): string | null {
    if (!this.provider) return null;
    return this.provider.getParent(path);
  }

  /**
   * Verifica si un nodo tiene padre
   * @param path Identificador del nodo
   * @returns true si tiene padre, false si es raíz o no existe
   */
	canGoBack(path: string): boolean {
	  if (!this.provider) return false;
	  return this.provider.canGoBack(path);
	}

  navigateTo(folderPath: string): void {
    // '' es la raíz del vault (Master en la raíz): navegación válida.
    if (folderPath === null || folderPath === undefined) return;
    this.currentPath = folderPath;
  }

  getCurrentPath(): string | null {
    return this.currentPath;
  }

  // ============================================================
  // CONSTRUCCIÓN DE ÁRBOL
  // ============================================================

  async build(): Promise<NavigationTree> {
    if (!this.provider) {
      throw new Error('No hay provider seleccionado');
    }

    this.isBuilding = true;
    try {
      this.currentTree = await this.provider.build();
      return this.currentTree;
    } finally {
      this.isBuilding = false;
    }
  }

  async refresh(): Promise<NavigationTree> {
    if (!this.provider) {
      throw new Error('No hay provider seleccionado');
    }
    this.currentTree = await this.provider.refresh();
    return this.currentTree;
  }

  // ============================================================
  // CONSULTAS
  // ============================================================

  getTree(): NavigationTree | null {
    return this.currentTree;
  }

  getRootNodes(): NavigationNode[] {
    return this.currentTree?.root || [];
  }

  async getNode(path: string): Promise<NavigationNode | null> {
    if (!this.provider) return null;
    return this.provider.getNode(path);
  }

  getNavigationType(): NavigationType {
    return this.settings.navigationType || 'folders';
  }

  isBuildingNavigation(): boolean {
    return this.isBuilding;
  }

  getProvider(): NavigationProvider | null {
    return this.provider;
  }

  // ============================================================
  // CAMBIO DE TIPO DE NAVEGACIÓN
  // ============================================================

  async setNavigationType(type: NavigationType): Promise<void> {
    this.settings.navigationType = type;
    this.provider = this.selectProvider(type);
    
            await this.build();
  }
}
