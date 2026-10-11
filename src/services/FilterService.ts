// ============================================================
// FILTER SERVICE
// ============================================================
// Lógica pura de filtrado usando estados semánticos.
// ============================================================

import { FilterOption } from '../models/FilterOption';
import { FolderLabItem } from '../models/FolderLabItem';
import { STATUSES } from '../constants/statuses';
import { i18n } from '../i18n/I18nService';

export class FilterService {
  /**
   * Obtiene las opciones de filtro disponibles
   */
  getFilterOptions(): FilterOption[] {
    return [
      { id: null, label: i18n.t('filters.all'), icon: 'list' },
      ...STATUSES.map(s => ({ 
        id: s.id, 
        label: s.label, 
        icon: s.icon 
      })),
      { id: '_empty', label: i18n.t('filters.empty'), icon: 'alert-circle' },
      { id: '_no-status', label: i18n.t('filters.noStatus'), icon: 'more-vertical' }
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
    if (!filterId) return i18n.t('filters.all');
    if (filterId === '_empty') return i18n.t('filters.empty');
    if (filterId === '_no-status') return i18n.t('filters.noStatus');
    
    const found = STATUSES.find(s => s.id === filterId);
    return found?.label || filterId;
  }
}
