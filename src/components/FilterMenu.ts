// ============================================================
// COMPONENTE: FilterMenu
// ============================================================
// Construye y muestra el menú de filtros. NO modifica estado.
// ============================================================

import { Menu } from 'obsidian';
import { FolderLabController } from '../core/FolderLabController';
import { FilterService } from '../services/FilterService';
import { i18n } from '../i18n/I18nService';

export class FilterMenu {
  private controller: FolderLabController;
  private filterService: FilterService;

  constructor(controller: FolderLabController, filterService: FilterService) {
    this.controller = controller;
    this.filterService = filterService;
  }

  /**
   * Muestra el menú de filtros en la posición del botón
   */
  show(button: HTMLElement): void {
    const menu = new Menu();
    const options = this.filterService.getFilterOptions();
    const currentFilter = this.controller.getActiveFilter();

    for (const option of options) {
      const isActive = currentFilter === option.id;
      menu.addItem((item) => {
        // Usar setChecked en lugar de prefijo ✓
        if (isActive) {
          item.setChecked(true);
        }

        item.setTitle(option.label)
          .setIcon(option.icon)
          .onClick(() => {
            // Solo disparar la acción, no modificar estado directamente
            this.controller.applyFilter(option.id);
          });
      });
    }

    // Si hay un filtro activo, mostrar opción para limpiar
    if (currentFilter !== null) {
      menu.addSeparator();
      menu.addItem((item) => {
        item.setTitle(i18n.t('filters.clear'))
          .setIcon('x-circle')
          .onClick(() => {
            this.controller.clearFilter();
          });
      });
    }

    // Usar currentTarget en lugar de target
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.right, y: rect.top });
  }
}