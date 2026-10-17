// src/config/settings.ts

export interface NavigationExclusionRule {
  /** Propiedad a evaluar (ej: 'nav_exclude', 'draft', 'published') */
  property: string;
  /** Valor que causa exclusión (opcional) */
  value?: string | boolean | number;
  /** Tipo de comparación: 'equals' (default), 'exists', 'not' */
  operator?: 'equals' | 'exists' | 'not';
}

export interface NavigationPropertyMapping {
  title: string;
  parent: string;
  order: string;
  hasChildren: string;
  permalink: string;
  /** Reglas de exclusión configurables */
  exclusions: NavigationExclusionRule[];
  /**
   * Nombres de carpetas excluidas de la iteración del orden
   * global (p. ej. carpetas técnicas como "assets"). Comparación
   * por nombre exacto, válida en cualquier nivel. Vacía por
   * defecto (= comportamiento anterior).
   */
  ignoredFolders: string[];
}

export const DEFAULT_JEKYLL_MAPPING: NavigationPropertyMapping = {
  title: 'title',
  parent: 'parent',
  order: 'nav_order',
  hasChildren: 'has_children',
  permalink: 'permalink',
  exclusions: [
    {
      property: 'nav_exclude',
      value: true,
      operator: 'equals'
    }
  ],
  ignoredFolders: []
};

export interface FolderOrderSettings {
  useManualOrder: boolean;
  useSimpleHiddenFile: boolean;
  autoUpdateOnRename: boolean;
  showNumbers: boolean;
  numberingStyle: 'roman' | 'arabic' | 'none';
  lastFolderPath: string;
  bookRootPath: string;
  lastOpenedNote: string;
  // IA
  aiProvider: "openai" | "gemini" | "anthropic" | "groq";
  aiApiKey: string;
  aiModel: string;
  aiUseRecommendedModel: boolean;
  aiTemperature: number;
  aiMaxTokens: number;
  // Navegación
  navigationType: 'folders' | 'properties';
  navigationPropertyMapping: NavigationPropertyMapping;
  /**
   * Meta de palabras del libro (carpeta master). 0 = sin meta.
   * Clave propia de ajustes: persiste con el mecanismo existente.
   * Solo el libro tiene meta; las subcarpetas no tienen ni meta
   * ni porcentaje propios.
   */
  bookWordGoal: number;
  /**
   * Estado privado del Asistente (fuentes/dominio/capacidad).
   * Clave persistida fuera de DEFAULT_SETTINGS (incluida en
   * ownedKeys de main.saveSettings); la forma es la real que
   * leen y escriben MemoryWidget.loadState/saveState (3E-1/W3).
   */
  _widgetState?: {
    sources?: string[];
    source?: string;
    domain?: string;
    capability?: string;
  };
}

export const DEFAULT_SETTINGS: FolderOrderSettings = {
  useManualOrder: true,
  useSimpleHiddenFile: true,
  autoUpdateOnRename: true,
  showNumbers: true,
  numberingStyle: 'roman',
  lastFolderPath: '',
  bookRootPath: '',
  lastOpenedNote: '',
  aiProvider: "openai",
  aiApiKey: "",
  aiModel: "",
  aiUseRecommendedModel: true,
  aiTemperature: 0.3,
  aiMaxTokens: 500,
  navigationType: 'folders',
  navigationPropertyMapping: DEFAULT_JEKYLL_MAPPING,
  bookWordGoal: 0
};
