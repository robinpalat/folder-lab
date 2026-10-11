// ============================================================
// CORE: FolderLabView - COORDINADOR PRINCIPAL
// ============================================================
// Renderiza la vista. SOLO CONSUME estado de navegación.
// ============================================================

import { ItemView, WorkspaceLeaf, TFolder, TFile, Notice, setIcon, MarkdownView } from 'obsidian';
import FolderLabPlugin from '../main';
import { VIEW_TYPE_FOLDER_ORDER, INTERNAL_FOLDER } from '../constants/view-types';
import { FolderLabController, FolderLabEvent } from '../core/FolderLabController';
import { FolderLabState, NavigationMode } from '../core/FolderLabState';
import { FolderRepository } from '../storage/FolderRepository';
import { HeaderComponent } from '../layout/HeaderComponent';
import { NoteListComponent, ListItem } from '../components/NoteListComponent';
import { NoteAreaComponent } from '../components/NoteAreaComponent';
import { SubfolderView } from './SubfolderView';
import { AllNotesView } from './AllNotesView';
import { FolderLabItem } from '../models/FolderLabItem';
import { WordCountModal } from '../modals/WordCountModal';
import { WordCountResult } from '../services/WordCountService';
import { FilterMenu } from '../components/FilterMenu';
import { NavigationService } from '../services/NavigationService';
import { NavigationNode, NavigationTree } from '../models/Navigation';
import { RecentActivityService } from '../services/RecentActivityService';
import { WidgetManager } from '../focus/WidgetManager';

// ============================================================
// IMPORTS PARA FOCUS
// ============================================================
import { FocusWorkspace } from '../focus/FocusWorkspace';
import { FocusWidgetRegistry } from '../focus/FocusWidgetRegistry';
import {
  BoardView,
  BOARD_VIEW_TYPE
} from '../focus/BoardView';

export class FolderLabView extends ItemView {
  private plugin: FolderLabPlugin;
  private controller: FolderLabController;
  private repository: FolderRepository;
  private state: FolderLabState;
  private _isDisposed: boolean = false;
  private renderTimeout: number | null = null;

  private recentActivityService: RecentActivityService;
  private mainContainer: HTMLElement;
  private headerContainer: HTMLElement;
  private listContainer: HTMLElement;
  private noteAreaContainer: HTMLElement;

  private headerComponent: HeaderComponent;
  private noteList: NoteListComponent | null = null;
  private noteArea: NoteAreaComponent | null = null;
  private subfolderView: SubfolderView | null = null;
  private allNotesView: AllNotesView | null = null;
  private filterMenu: FilterMenu | null = null;

  // ============================================================
  // PROPIEDADES FOCUS
  // ============================================================
  private widgetRegistry: FocusWidgetRegistry;
  private widgetManager: WidgetManager;
  private focusWorkspace: FocusWorkspace | null = null;
  private focusContainer: HTMLElement | null = null;
  private explorerContainer: HTMLElement | null = null;
  private onBoard: (() => void) | null = null;
  private boardPreviousState: Record<string, unknown> | null = null;


  // ============================================================
  // TRAZADO DE RENDER
  // ============================================================
  private renderSequence: number = 0;

