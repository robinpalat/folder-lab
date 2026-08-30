// ============================================================
// FILTER SERVICE
// ============================================================
// Lógica pura de filtrado usando estados semánticos.
// ============================================================

import { FilterOption } from '../models/FilterOption';
import { FolderLabItem } from '../models/FolderLabItem';
import { STATUSES } from '../constants/statuses';

export class FilterService {
  /**
   * Obtiene las opciones de filtro disponibles
   */
  getFilterOptions(): FilterOption[] {
    return [
      { id: null, label: 'Todas las notas', icon: 'list' },
      ...STATUSES.map(s => ({ 
        id: s.id, 
        label: s.label, 
        icon: s.icon 
      })),
      { id: '_empty', label: 'Notas vacías', icon: 'alert-circle' },
      { id: '_no-status', label: 'Sin estado', icon: 'more-vertical' }
    ];
  }

  /**
   * FUNCIÓN PURA - aplica filtro usando estados semánticos
   */
  applyFilter(items: FolderLabItem[], filterId: string | null): FolderLabItem[] {
    if (!filterId) return items;
    
    if (filterId === '_empty') {
      return items.filter(item => item.isEmpty);
    }
    
    if (filterId === '_no-status') {
      return items.filter(item => !item.status && !item.isEmpty);
    }
    
    // Filtrar por estado semántico (coincide exactamente)
    return items.filter(item => item.status === filterId);
  }

  /**
   * Obtiene la etiqueta de un filtro
   */
  getFilterLabel(filterId: string | null): string {
    if (!filterId) return 'Todas las notas';
    if (filterId === '_empty') return 'Notas vacías';
    if (filterId === '_no-status') return 'Sin estado';
    
    const found = STATUSES.find(s => s.id === filterId);
    return found?.label || filterId;
  }
}
