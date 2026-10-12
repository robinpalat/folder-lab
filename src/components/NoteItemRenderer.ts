// ============================================================
// COMPONENTE: NoteItemRenderer
// ============================================================
// Renderiza una nota individual de forma consistente
// Reutilizado por todas las vistas
// SIN ESTILOS EN LÍNEA
// ============================================================

import { App, TFile, setIcon, Menu, Notice } from 'obsidian';
import { FolderLabState } from '../core/FolderLabState';
import { NoteService } from '../services/NoteService';
import { FolderLabItem } from '../models/FolderLabItem';
import { getFileNameWithoutExtension } from '../utils/string-utils';
import { toRoman } from '../utils/roman-utils';
import { FolderLabController } from '../core/FolderLabController';
import { getStatusIcon, STATUSES } from '../constants/statuses';
import { VIEW_TYPE_FOLDER_ORDER } from '../constants/view-types';
import { FolderLabView } from '../views/FolderLabView';
import { i18n } from '../i18n/I18nService';
export interface NoteRenderOptions {
  index: number;
  showNumber?: boolean;
  numberingStyle?: 'roman' | 'arabic' | 'none';
  isActive?: boolean;
  indentLevel?: number;
}

export class NoteItemRenderer {
  private app: App;
  private state: FolderLabState;
  private controller: FolderLabController;
  private noteService: NoteService;
  private onNoteSelect: (item: FolderLabItem) => void;
  private onStatusChange?: (file: TFile, status: string) => void;
  private onDelete?: (file: TFile) => void;

  constructor(
    app: App,
    state: FolderLabState,
    controller: FolderLabController,
    noteService: NoteService,
    onNoteSelect: (item: FolderLabItem) => void,
    options?: {
      onStatusChange?: (file: TFile, status: string) => void;
      onDelete?: (file: TFile) => void;
    }
  ) {
    this.app = app;
    this.state = state;
    this.controller = controller;
    this.noteService = noteService;
    this.onNoteSelect = onNoteSelect;
    this.onStatusChange = options?.onStatusChange;
    this.onDelete = options?.onDelete;
  }

