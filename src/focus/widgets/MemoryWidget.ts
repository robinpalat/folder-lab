import { App, Component, MarkdownRenderer, Notice, TFile, Menu, setIcon } from 'obsidian';

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
import type { FocusWidgetRegistry } from '../FocusWidgetRegistry';

import { AIService } from '../../ai/AIService';
import { BOARD_VIEW_TYPE } from '../../constants/view-types';
import { CapabilityRegistry, CapabilityExecutor } from '../../ai/capabilities';
import { ContextResolver } from '../../ai/context/ContextResolver';
import { UserRequest } from '../../ai/types';
import { FocusWidget, FocusWidgetFactory, WidgetCallbacks } from "../FocusWidget";
import { FocusContext } from "../FocusContext";
import { FocusListItem } from '../FocusListItem';
import { CapabilityBrowser } from '../../ai/capabilities/browser';
import {
  getCapabilityLabel,
  getDomainLabel
} from '../../ai/capabilities/capabilityTexts';
import {
  FolderLabDragDrop,
  createExpandableText
} from '../FocusWidgetsUtils';


interface MemoryResult {
  id: string;
  content: string;
  /** Timestamp de creación. Ausente en datos antiguos. */
  createdAt?: number;
  /** ID estable de la capacidad que produjo el resultado. */
  capabilityId?: string;
  /** ID estable del dominio de la capacidad. */
  domainId?: string;
  /** Etiquetas opcionales asignadas por el usuario. */
  tags?: string[];
}

export class MemoryWidget implements FocusWidget {
  readonly id = "memory";
  get label(): string {
    return i18n.t('widgets.registered.memory.label');
  }
  /*
   * Identidad visual canónica: inyectada por FocusPane desde la
   * definición registrada del tipo (fuente única; sin iconos
   * propios duplicados en la clase).
   */
  private visualIdentity: { icon?: string; color?: string } | null = null;

  get icon(): string {
    return this.visualIdentity?.icon ?? "";
  }

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
  private widgetManager: WidgetManager;
  private widgetRegistry: FocusWidgetRegistry;
  private executor: CapabilityExecutor;
  private contextResolver: ContextResolver;

  private selectedSources: Array<'note' | 'notes' | 'snips' | 'tasks'> = ['note'];
  private selectedDomain: string = 'Memoria';
  private selectedCapability: string = '';

  /**
   * Selector de entrada del toolbar del Asistente (Board / Widgets).
   * - 'board': fuente Board (extracción pendiente; comportamiento
   *   actual conservado sin cambios).
   * - 'widget': fuente Widgets; las instancias elegibles se
   *   seleccionan en un segundo menú (multi-selección con OK).
   */
  private inputSource: 'board' | 'widget' | 'nota' = 'board';

  /**
   * Instancias de widgets confirmadas en el segundo menú del
   * selector de contexto (modo «Widgets»). Solo estas instancias
   * aportan contexto al Asistente al ejecutar. Selección por
   * instancia individual (dos instancias del mismo tipo son
   * independientes).
   */
  private selectedWidgetInstances: Set<string> = new Set();

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
  /*
   * Guard de reentrada: resolveResultsMirror() puede re-renderizar
   * al aplicar resultados del espejo; ese render interior NO debe
   * limpiar results ni relanzar la resolución (bucle infinito que
   * saturaba el event loop y congelaba la vista con espejos
   * presentes; vacíos no lo provocaban porque no había datos que
   * aplicar).
   */
  private applyingMirror = false;

  private responseArea: HTMLElement | null = null;
  private currentResponse: string = '';
  /** Indica si hay una respuesta visible en el área de texto. */
  private hasResponse: boolean = false;

