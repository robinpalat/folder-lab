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
  public filesList: unknown[] = [];
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
  const prev = this.navigationMode;
  this.navigationMode = NavigationMode.RECENT_NOTES;
  FolderLabState.traceModeTransition('setRecentNotesMode', prev, this.navigationMode);
}


  /** Verifica si está en modo "Todas las notas" */
  isAllNotesMode(): boolean {
    return this.navigationMode === NavigationMode.ALL_NOTES;
  }

  /** Cambia al modo "Todas las carpetas" */
  setFolderTreeMode(): void {
    const prev = this.navigationMode;
    this.navigationMode = NavigationMode.FOLDER_TREE;
    FolderLabState.traceModeTransition('setFolderTreeMode', prev, this.navigationMode);
  }

  /** Cambia al modo "Todas las notas" */
  setAllNotesMode(): void {
    const prev = this.navigationMode;
    this.navigationMode = NavigationMode.ALL_NOTES;
    FolderLabState.traceModeTransition('setAllNotesMode', prev, this.navigationMode);
  }

  /** Cambia al modo normal (carpeta específica) */
  setNormalMode(): void {
    const prev = this.navigationMode;
    this.navigationMode = NavigationMode.NORMAL;
    FolderLabState.traceModeTransition('setNormalMode', prev, this.navigationMode);
  }

  /** Salir de cualquier modo global y volver a normal */
  exitGlobalModes(): void {
    const prev = this.navigationMode;
    this.navigationMode = NavigationMode.NORMAL;
    FolderLabState.traceModeTransition('exitGlobalModes', prev, this.navigationMode);
  }
  
  // ============================================================
  // MÉTODOS DE RESET
  // ============================================================

  /**
   * TRAZA TEMPORAL DE INVESTIGACIÓN (no cambia comportamiento):
   * registra toda transición de navigationMode con pila.
   */
  private static traceModeTransition(
    _caller: string,
    _anterior: NavigationMode,
    _nuevo: NavigationMode,
    _motivo?: string
  ): void {
      }

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
    FolderLabState.traceModeTransition('reset', this.navigationMode, this.navigationMode, 'reset completo de estado');
    this.topPanelModule = "notes";
    this.bottomPanelModule = "resources";
    this.splitRatio = 50;
  }

  resetModes(): void {
    const prev = this.navigationMode;
    this.navigationMode = NavigationMode.NORMAL;
    this.isFocusMode = false;
    FolderLabState.traceModeTransition('resetModes', prev, this.navigationMode);
  }

  // ============================================================
  // MÉTODOS DE MODO (legacy para compatibilidad)
  // ============================================================
  toggleFolderMode(): void {
    const prev = this.navigationMode;
    if (this.navigationMode === NavigationMode.FOLDER_TREE) {
      this.navigationMode = NavigationMode.NORMAL;
    } else {
      this.navigationMode = NavigationMode.FOLDER_TREE;
    }
    FolderLabState.traceModeTransition('toggleFolderMode', prev, this.navigationMode);
  }

  toggleAllNotesMode(): void {
    const prev = this.navigationMode;
    if (this.navigationMode === NavigationMode.ALL_NOTES) {
      this.navigationMode = NavigationMode.NORMAL;
    } else {
      this.navigationMode = NavigationMode.ALL_NOTES;
    }
    FolderLabState.traceModeTransition('toggleAllNotesMode', prev, this.navigationMode);
  }
  
  toggleRecentNotesMode(): void {
  const prev = this.navigationMode;
  if (this.navigationMode === NavigationMode.RECENT_NOTES) {
    this.navigationMode = NavigationMode.NORMAL;
  } else {
    this.navigationMode = NavigationMode.RECENT_NOTES;
  }
  FolderLabState.traceModeTransition('toggleRecentNotesMode', prev, this.navigationMode);
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
