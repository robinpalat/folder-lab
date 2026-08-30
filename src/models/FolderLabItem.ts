// src/models/FolderLabItem.ts

import { TFile } from 'obsidian';

/**
 * Representa un elemento en el índice del panel Folder Lab
 * Puede ser una nota normal, la nota especial (compilada), o una carpeta virtual
 */
export interface FolderLabItem {
  /** Nombre del archivo (ej: 'Introducción.md') o título de carpeta virtual */
  name: string;
  
  /** Ruta completa del archivo o identificador del nodo virtual */
  path: string;
  
  /** Indica si es la nota especial (compilada) */
  isSpecial: boolean;
  
  /** Indica que la nota es la página propia del nodo de navegación */
  isOwnPage?: boolean;
  
  /** Referencia al archivo en Obsidian (null para carpetas virtuales) */
  file: TFile | null;
  
  /** Estado de la nota (extraído del frontmatter) */
  status?: string;
  
  /** Si la nota está vacía (sin contenido significativo) */
  isEmpty?: boolean;
}