  // ============================================================
  // NAVEGACIÓN VIRTUAL (MODO PROPERTIES)
  // ============================================================
  private currentNavigationNode: NavigationNode | null = null;
  private boundHandleNavigationTreeChanged = this.handleNavigationTreeChanged.bind(this);
  /**
 * LEGACY — mantenido temporalmente para compatibilidad
 * con goBackVirtual() y limpieza de estado existente.
 *
 * La navegación Back principal NO utiliza este historial.
 */
  private navigationHistory: NavigationNode[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    plugin: FolderLabPlugin,
    repository: FolderRepository,
    widgetRegistry: FocusWidgetRegistry,
    widgetManager: WidgetManager,
  ) {
    super(leaf);
    this.plugin = plugin;
    this.repository = repository;
    this.widgetRegistry = widgetRegistry;
    this.widgetManager = widgetManager;

    this.recentActivityService = new RecentActivityService(
      this.app,
      () => this.plugin.settings.bookRootPath
    );
    this.controller = new FolderLabController(plugin.app, plugin.settings, this.repository);
    this.state = this.controller.getState();

    this.filterMenu = new FilterMenu(this.controller, this.controller.filterService);

    this.controller.onStateChange((event: FolderLabEvent) => {
      this.handleEvent(event);
    });

    document.addEventListener('folder-lab-export', this.handleExportEvent.bind(this));
    document.addEventListener('folder-lab-refresh', this.handleRefreshEvent.bind(this));
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  //  Obtener NavigationService del controller
  private get navigationService(): NavigationService | null {
    return this.controller.navigationService;
  }

  private logRender(source: 'properties' | 'folders' | 'unknown', details?: any): void {
    const renderId = ++this.renderSequence;
    const navType = this.navigationService?.getNavigationType() || 'folders';
    console.log(
      `[RENDER ${renderId}]`,
      {
        navigationType: navType,
        source: source,
        details: details,
        stack: new Error().stack?.split('\n').slice(2, 6).join('\n')
      }
    );
  }

  async loadFolderOrder(folderPath: string): Promise<void> {
    if (this._isDisposed) return;
    await this.controller.loadFolder(folderPath);
    await this.loadFolder(folderPath);
    this.plugin.settings.lastFolderPath = folderPath;
    await this.plugin.saveSettings();
  }

  refresh(): void {
    if (this._isDisposed) return;
    const currentPath = this.controller.getCurrentPath();
    if (currentPath) {
      this.controller.loadFolder(currentPath);
    }
  }

  // ============================================================
  // MANEJADOR DE NAVIGATION-TREE-CHANGED
  // ============================================================

  private async handleNavigationTreeChanged(): Promise<void> {
    console.log('[UI] navigation-tree-changed recibido');
    console.log('[FOLDERLAB-EVENT-TRACE]', {
      evento: 'navigation-tree-changed',
      navType: this.navigationService?.getNavigationType() ?? 'folders(desconocido)',
      isAllNotes: this.state.isAllNotesMode()
    });

    if (!this.navigationService) {
      console.log('[UI] NavigationService no disponible');
      return;
    }

    const navType = this.navigationService.getNavigationType();

    if (navType === 'properties') {
      console.log('[UI] Actualizando Properties UI...');
      await this.renderPropertyNavigation();
    } else {
      console.log('[UI] Modo folders, ignorando navigation-tree-changed (UI ya actualizada por loadFolder)');
    }
  }

  // ============================================================
  // TOGGLES DE NAVEGACIÓN - USANDO NavigationMode
  // ============================================================

  toggleFolderMode(): void {
    if (this._isDisposed) return;

    const navType = this.navigationService?.getNavigationType() || 'folders';

    if (navType === 'properties') {
      console.log('[TOGGLE FOLDER] properties mode - renderPropertyNavigation');
      this.state.toggleFolderMode();
      this.updateToolbarButtons();
      this.renderPropertyNavigation();
    } else {
      this.state.toggleFolderMode();
      this.updateToolbarButtons();

      const currentPath = this.controller.getCurrentPath();
      if (currentPath) {
        this.loadFolder(currentPath);
      }
    }
  }


  toggleRecentNotesMode(): void {
    if (this._isDisposed) return;

    this.state.toggleRecentNotesMode();
    this.updateToolbarButtons();

    // ============================================================
    // ACTIVAR RECIENTES
    // ============================================================
    if (this.state.isRecentNotesMode()) {
      void this.renderRecentNotesMode();
      return;
    }

    // ============================================================
    // SALIR DE RECIENTES
    // Restaurar la vista correspondiente al contexto actual.
    // ============================================================

    const navType =
      this.navigationService?.getNavigationType() || 'folders';

    if (navType === 'properties') {
      void this.renderPropertyNavigation();
      return;
    }

    const currentPath = this.controller.getCurrentPath();

    if (currentPath !== null) {
      void this.loadFolder(currentPath);
    }
  }

  toggleAllNotesMode(): void {
    if (this._isDisposed) return;

    const navType = this.navigationService?.getNavigationType() || 'folders';

    if (navType === 'properties') {
      console.log('[TOGGLE ALL NOTES] properties mode - renderPropertyNavigation');
      this.state.toggleAllNotesMode();
      this.updateToolbarButtons();
      this.renderPropertyNavigation();
    } else {
      this.state.toggleAllNotesMode();
      this.updateToolbarButtons();

      const currentPath = this.controller.getCurrentPath();
      if (currentPath) {
        this.loadFolder(currentPath);
      }
    }
  }

  // ============================================================
  // ACTUALIZAR BOTONES DEL TOOLBAR - CENTRALIZADO
  // ============================================================

  public updateToolbarButtons(): void {
    const containerEl = this.containerEl;
    if (!containerEl) return;

    const recentNotesBtn = containerEl.querySelector(
      '#folder-lab-recent-notes-btn'
    ) as HTMLElement;

    if (recentNotesBtn) {
      if (this.state.isRecentNotesMode()) {
        recentNotesBtn.addClass('is-active');
        recentNotesBtn.setAttr(
          'aria-label',
          'Volver a notas de la carpeta'
        );
      } else {
        recentNotesBtn.removeClass('is-active');
        recentNotesBtn.setAttr(
          'aria-label',
          'Mostrar notas recientes'
        );
      }
    }

    const folderBtn = containerEl.querySelector('#folder-lab-folder-btn') as HTMLElement;
    if (folderBtn) {
      if (this.state.isFolderTreeMode()) {
        folderBtn.addClass('is-active');
        folderBtn.setAttr('aria-label', 'Ocultar carpetas');
      } else {
        folderBtn.removeClass('is-active');
        folderBtn.setAttr('aria-label', 'Ver carpetas');
      }
    }

    const allNotesBtn = containerEl.querySelector('#folder-lab-all-notes-btn') as HTMLElement;
    if (allNotesBtn) {
      if (this.state.isAllNotesMode()) {
        allNotesBtn.addClass('is-active');
        allNotesBtn.setAttr('aria-label', 'Volver a notas de la carpeta');
      } else {
        allNotesBtn.removeClass('is-active');
        allNotesBtn.setAttr('aria-label', 'Mostrar todas las notas');
      }
    }


    const filterBtn = containerEl.querySelector(
      '#folder-lab-filter-btn'
    ) as HTMLElement;

    if (filterBtn) {
      const filterActive =
        this.controller.getActiveFilter() !== null;

      if (filterActive) {
        filterBtn.addClass('is-active');
        filterBtn.setAttr(
          'aria-label',
          'Filtro activo'
        );
      } else {
        filterBtn.removeClass('is-active');
        filterBtn.setAttr(
          'aria-label',
          'Filtrar notas'
        );
      }
    }



  }

  private exitGlobalModes(): void {
    this.state.exitGlobalModes();
    this.updateToolbarButtons();

    /*
     * El Board es subordinado a Focus: al desactivarse cualquier
     * modo global, la vista del Board se cierra y se limpia su
     * estado de presentación. La nota activa vuelve a su vista
     * nativa (closeBoardView restaura el leaf markdown).
     */
    void this.closeBoardIfOpen();
  }

  /**
   * Cierra la vista del Board si está abierta y restablece su
   * estado de presentación. No toca el contenido persistido
   * (tarjetas/conexiones en _board.json).
   */
  private async closeBoardIfOpen(): Promise<void> {
    const boardLeaves =
      this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE);

    if (boardLeaves.length === 0) {
      this.boardPreviousState = null;
      return;
    }

    await this.closeBoardView();
    this.focusWorkspace?.setBoardActive(false);
    this.boardPreviousState = null;
  }

  // ============================================================
  // TOGGLE FOCUS MODE
  // ============================================================
  async toggleFocusMode(): Promise<void> {
    const state = this.state;

    console.log("ANTES", state.isFocusMode);

    state.toggleFocusMode();

    console.log("DESPUÉS", state.isFocusMode);

    if (state.isFocusMode) {
      const activeFile = this.app.workspace.getActiveFile();

      if (activeFile) {
        state.setFocusNote(activeFile.path);

        // Registrar entrada explícita en Contexto.
        void this.recentActivityService.record(
          activeFile,
          'context',
          4
        );

        this.showFocusMode();
      } else {
        new Notice('No hay nota activa para el modo Focus');
        state.toggleFocusMode();
        this.showExplorerMode();
      }
    } else {
      /*
       * Salida de Focus: el Board no puede sobrevivir a Focus.
       * Se cierra primero para que la nota activa quede en su
       * vista nativa antes de restaurar la lista de notas.
       */
      await this.closeBoardIfOpen();

      this.showExplorerMode();
      const currentPath = this.controller.getCurrentPath();

      if (currentPath) {
        await this.loadFolder(currentPath);
      }
    }

    this.controller.notifyEvent({ type: 'modeChanged' });
  }

  // ============================================================
  // MÉTODOS DE ItemView
  // ============================================================

  getModes(): { isFolderMode: boolean; isAllNotesMode: boolean } {
    return {
      isFolderMode: this.state.isFolderTreeMode(),
      isAllNotesMode: this.state.isAllNotesMode()
    };
  }

  getViewType(): string {
    return VIEW_TYPE_FOLDER_ORDER;
  }

  getDisplayText(): string {
    return 'Folder Lab';
  }

  getIcon(): string {
    return 'folder';
  }

  getFocusWorkspace(): any {
    return this.focusWorkspace;
  }

  // ============================================================
  // MANEJADOR DE EVENTOS
  // ============================================================

