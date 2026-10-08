// ============================================================
// LAYOUT: HeaderComponent
// ============================================================
// Header con control izquierdo (icono/flecha) a la derecha.
// ============================================================

import { setIcon, Notice } from 'obsidian';
import { FolderLabController } from '../core/FolderLabController';
import { FolderLabView } from '../views/FolderLabView';
import { FilterMenu } from '../components/FilterMenu';

export class HeaderComponent {
  private container: HTMLElement;
  private controller: FolderLabController;
  private view: FolderLabView | null;
  private element: HTMLElement | null = null;
  private filterMenu: FilterMenu | null = null;

  setFilterMenu(menu: FilterMenu | null): void {
    this.filterMenu = menu;
  }

  private topSection: HTMLElement | null = null;
  private titleBlock: HTMLElement | null = null;
  private rightControl: HTMLElement | null = null;
  private folderTitle: HTMLElement | null = null;
  private statistics: HTMLElement | null = null;
  private toolbar: HTMLElement | null = null;
  private leftGroup: HTMLElement | null = null;
  private rightGroup: HTMLElement | null = null;

  private backBtn: HTMLElement | null = null;
  private iconWrapper: HTMLElement | null = null;
  private allNotesBtn: HTMLElement | null = null;
  private folderBtn: HTMLElement | null = null;
  private recentNotesBtn: HTMLElement | null = null;
  private filterBtn: HTMLElement | null = null;
  private wordCountBtn: HTMLElement | null = null;

  constructor(
    container: HTMLElement,
    controller: FolderLabController,
    view: FolderLabView | null = null
  ) {
    this.container = container;
    this.controller = controller;
    this.view = view;
  }

  render(): void {
    if (this.element) {
      this.element.remove();
    }

    this.element = this.container.createEl('div', { cls: 'folder-lab-header' });

    // ============================================================
    // BLOQUE 1: TOP SECTION
    // ============================================================
    this.topSection = this.element.createEl('div', { cls: 'folder-lab-top-section' });

    this.titleBlock = this.topSection.createEl('div', {
      cls: 'folder-lab-title-block'
    });

    this.folderTitle = this.titleBlock.createEl('div', {
      cls: 'folder-lab-folder-title'
    });

    this.statistics = this.titleBlock.createEl('div', {
      cls: 'folder-lab-statistics'
    });
    this.statistics.textContent = '0 notas · 0 carpetas · 0% completado';

    this.rightControl = this.topSection.createEl('div', {
      cls: 'folder-lab-right-control'
    });

    this.iconWrapper = this.rightControl.createEl('span', {
      cls: 'folder-lab-title-icon'
    });
    setIcon(this.iconWrapper, 'book-open');

    this.backBtn = this.rightControl.createEl('button', {
      cls: 'folder-lab-back-btn',
      attr: {
        'aria-label': 'Volver a carpeta anterior'
      }
    });
    setIcon(this.backBtn, 'x');
    this.backBtn.onclick = async () => {
      if (this.view) {
        await this.view.goToParent();
      }
    };

    // ============================================================
    // BLOQUE 2: TOOLBAR
    // ============================================================
    this.toolbar = this.element.createEl('div', { cls: 'folder-lab-toolbar' });

    this.leftGroup = this.toolbar.createEl('div', {
      cls: 'folder-lab-toolbar-group-left'
    });

    const newNoteBtn = this.leftGroup.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': 'Nueva nota' }
    });
    setIcon(newNoteBtn, 'plus');
    newNoteBtn.onclick = () => {
      this.controller.createNewNote();
    };

    const compileBtn = this.leftGroup.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': 'Compilar' }
    });
    setIcon(compileBtn, 'book');
    compileBtn.onclick = () => this.controller.showExportMenu(compileBtn);



