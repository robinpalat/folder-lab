import { Resource } from './Resource';

/**
 * Datos completos de una nota almacenados en `_folder_order.json`
 */
export interface NoteData {
  /** Contenido del apunte particular de la nota */
  content: string;
  
  /** Recursos asociados a la nota (links, videos, referencias) */
  resources: Resource[];
  
  /** Estado de la nota (para el filtro) */
  status?: string;
}

/**
 * Datos del orden guardado en `_folder_order.json`
 */
export interface FolderOrderData {
  /** Lista de nombres de archivos en orden manual */
  order: string[];
  
  /** Datos de cada nota (apuntes y recursos) */
  notes: Record<string, NoteData>;
  
  /** Contenido de la Nota General */
  folderNote?: string;
  
  /** Versión del formato */
  version?: string;
  
  /** Última fecha de modificación */
  lastModified?: string;
}
