/**
 * Opción de filtro para el menú de filtrado por iconos
 */
export interface FilterOption {
  /** Identificador del filtro (null = "Todas las notas") */
  id: string | null;
  
  /** Etiqueta mostrada al usuario */
  label: string;
  
  /** Icono a mostrar junto a la opción */
  icon: string;
  
  /** Contador de notas que coinciden con el filtro (opcional) */
  count?: number;
}