const wordBtn = this.leftGroup.createEl('button', {
  cls: 'clickable-icon',
  attr: { 'aria-label': 'Contar palabras' }
});
setIcon(wordBtn, 'file-spreadsheet');
wordBtn.onclick = () => this.controller.countWords();

this.wordCountBtn = wordBtn;

    this.rightGroup = this.toolbar.createEl('div', {
      cls: 'folder-lab-toolbar-group-right'
    });

    // ============================================================
    // BOTÓN "NOTAS RECIENTES"
    // ============================================================
    this.recentNotesBtn = this.rightGroup.createEl('button', {
      cls: 'clickable-icon folder-lab-recent-notes-btn',
      attr: {
        'aria-label': 'Notas recientes',
        'id': 'folder-lab-recent-notes-btn'
      }
    });

    setIcon(this.recentNotesBtn, 'clock');

    this.recentNotesBtn.onclick = () => {
      if (this.view) {
        this.view.toggleRecentNotesMode();
        this.view.updateToolbarButtons();
      }
    };
    // ============================================================
    // BOTÓN "TODAS LAS NOTAS"
    // ============================================================
    this.allNotesBtn = this.rightGroup.createEl('button', {
      cls: 'clickable-icon folder-lab-all-notes-btn',
      attr: {
        'aria-label': 'Mostrar todas las notas',
        'id': 'folder-lab-all-notes-btn'
      }
    });
    setIcon(this.allNotesBtn, 'files');
    this.allNotesBtn.onclick = () => {
      if (this.view) {
        this.view.toggleAllNotesMode();
        // Delegar actualización al view
        this.view.updateToolbarButtons();
      }
    };

    // ============================================================
    // BOTÓN "VER CARPETAS"
    // ============================================================
    this.folderBtn = this.rightGroup.createEl('button', {
      cls: 'clickable-icon folder-lab-folder-btn',
      attr: {
        'aria-label': 'Ver carpetas',
        'id': 'folder-lab-folder-btn'
      }
    });
    setIcon(this.folderBtn, 'folder-tree');
    this.folderBtn.onclick = () => {
      if (this.view) {
        this.view.toggleFolderMode();
        //  Delegar actualización al view
        this.view.updateToolbarButtons();
      }
    };

    // ============================================================
    // BOTÓN FILTRAR
    // ============================================================
    this.filterBtn = this.rightGroup.createEl('button', {
      cls: 'clickable-icon folder-lab-filter-btn',
      attr: {
        'aria-label': 'Filtrar notas',
        'id': 'folder-lab-filter-btn'
      }
    });

    setIcon(this.filterBtn, 'filter');

    this.filterBtn.onclick = (e) => {
      if (this.filterMenu) {
        this.filterMenu.show(e.currentTarget as HTMLElement);
      } else {
        new Notice('🔍 Filtros (no disponible)');
      }
    };
    // ============================================================
    // INICIALIZAR ESTADOS
    // ============================================================
    this.updateRightControl();
    this.updateTitle();
    this.updateWordCountVisibility();
    this.updateStatistics();

    //  Delegar actualización de botones al view
    if (this.view) {
      this.view.updateToolbarButtons();
    }
  }

  public updateWordCountVisibility(): void {
  if (!this.wordCountBtn) return;

  this.wordCountBtn.style.display =
    this.isMasterOrRoot() ? '' : 'none';
}


  // ============================================================
  // VISIBILIDAD DEL CONTADOR DE PALABRAS
  // ============================================================

