import { App, Component, MarkdownRenderer, Notice, TFile } from 'obsidian';

/**
 * App + registro de plugins de escritorio (no incluido en el tipo
 * oficial App; usado por el widget para acceder a su propia
 * instancia).
 */
export type AppWithPluginRegistry = App & {
  plugins?: {
    plugins?: Record<string, FolderLabPlugin | undefined>;
  };
};
import { i18n } from '../../i18n/I18nService';
/* 3E-1 (W3): el plugin se obtiene de app.plugins.plugins['folder-lab']
 * (origen any); el campo se tipa con el tipo real del proyecto
 * (type-only, sin dependencia de runtime). El acceso a
 * settings._widgetState ya está declarado en FolderOrderSettings. */
import type FolderLabPlugin from '../../main';

import { WidgetControls } from './tools/WidgetControls';
import { WidgetControlsRenderer } from './tools/WidgetControlsRenderer';

import { WidgetController } from '../controllers/WidgetController';
import { WidgetManager } from '../WidgetManager';

import { AIService } from '../../ai/AIService';
import { CapabilityRegistry, CapabilityExecutor } from '../../ai/capabilities';
import { ContextResolver } from '../../ai/context/ContextResolver';
import { UserRequest } from '../../ai/types';
import { FocusWidget, FocusWidgetFactory, WidgetCallbacks } from "../FocusWidget";
import { FocusContext } from "../FocusContext";
import { FocusListItem } from '../FocusListItem';
import { CapabilityBrowser } from '../../ai/capabilities/browser';
import {
  FolderLabDragDrop,
  createExpandableText
} from '../FocusWidgetsUtils';


interface MemoryResult {
  id: string;
  content: string;
  active: boolean;
}

export class MemoryWidget implements FocusWidget {
  readonly id = "memory";
  get label(): string {
    return i18n.t('widgets.registered.memory.label');
  }
  readonly icon = "cpu";

  private container: HTMLElement | null = null;
  private currentFile: TFile | null = null;
  private lastContext: FocusContext | null = null;
  /*
   * 3E-3 (W5, conservado como any): el widget necesita
   * app.plugins.plugins['folder-lab'] (registro de plugins de
   * escritorio) que no está declarado en el tipo `App` de
   * obsidian; tiparlo obligaría a aserciones forzadas.
   */
  /*
   * Extensión documentada de App: el registro de plugins de
   * escritorio (app.plugins) no está en el tipo App oficial; se
   * declara aquí como intersección, sin `any`.
   */
  private app: AppWithPluginRegistry;
  private plugin: FolderLabPlugin;
  private position: 'top' | 'bottom' = 'top';
  private sessionView: 'capture' | 'today' = 'capture';
  private callbacks: WidgetCallbacks = {};

  private aiService: AIService;
  private registry: CapabilityRegistry;
  private executor: CapabilityExecutor;
  private contextResolver: ContextResolver;

  private selectedSources: Array<'note' | 'notes' | 'snips' | 'tasks'> = ['note'];
  private selectedDomain: string = 'Memoria';
  private selectedCapability: string = '';
  private instructions: string = '';

  // Propiedades de resultado
  private resultContainer: HTMLElement | null = null;

  private results: MemoryResult[] = [];
  /**
   * Corrección A: espejo de resultados AISLADO POR IDENTIDAD.
   * resultsMirrorId se resuelve en background tras el render;
   * pendingResultsJson retiene guardados ocurridos antes de tener
   * el id (se reintentan al resolverse).
   */
  private resultsMirrorId: string | null = null;
  private pendingResultsJson: string | null = null;

  private responseArea: HTMLElement | null = null;
  private currentResponse: string = '';

  private resultDragCleanups = new Map<string, () => void>();

  /*
   * Ciclo de vida del renderizado de markdown: el Component que se
   * pasa a MarkdownRenderer.render debe ser propio del widget (no
   * el plugin, cuyo ciclo de vida es el de toda la app y retendría
   * listeners/child-components hasta el unload del plugin).
   */
  private renderLifecycle: Component | null = null;

