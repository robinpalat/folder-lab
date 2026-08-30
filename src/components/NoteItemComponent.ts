// ============================================================
// COMPONENTE: NoteItemComponent
// ============================================================
// Renderiza una nota individual en el índice
// ============================================================

import { setIcon, Menu, Notice } from 'obsidian';
import { FolderLabController } from '../core/FolderLabController';  // CORREGIDO
import { FolderLabItem } from '../models/FolderLabItem';
import { toRoman } from '../utils/roman-utils';

export class NoteItemComponent {
  private container: HTMLElement;
  private controller: FolderLabController;
  private element: HTMLElement;
  private item: FolderLabItem | null = null;
  private index: number = 0;

  constructor(container: HTMLElement, controller: FolderLabController) {
    this.container = container;
    this.controller = controller;
  }

  render(item: FolderLabItem, index: number): void {
    this.item = item;
    this.index = index;
    const isSpecial = item.isSpecial;
    const isEmpty = item.isEmpty || false;
    const displayName = item.name.replace(/\.[^/.]+$/, '');

    this.element = this.container.createEl('div', {
      cls: 'folder-order-item',
      attr: { 'data-index': index.toString(), 'data-filename': item.name }
    });
    this.element.style.display = 'flex';
    this.element.style.alignItems = 'center';
    this.element.style.padding = '5px 10px 5px 6px';
    this.element.style.borderRadius = '6px';
    this.element.style.cursor = 'pointer';
    this.element.style.gap = '10px';
    this.element.style.transition = 'all 0.15s ease';
    this.element.style.userSelect = 'none';
    this.element.style.borderLeft = '3px solid transparent';
    this.element.style.marginBottom = '1px';

    if (isEmpty) {
      this.element.addClass('folder-order-item-empty');
    }
    if (isSpecial) {
      this.element.addClass('folder-order-item-exported');
      this.element.setAttribute('data-special', 'true');
    }

    // Eventos
    this.setupDragEvents(index);
    this.setupContextMenu();
    this.setupClickEvents();

    // Número
    this.renderNumber(index, isSpecial);

    // Nombre
    if (isSpecial) {
      this.renderSpecialNote(displayName);
    } else {
      this.renderNormalNote(displayName, isEmpty, item);
    }
  }

  private renderNumber(index: number, isSpecial: boolean): void {
    const numSpan = this.element.createEl('span', { cls: 'fo-number' });
    numSpan.style.fontSize = '1.0em';
    numSpan.style.fontWeight = '400';
    numSpan.style.color = 'var(--text-muted)';
    numSpan.style.minWidth = '30px';
    numSpan.style.textAlign = 'right';
    numSpan.style.opacity = '0.5';
    numSpan.style.flexShrink = '0';

    const state = this.controller.getState();
    if (!isSpecial && state.settings.showNumbers) {
      const style = state.settings.numberingStyle;
      if (style === 'roman') {
        numSpan.textContent = toRoman(index + 1) + '.';
      } else if (style === 'arabic') {
        numSpan.textContent = (index + 1) + '.';
      }
    }
  }

  private renderNormalNote(displayName: string, isEmpty: boolean, item: FolderLabItem): void {
    const nameSpan = this.element.createEl('span', { cls: 'folder-order-name' });
    nameSpan.style.flex = '1';
    nameSpan.style.fontSize = '0.88em';
    nameSpan.style.color = 'var(--text-muted)';
    nameSpan.style.transition = 'color 0.15s';
    nameSpan.textContent = displayName;

    // Icono de estado
    const statusContainer = this.element.createEl('span', { cls: 'folder-order-status' });
    statusContainer.style.display = 'flex';
    statusContainer.style.alignItems = 'center';
    statusContainer.style.justifyContent = 'center';
    statusContainer.style.marginLeft = 'auto';
    statusContainer.style.cursor = 'pointer';
    statusContainer.style.padding = '2px 6px';
    statusContainer.style.borderRadius = '4px';
    statusContainer.style.transition = 'all 0.2s';
    statusContainer.style.minWidth = '20px';

    const icon = statusContainer.createEl('span');
    icon.style.width = '14px';
    icon.style.height = '14px';
    icon.style.display = 'flex';

    if (isEmpty) {
      setIcon(icon, 'alert-circle');
      icon.style.color = 'var(--text-warning)';
      icon.title = 'Nota vacía';
      statusContainer.style.cursor = 'default';
      statusContainer.style.opacity = '0.8';
    } else {
      const status = item.status || '';
      if (status) {
        setIcon(icon, status);
        icon.style.color = 'var(--text-muted)';
        icon.title = 'Haz clic para cambiar estado';
      } else {
        setIcon(icon, 'more-vertical');
        icon.style.color = 'var(--text-muted)';
        icon.style.opacity = '0.4';
        icon.title = 'Haz clic para establecer estado';
      }

      statusContainer.onclick = (e) => {
        e.stopPropagation();
        new Notice('📝 Menú de estado (TODO)');
      };
    }
  }

