// src/core/FolderLabState.ts

import { FolderOrderSettings } from '../config/settings';
import { FolderLabItem } from '../models/FolderLabItem';

export enum NavigationMode {
  NORMAL = 'normal',
  FOLDER_TREE = 'folder_tree',
  ALL_NOTES = 'all_notes',
  RECENT_NOTES = 'recent_notes'
}


export class FolderLabState {
  // ============================================================
  // MODOS DE VISUALIZACIÓN
  // ============================================================
  public navigationMode: NavigationMode = NavigationMode.NORMAL;
  public isFocusMode: boolean = false;
  public isMaximized: boolean = false;

  // ============================================================
  // NOTAS
  // ============================================================
  public currentNoteType: string = "general";
  public filesList: any[] = [];
  public currentNoteName: string = "";

  // ============================================================
  // LISTAS DE ITEMS
  // ============================================================
  public items: FolderLabItem[] = [];

  // ============================================================
  // FILTROS
  // ============================================================
  public activeFilter: string | null = null;

  // ============================================================
  // PROPIEDADES FOCUS
  // ============================================================
  public focusNotePath: string = "";
  public topPanelModule: string = "notes";
  public bottomPanelModule: string = "memory";
  public splitRatio: number = 50;

  // ============================================================
  // SETTINGS
  // ============================================================
  public settings: FolderOrderSettings;

  constructor(settings: FolderOrderSettings) {
    this.settings = settings;
  }

  // ============================================================
  // MÉTODOS DE NAVEGACIÓN
  // ============================================================

  /** Verifica si está en modo normal (carpeta específica) */
  isNormalMode(): boolean {
    return this.navigationMode === NavigationMode.NORMAL;
  }

  /** Verifica si está en modo "Todas las carpetas" */
  isFolderTreeMode(): boolean {
    return this.navigationMode === NavigationMode.FOLDER_TREE;
  }
  
	isRecentNotesMode(): boolean {
	  return this.navigationMode === NavigationMode.RECENT_NOTES;
	}
	
	setRecentNotesMode(): void {
  this.navigationMode = NavigationMode.RECENT_NOTES;
}


  /** Verifica si está en modo "Todas las notas" */
  isAllNotesMode(): boolean {
    return this.navigationMode === NavigationMode.ALL_NOTES;
  }

  /** Cambia al modo "Todas las carpetas" */
  setFolderTreeMode(): void {
    this.navigationMode = NavigationMode.FOLDER_TREE;
  }

  /** Cambia al modo "Todas las notas" */
  setAllNotesMode(): void {
    this.navigationMode = NavigationMode.ALL_NOTES;
  }

  /** Cambia al modo normal (carpeta específica) */
  setNormalMode(): void {
    this.navigationMode = NavigationMode.NORMAL;
  }

  /** Salir de cualquier modo global y volver a normal */
  exitGlobalModes(): void {
    this.navigationMode = NavigationMode.NORMAL;
  }
  
  // ============================================================
  // MÉTODOS DE RESET
  // ============================================================
  reset(): void {
    this.navigationMode = NavigationMode.NORMAL;
    this.isFocusMode = false;
    this.isMaximized = false;
    this.currentNoteType = "general";
    this.filesList = [];
    this.currentNoteName = "";
    this.activeFilter = null;
    this.items = [];
    this.focusNotePath = "";
    this.topPanelModule = "notes";
    this.bottomPanelModule = "resources";
    this.splitRatio = 50;
  }

  resetModes(): void {
    this.navigationMode = NavigationMode.NORMAL;
    this.isFocusMode = false;
  }

  // ============================================================
  // MÉTODOS DE MODO (legacy para compatibilidad)
  // ============================================================
  toggleFolderMode(): void {
    if (this.navigationMode === NavigationMode.FOLDER_TREE) {
      this.navigationMode = NavigationMode.NORMAL;
    } else {
      this.navigationMode = NavigationMode.FOLDER_TREE;
    }
  }

  toggleAllNotesMode(): void {
    if (this.navigationMode === NavigationMode.ALL_NOTES) {
      this.navigationMode = NavigationMode.NORMAL;
    } else {
      this.navigationMode = NavigationMode.ALL_NOTES;
    }
  }
  
  toggleRecentNotesMode(): void {
  if (this.navigationMode === NavigationMode.RECENT_NOTES) {
    this.navigationMode = NavigationMode.NORMAL;
  } else {
    this.navigationMode = NavigationMode.RECENT_NOTES;
  }
}

  toggleFocusMode(): void {
    this.isFocusMode = !this.isFocusMode;
  }

  toggleMaximized(): void {
    this.isMaximized = !this.isMaximized;
  }

  // ============================================================
  // MÉTODOS DE NOTAS
  // ============================================================
  setCurrentNote(noteName: string): void {
    this.currentNoteName = noteName;
    this.currentNoteType = noteName;
  }

  setGeneralNote(): void {
    this.currentNoteName = "general";
    this.currentNoteType = "general";
  }

  isGeneralNote(): boolean {
    return this.currentNoteType === "general";
  }

  // ============================================================
  // MÉTODOS FOCUS
  // ============================================================
  setFocusNote(path: string): void {
    this.focusNotePath = path;
  }

  getFocusNote(): string {
    return this.focusNotePath;
  }

  setTopPanelModule(module: string): void {
    this.topPanelModule = module;
  }

  setBottomPanelModule(module: string): void {
    this.bottomPanelModule = module;
  }

  setSplitRatio(ratio: number): void {
    this.splitRatio = Math.max(15, Math.min(85, ratio));
  }

  // ============================================================
  // MÉTODOS DE FILTRO
  // ============================================================
  setFilter(filter: string | null): void {
    this.activeFilter = filter;
  }

  clearFilter(): void {
    this.activeFilter = null;
  }

  hasActiveFilter(): boolean {
    return this.activeFilter !== null;
  }
}
