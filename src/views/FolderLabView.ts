// ============================================================
// CORE: FolderLabView - COORDINADOR PRINCIPAL
// ============================================================
// Renderiza la vista. SOLO CONSUME estado de navegación.
// ============================================================

import { ItemView, WorkspaceLeaf, TFolder, TFile, Notice, MarkdownView } from 'obsidian';
import FolderLabPlugin from '../main';
import { VIEW_TYPE_FOLDER_ORDER, INTERNAL_FOLDER } from '../constants/view-types';
import { FolderLabController, FolderLabEvent } from '../core/FolderLabController';
import { FolderLabState } from '../core/FolderLabState';
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
import { shouldStartSessionWordCount } from '../utils/headerStats';
import { i18n } from '../i18n/I18nService';
import { applyObsidianLocale } from '../i18n/obsidianLocale';
import { RecentActivityService } from '../services/RecentActivityService';
import { WidgetManager } from '../focus/WidgetManager';

// ============================================================
// IMPORTS PARA FOCUS
// ============================================================
import { FocusWorkspace } from '../focus/FocusWorkspace';
import { FocusWidgetRegistry } from '../focus/FocusWidgetRegistry';
import { BOARD_VIEW_TYPE } from '../focus/BoardView';

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

  /**
   * Garantiza una sola patada del conteo automático de palabras
   * por instancia de vista (por sesión): evita que las varias
   * rutas de inicialización multipliquen los recorridos del libro.
   */
  private wordCountInitStarted: boolean = false;

  // ============================================================
  // NAVEGACIÓN VIRTUAL (MODO PROPERTIES)
  // ============================================================
  private currentNavigationNode: NavigationNode | null = null;
  private boundHandleNavigationTreeChanged = this.handleNavigationTreeChanged.bind(this);
  /*
   * 3B: handlers de document como campos estables. Registrar con
   * `.bind(this)` inline y remover con OTRO `.bind(this)` no
   * elimina nada (identidad distinta): los listeners sobrevivían
   * al cierre de la vista y seguían actuando sobre ella dispuesta.
   */
  private boundHandleExportEvent = this.handleExportEvent.bind(this);
  private boundHandleRefreshEvent = this.handleRefreshEvent.bind(this);
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
      void this.handleEvent(event);
    });

    document.addEventListener('folder-lab-export', this.boundHandleExportEvent);
    document.addEventListener('folder-lab-refresh', this.boundHandleRefreshEvent);
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  //  Obtener NavigationService del controller
  private get navigationService(): NavigationService | null {
    return this.controller.navigationService;
  }

  async loadFolderOrder(folderPath: string): Promise<void> {
    if (this._isDisposed) return;
    /*
     * controller.loadFolder notifica folderChanged y la vista ya
     * renderiza en el manejador. Llamar también a loadFolder(vista)
     * duplicaba el renderizado (encabezado y lista) en esta ruta.
     */
    await this.controller.loadFolder(folderPath);
    this.plugin.settings.lastFolderPath = folderPath;
    await this.plugin.saveSettings();
  }

  refresh(): void {
    if (this._isDisposed) return;
    const currentPath = this.controller.getCurrentPath();
    if (currentPath) {
      void this.controller.loadFolder(currentPath).catch((error) => {
        console.error('[FolderLab] Error cargando la carpeta:', error);
      });
    }
  }

  // ============================================================
  // MANEJADOR DE NAVIGATION-TREE-CHANGED
  // ============================================================

  private async handleNavigationTreeChanged(): Promise<void> {
    if (!this.navigationService) {
            return;
    }

    const navType = this.navigationService.getNavigationType();

    if (navType === 'properties') {
            // El árbol ya se reconstruyó en NavigationService.refresh()
      // (origen de este evento): reutilizarlo evita un segundo
      // escaneo completo del vault.
      await this.renderPropertyNavigation(
        this.navigationService.getTree() ?? undefined
      );
    }
  }

  // ============================================================
  // TOGGLES DE NAVEGACIÓN - USANDO NavigationMode
  // ============================================================

  toggleFolderMode(): void {
    if (this._isDisposed) return;

    const navType = this.navigationService?.getNavigationType() || 'folders';

    if (navType === 'properties') {
            this.state.toggleFolderMode();
      this.updateToolbarButtons();
      void this.renderPropertyNavigation().catch((error) => {
        console.error('[FolderLab] Error renderizando la navegación:', error);
      });
    } else {
      this.state.toggleFolderMode();
      this.updateToolbarButtons();

      const currentPath = this.controller.getCurrentPath();
      if (currentPath) {
        void this.loadFolder(currentPath).catch((error) => {
          console.error('[FolderLab] Error cargando la carpeta:', error);
        });
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
      void this.renderPropertyNavigation().catch((error) => {
        console.error('[FolderLab] Error renderizando la navegación:', error);
      });
      return;
    }

    const currentPath = this.controller.getCurrentPath();

    if (currentPath !== null) {
      void this.loadFolder(currentPath).catch((error) => {
        console.error('[FolderLab] Error cargando la carpeta:', error);
      });
    }
  }

  toggleAllNotesMode(): void {
    if (this._isDisposed) return;

    const navType = this.navigationService?.getNavigationType() || 'folders';

    if (navType === 'properties') {
            this.state.toggleAllNotesMode();
      this.updateToolbarButtons();
      void this.renderPropertyNavigation().catch((error) => {
        console.error('[FolderLab] Error renderizando la navegación:', error);
      });
    } else {
      this.state.toggleAllNotesMode();
      this.updateToolbarButtons();

      const currentPath = this.controller.getCurrentPath();
      if (currentPath) {
        void this.loadFolder(currentPath).catch((error) => {
          console.error('[FolderLab] Error cargando la carpeta:', error);
        });
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
          i18n.t('actions.recentNotesActive')
        );
      } else {
        recentNotesBtn.removeClass('is-active');
        recentNotesBtn.setAttr(
          'aria-label',
          i18n.t('actions.recentNotesInactive')
        );
      }
    }

    const folderBtn = containerEl.querySelector('#folder-lab-folder-btn') as HTMLElement;
    if (folderBtn) {
      if (this.state.isFolderTreeMode()) {
        folderBtn.addClass('is-active');
        folderBtn.setAttr('aria-label', i18n.t('actions.hideFolders'));
      } else {
        folderBtn.removeClass('is-active');
        folderBtn.setAttr('aria-label', i18n.t('actions.showFolders'));
      }
    }

    const allNotesBtn = containerEl.querySelector('#folder-lab-all-notes-btn') as HTMLElement;
    if (allNotesBtn) {
      if (this.state.isAllNotesMode()) {
        allNotesBtn.addClass('is-active');
        allNotesBtn.setAttr('aria-label', i18n.t('actions.recentNotesActive'));
      } else {
        allNotesBtn.removeClass('is-active');
        allNotesBtn.setAttr('aria-label', i18n.t('actions.allNotes'));
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
          i18n.t('actions.filterActive')
        );
      } else {
        filterBtn.removeClass('is-active');
        filterBtn.setAttr(
          'aria-label',
          i18n.t('actions.filterNotes')
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

    state.toggleFocusMode();

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

        void this.showFocusMode().catch((error) => {
          console.error('[FolderLab] Error abriendo el modo Contexto:', error);
        });
      } else {
        new Notice(i18n.t('errors.focus.noActiveNote'));
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
    return i18n.t('common.appName');
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
                        break;
          }

          /*
           * Proveedor folders con vista ALL_NOTES: refrescar el
           * listado en su sitio, SIN salir del modo (conserva la
           * actualización ante cambios estructurales legítimos).
           */
          const allNotesFolder =
            this.app.vault.getAbstractFileByPath(event.folderPath);

          if (allNotesFolder instanceof TFolder) {
            await this.renderAllNotesMode(allNotesFolder);
          }

          break;
        }

        /*
         * Vista de recientes activa: el MODO es la fuente de
         * verdad. Un cambio de carpeta genérico NO expulsa de
         * recientes ni pinta las estadísticas de master: se
         * rederiva la propia lista (y su recuento) en su sitio.
         */
        if (this.state.isRecentNotesMode()) {
                    await this.renderRecentNotesMode();
          break;
        }

                this.exitGlobalModes();
        // Await: el renderizado de la vista se serializa con el
        // evento; sin él, esta ruta y las llamadas explícitas
        // concurrentes solapaban renderizados del encabezado.
        await this.loadFolder(event.folderPath);
        break;

      case 'noteChanged':

        this.state.currentNoteType = 'general';
        if (this.noteArea) {
          void this.noteArea.loadNote().catch((error) => {
            console.error('[FolderLab] Error cargando la nota:', error);
          });
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

      case 'modeChanged': {


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
            await this.loadFolder(currentPath);
          }
        } else {
          const currentPath = this.controller.getCurrentPath();
          if (currentPath) {
            await this.loadFolder(currentPath);
          }
        }
        break;

      }
      case 'itemsChanged': {


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

      }
      case 'filterChanged': {
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

      }
      default:
        console.warn('Evento desconocido:', event);
    }
  }


  // ============================================================
  // CICLO DE VIDA
  // ============================================================

  async onOpen(): Promise<void> {
    if (this._isDisposed) return;

    // Reevaluar el locale de Obsidian al (re)abrir la vista.
    // Idempotente: solo actúa si el idioma activo cambió.
    applyObsidianLocale();

    const container = this.contentEl;
    container.empty();
    container.addClass('folder-lab-view');

    this.explorerContainer = container.createEl('div', {
      cls: 'folder-lab-explorer-mode'
    });

    this.focusContainer = container.createEl('div', {
      cls: 'folder-lab-focus-mode is-hidden'
    });

    this.buildExplorerMode(this.explorerContainer);

    this.setupVaultEvents();
    this.setupActiveLeafEvents();

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
      void this.showFocusMode().catch((error) => {
        console.error('[FolderLab] Error abriendo el modo Contexto:', error);
      });
    } else {
      this.showExplorerMode();
    }

    /*
     * Conteo de palabras del libro en SEGUNDO PLANO: no se
     * espera (void) y por tanto no bloquea ni retrasa la
     * presentación inicial. Si hay meta y aún no hay resultado,
     * el % de la raíz master aparecerá cuando termine.
     */
    this.initializeBookWordCountInBackground();
  }

  /**
   * Inicialización automática de sesión del conteo de palabras.
   *
   * Solo se inicia si hay meta global configurada y aún no
   * existe un resultado válido en memoria, y una única vez por
   * sesión (wordCountInitStarted). Cualquier vuelo en curso se
   * comparte con el modal vía SingleFlightCache.
   *
   * Al terminar, el encabezado SOLO se refresca si la vista
   * activa es la raíz master: el modo activo es la fuente de
   * verdad y nunca se pisan otras vistas. Si el usuario está en
   * una subcarpeta o vista global, el resultado queda preparado
   * en memoria para cuando vuelva a master.
   */
  private initializeBookWordCountInBackground(): void {
    const shouldStart = shouldStartSessionWordCount({
      alreadyStarted: this.wordCountInitStarted,
      goal: this.controller.getBookGoal(),
      hasCachedResult:
        this.controller.getCachedWordCountResult() !== null
    });

    // Una sola patada por sesión, decida lo que decida la regla.
    this.wordCountInitStarted = true;

    if (!shouldStart) return;

    void this.controller
      .getWordCountResult()
      .then(() => {
        if (this._isDisposed) return;

        if (this.controller.isAtMasterRoot()) {
          this.refreshHeaderStatistics();
        }
      })
      .catch((error) => {
        console.warn(
          '[FOLDER-LAB] No se pudo inicializar el conteo de palabras:',
          error
        );
      });
  }

  private showExplorerMode(): void {

    if (this.explorerContainer) {
      this.explorerContainer.removeClass('is-hidden');
    }
    if (this.focusContainer) {
      this.focusContainer.addClass('is-hidden');
    }

    if (this.focusWorkspace) {
      this.focusWorkspace.destroy();
      this.focusWorkspace = null;
    }
  }

  private async showFocusMode(): Promise<void> {

    if (this.explorerContainer) {
      this.explorerContainer.addClass('is-hidden');
    }

    if (this.focusContainer) {
      this.focusContainer.removeClass('is-hidden');

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
            void this.toggleFocusMode().catch((error) => {
              console.error('[FolderLab] Error alternando el modo Contexto:', error);
            });
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
          // 3A-final (P2-2): el estado del botón se deriva del
          // resultado real de la operación, no se asume.
          () => {
            const boardLeaves =
              this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE);

            if (boardLeaves.length > 0) {
              void this.closeBoardView().then((closed) => {
                if (closed) {
                  this.focusWorkspace?.setBoardActive(false);
                }
              });
            } else {
              void this.openBoardView().then((opened) => {
                if (opened) {
                  this.focusWorkspace?.setBoardActive(true);
                }
              });
            }
          }
        );


        await this.focusWorkspace.render();

        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          void this.focusWorkspace.updateNote(activeFile).catch((error) => {
            console.error('[FolderLab] Error actualizando el Contexto a la nueva nota:', error);
          });
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
    document.removeEventListener('folder-lab-export', this.boundHandleExportEvent);
    document.removeEventListener('folder-lab-refresh', this.boundHandleRefreshEvent);

    if (this.renderTimeout) {
      window.clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }

    if (this.focusWorkspace) {
      this.focusWorkspace.destroy();
      this.focusWorkspace = null;
    }
  }


  /**
   * 3A-final (P2-2): devuelve true solo si el Board quedó
   * realmente abierto, para que el botón Board/Nota no muestre
   * un estado que no corresponde cuando la apertura falla.
   */
  private async openBoardView(): Promise<boolean> {
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      new Notice(i18n.t('errors.board.noActiveNote'));
      return false;
    }

    const markdownLeaves =
      this.app.workspace.getLeavesOfType('markdown');

    const leaf = markdownLeaves.find(
      leaf =>
        leaf.view instanceof MarkdownView &&
        leaf.view.file?.path === activeFile.path
    );

    if (!leaf) {
      new Notice(i18n.t('errors.board.noteViewNotFound'));
      return false;
    }

    this.boardPreviousState = leaf.view.getState();

    await leaf.setViewState({
      type: BOARD_VIEW_TYPE,
      state: this.boardPreviousState
    });

    return true;
  }


  /** 3A-final: devuelve true solo si había un Board que restaurar. */
  private async closeBoardView(): Promise<boolean> {
    const boardLeaves =
      this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE);

    const leaf = boardLeaves[0];

    if (!leaf) {
      new Notice(i18n.t('errors.board.notFound'));
      return false;
    }

    const state = leaf.view.getState();

    await leaf.setViewState({
      type: 'markdown',
      state
    });

    return true;
  }


  // ============================================================
  // CONTEO DE PALABRAS
  // ============================================================

  showWordCountModal(result: WordCountResult): void {
    const currentPath = this.controller.getCurrentPath();
    const folder = currentPath ? this.app.vault.getAbstractFileByPath(currentPath) : null;
    const bookName = folder instanceof TFolder ? folder.name : i18n.t('modal.wordCount.fallbackBookName');

    /*
     * La meta pertenece al libro master, no a la carpeta abierta.
     * El diálogo la lee/escribe vía el controlador (persistencia en
     * ajustes). Cambiar la meta recalcula el % con el conteo en
     * memoria, sin recorrer las notas.
     *
     * «Actualizar estadísticas» fuerza un conteo nuevo (única vía
     * junto a la inicialización) y refresca también el % del
     * encabezado si corresponde.
     */
    const modal = new WordCountModal(this.app, result, bookName, {
      getGoal: () => this.controller.getBookGoal(),
      setGoal: async (words) => {
        this.controller.setBookGoal(words);
        await this.plugin.saveSettings();
        this.refreshHeaderStatistics();
      },
      refreshStats: async () => {
        const fresh = await this.controller.getWordCountResult({
          force: true
        });

        if (!fresh) {
          new Notice(i18n.t('errors.wordCount.updateFailed'));
          return null;
        }

        this.refreshHeaderStatistics();
        return fresh;
      }
    });
    modal.open();
  }

  /**
   * Refresca las estadísticas del encabezado según el MODO
   * ACTIVO (fuente de verdad). Las vistas globales y recientes
   * las fija su propio renderizador; aquí solo se rederivan los
   * modelos de navegación normal (raíz master o subcarpeta).
   */
  private refreshHeaderStatistics(): void {
    if (
      this.state.isAllNotesMode() ||
      this.state.isFolderTreeMode() ||
      this.state.isRecentNotesMode()
    ) {
      return;
    }

    if (this.controller.isAtMasterRoot()) {
      this.headerComponent?.updateStatistics(
        this.controller.getMasterRootHeaderStats()
      );
    } else {
      this.headerComponent?.updateStatistics(
        this.controller.getFolderHeaderStats()
      );
    }
  }

  // ============================================================
  // EVENTOS DEL VAULT
  // ============================================================

  /**
   * Indica si debe omitirse la recarga provocada por vault:modify.
   * Solo es true mientras un reorder de properties está escribiendo
   * (ventana cubierta por el refresco final de order-changed);
   * cualquier modificación externa fuera de esa ventana recarga
   * con normalidad.
   */
  private shouldSkipReloadDuringReorder(): boolean {
    return (
      (this.controller?.propertyOrderService as
        | { isReordering?: () => boolean }
        | null
        | undefined)?.isReordering?.() === true
    );
  }

  private setupVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!(file instanceof TFile)) return;
        if (file.path.includes(`/${INTERNAL_FOLDER}/`)) return;

        // Registrar actividad de edición únicamente para notas Markdown.
        if (file.extension === 'md') {
          this.recentActivityService.scheduleEdit(file);
        }

        // No se lanza ningún conteo de palabras aquí: el % del
        // encabezado usa el último conteo en memoria y solo se
        // actualiza con «Actualizar estadísticas» del diálogo.
        // Los recuentos de notas/subcarpetas se refrescan con el
        // re-render del modo (loadFolder → renderNormalMode).
        const currentPath = this.controller.getCurrentPath();

        if (currentPath && file.path.startsWith(currentPath)) {
          // Durante un reorder del Board/properties, las escrituras
          // intermedias NO provocan recarga: el refresco definitivo
          // llega vía order-changed tras sincronizar metadatos.
          if (!this.shouldSkipReloadDuringReorder()) {
            void this.controller.loadFolder(currentPath).catch((error) => {
              console.error('[FolderLab] Error cargando la carpeta:', error);
            });
          }
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
          void this.controller.loadFolder(currentPath).catch((error) => {
            console.error('[FolderLab] Error cargando la carpeta:', error);
          });
        }
        // Etapa 1: recuperar identidad si la nota restaura una ruta
        // con tombstone (borrado anterior).
        void this.plugin.noteLifecycle
          ?.onNoteCreated(file.path)
          .catch((error) => {
            console.error(
              '[FolderLab] Error recuperando identidad de nota:',
              error
            );
          });
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (!(file instanceof TFile)) return;
        if (file.path.includes(`/${INTERNAL_FOLDER}/`)) return;
        const currentPath = this.controller.getCurrentPath();
        if (currentPath && file.path.startsWith(currentPath)) {
          await this.controller.orderService.updateOrderOnDelete(file.path);
          void this.controller.loadFolder(currentPath).catch((error) => {
            console.error('[FolderLab] Error cargando la carpeta:', error);
          });
        }
        // Etapa 1: conservar la identidad como tombstone (recuperable).
        void this.plugin.noteLifecycle?.onNoteDeleted(file.path).catch((error) => {
          console.error('[FolderLab] Error registrando borrado:', error);
        });
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file.path.includes(`/${INTERNAL_FOLDER}/`)) return;
        if (oldPath.includes(`/${INTERNAL_FOLDER}/`)) return;

        // Etapa 1: migrar datos persistentes por nota (Board,
        // Contexto, identidad, borradores) ANTES del refresco.
        if (file instanceof TFolder) {
          void this.plugin.noteLifecycle
            ?.onFolderRenamed(oldPath, file.path)
            .catch((error) => {
              console.error(
                '[FolderLab] Error migrando datos por renombrado de carpeta:',
                error
              );
            });
          return;
        }
        if (!(file instanceof TFile)) return;

        void this.plugin.noteLifecycle
          ?.onFileRenamed(oldPath, file.path)
          .catch((error) => {
            console.error(
              '[FolderLab] Error migrando datos por renombrado:',
              error
            );
          });

        const currentPath = this.controller.getCurrentPath();
        if (currentPath && (file.path.startsWith(currentPath) || oldPath.startsWith(currentPath))) {
          await this.controller.orderService.updateOrderOnRename(oldPath, file.path);
          void this.controller.loadFolder(currentPath).catch((error) => {
            console.error('[FolderLab] Error cargando la carpeta:', error);
          });
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

        if (state.isFocusMode && activeFile) {
          const previousFocusNote = state.getFocusNote();

          if (previousFocusNote !== activeFile.path) {
            state.setFocusNote(activeFile.path);

            /*
             * P2-B: Focus representa UNA nota. Al cambiar la nota
             * activa (Quick Switcher u otra ruta de Obsidian), los
             * paneles, el contexto y las instancias de widgets
             * deben re-apuntarse a la nueva nota. updateNote es la
             * operación existente para eso (render lo usa al entrar
             * en Focus).
             */
            this.focusWorkspace
              ?.updateNote(activeFile)
              .catch((error) => {
                console.error(
                  '[FolderLabView] No se pudo actualizar el Contexto a la nueva nota:',
                  error
                );
              });

            /*
             * El Board es subordinado a Focus y representa la nota
             * de Focus: el Board de la nota ANTERIOR se cierra
             * (misma regla que al salir de Focus). Si el cambio de
             * nota activa es la propia pestaña del Board (mismo
             * path), no se cierra nada.
             */
            void this.closeBoardIfOpen();
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
        if (this._isDisposed) return;

    if (this.state.isFocusMode) {
      return;
    }

    /*
     * La vista de recientes posee su lista y su encabezado: un
     * loadFolder genérico no debe pisarlas con las estadísticas
     * de la carpeta. Se rederiva recientes en su sitio.
     */
    if (this.state.isRecentNotesMode()) {
      await this.renderRecentNotesMode();
      return;
    }

    const navType = this.navigationService?.getNavigationType() || 'folders';

    const folder =
      folderPath === ''
        ? this.app.vault.getRoot()
        : this.app.vault.getAbstractFileByPath(folderPath);

    if (!(folder instanceof TFolder)) {
      this.showEmptyState(i18n.t('empty.folderNotFound'));
      return;
    }

    /*
     * Título y botón atrás son agnósticos al modo. Las
     * ESTADÍSTICAS no: cada renderizador las calcula a partir del
     * modelo de su modo (notas de la carpeta, carpetas visibles o
     * notas de la vista global). Un updateStats() global aquí
     * mostraba siempre las notas de la carpeta maestra.
     */
    this.headerComponent.updateTitle();
    this.headerComponent.updateBackButton();

    if (this.state.isFolderTreeMode() && this.state.isAllNotesMode()) {
      await this.renderCombinedMode(folder);
    } else if (this.state.isFolderTreeMode()) {
      await this.renderFolderMode(folder);
    } else if (this.state.isAllNotesMode()) {
            await this.renderAllNotesMode(folder);
    } else {
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
      title: i18n.t('navigation.propertiesRootTitle'),
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


  // ============================================================
  // RENDERIZADO DE NAVEGACIÓN POR PROPIEDADES
  // ============================================================

  /**
   * Renderiza navegación por propiedades usando el Virtual Root
   *
   * Si se recibe un árbol ya construido (p. ej. recién refrescado
   * por NavigationService), se reutiliza tal cual; en cualquier
   * otro caso se construye uno nuevo para no usar datos obsoletos.
   */
  private async renderPropertyNavigation(prebuiltTree: NavigationTree | null = null): Promise<void> {
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


    const tree = prebuiltTree ?? await this.navigationService.build();

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

    /*
     * Las estadísticas NO se calculan aquí: dependen del modo
     * activo y las fija cada renderizador de modo con su propio
     * modelo (notas directas, carpetas visibles o notas de la
     * vista global). Calcular antes stats del contexto entero
     * leía todos los archivos descendientes y parpadeaba.
     */
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
        (item: FolderLabItem) => {
          void this.handleVirtualItemClick(item).catch((error) => {
            console.error('[FolderLab] Error abriendo el elemento:', error);
          });
        },
        (path: string) => {
          void this.navigateToVirtualNodeByPath(path).catch((error) => {
            console.error('[FolderLab] Error abriendo la carpeta:', error);
          });
        },
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
        (item: FolderLabItem) => {
          void this.handleVirtualItemClick(item).catch((error) => {
            console.error('[FolderLab] Error abriendo el elemento:', error);
          });
        },
        (path: string) => {
          void this.navigateToVirtualNodeByPath(path).catch((error) => {
            console.error('[FolderLab] Error abriendo la carpeta:', error);
          });
        },
        (newOrder: string[]) => {
          void this.controller.reorderItems(newOrder).catch((error) => {
            console.error('[FolderLab] Error reordenando elementos:', error);
          });
        }
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
        (item: FolderLabItem) => {
          void this.handleVirtualItemClick(item).catch((error) => {
            console.error('[FolderLab] Error abriendo el elemento:', error);
          });
        },
        (path: string) => {
          void this.navigateToVirtualNodeByPath(path).catch((error) => {
            console.error('[FolderLab] Error abriendo la carpeta:', error);
          });
        },
        (newOrder: string[]) => {
          void this.controller.reorderItems(newOrder).catch((error) => {
            console.error('[FolderLab] Error reordenando elementos:', error);
          });
        }
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
      // El encabezado de recientes SIEMPRE refleja su propia
      // lista, también vacía: nunca conserva el de master.
      this.headerComponent.updateStats({ kind: 'recent', files: 0 });
      this.showEmptyState(i18n.t('empty.noRecentNotes'));
      return;
    }

    const listItems: ListItem[] = [];

    for (const recent of recentNotes) {
      const file =
        this.app.vault.getAbstractFileByPath(recent.path);

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

    // Recuento derivado del MISMO modelo que se va a renderizar
    // (los archivos que realmente aparecerán en la lista).
    this.headerComponent.updateStats({
      kind: 'recent',
      files: listItems.length
    });

    if (listItems.length === 0) {
      this.showEmptyState(i18n.t('empty.noRecentNotes'));
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
        (item: FolderLabItem) => {
          void this.controller.openNote(item).catch((error) => {
            console.error('[FolderLab] Error abriendo la nota:', error);
          });
        },
        (path: string) => {
          this.exitGlobalModes();
          void this.controller.loadFolder(path).catch((error) => {
            console.error('[FolderLab] Error cargando la carpeta:', error);
          });
        },
        (newOrder: string[]) => {
          void this.controller.reorderItems(newOrder).catch((error) => {
            console.error('[FolderLab] Error reordenando elementos:', error);
          });
        }
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
        const items: ListItem[] = [];
    const filesForStats: TFile[] = [];
    let localNumber = 0;

    // 1. OWN PAGE (si existe y no es virtual root)
    const ownPage = this.getOwnPage(contextNode);
    if (ownPage && contextNode.id !== 'virtual:root') {
      const abstractFile = ownPage.filePath
        ? this.app.vault.getAbstractFileByPath(ownPage.filePath)
        : null;
      const file = abstractFile instanceof TFile ? abstractFile : null;
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
      const abstractFile = note.filePath
        ? this.app.vault.getAbstractFileByPath(note.filePath)
        : null;
      const file = abstractFile instanceof TFile ? abstractFile : null;
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

    /*
     * Navegación normal (properties): notas del contexto visible
     * (formato «N notas»); sin subcarpetas ni % (la raíz master
     * del libro no es un nodo de properties).
     */
    this.headerComponent.updateStats({
      kind: 'notes',
      notes: stats.total
    });

    if (items.length === 0) {
      this.showEmptyState(i18n.t('empty.noElements'));
      return;
    }

        await this.noteList!.render(items);
  }

  /**
   *  Modo Todas las notas: árbol completo desde el contexto
   */
  private async renderAllNotesModeProperties(
    tree: NavigationTree,
    contextNode: NavigationNode
  ): Promise<void> {
    const stats =
      contextNode.id === 'virtual:root'
        ? await this.allNotesView!.renderNavigation(tree)
        : await this.allNotesView!.renderNavigation(tree, contextNode);

    // «Todas las notas»: solo el recuento del propio conjunto;
    // sin carpetas ni porcentaje.
    this.headerComponent.updateStats({
      kind: 'notes',
      notes: stats.totalNotes
    });
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

    // «Todas las carpetas» (properties): solo el total de
    // contenedores listados; sin subcarpetas ni porcentaje.
    this.headerComponent.updateStats({
      kind: 'folders',
      folders: containers.length
    });

    if (items.length === 0) {
      this.showEmptyState(i18n.t('empty.noSubfolders'));
      return;
    }

        await this.noteList!.render(items);
  }

  /**
   *  Navega a un nodo virtual (cambia el contexto)
   */
  private async navigateToVirtualNode(
    node: NavigationNode
  ): Promise<void> {
    // Si no tiene hijos → abrir archivo
    if (
      node.type === 'note' ||
      (!node.children || node.children.length === 0)
    ) {
      if (node.filePath) {
        const abstractFile = this.app.vault.getAbstractFileByPath(node.filePath);
        const file = abstractFile instanceof TFile ? abstractFile : null;
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
      new Notice(i18n.t('errors.navigation.nodeNotFound', { path }));
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
    /*
     * Sin updateStats(): las estadísticas las fija el renderizador
     * del modo activo (loadFolder / renderPropertyNavigation).
     * Lanzarlas aquí duplicaba el renderizado del encabezado en la
     * inicialización.
     */
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

    /*
     * Navegación normal: modelo EXPLÍCITO según el ámbito.
     * - Raíz master: contrato propio de cuatro valores.
     * - Subcarpeta: notas directas · subcarpetas directas.
     */
    if (this.controller.isAtMasterRoot()) {
      this.headerComponent.updateStatistics(
        this.controller.getMasterRootHeaderStats()
      );
    } else {
      this.headerComponent.updateStatistics(
        this.controller.getFolderHeaderStats()
      );
    }

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
        (item: FolderLabItem) => {
          void this.controller.openNote(item).catch((error) => {
            console.error('[FolderLab] Error abriendo la nota:', error);
          });
        },
        (path: string) => {
          this.exitGlobalModes();
          void this.controller.loadFolder(path).catch((error) => {
            console.error('[FolderLab] Error cargando la carpeta:', error);
          });
        },
        (newOrder: string[]) => {
          void this.controller.reorderItems(newOrder).catch((error) => {
            console.error('[FolderLab] Error reordenando elementos:', error);
          });
        }
      );
    }

    await this.noteList.render(listItems);
    this.noteList.updateActiveNote();
  }

  private async renderFolderMode(folder: TFolder): Promise<void> {

    this.listContainer.empty();

    if (!this.subfolderView) {
      this.subfolderView = new SubfolderView(
        this.app,
        this.state,
        this.controller,
        this.controller.orderService,
        this.controller.noteService,
        this.listContainer,
        (item: FolderLabItem) => {
          void this.controller.openNote(item).catch((error) => {
            console.error('[FolderLab] Error abriendo la nota:', error);
          });
        },
        (path: string) => {
          this.exitGlobalModes();
          void this.controller.loadFolder(path).catch((error) => {
            console.error('[FolderLab] Error cargando la carpeta:', error);
          });
        },
        (newOrder: string[]) => {
          void this.controller.reorderItems(newOrder).catch((error) => {
            console.error('[FolderLab] Error reordenando elementos:', error);
          });
        }
      );
    }

    // «Todas las carpetas»: solo el total de carpetas de la
    // lista visible que acaba de renderizarse; sin subcarpetas,
    // sin notas y sin porcentaje.
    const { totalFolders } = this.subfolderView.render(folder.path);

    this.headerComponent.updateStats({
      kind: 'folders',
      folders: totalFolders
    });
  }

  private async renderAllNotesMode(folder: TFolder): Promise<void> {

    this.listContainer.empty();

    if (!this.allNotesView) {
      this.allNotesView = new AllNotesView(
        this.app,
        this.state,
        this.controller,
        this.controller.orderService,
        this.controller.noteService,
        this.listContainer,
        (item: FolderLabItem) => {
          void this.controller.openNote(item).catch((error) => {
            console.error('[FolderLab] Error abriendo la nota:', error);
          });
        },
        (path: string) => {
          this.exitGlobalModes();
          void this.controller.loadFolder(path).catch((error) => {
            console.error('[FolderLab] Error cargando la carpeta:', error);
          });
        },
        (newOrder: string[]) => {
          void this.controller.reorderItems(newOrder).catch((error) => {
            console.error('[FolderLab] Error reordenando elementos:', error);
          });
        }
      );
    }

    // «Todas las notas»: solo el total de notas del conjunto que
    // acaba de renderizarse; sin carpetas ni porcentaje.
    const stats = await this.allNotesView.render(folder.path);

    this.headerComponent.updateStats({
      kind: 'notes',
      notes: stats.totalNotes
    });
  }

  private async renderCombinedMode(folder: TFolder): Promise<void> {
    this.listContainer.empty();
    const message = this.listContainer.createEl('p', { cls: 'folder-lab-empty' });
    message.textContent = i18n.t('empty.combinedModeSoon');
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
    // 3B: un evento ya en cola al cerrar no debe actuar sobre la
    // vista dispuesta.
    if (this._isDisposed) return;

    const customEvent = event as CustomEvent;
    const folderPath = customEvent.detail?.folderPath || this.controller.getCurrentPath();
    if (folderPath) {
      await this.controller.exportAllNotes();
    }
  }

  private async handleRefreshEvent(event: Event): Promise<void> {
    // 3B: un evento ya en cola al cerrar no debe actuar sobre la
    // vista dispuesta.
    if (this._isDisposed) return;

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
      /*
       * controller.loadFolder notifica folderChanged y la vista
       * renderiza en el manejador (esperado con await). Una segunda
       * llamada a loadFolder(vista) duplicaba el renderizado.
       */
      await this.controller.loadFolder(folderPath);
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
