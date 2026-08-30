import { MarkdownRenderer, Notice } from 'obsidian';

import { WidgetControls } from './tools/WidgetControls';
import { WidgetControlsRenderer } from './tools/WidgetControlsRenderer';

import { AIService } from '../../ai/AIService';
import { CapabilityRegistry, CapabilityExecutor } from '../../ai/capabilities';
import { ContextResolver } from '../../ai/context/ContextResolver';
import { UserRequest } from '../../ai/types';
import { FocusWidget, FocusWidgetFactory, WidgetCallbacks } from "../FocusWidget";
import { FocusContext } from "../FocusContext";
import { TasksController } from '../controllers/TasksController';
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
  readonly label = "Asistente";
  readonly icon = "cpu";

  private container: HTMLElement | null = null;
  private currentFile: any = null;
  private app: any;
  private plugin: any;
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
  private tasksController: TasksController;

  // Propiedades de resultado
  private resultContainer: HTMLElement | null = null;

  private results: MemoryResult[] = [];
  private resultsStorageKey: string = '';

  private responseArea: HTMLElement | null = null;
  private currentResponse: string = '';

  private resultDragCleanups = new Map<string, () => void>();

  private resultElements =
    new Map<string, HTMLElement>();

  constructor(
    app: any,
    aiService: AIService,
    registry: CapabilityRegistry,
    tasksController: TasksController
  ) {
    this.app = app;
    this.plugin = app.plugins.plugins['folder-lab'];
    this.aiService = aiService;
    this.registry = registry;
    this.executor = new CapabilityExecutor(registry);
    this.contextResolver = new ContextResolver(
      app,
      this.plugin,
      tasksController
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
    this.currentFile = context.activeFile;

    this.resultsStorageKey = this.currentFile
      ? `focus-memory-results-${this.currentFile.path}`
      : '';

    this.results = this.loadResults();

    this.container.empty();
    this.container.addClass('fl-widget-memory');

    const configured = this.aiService.getStatus().configured;
    const assistantControlsAvailable = configured && !!this.currentFile;

    // El selector de widgets debe permanecer disponible aunque
    // el Asistente no esté configurado o no haya una nota activa.
    // La API Key y la nota solo determinan si las funciones propias
    // del Asistente están disponibles.

    if (!configured) {
      this.renderMessage('Configura tu API Key en Ajustes → Folder Lab');

      if (this.position === 'bottom') {
        this.renderControls(false);
      }

      return;
    }

    if (!this.currentFile) {
      this.renderMessage('Abre una nota para usar el Asistente');

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

    this.resultsStorageKey = this.currentFile
      ? `focus-memory-results-${this.currentFile.path}`
      : '';

    this.results = this.loadResults();

    if (this.container) {
      this.render(this.container, context);
    }
  }


  destroy(): void {

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
      note: 'Nota',
      notes: 'Apuntes',
      snips: 'Snips',
      tasks: 'Tareas'
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
      return 'Seleccionar';
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

    controls.select({
      id: 'session',
      label: 'Sesión',
      value: 'Hoy',
      options: [
        {
          id: 'today',
          label: 'Hoy'
        }
      ]
    });

    controls.action({
      id: 'work',
      label: 'Trabajo',
      primary: true
    });

    controls.action({
      id: 'execute',
      label: 'Aplicar',
      primary: true
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

          if (this.container) {
            this.render(
              this.container,
              {
                activeFile: this.currentFile
              } as FocusContext
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

                  if (this.container) {
                    this.render(
                      this.container,
                      {
                        activeFile: this.currentFile
                      } as FocusContext
                    );
                  }
                }
              }
            );

            modal.open();
            return;
          }

          if (controlId === 'execute') {
            this.execute();
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

    Object.assign(contentWrapper.style, {
      flex: '1 1 0',
      minHeight: '0',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      overflow: 'hidden'
    });

    // ============================================================
    // PANEL CAPTURE
    // ============================================================

    const capturePanel = contentWrapper.createEl('div', {
      cls: 'fl-memory-capture-panel'
    });

    Object.assign(capturePanel.style, {
      flex: '1 1 0',
      minHeight: '0',
      width: '100%',
      display: this.sessionView === 'capture' ? 'flex' : 'none',
      flexDirection: 'column',
      boxSizing: 'border-box',
      overflow: 'hidden'
    });

    // ------------------------------------------------------------
    // RESPUESTA ACTUAL
    // ------------------------------------------------------------

    this.responseArea = capturePanel.createEl('div', {
      cls: 'fl-memory-response-area'
    });

    Object.assign(this.responseArea.style, {
      flex: '1 1 0',
      minHeight: '0',
      width: '100%',
      boxSizing: 'border-box',
      overflowY: 'auto',
      overflowX: 'hidden',
      color: 'var(--text-normal)',
      userSelect: 'text'
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
        text: 'El resultado aparecerá aquí.'
      });
    }
    // ------------------------------------------------------------
    // INDICACIONES ADICIONALES
    // ------------------------------------------------------------

    const instructions = capturePanel.createEl('textarea', {
      cls: 'fl-widget-instructions-input'
    });

    instructions.placeholder = 'Indicaciones adicionales...';
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

    Object.assign(todayPanel.style, {
      flex: '1 1 0',
      minHeight: '0',
      width: '100%',
      display: this.sessionView === 'today' ? 'flex' : 'none',
      flexDirection: 'column',
      boxSizing: 'border-box',
      overflow: 'hidden'
    });

    this.resultContainer = todayPanel.createEl('div', {
      cls: 'fl-memory-results'
    });

    Object.assign(this.resultContainer.style, {
      flex: '1 1 0',
      minHeight: '0',
      width: '100%',
      overflowY: 'auto',
      overflowX: 'hidden',
      color: 'var(--text-normal)',
      boxSizing: 'border-box'
    });

    if (this.sessionView === 'today') {
      this.renderResults();
    }


  }


  private renderResults(): void {
    if (!this.resultContainer) return;

    this.resultContainer.empty();

    if (this.results.length === 0) {
      const empty = this.resultContainer.createEl('div', {
        cls: 'fl-widget-empty-text',
        text: 'No hay respuestas guardadas.'
      });

      empty.style.padding = '12px';
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
            ? 'Desactivar respuesta'
            : 'Activar respuesta',

          onClick: async () => {
            result.active = !result.active;

            listItem.setState(
              result.active ? 'active' : 'inactive'
            );

            await this.saveResults();
          }
        },

        deleteAction: {
          id: 'delete',
          label: 'Eliminar respuesta',

          onClick: async () => {
            const index = this.results.findIndex(
              item => item.id === result.id
            );

            if (index < 0) return;

            this.results.splice(index, 1);
            this.resultElements.delete(result.id);

            await this.saveResults();

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
        collapsedLabel: 'Expandir',
        expandedLabel: 'Contraer',
        editable: false,
        rootClass: 'fl-memory-expandable',
        contentClass: 'fl-memory-expandable-content',
        actionClass: 'fl-memory-expandable-action'
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

    expandable.content.style.userSelect = 'text';

    const children = Array.from(
      expandable.content.querySelectorAll('*')
    );

    for (const child of children) {
      if (child instanceof HTMLElement) {
        child.style.userSelect = 'text';
        child.style.cursor = 'text';
      }
    }
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

    target.style.userSelect = 'text';
    target.style.cursor = 'text';

    if (!content.trim()) {
      return;
    }

    try {
      await MarkdownRenderer.renderMarkdown(
        content,
        target,
        this.currentFile?.path || '',
        this.plugin
      );

      const allChildren = Array.from(
        target.querySelectorAll('*')
      );

      for (const child of allChildren) {
        if (child instanceof HTMLElement) {
          child.style.userSelect = 'text';
          child.style.cursor = 'text';
        }
      }

    } catch (error) {
      console.warn(
        'Error rendering markdown:',
        error
      );

      target.textContent = content;
      target.style.userSelect = 'text';
      target.style.cursor = 'text';
    }
  }

  private renderMessage(text: string): void {
    const empty = this.container!.createEl('div', {
      cls: 'fl-widget-empty'
    });

    empty.style.cssText = `
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		text-align: center;
	  `;

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
      new Notice('No hay nota activa');
      return;
    }

    if (!this.selectedCapability) {
      new Notice('Selecciona una capacidad');
      return;
    }

    // Una nueva consulta siempre vuelve a la vista principal.
    this.sessionView = 'capture';

    if (this.container) {
      this.render(
        this.container,
        {
          activeFile: this.currentFile
        } as FocusContext
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
        text: 'Procesando'
      });

      loadingEl.style.userSelect = 'none';
      loadingEl.style.cursor = 'default';

      // Llevar el scroll al indicador de procesamiento.
      requestAnimationFrame(() => {
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
          `No se pudo cargar la fuente "${sourceLabel}".`
        );
      }

      (context as any).aiService = this.aiService;

      console.log(
        '[MemoryWidget] Fuentes seleccionadas:',
        request.sources
      );

      console.log(
        '[MemoryWidget] contextType:',
        request.contextType
      );

      console.log(
        '[MemoryWidget] Apuntes resueltos:',
        (context as any).additional?.notes
      );

      console.log(
        '[MemoryWidget] CONTEXTO FINAL:',
        JSON.stringify(context, null, 2)
      );


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
        `Error: ${result.error || 'Error desconocido'
        }`
      );

      new Notice(
        `Error: ${result.error || 'Error desconocido'}`
      );

    } catch (error) {

      loadingEl?.remove();
      loadingEl = null;

      const message =
        error instanceof Error
          ? error.message
          : 'Error desconocido';

      this.showResultMessage(
        `Error: ${message}`
      );

      new Notice(`Error: ${message}`);
    }
  }

  /**
   * Muestra un mensaje en el área de resultado preservando el botón de copiar
   */
  private showResultMessage(message: string): void {
    if (!this.resultContainer) return;

    const errorEl = this.resultContainer.createEl('div', {
      cls: 'fl-memory-result-error',
      text: message
    });

    errorEl.style.userSelect = 'text';
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
    } catch (e) { /* ignorar */ }
  }



  private loadResults(): MemoryResult[] {
    if (!this.currentFile || !this.resultsStorageKey) {
      return [];
    }

    try {
      const serialized =
        localStorage.getItem(this.resultsStorageKey);

      if (!serialized) {
        return [];
      }

      const parsed = JSON.parse(serialized);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(
        (value): value is MemoryResult =>
          value &&
          typeof value.id === 'string' &&
          typeof value.content === 'string' &&
          typeof value.active === 'boolean'
      );
    } catch (error) {
      console.warn(
        '[MemoryWidget] Error cargando respuestas:',
        error
      );

      return [];
    }
  }

  private saveResults(): void {
    if (!this.currentFile || !this.resultsStorageKey) {
      return;
    }

    try {
      localStorage.setItem(
        this.resultsStorageKey,
        JSON.stringify(this.results)
      );
    } catch (error) {
      console.warn(
        '[MemoryWidget] Error guardando respuestas:',
        error
      );
    }
  }

  private saveState(): void {
    try {
      if (this.plugin) {
        this.plugin.settings._widgetState = {
          sources: this.selectedSources,
          domain: this.selectedDomain,
          capability: this.selectedCapability
        };
        this.plugin.saveSettings();
      }
    } catch (e) { /* ignorar */ }
  }
}

export class MemoryWidgetFactory implements FocusWidgetFactory {
  readonly widgetId = 'memory';

  private app: any;
  private aiService: AIService;
  private registry: CapabilityRegistry;
  private tasksController: TasksController;

  constructor(
    app: any,
    aiService: AIService,
    registry: CapabilityRegistry,
    tasksController: TasksController
  ) {
    this.app = app;
    this.aiService = aiService;
    this.registry = registry;
    this.tasksController = tasksController;
  }

  create(): FocusWidget {
    return new MemoryWidget(
      this.app,
      this.aiService,
      this.registry,
      this.tasksController
    );
  }
}
