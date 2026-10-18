import { App, Component, MarkdownRenderer, Notice, TFile, Menu } from 'obsidian';

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
  active: boolean;
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

    /*
     * Sin resolveResultsMirror() explícito: render() (abajo) ya
     * limpia results y lanza la resolución; hacerlo aquí duplicaba
     * la lectura del espejo en cada cambio de nota.
     */

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

    // ----------------------------------------------------------
    // TOOLBAR (derecha, izquierda → derecha):
    //   1. Selector de input (Board/Widgets)
    //   2. Configuración (biblioteca de capacidades, solo icono)
    //   3. Run (ejecuta la capacidad seleccionada)
    // ----------------------------------------------------------

    // 1. Selector de input: icono + etiqueta + flecha desplegable.
    //    Patrón labelParts del selector de sesiones de Notes:
    //    «Contexto:» atenuado + valor contrastado.
    const inputDisplay = this.getInputDisplay();
    controls.picker({
      id: 'input',
      label: inputDisplay.label,
      icon: inputDisplay.icon,
      labelParts: {
        prefix: `${i18n.t('widgets.common.context')}:`,
        value: inputDisplay.label
      }
    });

    // 2. Configuración: entre el selector y Run.
    controls.iconAction({
      id: 'open-capabilities',
      icon: 'sliders-horizontal'
    });

    // 3. Run: icono + etiqueta; último control.
    controls.iconAction({
      id: 'execute',
      icon: 'play',
      label: i18n.t('widgets.memory.action.run')
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
      '.fl-widget-control-item[data-control-id="input"]'
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
      '.fl-widget-control-item[data-control-id="input"]'
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
    } else {
      this.renderResponsePlaceholder();
    }
    // ============================================================
    // PANEL TODAY
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

    this.resultContainer.empty();

    if (this.results.length === 0) {
      this.resultContainer.createDiv({
        cls: 'fl-widget-empty-text',
        text: i18n.t('widgets.memory.empty.noSavedResponses')
      });
      return;
    }

    for (const result of [...this.results].reverse()) {
      void this.renderResultItem(result);
    }
  }

  /**
   * Ficha técnica pre-ejecución: se muestra en el área de
   * respuesta cuando NO hay respuesta actual. Describe la
   * configuración efectiva (capacidad + fuentes de contexto)
   * que se utilizará en la próxima ejecución.
   *
   * Reutiliza el estado y los mecanismos de resolución
   * existentes (selectedCapability, getEffectiveWidgetInstanceIds,
   * getCompanionInstance, isBoardModeActive, currentFile) para
   * garantizar que lo que muestra coincide con lo que recibe el
   * modelo. No se añade al prompt.
   */
  private renderResponsePlaceholder(): void {
    if (!this.responseArea) return;

    const card = this.responseArea.createDiv({
      cls: 'fl-memory-spec-card'
    });

    // ── CAPACIDADES ──
    const capSection = card.createDiv({
      cls: 'fl-memory-spec-section'
    });

    capSection.createDiv({
      cls: 'fl-memory-spec-heading',
      text: i18n.t('widgets.memory.spec.capabilities')
    });

    const capValue = this.selectedCapability
      ? this.getSpecCapabilityLabel()
      : i18n.t('widgets.memory.spec.noCapability');

    capSection.createDiv({
      cls: 'fl-memory-spec-value',
      text: capValue
    });

    // ── FUENTES DE CONTEXTO ──
    const srcSection = card.createDiv({
      cls: 'fl-memory-spec-section'
    });

    srcSection.createDiv({
      cls: 'fl-memory-spec-heading',
      text: i18n.t('widgets.memory.spec.sources')
    });

    const sources = this.resolveEffectiveContextSources();
    const srcList = srcSection.createDiv({
      cls: 'fl-memory-spec-sources'
    });

    if (sources.length === 0) {
      srcList.createDiv({
        cls: 'fl-memory-spec-source-item',
        text: i18n.t('widgets.memory.spec.noSources')
      });
    } else {
      for (const src of sources) {
        srcList.createDiv({
          cls: 'fl-memory-spec-source-item',
          text: src.label
        });
      }
    }
  }

  /**
   * Etiqueta canónica en inglés para la ficha técnica,
   * independiente del locale. Usa `getCapabilityLabel` de
   * capabilityTexts con la resolución i18n en inglés para la
   * capacidad y su dominio, formateando «Dominio → Capacidad».
   */
  private getSpecCapabilityLabel(): string {
    if (!this.selectedCapability) return '';

    // Mapa mental: etiqueta fija en inglés.
    if (this.selectedCapability === 'transform-mindmap') {
      return 'Transform → Mind Map';
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
          ? `${domainEn} → ${enLabel}`
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
