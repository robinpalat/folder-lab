import { TFile, setIcon } from "obsidian";
import { FocusSplitter } from "./FocusSplitter";
import { FocusPane, FocusPanePosition } from "./FocusPane";
import { FocusContext, createFocusContext, updateFocusContext } from "./FocusContext";
import { FocusWidgetRegistry } from "./FocusWidgetRegistry";
import { FolderLabController } from "../core/FolderLabController";
import { FolderLabState } from "../core/FolderLabState";
import { WidgetManager } from './WidgetManager';
import { LibraryBrowser } from './LibraryBrowser';
import { CapabilityRegistry } from '../ai/capabilities/CapabilityRegistry';
import { i18n } from '../i18n/I18nService';
export class FocusWorkspace {
  private static nextId = 1;

  private id = FocusWorkspace.nextId++;

  private container: HTMLElement;
  private app: any;
  private controller: FolderLabController;
  private state: FolderLabState;
  private registry: FocusWidgetRegistry;
  private onClose: () => void;

  private onWidgetActivity?: (
    position: 'top' | 'bottom',
    widgetId: string
  ) => void;

  private splitter: FocusSplitter | null = null;
  private topPane: FocusPane | null = null;
  private bottomPane: FocusPane | null = null;
  private context: FocusContext | null = null;
  private capabilityRegistry: CapabilityRegistry;

  private topContainer: HTMLElement | null = null;
  private bottomContainer: HTMLElement | null = null;
  private splitterContainer: HTMLElement | null = null;
  private mainArea: HTMLElement | null = null;
  private widgetManager: WidgetManager;
  private closeContainer: HTMLElement | null = null;
  private layoutObserver: ResizeObserver | null = null;
  private onBoard: (() => void) | null = null;
  private boardActive = false;

  constructor(
    container: HTMLElement,
    app: any,
    controller: FolderLabController,
    state: FolderLabState,
    registry: FocusWidgetRegistry,
    widgetManager: WidgetManager,
    capabilityRegistry: CapabilityRegistry,
    onClose: () => void,
    onWidgetActivity?: (
      position: 'top' | 'bottom',
      widgetId: string
    ) => void,
    onBoard?: () => void
  ) {
    this.container = container;
    this.app = app;
    this.controller = controller;
    this.state = state;
    this.registry = registry;
    this.widgetManager = widgetManager;
    this.capabilityRegistry = capabilityRegistry;
    this.onClose = onClose;
    this.onWidgetActivity = onWidgetActivity;
    this.onBoard = onBoard ?? null;
  }


  // ============================================================
  // RENDER - VERSIÓN ACTUALIZADA
  // ============================================================