  private resultElements =
    new Map<string, HTMLElement>();

constructor(
  app: AppWithPluginRegistry,
  aiService: AIService,
  registry: CapabilityRegistry,
  widgetController: WidgetController,
  widgetManager: WidgetManager
) {
    this.app = app;
    // El widget solo se instancia desde el propio plugin cargado.
    this.plugin = app.plugins?.plugins?.['folder-lab'] as FolderLabPlugin;
    this.aiService = aiService;
    this.registry = registry;
    this.executor = new CapabilityExecutor(registry);
this.contextResolver = new ContextResolver(
  app,
  this.plugin,
  widgetController,
  widgetManager
);
    this.loadState();
  }

  // ============================================================
  // FOCUS WIDGET INTERFACE
  // ============================================================

  setPosition(position: 'top' | 'bottom'): void {
    this.position = position;
  }

  setCallbacks(callbacks: WidgetCallbacks): void {
    this.callbacks = callbacks;
  }

  render(container: HTMLElement, context: FocusContext): void {
    this.container = container;
    this.lastContext = context;
    this.currentFile = context.activeFile;

    this.resultsMirrorId = null;
    this.results = [];
    void this.resolveResultsMirror();

    this.container.empty();
    this.container.addClass('fl-widget-memory');

    const configured = this.aiService.getStatus().configured;

    // El selector de widgets debe permanecer disponible aunque
    // el Asistente no esté configurado o no haya una nota activa.
    // La API Key y la nota solo determinan si las funciones propias
    // del Asistente están disponibles.

    if (!configured) {
      this.renderMessage(i18n.t('widgets.memory.empty.apiKeyRequired'));

      if (this.position === 'bottom') {
        this.renderControls(false);
      }

      return;
    }

    if (!this.currentFile) {
      this.renderMessage(i18n.t('widgets.memory.empty.noteRequired'));

      if (this.position === 'bottom') {
        this.renderControls(false);
      }

      return;
    }

    if (this.position === 'top') {
      this.renderControls();
      this.renderContent();
    } else {
      this.renderContent();
      this.renderControls(true);
    }
  }
  update(context: FocusContext): void {
    const newFile = context.activeFile;

    if (newFile === this.currentFile) return;

    this.currentFile = newFile;

    this.sessionView = 'capture';
    this.currentResponse = '';

    this.resultsMirrorId = null;
    this.results = [];
    void this.resolveResultsMirror();

    if (this.container) {
      this.render(this.container, context);
    }
  }


  destroy(): void {

    this.renderLifecycle?.unload();
    this.renderLifecycle = null;

    for (const cleanup of this.resultDragCleanups.values()) {
      cleanup();
    }

    this.resultDragCleanups.clear();

    if (this.container) {
      this.container.empty();
      this.container = null;
    }

    this.currentFile = null;
    this.resultContainer = null;
    this.responseArea = null;
    this.currentResponse = '';
    this.results = [];
  }
  // ============================================================
  // MÉTODOS AUXILIARES
  // ============================================================

  private getSourceLabel(): string {
    const labels: Record<string, string> = {
      note: i18n.t('focus.sources.note'),
      notes: i18n.t('focus.sources.notes'),
      snips: i18n.t('focus.sources.snips'),
      tasks: i18n.t('focus.sources.tasks')
    };

    return this.selectedSources
      .map(source => labels[source] || source)
      .join(', ');
  }

  private getSourceIcon(): string {
    if (this.selectedSources.length > 1) {
      return 'layers';
    }

    const icons: Record<string, string> = {
      note: 'file-text',
      notes: 'pencil',
      snips: 'scissors',
      tasks: 'check-square'
    };

    return icons[this.selectedSources[0]] || 'file-text';
  }