  render(
    container: HTMLElement,
    item: FolderLabItem,
    options: NoteRenderOptions
  ): HTMLElement {
    const {
      index,
      showNumber = true,
      numberingStyle = 'arabic',
      indentLevel = 0
    } = options;

    const isSpecial = item.isSpecial || false;
    const isEmpty = item.isEmpty || false;
    const displayName = getFileNameWithoutExtension(item.name);
    const hasStatus = !isEmpty && item.status && item.status !== '';
    const currentPath = this.controller.getCurrentPath() || '';

    const el = container.createEl('div', {
      cls: 'folder-lab-item',
      attr: {
        'data-index': index.toString(),
        'data-filename': item.name,
        'data-path': item.path,
        'data-folder': currentPath,
        'data-indent': Math.min(indentLevel, 5).toString()
      }
    });

    if (item.isOwnPage) {
      el.setAttribute('data-own-page', 'true');
    }


    if (isEmpty) el.addClass('is-empty');
    if (isSpecial) el.addClass('is-exported');


    // Solo las OWN PAGE representan nodos estructurales.
    // Las notas normales conservan tipografía normal,
    // independientemente de su nivel de indentación.
    const level = options.indentLevel || 0;

    // ============================================================
    // PROPERTIES — JERARQUÍA VISUAL DE NODOS ESTRUCTURALES
    // ============================================================

    if (item.isOwnPage) {
      if (level === 0) {
        el.addClass('property-structural-level-0');
      } else {
        el.addClass('property-structural-level-1');
      }
    }

    // ============================================================
    // NODOS ESTRUCTURALES DE PROPERTIES
    // ============================================================

    if (item.isOwnPage) {
      if (level === 0) {
        el.addClass('property-own-page-level-0');
      } else {
        el.addClass('property-own-page-level-1');
      }
    }
    const activeFile = this.app.workspace.getActiveFile();
    const isCurrentlyOpen = activeFile && activeFile.path === item.path;
    if (isCurrentlyOpen && !isSpecial) {
      el.addClass('is-active');
    }

    // ============================================================
    // NÚMERO O BOTÓN DE REFRESCAR (para nota especial)
    // ============================================================

    if (isSpecial) {
      const refreshBtn = el.createEl('span', {
        cls: 'folder-lab-special-refresh'
      });
      setIcon(refreshBtn, 'refresh-cw');
      refreshBtn.title = i18n.t('actions.regenerateCompile');

      refreshBtn.onclick = (e) => {
        e.stopPropagation();
        const event = new CustomEvent('folder-lab-export', {
          detail: { folderPath: currentPath }
        });
        document.dispatchEvent(event);
      };
    } else if (showNumber) {
      const numSpan = el.createEl('span', { cls: 'fo-number' });
      let num = '';
      if (numberingStyle === 'roman') {
        num = toRoman(index + 1) + '.';
      } else if (numberingStyle === 'arabic') {
        num = (index + 1) + '.';
      }
      numSpan.textContent = num;
    }

    // ============================================================
    // NOMBRE
    // ============================================================

    const nameSpan = el.createEl('span', {
      cls: 'folder-lab-name'
    });

    nameSpan.textContent = displayName;

    // ============================================================
    // ESTADO / MENÚ (SOLO PARA NOTAS REGULARES)
    // ============================================================

    if (!isSpecial) {
      const statusContainer = el.createEl('span', { cls: 'folder-lab-status' });
      const icon = statusContainer.createEl('span', { cls: 'icon' });

      if (isEmpty) {
        setIcon(icon, 'alert-circle');
        statusContainer.addClass('status-empty');
        icon.setAttribute('title', i18n.t('notes.status.emptyTooltip'));
      } else if (hasStatus) {
        const iconName = getStatusIcon(item.status);
        setIcon(icon, iconName);
        statusContainer.addClass('status-has');

        const statusLabel = STATUSES.find(s => s.id === item.status)?.label || item.status || '';
        icon.setAttribute('title', i18n.t('notes.status.tooltipWithLabel', { label: statusLabel }));

        // Verificar file antes de usar
        if (item.file) {
          statusContainer.onclick = (e) => {
            e.stopPropagation();
            if (this.onStatusChange) {
              this.showStatusMenu(statusContainer, item.file!, item.status!);
            }
          };
        }
      } else {
        setIcon(icon, 'more-vertical');
        statusContainer.addClass('status-menu');
        icon.setAttribute('title', i18n.t('notes.status.set'));
        //  Verificar file antes de usar
        if (item.file) {
          statusContainer.onclick = (e) => {
            e.stopPropagation();
            if (this.onStatusChange) {
              this.showStatusMenu(statusContainer, item.file!, '');
            }
          };
        }
      }
    }

    // ============================================================
    // EVENTOS
    // ============================================================

    el.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.folder-lab-special-refresh')) return;
      if ((e.target as HTMLElement).closest('.folder-lab-status')) return;

      if (this.controller.getState().isFocusMode) {
        return;
      }

      this.onNoteSelect(item);
    };

    el.ondblclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if ((e.target as HTMLElement).closest('.folder-lab-special-refresh')) return;
      if ((e.target as HTMLElement).closest('.folder-lab-status')) return;

      if (this.controller.getState().isFocusMode) {
        return;
      }

      //  Verificar file antes de usar
      if (!isSpecial && item.file) {
        await this.openInFocusMode(item.file);
      }
    };

    // Menú contextual
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (isSpecial) {
        const menu = new Menu();
        menu.addItem((itemMenu) => {
          itemMenu.setTitle(i18n.t('actions.regenerateCompile'))
            .setIcon('refresh-cw')
            .onClick(() => {
              const event = new CustomEvent('folder-lab-export', {
                detail: { folderPath: currentPath }
              });
              document.dispatchEvent(event);
            });
        });
        menu.showAtPosition({ x: e.clientX, y: e.clientY });
        return;
      }

      this.showContextMenu(e, item);
    });

    return el;
  }