  async render(): Promise<void> {
    this.container.empty();
    this.container.addClass('focus-workspace');

    const activeFile = this.app.workspace.getActiveFile();

    if (activeFile) {
      await this.widgetManager.loadForNote(activeFile);
    }


    // 1. Área principal
    this.mainArea = this.container.createEl('div', {
      cls: 'focus-main-area'
    });

    // 2. Panel superior
    this.topContainer = this.mainArea.createEl('div', {
      cls: 'fl-widget-container'
    });

    // 3. Splitter - USANDO FocusSplitter
    this.splitterContainer = this.mainArea.createEl('div', {
      cls: 'fl-splitter-wrapper'
    });

    // Crear FocusSplitter con lógica de arrastre
    const initialRatio = this.state.splitRatio || 50;
    this.splitter = new FocusSplitter(
      this.splitterContainer,
      initialRatio,
      (ratio) => {
        this.state.setSplitRatio(ratio);
        this.updatePaneHeights(ratio);
      }
    );
    this.splitter.render();  //  Esto renderiza el handle y los eventos

    // 4. Panel inferior
    this.bottomContainer = this.mainArea.createEl('div', {
      cls: 'fl-widget-container'
    });

    // Crear contexto
    this.context = createFocusContext(
      this.app,
      activeFile,
      this.controller,
      this.state
    );

    const layout = this.widgetManager.getLayout();

    const topInstanceId = layout.top;
    const bottomInstanceId = layout.bottom;

    const topInstance = this.widgetManager.getInstance(topInstanceId);
    const bottomInstance = this.widgetManager.getInstance(bottomInstanceId);

    if (!topInstance || !bottomInstance) {
      console.error(
        '[FocusWorkspace] No se pudieron resolver las instancias iniciales',
        {
          layout,
          instances: this.widgetManager.getInstances()
        }
      );
      return;
    }

    this.topPane = new FocusPane(
      this.topContainer,
      FocusPanePosition.Top,
      topInstanceId,
      this.registry,
      this.widgetManager,
      this.context,
      this.app,
      (instanceId) => this.onWidgetChange('top', instanceId)
    );
    this.topPane.render();

    this.bottomPane = new FocusPane(
      this.bottomContainer,
      FocusPanePosition.Bottom,
      bottomInstanceId,
      this.registry,
      this.widgetManager,
      this.context,
      this.app,
      (instanceId) => this.onWidgetChange('bottom', instanceId)
    );
    this.bottomPane.render();

    // 5. Botón Cerrar
    this.closeContainer = this.mainArea.createEl('div', {
      cls: 'fl-context-close'
    });

    const boardBtn = this.closeContainer.createEl('button', {
      cls: 'fl-context-board-btn'
    });

    setIcon(boardBtn, 'refresh-cw');

    boardBtn.createSpan({
      cls: 'fl-context-board-label',
      text: i18n.t('focus.workspace.board')
    });

    boardBtn.onclick = () => {
      if (this.onBoard) {
        this.onBoard();
      }
    };

    const closeBtn = this.closeContainer.createEl('button', {
      cls: 'fl-context-close-btn',
      text: i18n.t('focus.workspace.close')
    });

    closeBtn.onclick = () => {
      if (this.onClose) {
        this.onClose();
      }
    };


    const libraryBtn = this.closeContainer.createEl('button', {
      cls: 'fl-context-library-btn'
    });

    setIcon(libraryBtn, 'library');

    libraryBtn.createSpan({
      cls: 'fl-context-library-label',
      text: i18n.t('focus.workspace.library')
    });

    libraryBtn.onclick = () => {
      this.openLibrary();
    };
    this.updatePaneHeights(initialRatio);

    // Si cambia el tamaño del panel de Obsidian, recalcular la geometría.
    this.layoutObserver?.disconnect();
    this.layoutObserver = new ResizeObserver(() => {
      this.updatePaneHeights(this.state.splitRatio || 50);
    });

    this.layoutObserver.observe(this.mainArea);
  }


  private openLibrary(): void {
    const browser = new LibraryBrowser(
      this.app,
      this.registry,
      this.capabilityRegistry,
      this.widgetManager
    );

    browser.open();
  }

  // ============================================================
  // MANEJADOR DE CAMBIO DE WIDGET
  // ============================================================