  private renderSpecialNote(displayName: string): void {
    const specialContainer = this.element.createEl('div', {
      cls: 'folder-order-special-container'
    });
    specialContainer.style.display = 'flex';
    specialContainer.style.alignItems = 'center';
    specialContainer.style.gap = '8px';
    specialContainer.style.width = '100%';

    const refreshIcon = specialContainer.createEl('span', {
      cls: 'folder-order-refresh-icon'
    });
    setIcon(refreshIcon, 'refresh-cw');
    refreshIcon.title = 'Regenerar compilado';
    refreshIcon.style.cursor = 'pointer';
    refreshIcon.style.color = 'var(--text-muted)';
    refreshIcon.style.opacity = '0.6';
    refreshIcon.style.fontSize = '0.9em';
    refreshIcon.style.padding = '2px 4px';
    refreshIcon.style.borderRadius = '4px';
    refreshIcon.style.transition = 'all 0.2s';

    refreshIcon.onmouseenter = () => {
      refreshIcon.style.color = 'var(--text-accent)';
      refreshIcon.style.opacity = '1';
      refreshIcon.style.background = 'var(--background-modifier-hover)';
    };
    refreshIcon.onmouseleave = () => {
      refreshIcon.style.color = 'var(--text-muted)';
      refreshIcon.style.opacity = '0.6';
      refreshIcon.style.background = 'transparent';
    };

    refreshIcon.onclick = async (e) => {
      e.stopPropagation();
      await this.controller.exportAllNotes();
    };

    const titleSpan = specialContainer.createEl('span', {
      cls: 'folder-order-special-title'
    });
    titleSpan.textContent = displayName;
    titleSpan.style.fontSize = '0.88em';
    titleSpan.style.color = 'var(--text-normal)';
    titleSpan.style.fontWeight = '400';
    titleSpan.style.flex = '1';
  }

  private setupDragEvents(index: number): void {
    this.element.setAttribute('draggable', 'true');

    this.element.addEventListener('dragstart', (e) => {
      this.element.addClass('dragging');
      e.dataTransfer?.setData('text/plain', index.toString());
      e.dataTransfer!.effectAllowed = 'move';
    });

    this.element.addEventListener('dragend', () => {
      this.element.removeClass('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.removeClass('drag-over'));
    });

    this.element.addEventListener('dragover', (e) => {
      e.preventDefault();
      document.querySelectorAll('.drag-over').forEach(el => el.removeClass('drag-over'));
      this.element.addClass('drag-over');
    });

    this.element.addEventListener('dragleave', () => {
      this.element.removeClass('drag-over');
    });

    this.element.addEventListener('drop', async (e) => {
      e.preventDefault();
      this.element.removeClass('drag-over');

      const from = parseInt(e.dataTransfer?.getData('text/plain') || '-1');
      if (from === -1 || from === index) return;

      new Notice('Reordenamiento (TODO)');
    });
  }

  private setupContextMenu(): void {
    this.element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (this.item?.isSpecial) {
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle('Regenerar compilado')
            .setIcon('refresh-cw')
            .onClick(() => this.controller.exportAllNotes());
        });
        menu.showAtPosition({ x: e.clientX, y: e.clientY });
        return;
      }

      const menu = new Menu();
      menu.addItem((item) => {
        item.setTitle('Eliminar')
          .setIcon('trash-2')
          .onClick(() => {
            if (this.item?.file) {
              this.controller.deleteNote(this.item.file);
            }
          });
      });
      menu.showAtPosition({ x: e.clientX, y: e.clientY });
    });
  }

  private setupClickEvents(): void {
    this.element.onclick = async (e) => {
      if ((e.target as HTMLElement).closest('.folder-order-refresh-icon')) return;
      if ((e.target as HTMLElement).closest('.folder-order-status')) return;

      if (this.item) {
        await this.controller.openNote(this.item);
      }
    };
  }

  setActive(isActive: boolean): void {
    if (this.element) {
      if (isActive) {
        this.element.addClass('fo-active');
      } else {
        this.element.removeClass('fo-active');
      }
    }
  }
}