public updateStatus(
  element: HTMLElement,
  status: string
): void {
  const statusContainer =
    element.querySelector('.folder-lab-status');

  if (!(statusContainer instanceof HTMLElement)) {
    return;
  }

  const icon =
    statusContainer.querySelector('.icon');

  if (!(icon instanceof HTMLElement)) {
    return;
  }

  statusContainer.removeClass(
    'status-empty',
    'status-has',
    'status-menu'
  );

  icon.empty();

  if (!status) {
    setIcon(icon, 'more-vertical');
    statusContainer.addClass('status-menu');
    icon.setAttribute(
      'title',
      i18n.t('notes.status.set')
    );
    return;
  }

  const iconName =
    getStatusIcon(status);

  setIcon(icon, iconName);

  statusContainer.addClass(
    'status-has'
  );

  const statusLabel =
    STATUSES.find(
      s => s.id === status
    )?.label || status;

  icon.setAttribute(
    'title',
    i18n.t('notes.status.tooltipWithLabel', { label: statusLabel })
  );
}


  // ============================================================
  // MENÚ DE ESTADO
  // ============================================================

  private showStatusMenu(container: HTMLElement, file: TFile, currentStatus: string): void {
    const menu = new Menu();

    menu.addItem((item) => {
      const isActive = currentStatus === '';
      item.setTitle(`${isActive ? '✓' : ' '} ${i18n.t('notes.statusMenu.none')}`)
        .setIcon('more-vertical')
        .onClick(() => {
          if (this.onStatusChange) {
            this.onStatusChange(file, '');
          }
        });
    });

    menu.addSeparator();

    for (const s of STATUSES) {
      const isActive = s.id === currentStatus;
      menu.addItem((item) => {
        item.setTitle(`${isActive ? '✓ ' : '  '} ${s.label}`)
          .setIcon(s.icon)
          .onClick(() => {
            if (this.onStatusChange) {
              this.onStatusChange(file, s.id);
            }
          });
      });
    }

    const rect = container.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }

  // ============================================================
  // MENÚ CONTEXTUAL
  // ============================================================

  private showContextMenu(event: MouseEvent, item: FolderLabItem): void {
    const menu = new Menu();

    //  Verificar file antes de usar
    if (!item.isSpecial && item.file) {
      menu.addItem((itemMenu) => {
        itemMenu.setTitle(i18n.t('actions.openNoteContext'))
          .setIcon('target')
          .onClick(() => {
            this.openInFocusMode(item.file!);
          });
      });
    }

    // Verificar file antes de usar
    if (!item.isSpecial && this.onDelete && item.file) {
      menu.addSeparator();
      menu.addItem((itemMenu) => {
        itemMenu.setTitle(i18n.t('actions.delete'))
          .setIcon('trash-2')
          .onClick(() => {
            if (this.onDelete && item.file) {
              this.onDelete(item.file);
            }
          });
      });
    }

    menu.showAtPosition({ x: event.clientX, y: event.clientY });
  }

  // ============================================================
  // MÉTODO: Abrir en modo Focus (ASÍNCRONO)
  // ============================================================

  private async openInFocusMode(file: TFile): Promise<void> {
    await this.app.workspace.getLeaf().openFile(file);

    const view = this.getFolderLabView();
    if (view) {
      view.toggleFocusMode();
    } else {
      new Notice(i18n.t('errors.viewNotOpen'));
    }
  }

  private getFolderLabView(): FolderLabView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDER_ORDER);
    if (leaves.length === 0) return null;
    return leaves[0].view as FolderLabView;
  }
}