  private async onWidgetChange(
    position: 'top' | 'bottom',
    instanceId: string
  ): Promise<void> {
    const layout = this.widgetManager.getLayout();

    if (position === 'top') {
      this.widgetManager.setLayout(
        instanceId,
        layout.bottom
      );
    } else {
      this.widgetManager.setLayout(
        layout.top,
        instanceId
      );
    }

    await this.widgetManager.saveForCurrentNote();

    if (this.onWidgetActivity) {
      this.onWidgetActivity(position, instanceId);
    }
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

  private updatePaneHeights(ratio: number): void {
    const top = this.topContainer;
    const bottom = this.bottomContainer;
    const main = this.mainArea;

    if (!top || !bottom || !main) return;

    const safeRatio = Math.max(15, Math.min(85, ratio));

    /*
     * El splitter no debe depender de flex para transmitir su geometría.
     * Calculamos el espacio REAL disponible dentro de mainArea y asignamos
     * píxeles a los dos panes.
     *
     * mainArea contiene:
     *   top + splitter + bottom + close
     *
     * Por eso primero descontamos splitter y close.
     */
    const mainHeight = main.getBoundingClientRect().height;
    const splitterHeight =
      this.splitterContainer?.getBoundingClientRect().height ?? 0;
    const closeHeight =
      this.closeContainer?.getBoundingClientRect().height ?? 0;

    const availableHeight = Math.max(
      0,
      mainHeight - splitterHeight - closeHeight
    );

    const topHeight =
      availableHeight * (safeRatio / 100);
    const bottomHeight =
      availableHeight - topHeight;

    // Alturas computadas del ratio (dinámico); el resto de la
    // presentación vive en la regla .fl-widget-container.
    top.style.height = `${topHeight}px`;
    top.style.maxHeight = `${topHeight}px`;

    bottom.style.height = `${bottomHeight}px`;
    bottom.style.maxHeight = `${bottomHeight}px`;
  }


  setBoardActive(active: boolean): void {
    const btn = this.closeContainer?.querySelector(
      '.fl-context-board-btn'
    ) as HTMLButtonElement | null;

    if (!btn) {
      return;
    }

    btn.empty();

    setIcon(btn, 'refresh-cw');

    btn.createSpan({
      cls: 'fl-context-board-label',
      text: active ? i18n.t('focus.workspace.note') : i18n.t('focus.workspace.board')
    });

    btn.setAttribute(
      'aria-label',
      active ? i18n.t('focus.workspace.backToNote') : i18n.t('focus.workspace.openBoard')
    );

    btn.setAttribute(
      'title',
      active ? i18n.t('focus.workspace.backToNote') : i18n.t('focus.workspace.openBoard')
    );
  }

  async updateNote(activeFile: TFile): Promise<void> {
    if (this.context) {
      updateFocusContext(this.context, activeFile);
    }

    // Cargar la configuración correspondiente a la nueva nota
    await this.widgetManager.loadForNote(activeFile);

    /*
     * P2-B: si mientras cargaba se solicitó otra nota (cambio
     * rápido con Quick Switcher u otra ruta), el contexto ya
     * apunta a la nota más reciente: esta actualización queda
     * obsoleta y no debe tocar panes ni layout con datos ajenos.
     */
    if (this.context && this.context.activeFile !== activeFile) {
      return;
    }

    const layout = this.widgetManager.getLayout();

    const topInstance = this.widgetManager.getInstance(layout.top);
    const bottomInstance = this.widgetManager.getInstance(layout.bottom);

    if (!topInstance || !bottomInstance) {
      console.warn(
        '[FocusWorkspace] No se pudieron resolver las instancias de la nueva nota',
        {
          layout,
          instances: this.widgetManager.getInstances()
        }
      );
      return;
    }

    // Actualizar contexto de ambos panes
    if (this.topPane) {
      this.topPane.updateContext(this.context!);
    }

    if (this.bottomPane) {
      this.bottomPane.updateContext(this.context!);
    }

    // Cambiar la instancia mostrada en cada posición
    if (this.topPane) {
      this.topPane.setWidget(topInstance.instanceId);
    }

    if (this.bottomPane) {
      this.bottomPane.setWidget(bottomInstance.instanceId);
    }

    // Mantener la geometría actual del splitter
    this.updatePaneHeights(this.state.splitRatio || 50);
  }

  setWidget(position: 'top' | 'bottom', instanceId: string): void {
    const pane =
      position === 'top'
        ? this.topPane
        : this.bottomPane;

    if (!pane) {
      return;
    }

    const instance =
      this.widgetManager.getInstance(instanceId);

    if (!instance) {
      console.warn(
        `[FocusWorkspace] Instancia "${instanceId}" no encontrada`
      );
      return;
    }

    pane.setWidget(instanceId);

    this.updatePaneHeights(
      this.state.splitRatio || 50
    );
  }

  getContext(): FocusContext | null {
    return this.context;
  }

  destroy(): void {
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    if (this.topPane) {
      this.topPane.destroy();
      this.topPane = null;
    }
    if (this.bottomPane) {
      this.bottomPane.destroy();
      this.bottomPane = null;
    }
    if (this.splitter) {
      this.splitter.destroy();
      this.splitter = null;
    }


    this.container.empty();
    this.container.removeClass('focus-workspace');
    this.context = null;
  }
}
