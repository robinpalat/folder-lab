/**
 * Tipos de recursos soportados
 */
export type ResourceType = 'link' | 'video' | 'reference' | 'file' | 'note' | 'image';

/**
 * Recurso asociado a una nota
 */
export interface Resource {
  /** Identificador único del recurso (opcional para guardado) */
  id?: string;
  
  /** Tipo de recurso */
  type: ResourceType;
  
  /** Valor del recurso (URL, texto, ruta, etc.) */
  value: string;
  
  /** Título descriptivo (extraído automáticamente o manual) */
  title?: string;
  
  /** URL de miniatura (para videos o imágenes) */
  thumbnail?: string;
  
  /** Icono para mostrar (según tipo) */
  icon?: string;
}