  private getCapabilityLabel(): string {
    if (!this.selectedCapability) {
      return i18n.t('widgets.memory.capability.placeholder');
    }

    try {
      const tools = this.registry.getByGroup(this.selectedDomain);
      const found = tools.find(t => t.id === this.selectedCapability);
      if (found) {
        return found.label;
      }
    } catch (e) {
      console.warn('Error getting capability label:', e);
    }

    return this.selectedCapability;
  }


  private getWorkLabel(): string {
    const sourceLabel = this.getSourceLabel();

    if (!this.selectedCapability) {
      return sourceLabel;
    }

    const capabilityLabel = this.getCapabilityLabel();

    return `${sourceLabel} · ${capabilityLabel}`;
  }


  // ============================================================
  // RENDER: CONTROLES
  // ============================================================

  private buildControls(includeAssistantControls: boolean = true): WidgetControls {
    const controls = new WidgetControls();

    // El selector de widgets siempre está disponible.
    controls.setWidget({
      id: this.id,
      label: this.label,
      icon: this.icon,
      options: []
    });

    // Si el Asistente no está configurado, no mostrar sus controles
    // propios; solo se mantiene disponible la navegación entre widgets.
    if (!includeAssistantControls) {
      return controls;
    }

        controls.action({
      id: 'execute',
      label: i18n.t('widgets.memory.action.apply'),
      primary: true
    });


    controls.select({
      id: 'session',
      label: i18n.t('widgets.common.session'),
      value: i18n.t('widgets.common.sessionToday'),
      options: [
        {
          id: 'today',
          label: i18n.t('widgets.common.sessionToday')
        }
      ]
    });


    return controls;
  }


  private renderControls(includeAssistantControls: boolean = true): void {
    if (!this.container) {
      return;
    }

    const controls = this.buildControls(includeAssistantControls);

    WidgetControlsRenderer.render(
      this.container,
      controls.getConfig(),
      {
        onWidgetSelect: () => {
          this.callbacks.onWidgetSelect?.();
        },

        onControlSelect: (controlId, option) => {
          if (controlId !== 'session') return;
          if (option.id !== 'today') return;

          this.sessionView = 'today';

          if (this.container && this.lastContext) {
            this.render(
              this.container,
              this.lastContext
            );
          }

        },

        onAction: (controlId) => {
          if (controlId === 'work') {
            const modal = new CapabilityBrowser(
              this.app,
              {
                registry: this.registry,
                selectedGroup: this.selectedDomain,
                selectedCapability: this.selectedCapability,
                selectedSources: this.selectedSources,

                onSelect: ({
                  sourceIds,
                  groupId,
                  capabilityId
                }) => {
                  this.selectedSources = sourceIds;
                  this.selectedDomain = groupId;
                  this.selectedCapability = capabilityId;

                  this.saveState();

                  if (this.container && this.lastContext) {
                    this.render(
                      this.container,
                      this.lastContext
                    );
                  }
                }
              }
            );

            modal.open();
            return;
          }

          if (controlId === 'execute') {
            void this.execute();
          }
        }
      }
    );
  }




  // ============================================================
  // RENDER: CONTENIDO
  // ============================================================