  private async handleEvent(event: FolderLabEvent): Promise<void> {

    switch (event.type) {
      case 'folderChanged':

        console.log('[RENDER TRACE] folderChanged event');
        console.log('[FOLDERLAB-EVENT-TRACE]', {
          evento: 'folderChanged',
          navType: this.navigationService?.getNavigationType() ?? 'folders(desconocido)',
          isAllNotesAntes: this.state.isAllNotesMode()
        });

        /*
         * La decisión usa el MODO GLOBAL ACTIVO (isAllNotesMode),
         * no el proveedor: el proveedor (folders/properties) indica
         * DE DÓNDE vienen los datos; el modo indica QUÉ vista está
         * en pantalla. Mezclarlos expulsaba de «Todas las notas».
         */
        if (this.state.isAllNotesMode()) {
          if (this.navigationService?.getNavigationType() === 'properties') {
            /*
             * Los cambios de frontmatter (p. ej. la renumeración
             * nav_order) disparan vault modify → loadFolder →
             * folderChanged. La UI se refresca vía order-changed /
             * navigation-tree-changed; aquí no se hace nada.
             */
            console.log('[FOLDERLAB-EVENT-TRACE]', {
              evento: 'folderChanged',
              rama: 'ALL_NOTES+properties: IGNORADO (sin exitGlobalModes ni loadFolder)',
              isAllNotes: this.state.isAllNotesMode()
            });
            break;
          }

          /*
           * Proveedor folders con vista ALL_NOTES: refrescar el
           * listado en su sitio, SIN salir del modo (conserva la
           * actualización ante cambios estructurales legítimos).
           */
          console.log('[FOLDERLAB-EVENT-TRACE]', {
            evento: 'folderChanged',
            rama: 'ALL_NOTES+folders: re-render en el modo (sin exitGlobalModes)',
            isAllNotes: this.state.isAllNotesMode()
          });

          const allNotesFolder =
            this.app.vault.getAbstractFileByPath(event.folderPath);

          if (allNotesFolder instanceof TFolder) {
            await this.renderAllNotesMode(allNotesFolder);
          }

          break;
        }

        console.log('[FOLDERLAB-EVENT-TRACE]', {
          evento: 'folderChanged',
          rama: 'sin ALL_NOTES: exitGlobalModes + loadFolder (histórico)',
          isAllNotesAntes: this.state.isAllNotesMode()
        });
        this.exitGlobalModes();
        this.loadFolder(event.folderPath);
        break;

      case 'noteChanged':

        this.state.currentNoteType = 'general';
        if (this.noteArea) {
          this.noteArea.loadNote();
        }
        break;

      case 'selectionChanged':

        this.updateActiveNoteHighlight();
        if (this.noteList) {
          this.noteList.updateActiveNote();
        }

        if (this.allNotesView) {
          this.allNotesView.updateActiveNote();
        }
        break;

      case 'modeChanged':


        const navType2 = this.navigationService?.getNavigationType() || 'folders';

        if (navType2 === 'properties') {
          if (event.mode === 'folder') {
            this.state.setFolderTreeMode();
            this.updateToolbarButtons();
            await this.renderPropertyNavigation();
          }
          break;
        }

        if (event.mode === 'folder') {
          this.state.setFolderTreeMode();
          this.updateToolbarButtons();
          const currentPath = this.controller.getCurrentPath();
          if (currentPath) {
            this.loadFolder(currentPath);
          }
        } else {
          const currentPath = this.controller.getCurrentPath();
          if (currentPath) {
            this.loadFolder(currentPath);
          }
        }
        break;

      case 'itemsChanged':


        const navTypeItems =
          this.navigationService?.getNavigationType() || 'folders';

        if (navTypeItems === 'properties') {
          await this.renderPropertyNavigation();
        } else {
          const path = this.controller.getCurrentPath();

          if (path) {
            await this.loadFolder(path);
          }
        }
        break;

      case 'filterChanged':
        this.updateToolbarButtons();

        const navTypeFilter = this.navigationService?.getNavigationType() || 'folders';

        if (navTypeFilter === 'properties') {
          await this.renderPropertyNavigation();
        } else {
          const currentPathFilter = this.controller.getCurrentPath();

          if (currentPathFilter) {
            await this.loadFolder(currentPathFilter);
          }
        }
        break;

      default:
        console.warn('Evento desconocido:', event);
    }
  }


  // ============================================================
  // CICLO DE VIDA
  // ============================================================

