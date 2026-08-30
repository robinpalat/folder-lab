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
  ]
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
  aiProvider: "openai" | "gemini" | "anthropic";
  aiApiKey: string;
  aiModel: string;
  aiUseRecommendedModel: boolean;
  aiTemperature: number;
  aiMaxTokens: number;
  // Navegación
  navigationType: 'folders' | 'properties';
  navigationPropertyMapping: NavigationPropertyMapping;
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
  navigationPropertyMapping: DEFAULT_JEKYLL_MAPPING
};