  private renderContent(): void {
    if (!this.container) return;

    const contentWrapper = this.container.createEl('div', {
      cls: 'fl-widget-content fl-widget-content-expanded fl-memory-content-wrapper'
    });

    // ============================================================
    // PANEL CAPTURE
    // ============================================================

    const capturePanel = contentWrapper.createEl('div', {
      cls: 'fl-memory-capture-panel'
    });
    capturePanel.toggleClass(
      'is-hidden',
      this.sessionView !== 'capture'
    );

    // ------------------------------------------------------------
    // RESPUESTA ACTUAL
    // ------------------------------------------------------------

    this.responseArea = capturePanel.createEl('div', {
      cls: 'fl-memory-response-area'
    });

    this.responseArea.setAttr('contenteditable', 'false');

    if (this.currentResponse.trim()) {
      void this.renderMarkdown(
        this.currentResponse,
        this.responseArea
      );
    } else {
      this.responseArea.createEl('div', {
        cls: 'fl-widget-result-placeholder',
        text: i18n.t('widgets.memory.placeholder.result')
      });
    }
    // ------------------------------------------------------------
    // INDICACIONES ADICIONALES
    // ------------------------------------------------------------

    const instructions = capturePanel.createEl('textarea', {
      cls: 'fl-widget-instructions-input'
    });

    instructions.placeholder = i18n.t('widgets.memory.placeholder.instructions');
    instructions.value = this.instructions;

    instructions.addEventListener('input', () => {
      this.instructions = instructions.value;
    });

    // ============================================================
    // PANEL TODAY
    // ============================================================

    const todayPanel = contentWrapper.createEl('div', {
      cls: 'fl-memory-today-panel'
    });
    todayPanel.toggleClass(
      'is-hidden',
      this.sessionView !== 'today'
    );

    this.resultContainer = todayPanel.createEl('div', {
      cls: 'fl-memory-results'
    });

    if (this.sessionView === 'today') {
      this.renderResults();
    }


  }


  private renderResults(): void {
    if (!this.resultContainer) return;

    for (const cleanup of this.resultDragCleanups.values()) {
      cleanup();
    }
    this.resultDragCleanups.clear();

    this.resultContainer.empty();

    if (this.results.length === 0) {
      this.resultContainer.createEl('div', {
        cls: 'fl-widget-empty-text',
        text: i18n.t('widgets.memory.empty.noSavedResponses')
      });
      return;
    }

    for (const result of [...this.results].reverse()) {
      void this.renderResultItem(result);
    }
  }


  private async renderResultItem(
    result: MemoryResult
  ): Promise<void> {
    if (!this.resultContainer) return;

    const listItem = new FocusListItem(
      this.resultContainer,
      {
        state: result.active ? 'active' : 'inactive',

        primaryAction: {
          id: 'toggle',
          label: result.active
            ? i18n.t('widgets.memory.action.deactivateResponse')
            : i18n.t('widgets.memory.action.activateResponse'),

          onClick: () => {
            result.active = !result.active;

            listItem.setState(
              result.active ? 'active' : 'inactive'
            );

            // L3b: saveResults es síncrono (localStorage) y ya
            // gestiona sus errores internamente.
            this.saveResults();
          }
        },

        deleteAction: {
          id: 'delete',
          label: i18n.t('widgets.memory.action.deleteResponse'),

          onClick: () => {
            const index = this.results.findIndex(
              item => item.id === result.id
            );

            if (index < 0) return;

            this.resultDragCleanups.get(result.id)?.();
            this.resultDragCleanups.delete(result.id);

            this.results.splice(index, 1);
            this.resultElements.delete(result.id);

            // L3b: saveResults es síncrono; se llama sin await
            // (el await sobre void era la advertencia original).
            this.saveResults();

            listItem.destroy();
          }
        }
      }
    );

    const content = listItem.getContentElement();

    content.addClass('fl-memory-item-content');

    const expandable = createExpandableText(
      content,
      result.content,
      {
        initiallyExpanded: false,
        previewLines: 3,
        collapsedLabel: i18n.t('widgets.common.expand'),
        expandedLabel: i18n.t('widgets.common.collapse'),
        editable: false,
        // Vista ampliada a pantalla completa del widget en modo
        // lectura: el resultado IA no es editable; el × cierra.
        expandedEditing: true,
        rootClass: 'fl-memory-expandable',
        contentClass: 'fl-memory-expandable-content',
        actionClass: 'fl-memory-expandable-action',
        onExpandedChange: (expanded) => {
        listItem.setExpanded(expanded);
    }
      }
    );

    this.resultElements.set(
      result.id,
      content
    );

    expandable.content.setAttr(
      'contenteditable',
      'false'
    );

    await this.renderMarkdown(
      result.content,
      expandable.content
    );

    // ----------------------------------------------------------
    // DRAG HACIA EL BOARD (markdown crudo del resultado)
    // ----------------------------------------------------------

    const dragDrop =
      FolderLabDragDrop.getInstance(this.app);

    const cleanupDrag =
      dragDrop.registerTextDragSource(
        content,
        () => result.content,
        (active) => {
          content.toggleClass(
            'fl-dnd-drag-active',
            active
          );

          if (active) {
            dragDrop.setActiveDragSource({
              widgetId: 'memory',
              instanceId: 'memory',
              itemId: result.id,
              sessionId: 'today'
            });
          } else {
            dragDrop.clearActiveDragSource();
          }
        }
      );

    this.resultDragCleanups.set(
      result.id,
      cleanupDrag
    );
  }

