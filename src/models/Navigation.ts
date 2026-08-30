// src/models/Navigation.ts

export interface NavigationNode {
  /** Identificador único del nodo (para virtual folders y reales) */
  id: string;
  /** Ruta física del archivo (si existe) o ruta virtual */
  path: string;
  /** Título visible */
  title: string;
  /** Ruta del padre (null si es raíz) - SIEMPRE es un path real */
  parentPath: string | null;
  /** Orden entre hermanos */
  order?: number;
  /** Si es una carpeta o nota */
  type: 'folder' | 'note';
  /** Ruta completa del archivo físico asociado (si existe) */
  filePath: string | null;
  /** Hijos (se construye al armar el árbol) */
  children: NavigationNode[];
  /** Metadatos adicionales */
  metadata?: Record<string, unknown>;
  /** Si es un nodo virtual (creado por el provider) */
  isVirtual?: boolean;
}

export interface NavigationTree {
  root: NavigationNode[];
  nodeMap: Map<string, NavigationNode>;
  flatNodes: NavigationNode[];
}

export interface NavigationProvider {
  readonly id: string;
  readonly name: string;
  build(): Promise<NavigationTree>;
  refresh(): Promise<NavigationTree>;
  getNode(path: string): Promise<NavigationNode | null>;
  getParent(path: string): string | null;
  canGoBack(path: string): boolean;
}

export type NavigationType = 'folders' | 'properties';
