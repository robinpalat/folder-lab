// ============================================================
// COMPONENTE: NoteItemComponent
// ============================================================
// Renderiza una nota individual en el índice
// ============================================================

import { setIcon, Menu, Notice } from 'obsidian';
import { FolderLabController } from '../core/FolderLabController';  // CORREGIDO
import { FolderLabItem } from '../models/FolderLabItem';
import { toRoman } from '../utils/roman-utils';
import { i18n } from '../i18n/I18nService';
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
    nameSpan.textContent = displayName;

    // Icono de estado
    const statusContainer = this.element.createEl('span', { cls: 'folder-order-status' });
    const icon = statusContainer.createEl('span', { cls: 'folder-order-status-icon' });

    if (isEmpty) {
      setIcon(icon, 'alert-circle');
      icon.title = i18n.t('notes.status.emptyTooltip');
    } else {
      const status = item.status || '';
      if (status) {
        setIcon(icon, status);
        icon.title = i18n.t('notes.status.changeHint');
      } else {
        setIcon(icon, 'more-vertical');
        statusContainer.addClass('folder-order-status-unset');
        icon.title = i18n.t('notes.status.setHint');
      }

      statusContainer.onclick = (e) => {
        e.stopPropagation();
        new Notice(i18n.t('notes.status.todoNotice'));
      };
    }
  }

  private renderSpecialNote(displayName: string): void {
    const specialContainer = this.element.createEl('div', {
      cls: 'folder-order-special-container'
    });

    const refreshIcon = specialContainer.createEl('span', {
      cls: 'folder-order-refresh-icon'
    });
    setIcon(refreshIcon, 'refresh-cw');
    refreshIcon.title = i18n.t('actions.regenerateCompile');

    refreshIcon.onclick = async (e) => {
      e.stopPropagation();
      await this.controller.exportAllNotes();
    };

    const titleSpan = specialContainer.createEl('span', {
      cls: 'folder-order-special-title'
    });
    titleSpan.textContent = displayName;
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

      new Notice(i18n.t('notes.reorder.todoNotice'));
    });
  }

  private setupContextMenu(): void {
    this.element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (this.item?.isSpecial) {
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle(i18n.t('actions.regenerateCompile'))
            .setIcon('refresh-cw')
            .onClick(() => this.controller.exportAllNotes());
        });
        menu.showAtPosition({ x: e.clientX, y: e.clientY });
        return;
      }

      const menu = new Menu();
      menu.addItem((item) => {
        item.setTitle(i18n.t('actions.delete'))
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
