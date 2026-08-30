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
  private snipsController: any = null;
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
  // SNIPS CONTROLLER (sin cambios)
  // ============================================================

  setSnipsController(controller: any): void {

    this.snipsController = controller;

    if (this.snipsController) {


      this.snipsController.onChange(() => {

        this.updateSnipsWidget();
      });


    } else {

    }
  }

  private updateSnipsWidget(): void {


    const snipsWidget = this.getSnipsWidget();

    if (snipsWidget) {


      if (typeof snipsWidget.reload === 'function') {

        snipsWidget.reload();

      } else {

      }
    } else {

    }
  }

  private getSnipsWidget(): any {


    if (this.topPane) {
      const widget = this.topPane.getWidget();
      if (widget && widget.id === 'snips') {

        return widget;
      }
    }

    if (this.bottomPane) {
      const widget = this.bottomPane.getWidget();
      if (widget && widget.id === 'snips') {

        return widget;
      }
    }


    return null;
  }

  private registerSnipsController(): void {
    const snipsWidget = this.getSnipsWidget();
    if (snipsWidget && this.snipsController) {

    }
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

    this.registerSnipsController();

    // 1. Área principal
    this.mainArea = this.container.createEl('div', {
      cls: 'focus-main-area'
    });
    this.mainArea.style.cssText = `
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    height: 100%;
    min-height: 0;
    min-width: 0;
    position: relative;
    box-sizing: border-box;
  `;

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
      text: 'Board'
    });

    boardBtn.onclick = () => {
      if (this.onBoard) {
        this.onBoard();
      }
    };

    const closeBtn = this.closeContainer.createEl('button', {
      cls: 'fl-context-close-btn',
      text: 'Cerrar'
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
      text: 'Biblioteca'
    });

    libraryBtn.onclick = () => {
      this.openLibrary();
    };
    this.updatePaneHeights(initialRatio);

    // Diagnóstico: mide la cadena real sin modificar ninguna geometría.
    requestAnimationFrame(() => {
      const measure = (el: HTMLElement | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          height: Math.round(r.height * 100) / 100,
          cssHeight: cs.height,
          minHeight: cs.minHeight,
          maxHeight: cs.maxHeight,
          flex: cs.flex,
          display: cs.display,
          overflowY: cs.overflowY
        };
      };

      const frame =
        this.topContainer?.querySelector(".fl-widget-frame") as HTMLElement | null;
      const widget =
        this.topContainer?.querySelector(".fl-widget-notes") as HTMLElement | null;
      const surface =
        this.topContainer?.querySelector(".fl-notes-scroll-surface") as HTMLElement | null;
      const draft =
        this.topContainer?.querySelector(".fl-notes-draft-list-item") as HTMLElement | null;
      const textarea =
        this.topContainer?.querySelector(".fl-notes-draft-textarea") as HTMLElement | null;

      console.log("[FOCUS GEOMETRY]", {
        mainArea: measure(this.mainArea),
        topContainer: measure(this.topContainer),
        splitter: measure(this.splitterContainer),
        bottomContainer: measure(this.bottomContainer),
        frame: measure(frame),
        notesWidget: measure(widget),
        notesSurface: measure(surface),
        draft: measure(draft),
        textarea: measure(textarea)
      });
    });

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
    console.log(
      `[FocusWorkspace] Widget changed in ${position}: ${instanceId}`
    );

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

    console.log(
      '[FocusWorkspace] Layout actualizado:',
      this.widgetManager.getLayout()
    );

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

    Object.assign(top.style, {
      flex: "0 0 auto",
      width: "100%",
      height: `${topHeight}px`,
      minHeight: "0",
      maxHeight: `${topHeight}px`,
      boxSizing: "border-box",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column"
    });

    Object.assign(bottom.style, {
      flex: "0 0 auto",
      width: "100%",
      height: `${bottomHeight}px`,
      minHeight: "0",
      maxHeight: `${bottomHeight}px`,
      boxSizing: "border-box",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column"
    });
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
      text: active ? 'Nota' : 'Board'
    });

    btn.setAttribute(
      'aria-label',
      active ? 'Volver a la nota' : 'Abrir Board'
    );

    btn.setAttribute(
      'title',
      active ? 'Volver a la nota' : 'Abrir Board'
    );
  }

  async updateNote(activeFile: TFile): Promise<void> {
    console.trace("UPDATE NOTE");
    console.log("FocusWorkspace", this.id, "UPDATE NOTE");

    if (this.context) {
      updateFocusContext(this.context, activeFile);
    }

    // Cargar la configuración correspondiente a la nueva nota
    await this.widgetManager.loadForNote(activeFile);

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
    console.log("FocusWorkspace", this.id, "DESTROYED");

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