  // ============================================================
  // RENDER: MARKDOWN
  // ============================================================

  private async renderMarkdown(
    content: string,
    target: HTMLElement
  ): Promise<void> {
    target.empty();
    target.setAttr('contenteditable', 'false');

    /*
     * Selección de texto (Bloque 4): una clase en el objetivo
     * reproduce el comportamiento anterior (objetivo + todos los
     * descendientes tras renderizar) vía CSS .fl-memory-selectable.
     */
    target.addClass('fl-memory-selectable');

    if (!content.trim()) {
      return;
    }

    try {
      // 4-2: API actual (renderMarkdown está obsoleta). El
      // componente se limita al ciclo de vida del widget: se
      // descarga el anterior antes de cada render y en destroy().
      this.renderLifecycle?.unload();
      const lifecycle = new Component();
      lifecycle.load();
      this.renderLifecycle = lifecycle;
      await MarkdownRenderer.render(
        this.app,
        content,
        target,
        this.currentFile?.path || '',
        lifecycle
      );
    } catch (error) {
      console.warn(
        'Error rendering markdown:',
        error
      );

      target.textContent = content;
    }
  }

  private renderMessage(text: string): void {
    const empty = this.container!.createEl('div', {
      cls: 'fl-widget-empty'
    });

    empty.createEl('div', {
      cls: 'fl-widget-empty-text',
      text
    });
  }

  // ============================================================
  // EJECUCIÓN
  // ============================================================