private isMasterOrRoot(): boolean {
  const navigationType =
    this.controller.navigationService.getNavigationType();

  // ============================================================
  // PROPERTIES
  // ============================================================

  if (navigationType === 'properties') {
    const navigationNode =
      this.view?.getCurrentNavigationNode();

    return navigationNode?.id === 'virtual:root';
  }

  // ============================================================
  // FOLDERS
  // ============================================================

  const masterPath =
    this.controller.getMasterPath();

  const currentPath =
    this.controller.getCurrentPath();

  // Master configurado como raíz física del vault.
  if (masterPath === '') {
    return true;
  }

  // Estamos exactamente en la carpeta Master.
  return (
    masterPath !== null &&
    currentPath === masterPath
  );
}

  // ============================================================
  // ACTUALIZAR CONTROL DERECHO
  // ============================================================


  public updateRightControl(): void {
    if (!this.iconWrapper || !this.backBtn) return;

    // Usar canGoBack() de FolderLabView
    const canGoBack = this.view?.canGoBack() || false;

    console.log('[HEADER BACK DEBUG]', {
      canGoBack,
      navigationType: this.view
        ? this.view.getCurrentNavigationNode()
        : null,
      currentPath: this.controller.getCurrentPath(),
      masterPath: this.controller.getMasterPath()
    });


    if (canGoBack) {
      this.iconWrapper.style.display = 'none';
      this.backBtn.style.display = 'flex';
      this.backBtn.setAttr('aria-label', 'Volver al padre');
    } else {
      this.iconWrapper.style.display = 'none';
      this.backBtn.style.display = 'none';
    }
  }

  public updateTitle(): void {
    if (!this.folderTitle) return;

    const capitalizeFirst = (text: string): string => {
      if (!text) return text;
      return text.charAt(0).toUpperCase() + text.slice(1);
    };

    // ============================================================
    // MASTER
    // ============================================================

    const masterName =
      this.controller.getMasterName();

    // ============================================================
    // PROPERTIES
    // ============================================================

    const navigationNode =
      this.view?.getCurrentNavigationNode();

    if (navigationNode) {
      if (navigationNode.id === 'virtual:root') {
        this.folderTitle.textContent =
          capitalizeFirst(masterName);
      } else {
        this.folderTitle.textContent =
          capitalizeFirst(navigationNode.title);
      }

      return;
    }

    // ============================================================
    // FILESYSTEM
    // ============================================================

    const currentPath =
      this.controller.getCurrentPath();

    // En el root físico, el título representa al Master.
    if (currentPath === '') {
      this.folderTitle.textContent =
        capitalizeFirst(masterName);
      return;
    }

    // Dentro de una carpeta, mostrar la carpeta actual.
    if (currentPath) {
      this.folderTitle.textContent =
        capitalizeFirst(
          currentPath.split('/').pop() ||
          masterName
        );
      return;
    }

    // Fallback absoluto.
    this.folderTitle.textContent =
      capitalizeFirst(masterName);
  }
  public async updateStatistics(
    stats?: { totalNotes: number; percentage: number }
  ): Promise<void> {
    if (!this.statistics) return;

    const resolvedStats =
      stats ?? await this.controller.getStats();


    if (resolvedStats && resolvedStats.totalNotes > 0) {
      this.statistics.textContent = `${resolvedStats.totalNotes} notas · ${resolvedStats.percentage}% completado`;
    } else {
      this.statistics.textContent = '0 notas · 0 carpetas · 0% completado';
    }
  }

  // ============================================================
  // MÉTODOS PÚBLICOS
  // ============================================================

  async refresh(): Promise<void> {
    this.updateTitle();
    this.updateRightControl();
    this.updateWordCountVisibility();
    await this.updateStatistics();

    //  Delegar actualización de botones al view
    if (this.view) {
      this.view.updateToolbarButtons();
    }
  }

  updateFolderName(name: string): void {
    if (!this.folderTitle) return;

    if (!name) {
      this.folderTitle.textContent = '';
      return;
    }

    this.folderTitle.textContent =
      name.charAt(0).toUpperCase() + name.slice(1);
  }

  async updateStats(
    stats?: { totalNotes: number; percentage: number }
  ): Promise<void> {
    await this.updateStatistics(stats);
  }

  public updateBackButton(): void {
    this.updateRightControl();
    this.updateWordCountVisibility();
  }

  destroy(): void {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