  async onOpen(): Promise<void> {
    if (this._isDisposed) return;

    const container = this.contentEl;
    container.empty();
    container.addClass('folder-lab-view');

    this.explorerContainer = container.createEl('div', {
      cls: 'folder-lab-explorer-mode'
    });
    this.explorerContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
    `;

    this.focusContainer = container.createEl('div', {
      cls: 'folder-lab-focus-mode'
    });
    this.focusContainer.style.cssText = `
      display: none;
      flex-direction: column;
      height: 100%;
      width: 100%;
    `;

    this.buildExplorerMode(this.explorerContainer);

    this.setupVaultEvents();
    this.setupActiveLeafEvents();

    console.log('Inicializando controlador...');
    await this.controller.initialize();

    // NavigationService ya existe en controller, solo configurarlo
    if (this.navigationService) {
      this.navigationService.setMasterPath(this.plugin.settings.bookRootPath);
      await this.navigationService.initialize();

      // Escuchar cambios en el árbol de navegación
      (this.app.workspace as any).on('folder-lab:navigation-tree-changed', this.boundHandleNavigationTreeChanged);
    }

    const navType = this.navigationService?.getNavigationType() || 'folders';

    if (navType === 'properties') {
      console.log('[PROPERTIES] Cargando navegación por propiedades...');

      const tree = await this.navigationService?.build();

      this.currentNavigationNode =
        tree?.nodeMap.get('virtual:root') || null;

      this.navigationHistory = [];
    } else {
      await this.loadInitialFolder();
    }

    this.exitGlobalModes();
    this.updateToolbarButtons();
    this.renderContent();

    // Properties debe ser el último render inicial,
    // porque también establece las estadísticas de la vista activa.
    if (navType === 'properties') {
      await this.renderPropertyNavigation();
    }

    if (this.state.isFocusMode) {
      this.showFocusMode();
    } else {
      this.showExplorerMode();
    }
  }

  private showExplorerMode(): void {

    if (this.explorerContainer) {
      this.explorerContainer.style.display = 'flex';
    }
    if (this.focusContainer) {
      this.focusContainer.style.display = 'none';
    }

    if (this.focusWorkspace) {
      this.focusWorkspace.destroy();
      this.focusWorkspace = null;
    }
  }

  private async showFocusMode(): Promise<void> {

    if (this.explorerContainer) {
      this.explorerContainer.style.display = 'none';
    }

    if (this.focusContainer) {
      this.focusContainer.style.display = 'flex';

      if (!this.focusWorkspace) {

        this.focusWorkspace = new FocusWorkspace(
          this.focusContainer,
          this.app,
          this.controller,
          this.state,
          this.widgetRegistry,
          this.widgetManager,
          this.plugin.capabilityRegistry!,

          // Cerrar Contexto
          () => {
            this.toggleFocusMode();
          },

          // Actividad de widgets
          (_position, instanceId) => {
            const activeFile = this.app.workspace.getActiveFile();

            if (activeFile) {
              void this.recentActivityService.record(
                activeFile,
                `widget:${instanceId}`,
                2
              );
            }
          },

          // Board / Nota
          () => {
            const boardLeaves =
              this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE);

            if (boardLeaves.length > 0) {
              void this.closeBoardView();
              this.focusWorkspace?.setBoardActive(false);
            } else {
              void this.openBoardView();
              this.focusWorkspace?.setBoardActive(true);
            }
          }
        );


        await this.focusWorkspace.render();

        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          this.focusWorkspace.updateNote(activeFile);
          this.state.setFocusNote(activeFile.path);
        }
      }
    }
  }

  private buildExplorerMode(container: HTMLElement | null): void {
    if (!container) {
      console.warn('[buildExplorerMode] container es null');
      return;
    }

    this.headerContainer = container.createEl('div', {
      cls: 'folder-lab-header-wrapper'
    });

    this.headerComponent = new HeaderComponent(
      this.headerContainer,
      this.controller,
      this
    );
    this.headerComponent.render();
    this.headerComponent.setFilterMenu(this.filterMenu);

    this.listContainer = container.createEl('div', {
      cls: 'folder-lab-list-wrapper'
    });

    this.noteAreaContainer = container.createEl('div', {
      cls: 'folder-lab-notearea-wrapper'
    });

    this.noteArea = new NoteAreaComponent(this.noteAreaContainer, this.controller);
    this.noteArea.render();
  }

  async onClose(): Promise<void> {
    this._isDisposed = true;

    /*
     * El Board es subordinado a Focus: al cerrarse el panel,
     * cualquier vista del Board abierta se cierra también.
     */
    await this.closeBoardIfOpen();

    // Limpiar eventos
    (this.app.workspace as any).off('folder-lab:navigation-tree-changed', this.boundHandleNavigationTreeChanged);
    document.removeEventListener('folder-lab-export', this.handleExportEvent.bind(this));
    document.removeEventListener('folder-lab-refresh', this.handleRefreshEvent.bind(this));

    if (this.renderTimeout) {
      window.clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }

    if (this.focusWorkspace) {
      this.focusWorkspace.destroy();
      this.focusWorkspace = null;
    }
  }


  private async openBoardView(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      new Notice('No hay una nota activa.');
      return;
    }

    const markdownLeaves =
      this.app.workspace.getLeavesOfType('markdown');

    const leaf = markdownLeaves.find(
      leaf =>
        leaf.view instanceof MarkdownView &&
        leaf.view.file?.path === activeFile.path
    );

    if (!leaf) {
      new Notice('No se encontró la vista de la nota activa.');
      return;
    }

    this.boardPreviousState = leaf.view.getState();

    await leaf.setViewState({
      type: BOARD_VIEW_TYPE,
      state: this.boardPreviousState
    });
  }


  private async closeBoardView(): Promise<void> {
    const boardLeaves =
      this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE);

    const leaf = boardLeaves[0];

    if (!leaf) {
      new Notice('No se encontró el Board activo.');
      return;
    }

    const state = leaf.view.getState();

    await leaf.setViewState({
      type: 'markdown',
      state
    });
  }


  // ============================================================
  // CONTEO DE PALABRAS
  // ============================================================

  showWordCountModal(result: WordCountResult): void {
    const currentPath = this.controller.getCurrentPath();
    const folder = currentPath ? this.app.vault.getAbstractFileByPath(currentPath) : null;
    const bookName = folder instanceof TFolder ? folder.name : 'Libro';

    const modal = new WordCountModal(this.app, result, bookName);
    modal.open();
  }

  // ============================================================
  // EVENTOS DEL VAULT
  // ============================================================

  private setupVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!(file instanceof TFile)) return;
        if (file.path.includes(`/${INTERNAL_FOLDER}/`)) return;

        // Registrar actividad de edición únicamente para notas Markdown.
        if (file.extension === 'md') {
          this.recentActivityService.scheduleEdit(file);
        }

        const currentPath = this.controller.getCurrentPath();

        console.log('[FOLDERLAB-VAULT-TRACE]', {
          evento: 'vault:modify',
          archivo: file.path,
          currentPath,
          llamaLoadFolder: !!(currentPath && file.path.startsWith(currentPath))
        });

        if (currentPath && file.path.startsWith(currentPath)) {
          this.controller.loadFolder(currentPath);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('create', async (file) => {
        if (!(file instanceof TFile)) return;
        if (file.path.includes(`/${INTERNAL_FOLDER}/`)) return;
        const currentPath = this.controller.getCurrentPath();
        if (currentPath && file.path.startsWith(currentPath)) {
          await this.controller.orderService.updateOrderOnCreate(file.path);
          this.controller.loadFolder(currentPath);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (!(file instanceof TFile)) return;
        if (file.path.includes(`/${INTERNAL_FOLDER}/`)) return;
        const currentPath = this.controller.getCurrentPath();
        if (currentPath && file.path.startsWith(currentPath)) {
          await this.controller.orderService.updateOrderOnDelete(file.path);
          this.controller.loadFolder(currentPath);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (file.path.includes(`/${INTERNAL_FOLDER}/`)) return;
        const currentPath = this.controller.getCurrentPath();
        if (currentPath && (file.path.startsWith(currentPath) || oldPath.startsWith(currentPath))) {
          await this.controller.orderService.updateOrderOnRename(oldPath, file.path);
          this.controller.loadFolder(currentPath);
        }
      })
    );
  }

  private setupActiveLeafEvents(): void {
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        const state = this.state;

        if (this.noteList) {
          this.noteList.updateActiveNote();
        }

        if (this.allNotesView) {
          this.allNotesView.updateActiveNote();
        }

        const activeFile = this.app.workspace.getActiveFile();

        // Primera señal del sistema de actividad:
        // la nota pasó a ser la nota activa.
        //
        // Esto NO decide todavía que la nota sea "reciente".
        // Solo deja evidencia en _activity.log para que el ranking
        // pueda combinarla después con edición, Contexto y widgets.
        if (activeFile) {
          void this.recentActivityService.record(activeFile, 'open', 1);
        }

        if (state.isFocusMode) {
          if (activeFile) {
            state.setFocusNote(activeFile.path);
          }
        }

        this.updateActiveNoteHighlight();

        const currentPath = this.controller.getCurrentPath();
        if (
          activeFile &&
          currentPath &&
          activeFile.path.startsWith(currentPath)
        ) {
          this.plugin.settings.lastOpenedNote = activeFile.path;
          this.plugin.saveSettings();
        }
      })
    );
  }

  // ============================================================
  // CARGA INICIAL
  // ============================================================

  private async loadInitialFolder(): Promise<void> {
    const masterPath = this.plugin.settings.bookRootPath;
    const lastFolder = this.plugin.settings.lastFolderPath;

    // ============================================================
    // MASTER = ROOT DEL VAULT
    // "" es una ubicación válida: representa la raíz física.
    // ============================================================
    if (masterPath === '') {
      await this.controller.loadFolder('');
      await this.restoreLastOpenedNote();
      return;
    }


    if (masterPath) {
      const folder = this.app.vault.getAbstractFileByPath(masterPath);
      if (folder instanceof TFolder) {
        await this.controller.loadFolder(masterPath);
        await this.restoreLastOpenedNote();
        return;
      }
    }

    if (lastFolder) {
      const folder = this.app.vault.getAbstractFileByPath(lastFolder);
      if (folder instanceof TFolder) {
        await this.controller.loadFolder(lastFolder);
        await this.restoreLastOpenedNote();
        return;
      }
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile?.parent) {
      await this.controller.loadFolder(activeFile.parent.path);
      return;
    }

    const rootFolder = this.app.vault.getRoot();
    const firstFolder = rootFolder.children.find(child => child instanceof TFolder);
    if (firstFolder instanceof TFolder) {
      await this.controller.loadFolder(firstFolder.path);
    }
  }

  private async restoreLastOpenedNote(): Promise<void> {
    const lastNotePath = this.plugin.settings.lastOpenedNote;
    if (!lastNotePath) return;

    const file = this.app.vault.getAbstractFileByPath(lastNotePath);
    if (!(file instanceof TFile)) return;

    const currentPath = this.controller.getCurrentPath();
    if (!currentPath) return;
    if (!file.path.startsWith(currentPath)) return;

    await this.app.workspace.getLeaf().openFile(file);
    this.state.currentNoteType = file.name;
  }

  // ============================================================
  // CARGA DE CARPETA Y RENDERIZADO
  // ============================================================

  private async loadFolder(folderPath: string): Promise<void> {
    console.log('[FOLDERLAB-VIEW-TRACE]', {
      metodo: 'loadFolder(vista)',
      folderPath,
      navType: this.navigationService?.getNavigationType() ?? 'folders(desconocido)',
      navigationMode: (this.state as any).navigationMode,
      isAllNotes: this.state.isAllNotesMode(),
      pila: new Error().stack?.split('\n').slice(2, 8).join('\n')
    });
    if (this._isDisposed) return;

    if (this.state.isFocusMode) {
      return;
    }

    const navType = this.navigationService?.getNavigationType() || 'folders';

    const folder =
      folderPath === ''
        ? this.app.vault.getRoot()
        : this.app.vault.getAbstractFileByPath(folderPath);

    if (!(folder instanceof TFolder)) {
      this.showEmptyState('Carpeta no encontrada');
      return;
    }

    this.headerComponent.updateTitle();

    await this.headerComponent.updateStats();
    this.headerComponent.updateBackButton();

    if (this.state.isFolderTreeMode() && this.state.isAllNotesMode()) {
      await this.renderCombinedMode(folder);
    } else if (this.state.isFolderTreeMode()) {
      await this.renderFolderMode(folder);
    } else if (this.state.isAllNotesMode()) {
      console.log('[FOLDERLAB-VIEW-TRACE]', { decision: 'renderAllNotesMode', isAllNotes: true });
      await this.renderAllNotesMode(folder);
    } else {
      console.log('[FOLDERLAB-VIEW-TRACE]', { decision: 'renderNormalMode', isAllNotes: this.state.isAllNotesMode(), modo: (this.state as any).navigationMode });
      await this.renderNormalMode(folder);
    }

    this.state.currentNoteType = 'general';
    if (this.noteArea) {
      await this.noteArea.loadNote();
    }

    this.updateActiveNoteHighlight();
  }

  // ============================================================
  // HELPER: CREAR VIRTUAL ROOT
  // ============================================================

  /**
   * Crea un nodo raíz virtual para la navegación por propiedades
   */
  private createVirtualRoot(tree: NavigationTree): NavigationNode {
    return {
      id: 'virtual:root',
      path: 'virtual:root',
      title: 'Navegación por propiedades',
      parentPath: null,
      type: 'folder',
      filePath: null,
      children: tree.root,
      metadata: {
        isVirtualFolder: true,
        isOwnPage: false,
        isVirtualRoot: true
      }
    };
  }

  /**
   * Obtiene el contexto actual de navegación
   * El contexto NUNCA cambia al cambiar de modo (Normal/Carpetas/Todas)
   *
   * El nodo devuelto pertenece SIEMPRE al árbol actual: aunque el
   * ID siga existiendo, el objeto anterior conserva los hijos en
   * el orden previo a la última reconstrucción (p. ej. después de
   * renumerar nav_order). Devolver el objeto viejo dejaba a la
   * vista normal listando el orden anterior.
   */
  private getCurrentContext(tree: NavigationTree): NavigationNode {
    // Si no hay contexto, usar virtual root
    if (!this.currentNavigationNode) {
      return this.createVirtualRoot(tree);
    }

    // Resolver el ID en el árbol ACTUAL y devolver el nodo fresco
    const fresh = tree.nodeMap.get(this.currentNavigationNode.id);

    if (fresh) {
      return fresh;
    }

    //  Si ya no existe, volver al virtual root
    return this.createVirtualRoot(tree);
  }

  /**
   * Obtiene la OWN PAGE de un nodo (si existe)
   */
  private getOwnPage(node: NavigationNode): NavigationNode | null {
    if (!node.children) return null;
    return node.children.find(child => child.metadata?.isOwnPage === true) || null;
  }

  /**
   * Obtiene los hijos estructurales (excluyendo OWN PAGE)
   */
  private getStructuralChildren(node: NavigationNode): NavigationNode[] {
    if (!node.children) return [];
    // Si es virtual root, todos los hijos son estructurales
    if (node.id === 'virtual:root') {
      return node.children;
    }
    // Para carpetas virtuales, excluir OWN PAGE
    return node.children.filter(child => !child.metadata?.isOwnPage);
  }

  /**
   * Verifica si un nodo es un contenedor virtual
   */
  private isVirtualContainer(node: NavigationNode): boolean {
    return node.type === 'folder' || (node.children && node.children.length > 0);
  }

  /**
   * Obtiene solo los contenedores directos de un nodo
   */
  private getDirectContainers(node: NavigationNode): NavigationNode[] {
    const children = this.getStructuralChildren(node);
    return children.filter(child => this.isVirtualContainer(child));
  }

  /**
   * Obtiene solo las notas directas de un nodo (excluyendo contenedores)
   */
  private getDirectNotes(node: NavigationNode): NavigationNode[] {
    const children = this.getStructuralChildren(node);
    return children.filter(child => !this.isVirtualContainer(child));
  }


  /**
   * Calcula las estadísticas del contexto actual de Properties.
   *
   * A diferencia de Filesystem, Properties no utiliza currentPath.
   * El contexto está representado por un NavigationNode.
   */
  private async getPropertyStats(
    node: NavigationNode
  ): Promise<{ totalNotes: number; percentage: number }> {

    const files: TFile[] = [];

    const collectNotes = (current: NavigationNode): void => {
      if (current.filePath) {
        const file = this.app.vault.getFileByPath(current.filePath);

        if (file instanceof TFile) {
          files.push(file);
        }
      }

      if (current.children) {
        for (const child of current.children) {
          collectNotes(child);
        }
      }
    };

    // No contar el propio virtual root como archivo.
    // Sus descendientes sí forman parte del contexto.
    if (node.id === 'virtual:root') {
      for (const child of node.children || []) {
        collectNotes(child);
      }
    } else {
      collectNotes(node);
    }

    const stats =
      await this.controller.statsService.calculateNoteStats(files);

    return {
      totalNotes: stats.total,
      percentage: stats.percentage
    };
  }

  // ============================================================
  // RENDERIZADO DE NAVEGACIÓN POR PROPIEDADES
  // ============================================================

  /**
   * Renderiza navegación por propiedades usando el Virtual Root
   */
  private async renderPropertyNavigation(): Promise<void> {
    if (!this.navigationService) return;

    if (!this.headerComponent) {
      console.warn('[PROPERTY NAV] headerComponent no existe, construyendo...');
      if (this.explorerContainer) {
        this.buildExplorerMode(this.explorerContainer);
      } else {
        console.error('[PROPERTY NAV] No se puede construir headerComponent');
        return;
      }
    }

    // Limpiar contenedor
    this.listContainer.empty();

    this.logRender('properties', { method: 'renderPropertyNavigation' });

    const tree = await this.navigationService.build();

    // Obtener el contexto (NUNCA cambia al cambiar de modo)
    const contextNode = this.getCurrentContext(tree);

    // Guardar el contexto actual
    this.currentNavigationNode = contextNode;

    // Actualizar header
    const title = contextNode.id === 'virtual:root'
      ? this.controller.getVaultName()
      : contextNode.title;

this.headerComponent.updateFolderName(title);
this.headerComponent.updateWordCountVisibility();

    const propertyStats =
      await this.getPropertyStats(contextNode);

    await this.headerComponent.updateStats(propertyStats);

    this.headerComponent.updateBackButton();

    // Crear NoteListComponent si no existe
    if (!this.noteList) {
      this.noteList = new NoteListComponent(
        this.app,
        this.state,
        this.controller,
        this.controller.filterService,
        this.controller.orderService,
        this.controller.noteService,
        this.listContainer,
        (item: FolderLabItem) => this.handleVirtualItemClick(item),
        (path: string) => this.navigateToVirtualNodeByPath(path),
        (newOrder: string[]) => {
          // El refresco de Properties lo gestiona
          // NavigationService mediante order-changed.
        }
      );
    }

    //  Crear AllNotesView si no existe
    if (!this.allNotesView) {
      this.allNotesView = new AllNotesView(
        this.app,
        this.state,
        this.controller,
        this.controller.orderService,
        this.controller.noteService,
        this.listContainer,
        (item: FolderLabItem) => this.handleVirtualItemClick(item),
        (path: string) => this.navigateToVirtualNodeByPath(path),
        (newOrder: string[]) => this.controller.reorderItems(newOrder)
      );
    }

    //  Crear SubfolderView si no existe
    if (!this.subfolderView) {
      this.subfolderView = new SubfolderView(
        this.app,
        this.state,
        this.controller,
        this.controller.orderService,
        this.controller.noteService,
        this.listContainer,
        (item: FolderLabItem) => this.handleVirtualItemClick(item),
        (path: string) => this.navigateToVirtualNodeByPath(path),
        (newOrder: string[]) => this.controller.reorderItems(newOrder)
      );
    }

    //  Decidir qué mostrar según el modo (sin cambiar el contexto)
    if (this.state.isAllNotesMode()) {
      await this.renderAllNotesModeProperties(tree, contextNode);
      return;
    }

    if (this.state.isFolderTreeMode()) {
      await this.renderFolderModeProperties(contextNode);
      return;
    }

    //  Modo Normal
    await this.renderNormalModeProperties(contextNode);
  }

  private async renderRecentNotesMode(): Promise<void> {
    if (this._isDisposed) return;

    this.listContainer.empty();

    const recentNotes =
      await this.recentActivityService.getRecentNotes(5);


    if (recentNotes.length === 0) {
      this.showEmptyState('No hay notas recientes');
      return;
    }

    const listItems: ListItem[] = [];

    for (const recent of recentNotes) {
      const file =
        this.app.vault.getFileByPath(recent.path);

      if (!(file instanceof TFile)) {
        continue;
      }

      const status =
        await this.controller.noteService
          .getNoteStatusByFile(file);

      const item: FolderLabItem = {
        name: file.name,
        path: file.path,
        isSpecial: false,
        file,
        isEmpty: false,
        status: status || undefined
      };

      listItems.push({
        type: 'note',
        data: item,
        level: 0,
      });
    }

    if (listItems.length === 0) {
      this.showEmptyState('No hay notas recientes');
      return;
    }

    if (!this.noteList) {
      this.noteList = new NoteListComponent(
        this.app,
        this.state,
        this.controller,
        this.controller.filterService,
        this.controller.orderService,
        this.controller.noteService,
        this.listContainer,
        (item: FolderLabItem) =>
          this.controller.openNote(item),
        (path: string) => {
          this.exitGlobalModes();
          this.controller.loadFolder(path);
        },
        (newOrder: string[]) =>
          this.controller.reorderItems(newOrder)
      );
    }

    await this.noteList.render(
      listItems,
      {
        applyFilter: false,
        enableDragAndDrop: false
      }
    );

    this.noteList.updateActiveNote();
  }

  /**
   *  Modo Normal: OWN PAGE + notas directas (excluyendo contenedores)
   */
  private async renderNormalModeProperties(contextNode: NavigationNode): Promise<void> {
    console.log('[FOLDERLAB-VIEW-TRACE]', { metodo: 'renderNormalModeProperties', isAllNotes: this.state.isAllNotesMode() });
    const items: ListItem[] = [];
    const filesForStats: TFile[] = [];
    let localNumber = 0;

    // 1. OWN PAGE (si existe y no es virtual root)
    const ownPage = this.getOwnPage(contextNode);
    if (ownPage && contextNode.id !== 'virtual:root') {
      const file = ownPage.filePath
        ? this.app.vault.getFileByPath(ownPage.filePath)
        : null;
      const status = file
        ? await this.controller.noteService.getNoteStatusByFile(file)
        : '';

      if (file) {
        filesForStats.push(file);
        items.push({
          type: 'note',
          data: {
            name: ownPage.title + '.md',
            path: ownPage.filePath!,
            isSpecial: false,
            isOwnPage: true,
            file: file,
            isEmpty: false,
            status: status || undefined
          },
          level: 0,
          number: undefined
        });
      }
    }

    // 2. Notas directas
    const directNotes = this.getDirectNotes(contextNode);

    for (const note of directNotes) {
      const file = note.filePath
        ? this.app.vault.getFileByPath(note.filePath)
        : null;
      const status = file
        ? await this.controller.noteService.getNoteStatusByFile(file)
        : '';

      if (file) {
        filesForStats.push(file);
        items.push({
          type: 'note',
          data: {
            name: note.title + '.md',
            path: note.path,
            isSpecial: false,
            file: file,
            isEmpty: false,
            status: status || undefined
          },
          level: 0,
          number: localNumber++
        });
      }
    }



    const stats =
      await this.controller.statsService.calculateNoteStats(
        filesForStats
      );

    await this.headerComponent.updateStats({
      totalNotes: stats.total,
      percentage: stats.percentage
    });

    if (items.length === 0) {
      this.showEmptyState('No hay elementos para mostrar');
      return;
    }

    console.log('[PROPERTY NAV] Modo: Normal - items:', items.length);
    await this.noteList!.render(items);
  }

  /**
   *  Modo Todas las notas: árbol completo desde el contexto
   */
  private async renderAllNotesModeProperties(
    tree: NavigationTree,
    contextNode: NavigationNode
  ): Promise<void> {
    console.log('[FOLDERLAB-VIEW-TRACE]', { metodo: 'renderAllNotesModeProperties', contexto: contextNode.id, isAllNotes: this.state.isAllNotesMode() });

    const stats =
      contextNode.id === 'virtual:root'
        ? await this.allNotesView!.renderNavigation(tree)
        : await this.allNotesView!.renderNavigation(tree, contextNode);

    await this.headerComponent.updateStats(stats);
  }

  /**
   *  Modo Carpetas: solo contenedores directos (sin OWN PAGE, sin notas)
   */
  private async renderFolderModeProperties(contextNode: NavigationNode): Promise<void> {
    const items: ListItem[] = [];

    // Obtener contenedores directos
    const containers = this.getDirectContainers(contextNode);

    for (const container of containers) {
      items.push({
        type: 'folder',
        data: {
          name: container.title,
          path: container.path,
          level: 0
        },
        level: 0
      });
    }

    if (items.length === 0) {
      this.showEmptyState('No hay subcarpetas para mostrar');
      return;
    }

    console.log('[PROPERTY NAV] Modo: Carpetas - items:', items.length);
    await this.noteList!.render(items);
  }

  /**
   *  Navega a un nodo virtual (cambia el contexto)
   */
  private async navigateToVirtualNode(
    node: NavigationNode
  ): Promise<void> {
    console.log(
      '[VIRTUAL NAV] Navegando a:',
      node.title,
      'tipo:',
      node.type
    );

    // Si no tiene hijos → abrir archivo
    if (
      node.type === 'note' ||
      (!node.children || node.children.length === 0)
    ) {
      if (node.filePath) {
        const file = this.app.vault.getFileByPath(node.filePath);
        if (file) {
          await this.app.workspace.getLeaf().openFile(file);
          return;
        }
      }
      return;
    }

    // Es una carpeta virtual → establecer como contexto
    this.currentNavigationNode = node;

    // Resetear modos a normal (el modo se mantiene, pero el contexto cambia)
    this.exitGlobalModes();
    this.updateToolbarButtons();

    // Recargar la vista con el nuevo contexto
    await this.renderPropertyNavigation();
  }

  /**
   *  Navega a un nodo virtual por su path
   */
  private async navigateToVirtualNodeByPath(path: string): Promise<void> {
    if (!this.navigationService) return;

    const tree = await this.navigationService.build();

    let node = tree.nodeMap.get(path);
    if (!node) {
      for (const n of tree.flatNodes) {
        if (n.path === path || n.id === path) {
          node = n;
          break;
        }
      }
    }

    if (node) {
      await this.navigateToVirtualNode(node);
    } else {
      console.warn('[VIRTUAL NAV] Nodo no encontrado:', path);
      new Notice(`❌ Nodo no encontrado: ${path}`);
    }
  }

  /**
   *  Maneja el clic en un item (distingue entre carpeta virtual y nota real)
   */
  private async handleVirtualItemClick(item: FolderLabItem): Promise<void> {
    // Si no tiene file, es una carpeta virtual → navegar
    if (!item.file && item.path) {
      const tree = await this.navigationService!.build();
      let node = tree.nodeMap.get(item.path);
      if (!node) {
        for (const n of tree.flatNodes) {
          if (n.path === item.path || n.id === item.path) {
            node = n;
            break;
          }
        }
      }
      if (node) {
        await this.navigateToVirtualNode(node);
      }
      return;
    }

    // Nota real → abrir
    if (item.file) {
      this.controller.openNote(item);
    }
  }

  /**
   *  Volver al nodo anterior (modo properties)
   */
  private async goBackVirtual(): Promise<void> {
    this.currentNavigationNode = null;

    this.currentNavigationNode = this.navigationHistory.pop() || null;
    await this.renderPropertyNavigation();
  }

  private renderContent(): void {
    if (this._isDisposed) return;
    this.headerComponent.updateStats();
    this.headerComponent.updateBackButton();
    this.updateActiveNoteHighlight();
  }

  /**
   * Navega al padre jerárquico.
   *
   * La fuente de verdad es siempre el NavigationProvider
   * activo mediante NavigationService.
   */
  async goToParent(): Promise<void> {
    const navigationService = this.navigationService;

    if (!navigationService) return;

    const navType = navigationService.getNavigationType();

    // ============================================================
    // PROPERTIES
    // ============================================================

    if (navType === 'properties') {
      const currentNode = this.currentNavigationNode;

      if (!currentNode) {
        // Ya estamos en virtual:root
        return;
      }

      const parentId = navigationService.getParent(
        currentNode.id
      );

      // ------------------------------------------------------------
      // El padre es virtual:root
      // ------------------------------------------------------------

      if (parentId === 'virtual:root') {
        const tree = navigationService.getTree();

        if (!tree) {
          console.warn(
            '[PROPERTY NAV] No existe NavigationTree para volver al root'
          );
          return;
        }

        const rootNode =
          tree.nodeMap.get('virtual:root');

        if (!rootNode) {
          console.warn(
            '[PROPERTY NAV] virtual:root no encontrado en NavigationTree'
          );
          return;
        }

        this.currentNavigationNode = rootNode;

        this.exitGlobalModes();
        this.updateToolbarButtons();

        await this.renderPropertyNavigation();
        return;
      }

      // ------------------------------------------------------------
      // No hay padre → ya estamos en raíz
      // ------------------------------------------------------------

      if (!parentId) {
        this.currentNavigationNode = null;

        this.exitGlobalModes();
        this.updateToolbarButtons();

        await this.renderPropertyNavigation();
        return;
      }

      // ------------------------------------------------------------
      // Buscar el nodo padre en el árbol
      // ------------------------------------------------------------

      const tree = navigationService.getTree();

      if (!tree) {
        console.warn(
          '[PROPERTY NAV] No existe NavigationTree'
        );
        return;
      }

      const parentNode =
        tree.nodeMap.get(parentId) ||
        tree.flatNodes.find(
          node =>
            node.id === parentId ||
            node.path === parentId
        );

      if (!parentNode) {
        console.warn(
          '[PROPERTY NAV] Parent no encontrado:',
          parentId
        );
        return;
      }

      this.currentNavigationNode = parentNode;

      this.exitGlobalModes();
      this.updateToolbarButtons();

      await this.renderPropertyNavigation();
      return;
    }

    // ============================================================
    // FOLDERS
    // ============================================================

    const currentPath = this.controller.getCurrentPath();

    if (!currentPath) return;

    const parentPath =
      navigationService.getParent(currentPath);

    if (!parentPath) return;

    this.exitGlobalModes();
    this.updateToolbarButtons();
    console.log('[BACK TO PARENT]', {
      currentPath,
      parentPath
    });


    await this.controller.loadFolder(parentPath);
  }

  /**
   * Determina si existe un padre navegable.
   *
   * No utiliza historial.
   * No calcula jerarquía por filesystem.
   * Delega exclusivamente al NavigationProvider activo.
   */
  canGoBack(): boolean {
    const navigationService = this.navigationService;

    if (!navigationService) {
      console.log(
        '[BACK DEBUG] navigationService = NULL'
      );
      return false;
    }

    const navType =
      navigationService.getNavigationType();

    // ============================================================
    // PROPERTIES
    // ============================================================

    if (navType === 'properties') {
      const currentNode =
        this.currentNavigationNode;

      if (!currentNode) {
        console.log(
          '[BACK DEBUG] PROPERTIES - virtual:root'
        );
        return false;
      }

      const result =
        navigationService.canGoBack(
          currentNode.id
        );

      return result;
    }

    // ============================================================
    // FOLDERS
    // ============================================================

    const currentPath =
      this.controller.getCurrentPath();

    if (!currentPath) {
      console.log(
        '[BACK DEBUG] FOLDERS - sin currentPath'
      );
      return false;
    }

    const result =
      navigationService.canGoBack(
        currentPath
      );

    return result;
  }
  /**
   * Obtiene el nodo de navegación actual (para HeaderComponent)
   */
  getCurrentNavigationNode(): NavigationNode | null {
    return this.currentNavigationNode;
  }

  // ============================================================
  // MODOS DE RENDERIZADO (EXPLORER)
  // ============================================================

  private async renderNormalMode(folder: TFolder): Promise<void> {
    console.log('[FOLDERLAB-VIEW-TRACE]', { metodo: 'renderNormalMode(vista-carpetas)', folder: folder.path, isAllNotes: this.state.isAllNotesMode() });
    this.logRender('folders', { folder: folder.path });

    this.listContainer.empty();

    const items = this.state.items || [];

    let noteNumber = 0;

    const listItems: ListItem[] = items.map(item => {
      const number = item.isSpecial ? undefined : noteNumber++;
      return {
        type: 'note',
        data: item,
        level: 0,
        number
      };
    });

    if (!this.noteList) {
      this.noteList = new NoteListComponent(
        this.app,
        this.state,
        this.controller,
        this.controller.filterService,
        this.controller.orderService,
        this.controller.noteService,
        this.listContainer,
        (item: FolderLabItem) => this.controller.openNote(item),
        (path: string) => {
          this.exitGlobalModes();
          this.controller.loadFolder(path);
        },
        (newOrder: string[]) => this.controller.reorderItems(newOrder)
      );
    }

    await this.noteList.render(listItems);
    this.noteList.updateActiveNote();
  }

  private async renderFolderMode(folder: TFolder): Promise<void> {
    this.logRender('folders', { folder: folder.path });

    this.listContainer.empty();

    if (!this.subfolderView) {
      this.subfolderView = new SubfolderView(
        this.app,
        this.state,
        this.controller,
        this.controller.orderService,
        this.controller.noteService,
        this.listContainer,
        (item: FolderLabItem) => this.controller.openNote(item),
        (path: string) => {
          this.exitGlobalModes();
          this.controller.loadFolder(path);
        },
        (newOrder: string[]) => this.controller.reorderItems(newOrder)
      );
    }

    this.subfolderView.render(folder.path);
  }

  private async renderAllNotesMode(folder: TFolder): Promise<void> {
    console.log('[FOLDERLAB-VIEW-TRACE]', { metodo: 'renderAllNotesMode(vista-carpetas)', folder: folder.path });
    this.logRender('folders', { folder: folder.path });

    this.listContainer.empty();

    if (!this.allNotesView) {
      this.allNotesView = new AllNotesView(
        this.app,
        this.state,
        this.controller,
        this.controller.orderService,
        this.controller.noteService,
        this.listContainer,
        (item: FolderLabItem) => this.controller.openNote(item),
        (path: string) => {
          this.exitGlobalModes();
          this.controller.loadFolder(path);
        },
        (newOrder: string[]) => this.controller.reorderItems(newOrder)
      );
    }

    await this.allNotesView.render(folder.path);
  }

  private async renderCombinedMode(folder: TFolder): Promise<void> {
    this.listContainer.empty();
    const message = this.listContainer.createEl('p', { cls: 'folder-lab-empty' });
    message.textContent = 'Modo combinado (próximamente)';
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

  private showEmptyState(message: string): void {
    if (!this.listContainer) return;
    this.listContainer.empty();
    const el = this.listContainer.createEl('p', { cls: 'folder-lab-empty' });
    el.textContent = message;
  }

  private async reloadGeneralNote(): Promise<void> {
    this.state.currentNoteType = 'general';
    if (this.noteArea) {
      await this.noteArea.loadNote();
    }
  }

  // ============================================================
  // HANDLERS DE EVENTOS PERSONALIZADOS
  // ============================================================

  private async handleExportEvent(event: Event): Promise<void> {
    const customEvent = event as CustomEvent;
    const folderPath = customEvent.detail?.folderPath || this.controller.getCurrentPath();
    if (folderPath) {
      await this.controller.exportAllNotes();
    }
  }

  private async handleRefreshEvent(event: Event): Promise<void> {
    const navigationType = this.controller.navigationService.getNavigationType();

    if (navigationType === 'properties') {
      await this.renderPropertyNavigation();
      return;
    }

    const customEvent = event as CustomEvent;
    const folderPath =
      customEvent.detail?.folderPath ||
      this.controller.getCurrentPath();

    if (folderPath) {
      await this.controller.loadFolder(folderPath);
      await this.loadFolder(folderPath);
    }
  }

  /**
   * Refresca la navegación desde Settings
   */
  async refreshNavigation(): Promise<void> {
    if (!this.navigationService) return;

    // Limpiar estado de navegación anterior.
    this.currentNavigationNode = null;
    this.navigationHistory = [];
    this.listContainer.empty();

    // Al cambiar de modalidad, comenzar siempre
    // en la Vista Normal.
    this.exitGlobalModes();
    this.updateToolbarButtons();

    const navType = this.navigationService.getNavigationType();

    // ============================================================
    // PROPERTIES
    // ============================================================

    if (navType === 'properties') {
      // Reconstruir el árbol Properties y establecer
      // explícitamente el nodo virtual:root como contexto actual.
      const tree = await this.navigationService.build();

      this.currentNavigationNode =
        tree.nodeMap.get('virtual:root') || null;

      if (!this.currentNavigationNode) {
        console.error(
          '[PROPERTIES] No se pudo establecer virtual:root'
        );
        return;
      }

      await this.renderPropertyNavigation();
      return;
    }

    // ============================================================
    // FILESYSTEM
    // ============================================================

    await this.navigationService.refresh();

    const masterPath = this.plugin.settings.bookRootPath;

    // El root del vault se representa mediante "".
    if (masterPath === '') {
      await this.controller.loadFolder('');
      return;
    }

    // Master físico.
    if (masterPath) {
      const folder =
        this.app.vault.getAbstractFileByPath(masterPath);

      if (folder instanceof TFolder) {
        await this.controller.loadFolder(masterPath);
        return;
      }
    }

    // Fallback: conservar la carpeta física actual.
    const currentPath = this.controller.getCurrentPath();

    if (currentPath !== null) {
      await this.loadFolder(currentPath);
      return;
    }

    // Último fallback: comportamiento normal de inicialización.
    await this.loadInitialFolder();
  }
  // ============================================================
  // RESALTADO DE NOTA ACTIVA
  // ============================================================

  private updateActiveNoteHighlight(): void {
    if (!this.listContainer) return;
    const active = this.app.workspace.getActiveFile();
    const currentPath = this.controller.getCurrentPath();
    if (!active || !currentPath || !active.path.startsWith(currentPath)) return;

    const items = this.listContainer.querySelectorAll('.folder-lab-item');
    items.forEach(el => {
      const filename = el.getAttribute('data-filename');
      if (filename === active.name) {
        el.addClass('is-active');
      } else {
        el.removeClass('is-active');
      }
    });
  }
}