  private async execute(): Promise<void> {
    if (!this.currentFile) {
      new Notice(i18n.t('notices.noActiveNote'));
      return;
    }

    if (!this.selectedCapability) {
      new Notice(i18n.t('widgets.memory.notice.selectCapability'));
      return;
    }

    // Una nueva consulta siempre vuelve a la vista principal.
    this.sessionView = 'capture';

    if (this.container && this.lastContext) {
      this.render(
        this.container,
        this.lastContext
      );
    }

    // ----------------------------------------------------------
    // MOSTRAR "PROCESANDO" SIN BORRAR RESULTADOS ANTERIORES
    // ----------------------------------------------------------

    let loadingEl: HTMLElement | null = null;

    if (this.responseArea) {
      // Limpiar el contenido anterior del área de respuesta.
      this.responseArea.empty();

      loadingEl = this.responseArea.createEl('div', {
        cls: 'fl-widget-result-placeholder fl-widget-loading-dots',
        text: i18n.t('widgets.memory.status.processing')
      });

      // Llevar el scroll al indicador de procesamiento.
      window.requestAnimationFrame(() => {
        this.responseArea?.scrollTo({
          top: this.responseArea.scrollHeight,
          behavior: 'smooth'
        });
      });
    }

    try {
      const request: UserRequest = {
        toolId: this.selectedCapability,

        sources: [...this.selectedSources],

        // Compatibilidad temporal.
        contextType: this.selectedSources[0] || 'note',

        instructions: this.instructions || undefined,
        activeNotePath: this.currentFile.path,
        temperature: this.plugin?.settings?.aiTemperature,
        maxTokens: this.plugin?.settings?.aiMaxTokens
      };

      let context;
      try {
        context =
          await this.contextResolver.resolve(request);
      } catch (sourceError) {
        const sourceLabel = this.getSourceLabel();

        console.error(
          `[MemoryWidget] Error cargando fuentes "${this.getSourceLabel()}":`,
          sourceError
        );

        throw new Error(
          i18n.t('widgets.memory.error.sourceLoadFailed', { source: sourceLabel })
        );
      }

      context.aiService = this.aiService;


      const result =
        await this.executor.execute(
          this.selectedCapability,
          context
        );

      // --------------------------------------------------------
      // QUITAR "PROCESANDO"
      // --------------------------------------------------------

      loadingEl?.remove();
      loadingEl = null;

      // --------------------------------------------------------
      // NUEVO RESULTADO
      // --------------------------------------------------------

      if (result.success && result.content) {
        // --------------------------------------------------------
        // La nueva respuesta pasa a ser la respuesta actual.
        // --------------------------------------------------------

        this.currentResponse = result.content;

        // --------------------------------------------------------
        // La respuesta se archiva inmediatamente como fragmento.
        // --------------------------------------------------------

        const newResult: MemoryResult = {
          id:
            `memory-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
          content: result.content,
          active: false
        };

        this.results.push(newResult);
        this.saveResults();

        // --------------------------------------------------------
        // Mostrar la respuesta actual en el panel principal.
        // --------------------------------------------------------

        if (this.responseArea) {
          await this.renderMarkdown(
            this.currentResponse,
            this.responseArea
          );
        }

        return;
      }

      // --------------------------------------------------------
      // ERROR
      // --------------------------------------------------------

      this.showResultMessage(
        i18n.t('widgets.common.errorWithMessage', {
          message: result.error || i18n.t('widgets.memory.error.unknown')
        })
      );

      new Notice(
        i18n.t('widgets.common.errorWithMessage', {
          message: result.error || i18n.t('widgets.memory.error.unknown')
        })
      );

    } catch (error) {

      loadingEl?.remove();
      loadingEl = null;

      const message =
        error instanceof Error
          ? error.message
          : i18n.t('widgets.memory.error.unknown');

      this.showResultMessage(
        i18n.t('widgets.common.errorWithMessage', { message })
      );

      new Notice(i18n.t('widgets.common.errorWithMessage', { message }));
    }
  }

  /**
   * Muestra un mensaje en el área de resultado preservando el botón de copiar
   */
  private showResultMessage(message: string): void {
    if (!this.resultContainer) return;

    this.resultContainer.createEl('div', {
      cls: 'fl-memory-result-error',
      text: message
    });
  }

  // ============================================================
  // PERSISTENCIA
  // ============================================================

  private loadState(): void {
    try {
      const data = this.plugin?.settings?._widgetState;
      if (data) {
        const source = data.source;

        const sources = Array.isArray(data.sources)
          ? data.sources
          : [source];

        this.selectedSources = sources.filter(
          (value: unknown): value is 'note' | 'notes' | 'snips' | 'tasks' =>
            value === 'note' ||
            value === 'notes' ||
            value === 'snips' ||
            value === 'tasks'
        );

        if (this.selectedSources.length === 0) {
          this.selectedSources = ['note'];
        }

        this.selectedDomain = data.domain || this.registry.getDefaultGroup() || 'Memoria';
        this.selectedCapability = data.capability || '';
      }
    } catch { /* ignorar */ }
  }



  /** Validación de forma del espejo (dato externo, unknown). */
  private parseResults(serialized: string): MemoryResult[] {
    try {
      const parsed: unknown = JSON.parse(serialized);

      if (!Array.isArray(parsed)) {
        return [];
      }

      const items: unknown[] = parsed;

      return items.filter((value): value is MemoryResult => {
        if (!value || typeof value !== 'object') {
          return false;
        }
        const candidate = value as {
          id?: unknown;
          content?: unknown;
          active?: unknown;
        };
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.content === 'string' &&
          typeof candidate.active === 'boolean'
        );
      });
    } catch (error) {
      console.warn(
        '[MemoryWidget] Error parseando respuestas del espejo:',
        error
      );
      return [];
    }
  }

  /**
   * Corrección A: carga el espejo por IDENTIDAD (nunca por ruta).
   * Si el id se resuelve con los resultados aún vacíos y el espejo
   * tiene datos legados de la PROPIA identidad, se re-renderiza una
   * vez para presentarlos.
   */
  private async resolveResultsMirror(): Promise<void> {
    if (!this.currentFile) return;
    const path = this.currentFile.path;
    const mirror = this.plugin.localMirror;
    if (!mirror) return;

    try {
      const id = await this.plugin.noteLifecycle?.getNoteId(path) ?? null;
      if (!id || this.currentFile?.path !== path) return;
      this.resultsMirrorId = id;

      // Guardados en vuelo antes de resolver el id: reintentar.
      if (this.pendingResultsJson !== null) {
        await mirror.write(
          'focus-memory-results',
          path,
          this.pendingResultsJson
        );
        if (this.currentFile?.path === path) {
          this.pendingResultsJson = null;
        }
      }

      const mirrored = await mirror.read('focus-memory-results', path);
      if (mirrored.value) {
        const parsed = this.parseResults(mirrored.value);
        if (this.results.length === 0 && parsed.length > 0) {
          this.results = parsed;
          if (
            this.container &&
            this.lastContext &&
            this.currentFile?.path === path
          ) {
            this.render(this.container, this.lastContext);
          }
        }
      }
    } catch (error) {
      console.warn(
        '[MemoryWidget] Error resolviendo espejo de resultados:',
        error
      );
    }
  }

  private async flushResultsMirror(): Promise<void> {
    if (!this.currentFile || this.pendingResultsJson === null) return;
    if (!this.resultsMirrorId) return; // se reintenta en resolve/flush
    const path = this.currentFile.path;
    const mirror = this.plugin.localMirror;
    if (!mirror) return;
    try {
      await mirror.write(
        'focus-memory-results',
        path,
        this.pendingResultsJson
      );
      if (this.currentFile?.path === path) {
        this.pendingResultsJson = null;
      }
    } catch (error) {
      console.warn(
        '[MemoryWidget] Error guardando respuestas:',
        error
      );
    }
  }

  private saveResults(): void {
    if (!this.currentFile) {
      return;
    }
    this.pendingResultsJson = JSON.stringify(this.results);
    void this.flushResultsMirror();
  }

  private saveState(): void {
    try {
      if (this.plugin) {
        this.plugin.settings._widgetState = {
          sources: this.selectedSources,
          domain: this.selectedDomain,
          capability: this.selectedCapability
        };
        void this.plugin.saveSettings().catch((error) => {
          console.warn('[MemoryWidget] Error guardando ajustes:', error);
        });
      }
    } catch { /* ignorar */ }
  }
}

export class MemoryWidgetFactory implements FocusWidgetFactory {
  readonly widgetId = 'memory';

  private app: AppWithPluginRegistry;
  private aiService: AIService;
  private registry: CapabilityRegistry;
  private widgetController: WidgetController;
private widgetManager: WidgetManager;

constructor(
  app: AppWithPluginRegistry,
  aiService: AIService,
  registry: CapabilityRegistry,
  widgetController: WidgetController,
  widgetManager: WidgetManager
) {
  this.app = app;
  this.aiService = aiService;
  this.registry = registry;
  this.widgetController = widgetController;
  this.widgetManager = widgetManager;
}

  create(): FocusWidget {
return new MemoryWidget(
  this.app,
  this.aiService,
  this.registry,
  this.widgetController,
  this.widgetManager
);
  }
}