  // ---- Estado del modo Browser ----
  private browserMode: boolean = false;
  private browserSearch: string = '';
  private browserTreeVisible: boolean = false;
  private browserFilterCapability: string | null = null;

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
  widgetManager: WidgetManager,
  widgetRegistry: FocusWidgetRegistry
) {
    this.app = app;
    // El widget solo se instancia desde el propio plugin cargado.
    this.plugin = app.plugins?.plugins?.['folder-lab'] as FolderLabPlugin;
    this.aiService = aiService;
    this.registry = registry;
    this.widgetManager = widgetManager;
    this.widgetRegistry = widgetRegistry;
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

  setInstanceIdentity(
    _instanceId: string,
    _instanceName: string,
    visual?: { icon?: string; color?: string }
  ): void {
    this.visualIdentity = visual ?? null;
  }

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

    // El render interior disparado por resolveResultsMirror()
    // conserva los resultados ya aplicados (ver applyingMirror).
    if (!this.applyingMirror) {
      this.resultsMirrorId = null;
      this.results = [];
      void this.resolveResultsMirror();
    }

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

    /*
     * En modo Browser, la barra de búsqueda se renderiza
     * inmediatamente adyacente al toolbar, según su posición.
     */
    if (this.position === 'top') {
      this.renderControls();
      if (this.browserMode) {
        this.renderBrowserSearchBar(this.container);
      }
      this.renderContent();
    } else {
      this.renderContent();
      if (this.browserMode) {
        this.renderBrowserSearchBar(this.container);
      }
      this.renderControls(true);
    }
  }

  update(context: FocusContext): void {
    const newFile = context.activeFile;

    if (newFile === this.currentFile) return;

    this.currentFile = newFile;

    this.sessionView = 'capture';
    this.currentResponse = '';
    this.hasResponse = false;

    /*
     * Sin resolveResultsMirror() explícito: render() (abajo) ya
     * limpia results y lanza la resolución; hacerlo aquí duplicaba
     * la lectura del espejo en cada cambio de nota.
     */

    if (this.container) {
      this.render(this.container, context);
    }
  }


  /**
   * Re-renderiza el widget completo (toolbar + contenido) sin
   * resetear results ni re-resolver el espejo. Se usa para
   * alternar entre vistas (capture ↔ today) manteniendo el
   * estado de resultados en memoria.
   */
  private rerenderWidget(): void {
    if (!this.container) return;

    this.container.empty();

    /*
     * En modo Browser, la barra de búsqueda se renderiza
     * inmediatamente adyacente al toolbar, según su posición.
     */
    if (this.position === 'top') {
      this.renderControls();
      if (this.browserMode) {
        this.renderBrowserSearchBar(this.container);
      }
      this.renderContent();
    } else {
      this.renderContent();
      if (this.browserMode) {
        this.renderBrowserSearchBar(this.container);
      }
      this.renderControls(true);
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
    this.hasResponse = false;
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

    // ----------------------------------------------------------
    // MODO BROWSER: solo el selector de widgets en el toolbar.
    // La barra de búsqueda, el filtro y cerrar van en el
    // contenido (ver renderContent).
    // ----------------------------------------------------------
    if (this.browserMode) {
      return controls;
    }

    // ----------------------------------------------------------
    // TOOLBAR DEL ASISTENTE — dos estados según haya respuesta.
    // El selector de capacidades y la fuente de contexto viven
    // en el módulo de preparación del área de trabajo.
    // ----------------------------------------------------------

    if (this.hasResponse) {
      // ---- Estado respuesta ----
      controls.iconAction({
        id: 'browse-results',
        icon: 'search',
        zone: 'right'
      });

      controls.iconAction({
        id: 'save-response',
        icon: 'save',
        label: i18n.t('widgets.memory.action.save'),
        zone: 'right'
      });

      controls.iconAction({
        id: 'clear-response',
        icon: 'trash-2',
        label: i18n.t('widgets.memory.action.clear'),
        zone: 'right'
      });

      return controls;
    }

    // ---- Estado preparación ----
    // Solo la lupa de Browser. Run vive en el módulo de
    // preparación del área de trabajo.

    controls.iconAction({
      id: 'browse-results',
      icon: 'search',
      zone: 'right'
    });

    return controls;
  }

  /**
   * Instancia compañera: la que ocupa el otro panel junto a
   * Assistant en el layout actual. Se calcula dinámicamente en
   * cada uso para reflejar cambios de disposición.
   */
  /**
   * Fuente de verdad del modo Board: consulta directamente las
   * hojas abiertas del tipo BOARD_VIEW_TYPE. No usa una variable
   * independiente que pueda desincronizarse.
   */
  private isBoardModeActive(): boolean {
    try {
      return (
        this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE).length > 0
      );
    } catch {
      return false;
    }
  }

  private getCompanionInstance(): { instanceId: string; name: string; icon?: string } | null {
    const layout = this.widgetManager.getLayout();
    const companionId =
      this.position === 'top' ? layout.bottom : layout.top;
    if (!companionId) return null;
    const instance = this.widgetManager.getInstance(companionId);
    if (!instance) return null;
    const definition = this.widgetManager.getDefinition(instance.typeId);
    return {
      instanceId: instance.instanceId,
      name: instance.name,
      icon: definition?.identity?.icon
    };
  }

  /**
   * IDs efectivos de instancias para el contexto: el compañero
   * (automático) unido a las seleccionadas explícitamente, sin
   * duplicados por instanceId.
   */
  private getEffectiveWidgetInstanceIds(): string[] {
    const companion = this.getCompanionInstance();
    const ids = new Set<string>(this.selectedWidgetInstances);
    if (companion) {
      ids.add(companion.instanceId);
    }
    return [...ids];
  }

  /**
   * Hay instancias adicionales más allá del compañero automático?
   * Determina el indicador «Widgets+».
   */
  private hasAdditionalWidgetInstances(): boolean {
    const companion = this.getCompanionInstance();
    if (!companion) return this.selectedWidgetInstances.size > 0;
    // Explícitas que no son el compañero.
    for (const id of this.selectedWidgetInstances) {
      if (id !== companion.instanceId) return true;
    }
    return false;
  }

  /** Icono y etiqueta del selector de input (placeholder). */
  /**
   * Representación en el toolbar del valor seleccionado.
   * Sin icono: solo texto (el icono aparece únicamente en el
   * menú desplegable, no en el control visible).
   */
  private getInputDisplay(): { label: string; icon: string } {
    if (this.inputSource === 'board' && this.isBoardModeActive()) {
      return {
        label: i18n.t('widgets.memory.input.board'),
        icon: ''
      };
    }
    if (this.inputSource === 'nota') {
      return {
        label: i18n.t('widgets.memory.input.nota'),
        icon: ''
      };
    }
    const base = i18n.t('widgets.memory.input.widget');
    return {
      label: this.hasAdditionalWidgetInstances() ? `${base} +` : base,
      icon: ''
    };
  }

  /**
   * Menú del selector de input (placeholder): Board / Widget.
   * Solo actualiza el estado visual del control.
   */
  /**
   * Elimina del conjunto de selección las instancias que ya no
   * existen en el widget manager (referencias contextuales
   * obsoletas tras borrado de una instancia).
   */
  private pruneSelectedInstances(): void {
    if (this.selectedWidgetInstances.size === 0) return;
    const valid = new Set(
      this.widgetManager
        .getInstances()
        .map((i) => i.instanceId)
    );
    for (const id of [...this.selectedWidgetInstances]) {
      if (!valid.has(id)) {
        this.selectedWidgetInstances.delete(id);
      }
    }
  }

  private showInputMenu(): void {
    if (!this.container) return;

    const anchor = this.container.querySelector(
      '.fl-memory-prep-src-select'
    );

    if (!anchor?.instanceOf(HTMLElement)) return;

    const rect = anchor.getBoundingClientRect();
    const menu = new Menu();

    // Encabezado informativo, no seleccionable.
    menu.addItem((item) => {
      item
        .setTitle(i18n.t('widgets.memory.contextMenu.header'))
        .setDisabled(true);
    });

    menu.addSeparator();

    const options: Array<{ id: 'board' | 'widget' | 'nota'; label: string; icon: string }> = [
      {
        id: 'board',
        label: i18n.t('widgets.memory.input.board'),
        icon: 'layout-dashboard'
      },
      {
        id: 'widget',
        label: i18n.t('widgets.memory.input.widget'),
        icon: 'blocks'
      },
      {
        id: 'nota',
        label: i18n.t('widgets.memory.input.nota'),
        icon: 'file-text'
      }
    ];

    const boardActive = this.isBoardModeActive();

    for (const option of options) {
      menu.addItem((item) => {
        /*
         * Sin casilla verificadora: la selección se comunica
         * mediante el estado visual del propio elemento y del
         * picker. Una casilla aquí sugeriría selección múltiple
         * independiente, que no es el caso (Board/Widgets es
         * exclusivo).
         *
         * Board solo está habilitado en modo Board. En modo Nota
         * aparece atenuado (setDisabled aplica opacidad reducida
         * en Obsidian) y no responde al clic ni al teclado.
         */
        const isBoard = option.id === 'board';
        const disabled = isBoard && !boardActive;

        item
          .setTitle(option.label)
          .setIcon(option.icon);

        if (disabled) {
          item.setDisabled(true);
        }

        item.onClick(() => {
          if (disabled) return;

          this.inputSource = option.id;

          if (this.container && this.lastContext) {
            this.render(this.container, this.lastContext);
          }

          // Al elegir «Widgets», abrir el segundo menú de
          // selección de instancias tras el cierre del principal.
          if (option.id === 'widget') {
            window.setTimeout(
              () => this.showWidgetInstanceMenu(),
              0
            );
          }
        });
      });
    }

    /*
     * Apartado informativo del widget que comparte el panel con
     * Assistant. Sin casilla y sin toggle: el compañero forma
     * parte del contexto automáticamente. Nombre e icono de la
     * instancia real (cálculo dinámico, sin estado duplicado).
     */
    const companion = this.getCompanionInstance();
    if (companion) {
      menu.addSeparator();
      menu.addItem((item) => {
        item
          .setTitle(i18n.t('widgets.memory.contextMenu.companionHeader'))
          .setDisabled(true);
      });
      menu.addItem((item) => {
        item.setTitle(companion.name);
        if (companion.icon) {
          item.setIcon(companion.icon);
        }
        // Informativo: clic cierra el menú sin cambios.
        item.onClick(() => {
          // El compañero es automático; no hay nada que alternar.
        });
      });
    }

    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }

  /**
   * Segundo menú: selección múltiple de instancias de widgets.
   *
   * Se abre al elegir «Widgets» en el menú principal. Lista todas
   * las instancias de widgets de la sesión actual con casillas de
   * selección. Un botón «OK» confirma y cierra; cerrar sin
   * confirmar (Escape o clic fuera) descarta los cambios pendientes.
   *
   * La selección es por instancia individual: dos instancias del
   * mismo tipo se seleccionan de forma independiente.
   */
  private showWidgetInstanceMenu(): void {
    if (!this.container) return;

    // Poda de referencias obsoletas antes de mostrar el menú.
    this.pruneSelectedInstances();

    const anchor = this.container.querySelector(
      '.fl-memory-prep-src-select'
    );

    if (!anchor?.instanceOf(HTMLElement)) return;

    const rect = anchor.getBoundingClientRect();
    const menu = new Menu();

    // Selección de trabajo: se confirma SOLO con OK.
    const pending = new Set<string>(this.selectedWidgetInstances);
    let confirmed = false;

    // Excluir Assistant (memory) y Active Note: no son fuentes
    // adicionales elegibles. Filtro por typeId real, no por nombre.
    const instances = this.widgetManager.getInstances().filter(
      (i) => i.typeId !== 'memory' && i.typeId !== 'active-note'
    );

    if (instances.length === 0) {
      menu.addItem((item) => {
        item
          .setTitle(i18n.t('widgets.memory.instanceMenu.empty'))
          .setDisabled(true);
      });
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
      return;
    }

    // Encabezado informativo.
    menu.addItem((item) => {
      item
        .setTitle(i18n.t('widgets.memory.instanceMenu.header'))
        .setDisabled(true);
    });

    menu.addSeparator();

    for (const instance of instances) {
      const definition = this.widgetManager.getDefinition(
        instance.typeId
      );
      const icon = definition?.identity?.icon;

      menu.addItem((item) => {
        item
          .setTitle(instance.name)
          .setChecked(pending.has(instance.instanceId));

        if (icon) {
          item.setIcon(icon);
        }

        item.onClick(() => {
          // Alternar la selección pendiente SIN cerrar el menú.
          if (pending.has(instance.instanceId)) {
            pending.delete(instance.instanceId);
          } else {
            pending.add(instance.instanceId);
          }
          // Reabrir para reflejar el cambio de casilla.
          menu.hide();
          window.setTimeout(() => {
            this.reopenInstanceMenu(rect, pending, (confirmedPending) => {
              this.selectedWidgetInstances = confirmedPending;
              if (this.container && this.lastContext) {
                this.render(this.container, this.lastContext);
              }
            });
          }, 0);
        });
      });
    }

    menu.addSeparator();

    // Acción independiente de confirmación: sin icono de
    // verificación (evita confusión con selección de ítems).
    menu.addItem((item) => {
      item
        .setTitle(i18n.t('widgets.memory.instanceMenu.ok'))
        .onClick(() => {
          confirmed = true;
          this.selectedWidgetInstances = pending;
          if (this.container && this.lastContext) {
            this.render(this.container, this.lastContext);
          }
        });
    });

    // Cancelar o cerrar sin confirmar: descartar cambios pendientes.
    menu.onHide(() => {
      if (!confirmed) {
        // Los cambios pendientes se descartan; la selección
        // confirmada permanece intacta.
      }
    });

    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
    this.centerMenuAction(menu);
  }

  /**
   * Centra horizontalmente el último ítem del menú (la acción
   * OK) añadiendo una clase CSS al elemento DOM correspondiente.
   * Obsidian no expone el DOM de MenuItem; se localiza el menú
   * renderizado en el documento y se marca el último .menu-item.
   */
  private centerMenuAction(menu: Menu): void {
    if (typeof document === 'undefined') return;
    window.requestAnimationFrame(() => {
      const menus = document.querySelectorAll('.menu');
      const lastMenu = menus[menus.length - 1];
      if (!lastMenu) return;
      const items = lastMenu.querySelectorAll('.menu-item');
      const lastItem = items[items.length - 1];
      if (lastItem) {
        lastItem.addClass('fl-menu-action-centered');
      }
    });
  }

  /**
   * Reabre el menú de instancias tras alternar una casilla,
   * conservando la selección pendiente.
   */
  private reopenInstanceMenu(
    rect: DOMRect,
    pending: Set<string>,
    onConfirm: (selection: Set<string>) => void
  ): void {
    const menu = new Menu();
    let confirmed = false;

    const instances = this.widgetManager.getInstances().filter(
      (i) => i.typeId !== 'memory' && i.typeId !== 'active-note'
    );

    menu.addItem((item) => {
      item
        .setTitle(i18n.t('widgets.memory.instanceMenu.header'))
        .setDisabled(true);
    });

    menu.addSeparator();

    for (const instance of instances) {
      const definition = this.widgetManager.getDefinition(
        instance.typeId
      );
      const icon = definition?.identity?.icon;

      menu.addItem((item) => {
        item
          .setTitle(instance.name)
          .setChecked(pending.has(instance.instanceId));

        if (icon) {
          item.setIcon(icon);
        }

        item.onClick(() => {
          if (pending.has(instance.instanceId)) {
            pending.delete(instance.instanceId);
          } else {
            pending.add(instance.instanceId);
          }
          menu.hide();
          window.setTimeout(() => {
            this.reopenInstanceMenu(rect, pending, onConfirm);
          }, 0);
        });
      });
    }

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle(i18n.t('widgets.memory.instanceMenu.ok'))
        .onClick(() => {
          confirmed = true;
          onConfirm(new Set(pending));
        });
    });

    menu.onHide(() => {
      if (!confirmed) {
        // Descartar: no se aplica la selección pendiente.
      }
    });

    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
    this.centerMenuAction(menu);
  }


  private renderControls(includeAssistantControls: boolean = true): void {
    if (!this.container) {
      return;
    }

    // Eliminar toolbar anterior para evitar duplicados al
    // alternar entre estados inicial y resultado.
    const oldToolbar = this.container.querySelector('.fl-widget-controls');
    if (oldToolbar) {
      oldToolbar.remove();
    }

    const controls = this.buildControls(includeAssistantControls);

    WidgetControlsRenderer.render(
      this.container,
      controls.getConfig(),
      {
        onWidgetSelect: () => {
          this.callbacks.onWidgetSelect?.();
        },

        onControlSelect: () => {},

        onPickerOpen: (controlId) => {
          if (controlId !== 'input') return;
          this.showInputMenu();
        },

        onAction: (controlId) => {
          if (controlId === 'open-capabilities') {
            // Biblioteca de capacidades (browser.ts): búsqueda,
            // exploración y selección de capacidades.
            const modal = new CapabilityBrowser(
              this.app,
              {
                registry: this.registry,
                selectedGroup: this.selectedDomain,
                selectedCapability: this.selectedCapability,

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
            return;
          }

          if (controlId === 'browse-results') {
            // Abrir el modo Browser.
            this.browserMode = true;
            this.sessionView = 'today';
            this.rerenderWidget();
            return;
          }

          if (controlId === 'close-browser') {
            // Cerrar Browser: restaura la vista de captura.
            this.browserMode = false;
            this.sessionView = 'capture';
            this.rerenderWidget();
            return;
          }

          if (controlId === 'clear-response') {
            this.clearResponse();
            return;
          }

          if (controlId === 'save-response') {
            // La respuesta ya se archivó automáticamente al
            // generarse. Se re-confirma el guardado.
            this.saveResults();
            return;
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

    const contentWrapper = this.container.createDiv({
      cls: 'fl-widget-content fl-widget-content-expanded fl-memory-content-wrapper'
    });

    // ============================================================
    // PANEL CAPTURE
    // ============================================================

    const capturePanel = contentWrapper.createDiv({
      cls: 'fl-memory-capture-panel'
    });
    capturePanel.toggleClass(
      'is-hidden',
      this.sessionView !== 'capture'
    );

    // ------------------------------------------------------------
    // MÓDULO DE PREPARACIÓN (solo sin respuesta)
    // Contiene el selector de capacidades y la fuente de contexto.
    // Se oculta cuando hay respuesta (hasResponse).
    // ------------------------------------------------------------

    if (!this.hasResponse) {
      const prepModule = capturePanel.createDiv({
        cls: 'fl-memory-prep-module'
      });

      // ---- Cabecera del módulo ----
      const header = prepModule.createDiv({
        cls: 'fl-memory-prep-header'
      });

      const headerText = header.createDiv({
        cls: 'fl-memory-prep-header-text'
      });

      // Título: nombre de la instancia (futuro) o «Asistente».
      // TODO: sustituir por el nombre real de la instancia cuando
      // se implemente la personalización de instancias del widget.
      headerText.createDiv({
        cls: 'fl-memory-prep-header-title',
        text: this.label
      });

      headerText.createDiv({
        cls: 'fl-memory-prep-header-subtitle',
        text: i18n.t('widgets.memory.prep.subtitle')
      });

      // Botón de configuración del perfil.
      // TODO: conectar a la interfaz de configuración del perfil
      // cuando exista. Por ahora es un control real sin acción
      // de persistencia para no simular datos que no se guardan.
      const configBtn = header.createEl('button', {
        cls: 'fl-memory-prep-header-config',
        attr: {
          type: 'button',
          'aria-label': i18n.t('widgets.memory.prep.configure'),
          title: i18n.t('widgets.memory.prep.configure')
        }
      });
      setIcon(configBtn, 'settings');

      // ---- Bloque 1: Capacidad ----
      const capBlock = prepModule.createDiv({
        cls: 'fl-memory-prep-block'
      });

      capBlock.createDiv({
        cls: 'fl-memory-prep-block-label',
        text: i18n.t('widgets.memory.spec.capabilities')
      });

      const capBtn = capBlock.createEl('button', {
        cls: 'fl-memory-prep-select',
        attr: {
          type: 'button',
          'aria-label': i18n.t('widgets.memory.capability.placeholder')
        }
      });

      // Nombre de la capacidad seleccionada (principal).
      const capValue = capBtn.createDiv({
        cls: 'fl-memory-prep-cap-value',
        text: this.selectedCapability
          ? this.getCapabilityLabel()
          : i18n.t('widgets.memory.capability.placeholder')
      });
      if (!this.selectedCapability) {
        capValue.addClass('is-empty');
      }

      // Dominio de la capacidad (secundario, debajo).
      if (this.selectedCapability && this.selectedDomain) {
        const groups = this.registry.getGroups();
        const group = groups.find(g => g.id === this.selectedDomain);
        if (group) {
          capBtn.createDiv({
            cls: 'fl-memory-prep-cap-domain',
            text: getDomainLabel(group.id, group.label)
          });
        }
      }

      capBtn.addEventListener('click', () => {
        const modal = new CapabilityBrowser(
          this.app,
          {
            registry: this.registry,
            selectedGroup: this.selectedDomain,
            selectedCapability: this.selectedCapability,
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
                this.render(this.container, this.lastContext);
              }
            }
          }
        );
        modal.open();
      });

      // ---- Bloque 2: Fuente de contexto ----
      const srcBlock = prepModule.createDiv({
        cls: 'fl-memory-prep-block'
      });

      srcBlock.createDiv({
        cls: 'fl-memory-prep-block-label',
        text: i18n.t('widgets.common.context')
      });

      const inputDisplay = this.getInputDisplay();
      const srcBtn = srcBlock.createEl('button', {
        cls: 'fl-memory-prep-select fl-memory-prep-src-select',
        attr: {
          type: 'button',
          'aria-label': `${i18n.t('widgets.common.context')}: ${inputDisplay.label}`
        }
      });
      srcBtn.createSpan({
        cls: 'fl-memory-prep-select-value',
        text: inputDisplay.label
      });
      const srcChevron = srcBtn.createSpan({
        cls: 'fl-memory-prep-select-chevron',
        attr: { 'aria-hidden': 'true' }
      });
      setIcon(srcChevron, 'chevron-down');
      srcBtn.addEventListener('click', () => {
        this.showInputMenu();
      });

      // ---- Separador discreto ----
      prepModule.createDiv({ cls: 'fl-memory-prep-sep' });

      // ---- Botón Run (alineado a la derecha) ----
      const runBtn = prepModule.createEl('button', {
        cls: 'fl-memory-prep-run',
        attr: { type: 'button' }
      });
      setIcon(runBtn, 'play');
      runBtn.createSpan({ text: i18n.t('widgets.memory.action.run') });
      runBtn.addEventListener('click', () => {
        void this.execute();
      });
    }

    // ------------------------------------------------------------
    // RESPUESTA ACTUAL
    // ------------------------------------------------------------

    this.responseArea = capturePanel.createDiv({
      cls: 'fl-memory-response-area'
    });

    this.responseArea.setAttr('contenteditable', 'false');

    if (this.currentResponse.trim()) {
      void this.renderMarkdown(
        this.currentResponse,
        this.responseArea
      );
    }
    // Sin respuesta: el módulo de preparación muestra la
    // configuración; el área de respuesta queda vacía.
    // ============================================================
    // PANEL TODAY / BROWSER
    // ============================================================

    const todayPanel = contentWrapper.createDiv({
      cls: 'fl-memory-today-panel'
    });
    todayPanel.toggleClass(
      'is-hidden',
      this.sessionView !== 'today'
    );

    this.resultContainer = todayPanel.createDiv({
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

    // No vaciar todo el contenedor: preservar la barra de búsqueda
    // del modo Browser. Solo limpiar los resultados anteriores.
    const oldItems = this.resultContainer.querySelectorAll(
      '.fl-focus-list-item, .fl-widget-empty-text'
    );
    Array.from(oldItems).forEach(el => el.remove());

    const filtered = this.getFilteredResults();

    if (filtered.length === 0) {
      let emptyMsg: string;
      if (this.results.length === 0) {
        emptyMsg = i18n.t('widgets.memory.empty.noSavedResponses');
      } else if (this.browserFilterCapability) {
        emptyMsg = i18n.t('widgets.memory.empty.noSelectionResults');
      } else {
        emptyMsg = i18n.t('widgets.memory.empty.noSearchResults');
      }
      this.resultContainer.createDiv({
        cls: 'fl-widget-empty-text',
        text: emptyMsg
      });
      return;
    }

    for (const result of [...filtered].reverse()) {
      void this.renderResultItem(result);
    }
  }

  /**
   * Filtra los resultados según la búsqueda textual y los filtros
   * activos del modo Browser. Sin filtros activos, devuelve todos.
   */
  private getFilteredResults(): MemoryResult[] {
    let filtered = this.results;

    // Filtro por capacidad (único filtro de metadatos).
    if (this.browserFilterCapability) {
      filtered = filtered.filter(
        r => r.capabilityId === this.browserFilterCapability
      );
    }

    // Búsqueda textual sobre contenido y etiquetas.
    const query = this.browserSearch.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter(r => {
        const inContent = r.content.toLowerCase().includes(query);
        const inTags = r.tags?.some(
          t => t.toLowerCase().includes(query)
        ) ?? false;
        return inContent || inTags;
      });
    }

    return filtered;
  }

  /**
   * Barra de búsqueda permanente del modo Browser.
   * Una sola línea: campo de búsqueda + limpiar + filtro + cerrar.
   * El árbol de capacidades se muestra/oculta con el filtro.
   */
  private renderBrowserSearchBar(container: HTMLElement): void {
    const panel = container.createDiv({
      cls: 'fl-memory-browser-panel'
    });

    const searchBar = panel.createDiv({
      cls: 'fl-memory-browser-search'
    });

    // Envoltorio del campo: input + icono de limpiar integrado.
    const inputWrap = searchBar.createDiv({
      cls: 'fl-browser-search-wrap'
    });

    const searchInput = inputWrap.createEl('input', {
      cls: 'fl-memory-browser-search-input',
      attr: {
        type: 'text',
        placeholder: i18n.t('widgets.memory.browser.searchPlaceholder')
      },
      value: this.browserSearch
    });

    // Icono de limpiar: solo visible cuando hay texto.
    const clearBtn = inputWrap.createEl('button', {
      cls: 'fl-browser-search-clear',
      attr: { type: 'button', 'aria-label': i18n.t('widgets.memory.browser.clearSearch') }
    });
    setIcon(clearBtn, 'broom');
    clearBtn.toggleClass('is-visible', this.browserSearch.length > 0);

    searchInput.addEventListener('input', () => {
      this.browserSearch = searchInput.value;
      clearBtn.toggleClass('is-visible', this.browserSearch.length > 0);
      this.renderResults();
    });

    clearBtn.addEventListener('click', () => {
      this.browserSearch = '';
      searchInput.value = '';
      clearBtn.toggleClass('is-visible', false);
      this.renderResults();
    });

    // Control de filtro: alterna el árbol de capacidades.
    const filterBtn = searchBar.createEl('button', {
      cls: 'fl-browser-filter-btn',
      attr: {
        type: 'button',
        'aria-label': i18n.t('widgets.memory.browser.filterCapability'),
        title: i18n.t('widgets.memory.browser.filterCapability')
      }
    });
    setIcon(filterBtn, 'filter');
    filterBtn.addEventListener('click', () => {
      this.browserTreeVisible = !this.browserTreeVisible;
      this.rerenderWidget();
    });

    // Etiqueta «Close»: texto cliqueable, no botón.
    const closeEl = searchBar.createSpan({
      cls: 'fl-browser-close-label',
      attr: { role: 'button', tabindex: '0' },
      text: 'Close'
    });
    const closeAction = (): void => {
      this.browserMode = false;
      this.sessionView = 'capture';
      this.rerenderWidget();
    };
    closeEl.addEventListener('click', closeAction);
    closeEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        closeAction();
      }
    });

    // Árbol de capacidades (visible/oculto según filtro).
    if (this.browserTreeVisible) {
      this.renderBrowserCapabilityTree(panel);
    }
  }

  /**
   * Árbol navegable de capacidades del modo Browser.
   * Deriva dominios y capacidades del registry del Asistente.
   * Seleccionar una capacidad filtra los fragmentos por
   * capabilityId. Las capacidades se muestran aunque no tengan
   * fragmentos asociados.
   */
  private renderBrowserCapabilityTree(container: HTMLElement): void {
    const tree = container.createDiv({
      cls: 'fl-memory-browser-tree'
    });

    const groups = this.registry.getGroups();

    for (const group of groups) {
      const groupLabel = getDomainLabel(group.id, group.label);
      const capabilities = this.registry.getByGroup(group.id);

      const groupEl = tree.createDiv({ cls: 'fl-browser-tree-group' });

      groupEl.createDiv({
        cls: 'fl-browser-tree-group-label',
        text: groupLabel
      });

      const capList = groupEl.createDiv({ cls: 'fl-browser-tree-caps' });

      for (const cap of capabilities) {
        const capLabel = getCapabilityLabel(cap.id, cap.label);
        const isSelected = this.browserFilterCapability === cap.id;

        const capEl = capList.createDiv({
          cls: `fl-browser-tree-cap${isSelected ? ' is-selected' : ''}`,
          attr: { role: 'button', tabindex: '0' }
        });

        capEl.createSpan({ cls: 'fl-browser-tree-cap-label', text: capLabel });

        // Contador de fragmentos para esta capacidad.
        const count = this.results.filter(
          r => r.capabilityId === cap.id
        ).length;
        if (count > 0) {
          capEl.createSpan({
            cls: 'fl-browser-tree-cap-count',
            text: String(count)
          });
        }

        const selectCap = (): void => {
          this.browserFilterCapability = isSelected ? null : cap.id;
          this.rerenderWidget();
        };

        capEl.addEventListener('click', selectCap);
        capEl.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectCap();
          }
        });
      }
    }
  }

  /**
   * Ficha técnica pre-ejecución: se muestra en el área de
   * respuesta cuando NO hay respuesta actual. Describe la
   * configuración efectiva (capacidad + fuentes de contexto)
   * que se utilizará en la próxima ejecución.
   *
   * Formato en UNA sola línea:
   *   Capacidades: Dominio - Capacidad · Fuentes: Fuente1, Fuente2
   *
   * Reutiliza el estado y los mecanismos de resolución
   * existentes para garantizar que lo que muestra coincide
   * con lo que recibe el modelo. No se añade al prompt.
   */
  private renderResponsePlaceholder(): void {
    if (!this.responseArea) return;

    const card = this.responseArea.createDiv({
      cls: 'fl-memory-spec-card'
    });

    // ── CAPACIDADES ──
    const capValue = this.selectedCapability
      ? this.getSpecCapabilityLabel()
      : i18n.t('widgets.memory.spec.noCapability');

    // ── FUENTES DE CONTEXTO ──
    const sources = this.resolveEffectiveContextSources();
    const srcValue = sources.length === 0
      ? i18n.t('widgets.memory.spec.noSources')
      : sources.map(s => s.label).join(', ');

    // ── LÍNEA ÚNICA ──
    const capLabel = i18n.t('widgets.memory.spec.capabilities');
    const srcLabel = i18n.t('widgets.memory.spec.sources');

    const line = card.createDiv({
      cls: 'fl-memory-spec-line'
    });

    line.createSpan({
      cls: 'fl-memory-spec-part',
      text: `${capLabel}: ${capValue}`
    });

    line.createSpan({
      cls: 'fl-memory-spec-sep',
      text: '·',
      attr: { 'aria-hidden': 'true' }
    });

    line.createSpan({
      cls: 'fl-memory-spec-part',
      text: `${srcLabel}: ${srcValue}`
    });
  }

  /**
   * Etiqueta canónica en inglés para la ficha técnica,
   * independiente del locale. Usa `getCapabilityLabel` de
   * capabilityTexts con la resolución i18n en inglés para la
   * capacidad y su dominio, formateando «Dominio - Capacidad».
   */
  private getSpecCapabilityLabel(): string {
    if (!this.selectedCapability) return '';

    // Mapa mental: etiqueta fija en inglés.
    if (this.selectedCapability === 'transform-mindmap') {
      return 'Transform - Mind Map';
    }

    try {
      const tools = this.registry.getByGroup(this.selectedDomain);
      const found = tools.find(t => t.id === this.selectedCapability);
      if (found) {
        // Resolver la etiqueta en inglés vía capabilityTexts.
        const enLabel = getCapabilityLabel(
          found.id,
          found.label
        );
        // Obtener el nombre del dominio en inglés.
        const groups = this.registry.getGroups();
        const group = groups.find(g => g.id === this.selectedDomain);
        const domainEn = group
          ? getDomainLabel(group.id, group.label)
          : '';
        return domainEn
          ? `${domainEn} - ${enLabel}`
          : enLabel;
      }
    } catch (e) {
      console.warn('Error resolving spec capability label:', e);
    }

    return this.selectedCapability;
  }

  /**
   * Resuelve las fuentes de contexto efectivas para la próxima
   * ejecución, reutilizando el estado real (sin copia
   * independiente). Devuelve solo fuentes activas y elegibles.
   * Sin iconos: la ficha técnica es solo texto.
   */
  private resolveEffectiveContextSources(): Array<{
    label: string;
  }> {
    const sources: Array<{ label: string }> = [];

    // Fuente principal según inputSource.
    if (this.inputSource === 'board' && this.isBoardModeActive()) {
      sources.push({
        label: i18n.t('widgets.memory.input.board')
      });
    } else if (this.inputSource === 'nota') {
      const noteName = this.currentFile?.basename ?? '';
      sources.push({
        label: noteName
          ? `${i18n.t('widgets.memory.input.nota')}: ${noteName}`
          : i18n.t('widgets.memory.input.nota')
      });
    } else {
      // Modo widget: companion + instancias adicionales.
      const companion = this.getCompanionInstance();
      if (companion) {
        sources.push({
          label: companion.name
        });
      }

      const companionId = companion?.instanceId;
      for (const id of this.getEffectiveWidgetInstanceIds()) {
        if (id === companionId) continue;
        const inst = this.widgetManager.getInstance(id);
        if (inst) {
          sources.push({
            label: inst.name
          });
        }
      }
    }

    return sources;
  }

  private async renderResultItem(
    result: MemoryResult
  ): Promise<void> {
    if (!this.resultContainer) return;

    const listItem = new FocusListItem(
      this.resultContainer,
      {
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

            this.saveResults();

            listItem.destroy();
          }
        }
      }
    );

    const content = listItem.getContentElement();

    content.addClass('fl-memory-item-content');

    // ----------------------------------------------------------
    // METADATOS: capacidad y dominio (IDs estables → labels i18n)
    // ----------------------------------------------------------

    if (result.capabilityId || result.domainId) {
      const meta = content.createDiv({ cls: 'fl-memory-item-meta' });

      if (result.domainId) {
        const group = this.registry
          .getGroups()
          .find(g => g.id === result.domainId);
        const domainLabel = group
          ? getDomainLabel(group.id, group.label)
          : result.domainId;
        meta.createSpan({ cls: 'fl-memory-item-domain', text: domainLabel });
      }

      if (result.capabilityId) {
        const capLabel = getCapabilityLabel(
          result.capabilityId,
          result.capabilityId
        );
        meta.createSpan({ cls: 'fl-memory-item-capability', text: capLabel });
      }
    }

    // ----------------------------------------------------------
    // CONTENIDO EXPANDIBLE Y EDITABLE
    // ----------------------------------------------------------

    const expandable = createExpandableText(
      content,
      result.content,
      {
        initiallyExpanded: false,
        previewLines: 3,
        collapsedLabel: i18n.t('widgets.common.expand'),
        expandedLabel: i18n.t('widgets.common.collapse'),
        editable: true,
        expandedEditing: true,
        saveExpandedEdit: async (newText: string) => {
          result.content = newText;
          this.saveResults();
        },
        rootClass: 'fl-memory-expandable',
        contentClass: 'fl-memory-expandable-content',
        actionClass: 'fl-memory-expandable-action',
        onExpandedChange: (expanded) => {
          listItem.setExpanded(expanded);
        }
      }
    );

    this.resultElements.set(result.id, content);

    await this.renderMarkdown(result.content, expandable.content);

    // ----------------------------------------------------------
    // ETIQUETAS
    // ----------------------------------------------------------

    this.renderResultTags(content, result);

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

  /**
   * Renderiza las etiquetas de un resultado con opciones para
   * añadir y eliminar. Se persisten en el propio resultado.
   */
  private renderResultTags(
    container: HTMLElement,
    result: MemoryResult
  ): void {
    const tagsRow = container.createDiv({ cls: 'fl-memory-item-tags' });

    // Etiquetas existentes.
    for (const tag of result.tags ?? []) {
      const tagEl = tagsRow.createSpan({
        cls: 'fl-memory-item-tag',
        attr: { role: 'button', tabindex: '0' },
        text: tag
      });
      tagEl.addEventListener('click', () => {
        // Eliminar etiqueta al hacer clic.
        result.tags = (result.tags ?? []).filter(t => t !== tag);
        this.saveResults();
        this.rerenderWidget();
      });
    }

    // Botón añadir etiqueta.
    const addTagBtn = tagsRow.createEl('button', {
      cls: 'fl-memory-item-add-tag',
      attr: { type: 'button', 'aria-label': i18n.t('widgets.memory.browser.addTag') }
    });
    setIcon(addTagBtn, 'plus');
    addTagBtn.addEventListener('click', () => {
      void import('obsidian').then(({ Modal }) => {
        const onSaveTag = (tag: string): void => {
          result.tags = [...(result.tags ?? []), tag];
          this.saveResults();
          this.rerenderWidget();
        };
        const appRef = this.app;

        class TagModal extends Modal {
          onOpen(): void {
            const { contentEl } = this;
            contentEl.createEl('h3', {
              text: i18n.t('widgets.memory.browser.addTag')
            });
            const input = contentEl.createEl('input', {
              attr: { type: 'text', placeholder: i18n.t('widgets.memory.browser.tagPlaceholder') }
            });
            input.addEventListener('keydown', (e: KeyboardEvent) => {
              if (e.key === 'Enter' && input.value.trim()) {
                onSaveTag(input.value.trim());
                this.close();
              }
            });
            input.focus();
          }
        }
        new TagModal(appRef).open();
      });
    });
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
    const empty = this.container!.createDiv({
      cls: 'fl-widget-empty'
    });

    empty.createDiv({
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

      loadingEl = this.responseArea.createDiv({
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
      // Poda de referencias obsoletas antes de ejecutar.
      this.pruneSelectedInstances();

      const request: UserRequest = {
        toolId: this.selectedCapability,

        sources: [...this.selectedSources],

        // Compatibilidad temporal. En modo «nota» se fuerza
        // 'note' para que el contexto sea la nota activa.
        contextType:
          this.inputSource === 'nota'
            ? 'note'
            : this.selectedSources[0] || 'note',

        activeNotePath: this.currentFile.path,
        temperature: this.plugin?.settings?.aiTemperature,
        maxTokens: this.plugin?.settings?.aiMaxTokens,

        // Modo «Widgets»: el contexto se construye a partir del
        // compañero automático + las instancias confirmadas en el
        // segundo menú (sin duplicados). inputSource se envía
        // SIEMPRE en modo widget para que PromptBuilder no caiga
        // al heredado. En modo «nota» no se envía inputSource
        // widget: PromptBuilder usa el camino heredado con
        // contextType 'note' (contenido de la nota activa).
        ...(this.inputSource === 'widget'
          ? {
              inputSource: 'widget' as const,
              widgetInstanceIds: this.getEffectiveWidgetInstanceIds()
            }
          : {})
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
          createdAt: Date.now(),
          capabilityId: this.selectedCapability,
          domainId: this.selectedDomain
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

        // --------------------------------------------------------
        // Cambiar toolbar al estado resultado y re-renderizar
        // solo los controles (sin reconstruir el contenido).
        // --------------------------------------------------------

        this.hasResponse = true;
        this.renderControls();

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
   * Borra la respuesta visible del área de texto y devuelve el
   * toolbar al estado inicial, restaurando los controles de
   * capacidades, fuente de contexto, Browser y Run.
   */
  private clearResponse(): void {
    this.currentResponse = '';
    this.hasResponse = false;

    // Re-renderizar toolbar + contenido para restaurar
    // el módulo de preparación y el placeholder.
    this.rerenderWidget();
  }

  /**
   * Muestra un mensaje en el área de resultado preservando el botón de copiar
   */
  private showResultMessage(message: string): void {
    if (!this.resultContainer) return;

    this.resultContainer.createDiv({
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
          createdAt?: unknown;
          capabilityId?: unknown;
          domainId?: unknown;
          tags?: unknown;
        };
        // Formato base: id y content siempre requeridos.
        if (
          typeof candidate.id !== 'string' ||
          typeof candidate.content !== 'string'
        ) {
          return false;
        }
        // Campos opcionales: si están presentes, deben tener tipo correcto.
        if (
          candidate.createdAt !== undefined &&
          typeof candidate.createdAt !== 'number'
        ) {
          return false;
        }
        if (
          candidate.capabilityId !== undefined &&
          typeof candidate.capabilityId !== 'string'
        ) {
          return false;
        }
        if (
          candidate.domainId !== undefined &&
          typeof candidate.domainId !== 'string'
        ) {
          return false;
        }
        if (
          candidate.tags !== undefined &&
          !Array.isArray(candidate.tags)
        ) {
          return false;
        }
        return true;
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
            /*
             * Re-render con applyingMirror=true: render() dibuja los
             * resultados ya aplicados SIN limpiar results ni volver
             * a lanzar esta resolución (evita el bucle infinito
             * render→resolve→render cuando el espejo tiene datos).
             */
            this.applyingMirror = true;
            try {
              this.render(this.container, this.lastContext);
            } finally {
              this.applyingMirror = false;
            }
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
  private widgetRegistry: FocusWidgetRegistry;

  constructor(
    app: AppWithPluginRegistry,
    aiService: AIService,
    registry: CapabilityRegistry,
    widgetController: WidgetController,
    widgetManager: WidgetManager,
    widgetRegistry: FocusWidgetRegistry
  ) {
    this.app = app;
    this.aiService = aiService;
    this.registry = registry;
    this.widgetController = widgetController;
    this.widgetManager = widgetManager;
    this.widgetRegistry = widgetRegistry;
  }

  create(): FocusWidget {
    return new MemoryWidget(
      this.app,
      this.aiService,
      this.registry,
      this.widgetController,
      this.widgetManager,
      this.widgetRegistry
    );
  }
}
