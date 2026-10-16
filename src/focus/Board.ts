import { App, Notice, setIcon } from 'obsidian';

import {
  BoardRepository,
  BoardBlock,
  BoardConnection,
  BoardData,
  BoardArchNode,
  BoardFragmentOverride,
  BoardGroup,
  BoardViewMode
} from '../storage/BoardRepository';

import { WidgetManager } from './WidgetManager';
import type { WidgetController } from './controllers/WidgetController';

import {
  FolderLabDragDrop,
  FolderLabTextPayload,
  applyWidgetIdentity
} from './FocusWidgetsUtils';

import {
  BoardArchitectureView,
  BoardArchitectureHost
} from './BoardArchitectureView';

import {
  BoardDocumentView,
  BoardDocumentHost
} from './BoardDocumentView';

import { BoardPolishModal } from '../modals/BoardPolishModal';
import { i18n } from '../i18n/I18nService';
export interface BoardDependencies {
  app: App;
  widgetManager: WidgetManager;
  repository: BoardRepository;
  notePath: string;

  /**
   * Acceso a los datos REALES de los widgets (participación
   * 'context'): lectura de estado y suscripción a cambios.
   */
  controller?: WidgetController;
}

const FALLBACK_SOURCE_TYPE = 'text';

const DROP_CENTER_OFFSET_X = 120;
const DROP_CENTER_OFFSET_Y = 20;

const VIEW_MODES: Array<{
  id: BoardViewMode;
  label: string;
  icon: string;
}> = [
  { id: 'explore', get label() { return i18n.t('board.modes.explore'); }, icon: 'compass' },
  { id: 'architecture', get label() { return i18n.t('board.modes.architecture'); }, icon: 'list-tree' },
  { id: 'document', get label() { return i18n.t('board.modes.document'); }, icon: 'file-text' }
];

export class Board
  implements BoardArchitectureHost, BoardDocumentHost {

  private readonly deps: BoardDependencies;

  private container: HTMLElement | null = null;
  private contentHost: HTMLElement | null = null;
  private modeButtons = new Map<BoardViewMode, HTMLElement>();
  private surface: HTMLElement | null = null;
  private blockLayer: HTMLElement | null = null;
  private connectionLayer: SVGSVGElement | null = null;
  private emptyState: HTMLElement | null = null;

  private connectionSource: { kind: 'block' | 'group'; id: string } | null = null;
  private lastDropPoint: { x: number; y: number } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dropCleanup: (() => void) | null = null;

  private blocks: BoardBlock[] = [];
  private connections: BoardConnection[] = [];

  private viewMode: BoardViewMode = 'explore';
  private architecture: BoardArchNode[] = [];
  private fragmentOverrides: BoardFragmentOverride[] = [];

  private architectureView = new BoardArchitectureView();
  private documentView = new BoardDocumentView();

  private saveTimer: number | null = null;
  /**
   * P1-2A: hay mutaciones aún no persistidas con éxito. Lo marca
   * scheduleSave y lo limpia save solo si ninguna mutación más
   * reciente ha llegado durante el guardado (comparación por
   * generación). flushSave lo usa para reintentar en el cierre.
   */
  private saveDirty = false;
  private saveGeneration = 0;
  /** Guardado en vuelo, si lo hay; el cierre lo espera. */
  private saveInFlight: Promise<void> | null = null;
  /** Generación del snapshot que contiene el guardado en vuelo. */
  private saveInFlightGeneration = 0;
  private contextHeader: HTMLElement | null = null;
  private contextUnsubscribe: (() => void) | null = null;
  private instancesUnsubscribe: (() => void) | null = null;

  // Selección rectangular (transitoria) y grupos etiquetados
  private selectedBlockIds = new Set<string>();
  private groups: BoardGroup[] = [];
  private marqueeEl: HTMLElement | null = null;
  private groupOutlineEl: HTMLElement | null = null;

  constructor(deps: BoardDependencies) {
    this.deps = deps;

    /*
     * Los indicadores contextuales se refrescan cuando cualquier
     * widget cambia sus datos (controller.onChange es el único
     * punto por el que pasan todas las mutaciones de storage).
     */
    this.contextUnsubscribe =
      deps.controller?.onChange(() => {
        void this.refreshContextIndicators();
      }) ?? null;

    /*
     * Renombrado de INSTANCIAS (Biblioteca → applyInstances /
     * renameInstance): las tarjetas y la cabecera resuelven el
     * nombre en vivo desde WidgetManager; este aviso provoca el
     * refresco de las etiquetas sin reconstruir el Board.
     */
    this.instancesUnsubscribe =
      deps.widgetManager.onChange(() => {
        this.handleInstanceNamesChanged();
      });
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================

  async load(): Promise<void> {
    const data = await this.deps.repository.loadNote(
      this.deps.notePath
    );

    this.blocks = data?.blocks ?? [];
    this.connections = data?.connections ?? [];
    this.groups = data?.groups ?? [];
    this.viewMode = data?.viewMode ?? 'explore';
    this.architecture = data?.architecture?.nodes ?? [];
    this.fragmentOverrides = data?.fragmentOverrides ?? [];
  }

  render(container: HTMLElement): void {
    this.destroyDom();

    this.container = container;
    this.container.addClass('fl-board');

    /*
     * Cabecera general (solo en Explorar): identificación
     * «Contexto | nota activa» + indicadores, ANTES de la franja
     * de navegación. La navegación queda fuera de la cabecera.
     */
    if (this.viewMode === 'explore') {
      this.renderContextHeader();
    }

    /*
     * La barra se construye UNA sola vez. Cambiar de modo NO la
     * reconstruye: solo actualiza sus clases y reconstruye el área
     * de contenido. Así el botón que procesa el click nunca se
     * elimina del DOM durante el despacho del evento.
     */
    this.renderModeBar();

    this.contentHost = this.container.createDiv({
      cls: 'fl-board-mode-content'
    });

    this.renderModeContent();
  }

  /**
   * Destruye el Board esperando (await) que termine el guardado
   * pendiente o en vuelo. Los errores de guardado ya se han
   * hecho visibles dentro de save(); el cierre se completa
   * igualmente para no bloquear el ciclo de vida de la vista.
   */
  async destroy(): Promise<void> {
    this.instancesUnsubscribe?.();
    this.instancesUnsubscribe = null;

    this.contextUnsubscribe?.();
    this.contextUnsubscribe = null;

    await this.flushSave();
    this.destroyDom();
  }

  private destroyDom(): void {
    this.dropCleanup?.();
    this.dropCleanup = null;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.connectionSource = null;
    this.lastDropPoint = null;
    this.marqueeEl = null;
    this.groupOutlineEl = null;
    this.selectedBlockIds.clear();

    this.container?.empty();
    this.container = null;
    this.contentHost = null;
    this.modeButtons.clear();
    this.contextHeader = null;
    this.surface = null;
    this.blockLayer = null;
    this.connectionLayer = null;
    this.emptyState = null;
  }

  // ============================================================
  // NAVEGACIÓN ENTRE INSTANCIAS
  // ============================================================

  private renderModeBar(): void {
    if (!this.container) return;

    const bar = this.container.createDiv({
      cls: 'fl-board-mode-bar'
    });

    for (const mode of VIEW_MODES) {
      const button = bar.createEl('button', {
        cls: 'fl-board-mode-button',
        attr: {
          type: 'button',
          'aria-label': mode.label
        }
      });

      setIcon(button, mode.icon);
      button.createSpan({ text: mode.label });

      button.toggleClass(
        'is-active',
        this.viewMode === mode.id
      );

      button.addEventListener('click', () => {
        this.setMode(mode.id);
      });

      this.modeButtons.set(mode.id, button);
    }
  }

  private setMode(mode: BoardViewMode): void {
    if (this.viewMode === mode) {
      return;
    }

    this.viewMode = mode;

    // Solo clases en los botones existentes: no se toca el DOM de la barra.
    for (const [modeId, button] of this.modeButtons) {
      button.toggleClass('is-active', modeId === mode);
    }

    this.renderModeContent();
    this.scheduleSave();
  }

  private renderModeContent(): void {
    const host = this.contentHost;

    if (!host) return;

    host.empty();
    host.removeClass('fl-board-architecture');
    host.removeClass('fl-board-document');

    if (this.viewMode === 'architecture') {
      this.architectureView.render(host, this);
      return;
    }

    if (this.viewMode === 'document') {
      this.documentView.render(host, this);
      return;
    }

    this.renderExplore();
  }

  private rerender(): void {
    this.renderModeContent();
  }

  // ============================================================
  // PERSISTENCIA
  // ============================================================

  private scheduleSave(): void {
    this.saveDirty = true;
    this.saveGeneration++;

    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }

    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, 250);
  }

  /**
   * Escribe de inmediato cualquier guardado pendiente y ESPERA
   * a que termine (incluido un guardado ya en vuelo o en cola:
   * el repositorio serializa por FIFO, por lo que esperar la
   * última promesa cubre también las escrituras anteriores).
   * Devuelve la promesa para que el cierre de la vista pueda
   * await-earla.
   */
  private async flushSave(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // El guardado en vuelo contiene ya el estado actual (ninguna
    // mutación posterior): esperarlo basta, sin escribir de más.
    if (
      this.saveInFlight !== null &&
      this.saveInFlightGeneration === this.saveGeneration
    ) {
      await this.saveInFlight;
      return;
    }

    if (this.saveDirty) {
      await this.save();
      return;
    }

    // Sin cambios pendientes puede quedar un guardado en vuelo
    // (disparado por el debounce): el cierre lo espera igual.
    if (this.saveInFlight) {
      await this.saveInFlight;
    }
  }

  /**
   * P1-2A: los errores de guardado ya no quedan ocultos en
   * promesas flotantes. Un fallo se registra en consola, se
   * avisa con un Notice y MANTIENE saveDirty para que el
   * siguiente flushSave (cierre) reintente. El estado en
   * memoria no se toca: sigue siendo la fuente de la que
   * partirá el reintento.
   */
  private save(): Promise<void> {
    const data: BoardData = {
      blocks: this.blocks.map(block => ({ ...block })),
      connections: this.connections.map(connection => ({
        ...connection
      })),
      viewMode: this.viewMode,
      architecture: {
        nodes: this.architecture.map(node => ({
          ...node,
          blockIds: [...node.blockIds]
        }))
      },
      fragmentOverrides: this.fragmentOverrides.map(override => ({
        ...override
      })),
      groups: this.groups.map(group => ({
        ...group,
        blockIds: [...group.blockIds]
      }))
    };

    const generation = this.saveGeneration;

    const write = this.deps.repository.saveNote(
      this.deps.notePath,
      data
    );

    // La promesa rastreada NUNCA rechaza: los errores quedan
    // registrados/avisados abajo y el dirty se conserva, de modo
    // que await-ear el cierre no propaga una excepción que ya se
    // ha hecho visible por otra vía.
    const tracked: Promise<void> = write
      .then(() => {
        // Solo se limpia el dirty si NO ha llegado una mutación
        // más reciente durante este guardado (el snapshot de
        // data no la contiene).
        if (this.saveGeneration === generation) {
          this.saveDirty = false;
        }
      })
      .catch((error) => {
        this.saveDirty = true;
        console.error(
          `[Board] Error guardando "${this.deps.notePath}":`,
          error
        );
        new Notice(i18n.t('board.saveError'));
      })
      .finally(() => {
        if (this.saveInFlight === tracked) {
          this.saveInFlight = null;
        }
      });

    this.saveInFlight = tracked;
    this.saveInFlightGeneration = generation;

    return tracked;
  }

  // ============================================================
  // INSTANCIA 1: EXPLORAR
  // ============================================================

  private renderExplore(): void {
    if (!this.contentHost) return;

    /*
     * Explorar = superficie de lienzo (la cabecera general vive
     * fuera, arriba de la navegación). Las coordenadas
     * persistidas de las tarjetas no cambian: siguen siendo
     * relativas al blockLayer dentro del surface.
     */
    const explore = this.contentHost.createDiv({
      cls: 'fl-board-explore'
    });

    this.surface = explore.createDiv({
      cls: 'fl-board-surface'
    });

    this.connectionLayer = this.surface.createSvg('svg', {
      cls: 'fl-board-connection-layer',
      attr: { 'aria-hidden': 'true' }
    });

    this.blockLayer = this.surface.createDiv({
      cls: 'fl-board-card-grid'
    });

    this.emptyState = this.surface.createDiv({
      cls: 'fl-board-empty-state',
      text: i18n.t('board.explore.emptyHint')
    });

    /*
     * Se registra ANTES del drop target de FolderLabDragDrop
     * para que lastDropPoint esté actualizado cuando se procese
     * el payload (los listeners del mismo elemento se ejecutan
     * en orden de registro).
     */
    this.surface.addEventListener('drop', (event) => {
      const rect = this.blockLayer?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      this.lastDropPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    });

    this.registerDropTarget(this.surface);

    /*
     * Selección rectangular: solo desde el propio surface (área
     * vacía). Las tarjetas tienen pointer-events:auto y los
     * controles/puntos son elementos distintos → este listener
     * no intercepta sus interacciones.
     */
    this.surface.addEventListener(
      'pointerdown',
      (event) => this.handleSurfacePointerDown(event)
    );

    this.surface.addEventListener(
      'scroll',
      () => this.renderConnections()
    );

    this.resizeObserver = new ResizeObserver(() => {
      this.updateCanvasSize();
      this.renderConnections();
    });
    this.resizeObserver.observe(this.surface);

    this.renderAllBlocks();
    this.renderGroups();
    this.renderConnections();
    this.updateCanvasSize();
    this.updateEmptyState();
  }

  private registerDropTarget(surface: HTMLElement): void {
    const dragDrop = FolderLabDragDrop.getInstance(
      this.deps.app
    );

    this.dropCleanup = dragDrop.registerTextDropTarget(
      surface,

      (payload) => {
        this.handleExternalDrop(payload);
      },

      (active) => {
        surface.toggleClass('is-text-dragging', active);
      }
    );
  }

  private handleExternalDrop(payload: FolderLabTextPayload): void {
    const text = payload.text?.trim();

    if (!text) {
      return;
    }

    /*
     * Los widgets declarativos incluyen `source` en el payload.
     * Apuntes y el Asistente declaran su procedencia mediante
     * activeDragSource (sigue activo durante el drop; se limpia
     * en dragend).
     */
    const dragDrop = FolderLabDragDrop.getInstance(
      this.deps.app
    );

    const source =
      payload.source ??
      dragDrop.getActiveDragSource() ??
      undefined;

    const point = this.lastDropPoint ?? {
      x: DROP_CENTER_OFFSET_X,
      y: DROP_CENTER_OFFSET_Y
    };

    const x = Math.max(0, point.x - DROP_CENTER_OFFSET_X);
    const y = Math.max(0, point.y - DROP_CENTER_OFFSET_Y);

    /*
     * Participación declarada (transfer.board.participation):
     * 'context' → el widget aporta contexto mediante indicadores;
     * sus elementos NO se convierten en tarjetas. Ausente o
     * 'composition' → comportamiento histórico (tarjeta nueva).
     */
    const participation = source
      ? this.deps.widgetManager.getDefinition(source.widgetId)
          ?.transfer?.board?.participation
      : undefined;

    if (participation === 'context') {
      return;
    }

    this.createBlock({
      text,
      sourceType:
        source?.widgetId ?? FALLBACK_SOURCE_TYPE,
      sourceInstanceId: source?.instanceId,
      sourceItemId: source?.itemId,
      sessionId: source?.sessionId,
      x,
      y
    });
  }

  // ============================================================
  // INDICADORES CONTEXTUALES (widgets participation: 'context')
  // ============================================================

  /**
   * Lee los items REALES de todas las instancias de un tipo de
   * widget desde su almacenamiento (sin copias en el Board).
   */
  private async readContextItems(
    typeId: string
  ): Promise<Array<Record<string, any>>> {
    const controller = this.deps.controller;

    if (!controller) {
      return [];
    }

    const instances = this.deps.widgetManager
      .getInstances()
      .filter(instance => instance.typeId === typeId);

    const items: Array<Record<string, any>> = [];

    for (const instance of instances) {
      const data = await controller.storage.get(
        typeId,
        this.deps.notePath,
        instance.instanceId
      );

      const rawItems: unknown = data?.items;
      if (Array.isArray(rawItems)) {
        items.push(...(rawItems as Array<Record<string, any>>));
      }
    }

    return items;
  }

  /** Número de listas (instancias) de un tipo para esta nota. */
  private countContextLists(typeId: string): number {
    return this.deps.widgetManager
      .getInstances()
      .filter(instance => instance.typeId === typeId)
      .length;
  }

  /**
   * Nombres de las instancias de un tipo para esta nota:
   * nombre personalizado o, si no existe, el genérico de la
   * definición (fallback ya almacenado en WidgetInstance.name).
   */
  private contextInstanceNames(typeId: string): string[] {
    return this.deps.widgetManager
      .getInstances()
      .filter(instance => instance.typeId === typeId)
      .map(instance =>
        instance.name?.trim() ||
        this.deps.widgetManager.getDefinition(typeId)?.identity?.label ||
        typeId
      );
  }

  /** Identidad real del widget (icono + color de definiciones). */
  private contextIdentity(typeId: string): {
    icon?: string;
    color?: string;
  } {
    const identity =
      this.deps.widgetManager.getDefinition(typeId)?.identity;

    return {
      icon: identity?.icon,
      color: identity?.color
    };
  }

  private plural(count: number, pluralKey: string): string {
    return `${count} ${i18n.tn(pluralKey, count)}`;
  }

  /**
   * Nombre de la nota REALMENTE asociada a este Board (la nota
   * cuyo leaf lo contiene: deps.notePath). Sin cachés ni títulos
   * heredados; el Board se crea por nota en BoardView.setViewData.
   */
  private activeNoteName(): string {
    const path = this.deps.notePath ?? '';
    const file = path.split('/').pop() ?? '';

    return file.replace(/\.md$/i, '');
  }

  /**
   * Cabecera general del Board (solo en Explorar), ENCIMA de la
   * navegación:
   *   franja 1: «Contexto | <nota activa>»
   *   franja 2: indicadores (iconos + métricas globales)
   * La navegación (Explorar/Arquitectura/Documento) queda fuera
   * de la cabecera, en su propia franja inmediatamente debajo.
   */
  private renderContextHeader(): void {
    if (!this.container) return;

    this.contextHeader = this.container.createDiv({
      cls: 'fl-board-context-header'
    });

    void this.refreshContextIndicators();
  }

  /**
   * Refresca la cabecera general desde los datos REALES de TODAS
   * las listas (instancias) de la nota: título de la nota +
   * recuento de listas + totales agregados. Sin nombres ni textos
   * de elementos. Se invoca en cada cambio de storage
   * (controller.onChange) — sin escrituras nuevas.
   */
  private async refreshContextIndicators(): Promise<void> {
    if (this.viewMode !== 'explore' || !this.contextHeader) {
      return;
    }

    const [restrictions, candidates, tasks] = await Promise.all([
      this.readContextItems('restrictions'),
      this.readContextItems('candidates'),
      this.readContextItems('tasks')
    ]);

    // El modo pudo cambiar durante las lecturas asíncronas.
    if (!this.contextHeader || this.viewMode !== 'explore') {
      return;
    }

    /*
     * Nombres de las INSTANCIAS (listas) de la nota actual:
     * nombre personalizado si existe; si no, el genérico de la
     * definición (WidgetInstance.name ya guarda ese fallback al
     * crearse). Fuente de verdad: WidgetManager — sin copias.
     */
    const instanceNames = {
      restrictions: this.contextInstanceNames('restrictions'),
      candidates: this.contextInstanceNames('candidates'),
      tasks: this.contextInstanceNames('tasks')
    };

    // Restricciones: activas = campo de estado real (active === true)
    const activeRestrictions = restrictions.filter(
      item => item?.active === true
    ).length;

    // Candidatos: selección exclusiva POR LISTA; el agregado cuenta
    // los seleccionados de todas las listas (respetando el modelo).
    const activeCandidates = candidates.filter(
      item => item?.selected === true
    ).length;

    // Tareas: pendientes = completed !== true; completadas = === true
    const pendingTasks = tasks.filter(
      item => item?.completed !== true
    ).length;
    const completedTasks = tasks.filter(
      item => item?.completed === true
    ).length;

    const header = this.contextHeader;
    header.empty();

    // ---- Franja 1: Contexto | nota activa ----
    const titleRow = header.createDiv({
      cls: 'fl-board-context-title-row'
    });

    titleRow.createSpan({
      cls: 'fl-ctx-title',
      text: i18n.t('board.context.title')
    });

    titleRow.createSpan({
      cls: 'fl-ctx-title-sep',
      text: '|'
    });

    const noteName = this.activeNoteName();

    titleRow.createSpan({
      cls: 'fl-ctx-note-name',
      text: noteName
    });

    // ---- Franja 2: indicadores ----
    const groups = header.createDiv({
      cls: 'fl-board-context-groups'
    });

    const addSeparator = (): void => {
      groups.createSpan({
        cls: 'fl-ctx-separator',
        attr: { 'aria-hidden': 'true' }
      });
    };

    const renderGroup = (
      label: string,
      typeId: string,
      countsLine: string
    ): void => {
      const group = groups.createDiv({
        cls: 'fl-board-context-group'
      });

      const labelRow = group.createDiv({
        cls: 'fl-ctx-group-label'
      });

      /*
       * Icono REAL del widget (definition.identity.icon) con su
       * color semántico — mismo mecanismo que las tarjetas
       * (applyWidgetIdentity).
       */
      const iconSpan = labelRow.createSpan({
        cls: 'fl-ctx-icon'
      });

      applyWidgetIdentity(iconSpan, this.contextIdentity(typeId));

      labelRow.createSpan({ text: label });

      const names = instanceNames[typeId as keyof typeof instanceNames];

      group.createDiv({
        cls: 'fl-ctx-instances',
        text: names.length > 0 ? names.join(' · ') : i18n.t('board.context.noLists')
      });

      group.createDiv({
        cls: 'fl-ctx-counts',
        text: countsLine
      });

      group.toggleClass('is-empty', names.length === 0);
    };

    renderGroup(
      i18n.t('board.context.group.restrictions'),
      'restrictions',
      this.plural(activeRestrictions, 'board.context.counts.activeFeminine')
    );

    addSeparator();

    renderGroup(
      i18n.t('board.context.group.candidates'),
      'candidates',
      this.plural(activeCandidates, 'board.context.counts.activeMasculine')
    );

    addSeparator();

    renderGroup(
      i18n.t('board.context.group.tasks'),
      'tasks',
      `${this.plural(pendingTasks, 'board.context.counts.pending')} · ` +
        `${this.plural(completedTasks, 'board.context.counts.completed')}`
    );
  }

  /**
   * Título vigente de una tarjeta: nombre de la instancia de
   * origen (personalizable) o el genérico de la definición.
   * Resuelto en vivo — sin copias del nombre.
   */
  private resolveBlockTitle(block: BoardBlock): string {
    const definition = this.deps.widgetManager.getDefinition(
      block.sourceType
    );

    const instance = block.sourceInstanceId
      ? this.deps.widgetManager.getInstance(block.sourceInstanceId)
      : undefined;

    const instanceTitle = instance?.name?.trim();

    if (instanceTitle) {
      return instanceTitle;
    }

    if (definition) {
      return definition.identity.label;
    }

    return i18n.t('board.card.fallbackTitle');
  }

  /**
   * Renombrado de instancias (Biblioteca): actualiza SOLO las
   * etiquetas afectadas, en sitio, sin reconstruir tarjetas ni
   * alterar posiciones, conexiones o contenido.
   */
  private handleInstanceNamesChanged(): void {
    if (this.viewMode !== 'explore') {
      return;
    }

    void this.refreshContextIndicators();

    if (!this.blockLayer) {
      return;
    }

    for (const block of this.blocks) {
      const card: HTMLElement | null = this.blockLayer.querySelector(
        `[data-board-block-id="${block.id}"]`
      );

      const label = card?.querySelector(
        '.fl-board-block-badge-label'
      );

      if (label) {
        label.textContent = this.resolveBlockTitle(block);
      }
    }
  }

  // ============================================================
  // SELECCIÓN RECTANGULAR Y CONTENEDORES DE GRUPO
  // ============================================================

  /**
   * Inicio de marquee al pulsar el botón izquierdo sobre el área
   * vacía del surface. Se ignoran eventos originados en tarjetas,
   * controles o puntos de conexión (target !== surface).
   */
  private handleSurfacePointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    if (event.target !== this.surface) {
      return;
    }

    const layer = this.blockLayer;

    if (!layer) {
      return;
    }

    const layerRect = layer.getBoundingClientRect();

    const startX = event.clientX - layerRect.left;
    const startY = event.clientY - layerRect.top;

    let moved = false;

    const marquee = layer.createDiv({
      cls: 'fl-board-marquee'
    });

    this.marqueeEl = marquee;

    const update = (moveEvent: PointerEvent): void => {
      const x = moveEvent.clientX - layerRect.left;
      const y = moveEvent.clientY - layerRect.top;

      if (!moved && Math.hypot(x - startX, y - startY) < 4) {
        return;
      }

      moved = true;

      marquee.style.left = `${Math.min(startX, x)}px`;
      marquee.style.top = `${Math.min(startY, y)}px`;
      marquee.style.width = `${Math.abs(x - startX)}px`;
      marquee.style.height = `${Math.abs(y - startY)}px`;
    };

    const finish = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', finish);

      marquee.remove();
      this.marqueeEl = null;

      if (!moved) {
        this.selectedBlockIds.clear();
        return;
      }

      const x = upEvent.clientX - layerRect.left;
      const y = upEvent.clientY - layerRect.top;

      const rect = {
        left: Math.min(startX, x),
        top: Math.min(startY, y),
        right: Math.max(startX, x),
        bottom: Math.max(startY, y)
      };

      this.selectedBlockIds = new Set(
        this.blocks
          .filter(block => this.blockIntersectsRect(block, rect))
          .map(block => block.id)
      );

      /*
       * El rectángulo ES el grupo: con 2+ tarjetas se crea el
       * contenedor persistente; la selección del ratón es solo
       * el gesto de creación y no se conserva como estado.
       */
      if (this.selectedBlockIds.size >= 2) {
        this.createGroupFromSelection();
      }

      this.selectedBlockIds.clear();
    };

    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', finish);
  }

  /**
   * Intersección por rectángulos REALES de la tarjeta (posición
   * persistida + medidas del elemento). Basta intersección parcial.
   */
  private blockIntersectsRect(
    block: BoardBlock,
    rect: { left: number; top: number; right: number; bottom: number }
  ): boolean {
    const element = this.blockLayer?.querySelector(
      `[data-board-block-id="${block.id}"]`
    ) as HTMLElement | null;

    const width = element?.offsetWidth ?? 240;
    const height = element?.offsetHeight ?? 120;

    return !(
      block.x > rect.right ||
      block.x + width < rect.left ||
      block.y > rect.bottom ||
      block.y + height < rect.top
    );
  }

  /** Bounds reales de un conjunto de tarjetas (+ margen). */
  private selectionBounds(
    blockIds: string[]
  ): { x: number; y: number; w: number; h: number } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const id of blockIds) {
      const block = this.blocks.find(entry => entry.id === id);

      if (!block) {
        continue;
      }

      const element = this.blockLayer?.querySelector(
        `[data-board-block-id="${block.id}"]`
      ) as HTMLElement | null;

      const width = element?.offsetWidth ?? 240;
      const height = element?.offsetHeight ?? 120;

      minX = Math.min(minX, block.x);
      minY = Math.min(minY, block.y);
      maxX = Math.max(maxX, block.x + width);
      maxY = Math.max(maxY, block.y + height);
    }

    if (!Number.isFinite(minX)) {
      return null;
    }

    const pad = 16;

    return {
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2
    };
  }

  /** Crea el contenedor persistente a partir de la selección. */
  private createGroupFromSelection(): void {
    const bounds = this.selectionBounds([...this.selectedBlockIds]);

    if (!bounds) {
      return;
    }

    this.groups.push({
      id: `board-group-${crypto.randomUUID()}`,
      label: '',
      blockIds: [...this.selectedBlockIds],
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h
    });

    this.scheduleSave();
    this.renderGroups();
  }

  private removeGroup(groupId: string): void {
    const index = this.groups.findIndex(
      group => group.id === groupId
    );

    if (index === -1) {
      return;
    }

    // Solo desaparece el contenedor: las tarjetas quedan intactas.
    this.groups.splice(index, 1);

    // Las conexiones del contenedor se retiran con él.
    this.connections = this.connections.filter(
      connection =>
        connection.sourceGroupId !== groupId &&
        connection.targetGroupId !== groupId
    );

    this.scheduleSave();
    this.renderGroups();
    this.renderConnections();
  }

  /**
   * (Re)dibuja todos los contenedores de grupo en el lienzo.
   * Cada grupo es un objeto visual independiente: caja punteada
   * con encabezado (etiqueta + eliminar). Sin nada dentro de las
   * tarjetas.
   */
  private renderGroups(): void {
    const layer = this.blockLayer;

    if (!layer) {
      return;
    }

    layer
      .querySelectorAll('.fl-board-group-box')
      .forEach((box) => box.remove());

    for (const group of this.groups) {
      this.renderGroupBox(group);
    }
  }

  private renderGroupBox(group: BoardGroup): void {
    const layer = this.blockLayer;

    if (!layer) {
      return;
    }

    const box = layer.createDiv({
      cls: 'fl-board-group-box'
    });

    box.setAttr('data-board-group-id', group.id);

    box.style.left = `${group.x ?? 0}px`;
    box.style.top = `${group.y ?? 0}px`;
    box.style.width = `${group.w ?? 0}px`;
    box.style.height = `${group.h ?? 0}px`;

    const header = box.createDiv({
      cls: 'fl-board-group-header'
    });

    /*
     * La ETIQUETA es el asa de arrastre del contenedor (como la
     * cabecera de las tarjetas): arrastrar mueve el grupo y sus
     * miembros; un clic sin arrastrar renombra.
     */
    const labelBtn = header.createEl('button', {
      cls: 'fl-board-group-label',
      text: group.label || i18n.t('board.group.placeholderName'),
      attr: { type: 'button', title: i18n.t('board.group.tooltip') }
    });

    labelBtn.toggleClass('is-placeholder', !group.label);

    labelBtn.addEventListener(
      'pointerdown',
      (event) => this.startGroupMove(event, group, header)
    );

    const removeBtn = header.createEl('button', {
      cls: 'fl-board-group-remove',
      attr: { type: 'button', 'aria-label': i18n.t('board.group.action.remove') }
    });
    setIcon(removeBtn, 'x');

    removeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.removeGroup(group.id);
    });

    // Clic en el fondo del encabezado: completa una conexión pendiente
    header.addEventListener('click', (event) => {
      if (event.target !== header) {
        return;
      }

      const source = this.connectionSource;

      if (!source) {
        return;
      }

      if (source.kind === 'group' && source.id === group.id) {
        return;
      }

      this.addConnection(source, { kind: 'group', id: group.id });
    });

    /*
     * Punto de conexión del contenedor (centro inferior), con el
     * mismo lenguaje que el de las tarjetas.
     */
    const dot = box.createEl('button', {
      cls: 'fl-board-group-dot',
      attr: {
        type: 'button',
        'aria-label': i18n.t('board.group.connect.aria'),
        title: i18n.t('board.connectTooltip')
      }
    });

    dot.addEventListener('click', (event) => {
      event.stopPropagation();
      this.startConnectionFrom({ kind: 'group', id: group.id });
    });
  }

  /**
   * Arrastre del contenedor usando la ETIQUETA como asa.
   * Mueve la caja y todas sus tarjetas miembro por el mismo
   * delta. Un clic sin arrastrar renombra el grupo.
   */
  private startGroupMove(
    event: PointerEvent,
    group: BoardGroup,
    header: HTMLElement
  ): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const originX = group.x ?? 0;
    const originY = group.y ?? 0;

    const memberOrigins = group.blockIds
      .map((id) => this.blocks.find((block) => block.id === id))
      .filter((block): block is BoardBlock => !!block)
      .map((block) => ({ block, x: block.x, y: block.y }));

    let moved = false;

    const onMove = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      if (!moved && Math.hypot(dx, dy) < 3) {
        return;
      }

      moved = true;

      group.x = originX + dx;
      group.y = originY + dy;

      const box = this.blockLayer?.querySelector(
        `[data-board-group-id="${group.id}"]`
      ) as HTMLElement | null;

      if (box) {
        box.style.left = `${group.x}px`;
        box.style.top = `${group.y}px`;
      }

      // Las tarjetas miembro se mueven con el contenedor
      for (const origin of memberOrigins) {
        origin.block.x = origin.x + dx;
        origin.block.y = origin.y + dy;

        const card = this.blockLayer?.querySelector(
          `[data-board-block-id="${origin.block.id}"]`
        ) as HTMLElement | null;

        if (card) {
          card.style.left = `${origin.block.x}px`;
          card.style.top = `${origin.block.y}px`;
        }
      }

      this.renderConnections();
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      if (!moved) {
        // Clic sin arrastrar sobre la etiqueta: renombrar
        this.startRenameGroup(group, header);
        return;
      }

      this.updateCanvasSize();
      this.renderConnections();
      this.scheduleSave();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /** Renombrado inline en el encabezado del contenedor. */
  private startRenameGroup(group: BoardGroup, header: HTMLElement): void {
    header.empty();

    const input = header.createEl('input', {
      cls: 'fl-board-group-input',
      attr: { type: 'text', placeholder: i18n.t('board.group.renameInput') }
    });

    input.value = group.label;

    window.requestAnimationFrame(() => {
      input.focus();
      input.select?.();
    });

    let done = false;

    const finishInput = (): void => {
      if (done) return;
      done = true;

      group.label = input.value.trim();
      this.scheduleSave();
      this.renderGroups();
    };

    input.addEventListener('keydown', (keydownEvent) => {
      if (keydownEvent.key === 'Enter') {
        finishInput();
      } else if (keydownEvent.key === 'Escape') {
        done = true;
        this.renderGroups();
      }
      keydownEvent.stopPropagation();
    });

    input.addEventListener('blur', finishInput);
  }

  /**
   * Geometría de los contenedores: se recalcula desde las
   * tarjetas miembro (bounds reales + margen). También inicializa
   * la geometría de grupos persistidos sin ella (datos previos).
   */
  private updateGroupGeometries(): void {
    for (const group of this.groups) {
      const bounds = this.selectionBounds(group.blockIds);

      if (!bounds) {
        continue;
      }

      const changed =
        group.x !== bounds.x ||
        group.y !== bounds.y ||
        group.w !== bounds.w ||
        group.h !== bounds.h;

      if (changed) {
        group.x = bounds.x;
        group.y = bounds.y;
        group.w = bounds.w;
        group.h = bounds.h;

        const box = this.blockLayer?.querySelector(
          `[data-board-group-id="${group.id}"]`
        ) as HTMLElement | null;

        if (box) {
          box.style.left = `${group.x}px`;
          box.style.top = `${group.y}px`;
          box.style.width = `${group.w}px`;
          box.style.height = `${group.h}px`;
        }

        this.scheduleSave();
      }
    }
  }

  // ============================================================
  // BLOQUES
  // ============================================================

  private createBlock(
    partial: Omit<BoardBlock, 'id'>
  ): BoardBlock {
    const block: BoardBlock = {
      id: `board-block-${crypto.randomUUID()}`,
      ...partial
    };

    this.blocks.push(block);
    this.renderBlock(block);
    this.updateEmptyState();
    this.updateCanvasSize();
    this.renderConnections();
    this.scheduleSave();

    return block;
  }

  private removeBlock(blockId: string): void {
    const index = this.blocks.findIndex(
      block => block.id === blockId
    );

    if (index === -1) {
      return;
    }

    this.blocks.splice(index, 1);

    this.connections = this.connections.filter(
      connection =>
        connection.sourceBlockId !== blockId &&
        connection.targetBlockId !== blockId
    );

    /*
     * El bloque deja atrás sus asignaciones estructurales y
     * sus versiones personales: no se conservan relaciones
     * ni versiones sin tarjeta de origen.
     */
    for (const node of this.architecture) {
      node.blockIds = node.blockIds.filter(
        id => id !== blockId
      );
    }

    this.fragmentOverrides = this.fragmentOverrides.filter(
      override => override.blockId !== blockId
    );

    // Los grupos pierden al miembro; los grupos vacíos se retiran.
    for (const group of this.groups) {
      group.blockIds = group.blockIds.filter(id => id !== blockId);
    }

    /*
     * 3A-final (P2-3): los grupos vacíos se retiran CON sus
     * conexiones (misma regla que removeGroup): no deben quedar
     * extremos de grupo huérfanos persistidos en el JSON.
     */
    const removedGroupIds = new Set(
      this.groups
        .filter(group => group.blockIds.length === 0)
        .map(group => group.id)
    );

    this.groups = this.groups.filter(
      group => group.blockIds.length > 0
    );

    if (removedGroupIds.size > 0) {
      this.connections = this.connections.filter(
        connection =>
          !removedGroupIds.has(connection.sourceGroupId ?? '') &&
          !removedGroupIds.has(connection.targetGroupId ?? '')
      );
    }

    this.selectedBlockIds.delete(blockId);

    this.blockLayer
      ?.querySelector(`[data-board-block-id="${blockId}"]`)
      ?.remove();

    if (
      this.connectionSource?.kind === 'block' &&
      this.connectionSource.id === blockId
    ) {
      this.cancelConnection();
    }

    this.updateEmptyState();
    this.updateCanvasSize();
    this.renderConnections();
    this.scheduleSave();
  }

  private toggleBlockActive(blockId: string): void {
    const block = this.blocks.find(
      entry => entry.id === blockId
    );

    if (!block) {
      return;
    }

    block.active = block.active === false;

    const card = this.blockLayer?.querySelector(
      `[data-board-block-id="${blockId}"]`
    ) as HTMLElement | null;

    if (card) {
      card.toggleClass('is-block-inactive', block.active === false);

      const indicator = card.querySelector(
        '.fl-board-block-indicator'
      );

      indicator?.toggleClass('is-active', block.active !== false);

      const indicatorButton = card.querySelector(
        '.fl-board-block-indicator-button'
      );

      if (indicatorButton) {
        indicatorButton.setAttr(
          'aria-label',
          block.active === false
            ? i18n.t('board.card.action.activate')
            : i18n.t('board.card.action.deactivate')
        );
        indicatorButton.setAttr(
          'aria-pressed',
          String(block.active !== false)
        );
      }
    }

    this.scheduleSave();
  }

  private renderAllBlocks(): void {
    if (!this.blockLayer) {
      return;
    }

    this.blockLayer.empty();

    for (const block of this.blocks) {
      this.renderBlock(block);
    }
  }

  private renderBlock(block: BoardBlock): void {
    if (!this.blockLayer) {
      return;
    }

    const card = this.blockLayer.createEl('article', {
      cls: 'fl-board-text-card'
    });

    card.setAttr('data-board-block-id', block.id);
    card.style.left = `${block.x}px`;
    card.style.top = `${block.y}px`;

    if (block.active === false) {
      card.addClass('is-block-inactive');
    }

    const header = card.createDiv({
      cls: 'fl-board-block-header'
    });

    const badge = header.createDiv({
      cls: 'fl-board-block-badge'
    });

    const definition = this.deps.widgetManager.getDefinition(
      block.sourceType
    );

    /*
     * Título de la tarjeta: nombre de la INSTANCIA de origen si
     * fue personalizado; si no, el genérico de la definición.
     * Resuelto en vivo desde WidgetManager (resolveBlockTitle).
     */
    if (definition) {
      applyWidgetIdentity(badge, {
        icon: definition.identity.icon,
        color: definition.identity.color
      });
    } else {
      setIcon(badge, 'type');
    }

    badge.createSpan({
      cls: 'fl-board-block-badge-label',
      text: this.resolveBlockTitle(block)
    });

    /*
     * Controles de la esquina superior derecha: solo el indicador
     * activo/inactivo (mismo patrón que los bloques de widgets).
     * El cierre (×) se traslada al pie de la tarjeta.
     */
    const controls = header.createDiv({
      cls: 'fl-board-block-controls'
    });

    const indicatorButton = controls.createEl('button', {
      cls: 'fl-board-block-indicator-button',
      attr: {
        type: 'button',
        'aria-label': block.active === false
          ? i18n.t('board.card.action.activate')
          : i18n.t('board.card.action.deactivate'),
        'aria-pressed': String(block.active !== false)
      }
    });

    const indicator = indicatorButton.createSpan({
      cls: 'fl-board-block-indicator'
    });

    if (block.active !== false) {
      indicator.addClass('is-active');
    }

    indicatorButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleBlockActive(block.id);
    });

    header.addEventListener(
      'pointerdown',
      (event) => this.startBlockMove(event, block, card)
    );

    const content = card.createDiv({
      cls: 'fl-board-text-card-content is-compact',
      text: block.text
    });

    /*
     * Pie de la tarjeta (grid 1fr auto 1fr → estable ante
     * cambios de longitud/expansión):
     *   [Ver más/Ver menos] [Punto conector centrado] [Cerrar ×]
     */
    const actions = card.createDiv({
      cls: 'fl-board-text-card-actions'
    });

    const expandToggle = actions.createEl('button', {
      cls: 'fl-board-text-card-toggle',
      text: i18n.t('board.card.action.showMore'),
      attr: { type: 'button' }
    });

    expandToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const expanded = !card.hasClass('is-expanded');
      card.toggleClass('is-expanded', expanded);
      content.toggleClass('is-compact', !expanded);
      expandToggle.setText(expanded ? i18n.t('board.card.action.showLess') : i18n.t('board.card.action.showMore'));
      window.requestAnimationFrame(() => {
        this.updateCanvasSize();
        this.renderConnections();
        this.scheduleSave();
      });
    });

    /*
     * Punto de conexión: círculo blanco en el centro exacto del
     * borde inferior. Siempre accesible, también con conexiones
     * existentes (los puntos ancla del borde son solo extremos de
     * línea; este es el control de inicio).
     */
    const connectDot = actions.createEl('button', {
      cls: 'fl-board-connect-dot',
      attr: {
        type: 'button',
        'aria-label': i18n.t('board.card.connect.aria'),
        title: i18n.t('board.connectTooltip')
      }
    });

    connectDot.addEventListener('click', (event) => {
      event.stopPropagation();
      this.startConnection(block.id);
    });

    const removeButton = actions.createEl('button', {
      cls: 'fl-board-block-remove fl-board-card-close',
      attr: { type: 'button', 'aria-label': i18n.t('board.card.action.remove') }
    });
    setIcon(removeButton, 'x');

    removeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.removeBlock(block.id);
    });

    card.addEventListener('click', () => {
      const source = this.connectionSource;

      if (!source) {
        return;
      }

      if (source.kind === 'block' && source.id === block.id) {
        return;
      }

      this.addConnection(source, { kind: 'block', id: block.id });
    });

    window.requestAnimationFrame(() => {
      if (!card.isConnected) return;
      card.toggleClass(
        'is-expandable',
        content.scrollHeight > content.clientHeight
      );
      this.updateCanvasSize();
      this.renderConnections();
    });
  }

  // ============================================================
  // MOVIMIENTO INTERNO DE BLOQUES
  // ============================================================

  private startBlockMove(
    event: PointerEvent,
    block: BoardBlock,
    card: HTMLElement
  ): void {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.closest('button')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const originX = block.x;
    const originY = block.y;

    let moved = false;

    const onMove = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      if (!moved && Math.hypot(dx, dy) < 3) {
        return;
      }

      moved = true;
      card.addClass('is-dragging');

      block.x = Math.max(0, originX + dx);
      block.y = Math.max(0, originY + dy);

      card.style.left = `${block.x}px`;
      card.style.top = `${block.y}px`;

      this.renderConnections();
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      card.removeClass('is-dragging');

      if (moved) {
        this.updateCanvasSize();
        this.renderConnections();
        this.scheduleSave();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ============================================================
  // CONEXIONES
  // ============================================================

  private startConnection(blockId: string): void {
    this.startConnectionFrom({ kind: 'block', id: blockId });
  }

  private startConnectionFrom(source: {
    kind: 'block' | 'group';
    id: string;
  }): void {
    this.connectionSource = source;
    this.refreshConnectionSourceMarks();
    this.surface?.addClass('is-connecting');
  }

  private refreshConnectionSourceMarks(): void {
    const source = this.connectionSource;

    this.blockLayer
      ?.querySelectorAll('.fl-board-text-card')
      .forEach((element) => {
        element.toggleClass(
          'is-connection-source',
          !!source &&
            source.kind === 'block' &&
            element.getAttribute('data-board-block-id') === source.id
        );
      });

    this.blockLayer
      ?.querySelectorAll('.fl-board-group-box')
      .forEach((element) => {
        element.toggleClass(
          'is-connection-source',
          !!source &&
            source.kind === 'group' &&
            element.getAttribute('data-board-group-id') === source.id
        );
      });
  }

  private cancelConnection(): void {
    this.connectionSource = null;
    this.surface?.removeClass('is-connecting');
    this.refreshConnectionSourceMarks();
  }

  private addConnection(
    source: { kind: 'block' | 'group'; id: string },
    target: { kind: 'block' | 'group'; id: string }
  ): void {
    const exists = this.connections.some(
      connection => {
        const connectionSource = connection.sourceGroupId
          ? { kind: 'group' as const, id: connection.sourceGroupId }
          : { kind: 'block' as const, id: connection.sourceBlockId ?? '' };

        const connectionTarget = connection.targetGroupId
          ? { kind: 'group' as const, id: connection.targetGroupId }
          : { kind: 'block' as const, id: connection.targetBlockId ?? '' };

        return (
          connectionSource.kind === source.kind &&
          connectionSource.id === source.id &&
          connectionTarget.kind === target.kind &&
          connectionTarget.id === target.id
        );
      }
    );

    if (!exists) {
      this.connections.push({
        id: `board-connection-${crypto.randomUUID()}`,
        sourceBlockId: source.kind === 'block' ? source.id : undefined,
        sourceGroupId: source.kind === 'group' ? source.id : undefined,
        targetBlockId: target.kind === 'block' ? target.id : undefined,
        targetGroupId: target.kind === 'group' ? target.id : undefined
      });
      this.scheduleSave();
    }

    this.cancelConnection();
    this.renderConnections();
  }

  private removeConnection(connectionId: string): void {
    const index = this.connections.findIndex(
      connection => connection.id === connectionId
    );

    if (index === -1) {
      return;
    }

    this.connections.splice(index, 1);
    this.renderConnections();
    this.scheduleSave();
  }

  /**
   * Lados enfrentados entre dos tarjetas según su posición relativa.
   *
   * Preferencia por los bordes SUPERIORES/INFERIORES: se usan los
   * bordes laterales solo cuando el desplazamiento horizontal es
   * claramente dominante (más del doble que el vertical). Para
   * posiciones diagonales o casi verticales, la conexión se ancla
   * arriba/abajo.
   */
  private computeAnchorSides(
    sourceRect: DOMRect,
    targetRect: DOMRect
  ): {
    source: 'top' | 'bottom' | 'left' | 'right';
    target: 'top' | 'bottom' | 'left' | 'right';
  } {
    const sourceCenter = {
      x: sourceRect.left + sourceRect.width / 2,
      y: sourceRect.top + sourceRect.height / 2
    };
    const targetCenter = {
      x: targetRect.left + targetRect.width / 2,
      y: targetRect.top + targetRect.height / 2
    };

    const dx = targetCenter.x - sourceCenter.x;
    const dy = targetCenter.y - sourceCenter.y;

    // Lateral solo con desplazamiento horizontal claramente dominante.
    if (Math.abs(dx) > Math.abs(dy) * 2) {
      return dx >= 0
        ? { source: 'right', target: 'left' }
        : { source: 'left', target: 'right' };
    }

    return dy >= 0
      ? { source: 'bottom', target: 'top' }
      : { source: 'top', target: 'bottom' };
  }

  /**
   * Punto de anclaje de una tarjeta sobre un borde dado.
   *
   * El punto es FIJO: el punto medio del borde elegido. Lo único
   * que cambia según la posición relativa de la otra tarjeta es
   * el LATERAL (computeAnchorSides), no la posición sobre él.
   */
  private computeAnchorPoint(
    rect: DOMRect,
    side: 'top' | 'bottom' | 'left' | 'right'
  ): { x: number; y: number } {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    switch (side) {
      case 'top':
        return { x: centerX, y: rect.top };
      case 'bottom':
        return { x: centerX, y: rect.bottom };
      case 'left':
        return { x: rect.left, y: centerY };
      case 'right':
        return { x: rect.right, y: centerY };
    }
  }

  /**
   * Punto de conexión anclado al borde del extremo (tarjeta o
   * contenedor de grupo). Se coloca en el MISMO punto que el
   * extremo de la línea (misma matemática, misma pasada).
   */
  private renderEndpointDot(
    element: HTMLElement,
    endpoint: { kind: 'block' | 'group'; id: string },
    anchor: { x: number; y: number },
    cardRect: DOMRect
  ): void {
    if (endpoint.kind === 'block') {
      element.addClass('has-connection');
    }

    const dot = element.createEl('button', {
      cls: 'fl-board-anchor-dot',
      attr: {
        type: 'button',
        'aria-label': i18n.t('board.connection.dot.aria'),
        title: i18n.t('board.connectTooltip')
      }
    });

    dot.style.left = `${anchor.x - cardRect.left}px`;
    dot.style.top = `${anchor.y - cardRect.top}px`;

    dot.addEventListener('click', (event) => {
      event.stopPropagation();
      this.startConnectionFrom(endpoint);
    });
  }

  /**
   * ¿El segmento atraviesa el interior de un rectángulo (expandido
   * por un pequeño padding)? Recorte de Liang-Barsky.
   *
   * El padding es 2px: coincide con el grosor del trazo
   * (stroke-width 2 → medio trazo 1px + 1px de holgura). Un halo
   * mayor (p. ej. 6px) sellaba corredores visualmente libres y
   * forzaba desvíos innecesarios aunque la línea no cruzara
   * realmente ninguna tarjeta.
   */
  private segmentIntersectsRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    rect: { left: number; top: number; right: number; bottom: number },
    padding: number = 2
  ): boolean {
    const minX = rect.left - padding;
    const maxX = rect.right + padding;
    const minY = rect.top - padding;
    const maxY = rect.bottom + padding;

    const dx = x2 - x1;
    const dy = y2 - y1;

    let t0 = 0;
    let t1 = 1;

    const checks: Array<[number, number]> = [
      [-dx, x1 - minX],
      [dx, maxX - x1],
      [-dy, y1 - minY],
      [dy, maxY - y1]
    ];

    for (const [p, q] of checks) {
      if (p === 0) {
        if (q < 0) return false;
      } else {
        const r = q / p;
        if (p < 0) {
          if (r > t1) return false;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return false;
          if (r < t1) t1 = r;
        }
      }
    }

    return t0 < t1;
  }

  /** Todos los segmentos de una polilínea están libres de obstáculos. */
  private polylineClear(
    points: Array<{ x: number; y: number }>,
    obstacles: Array<{ left: number; top: number; right: number; bottom: number }>
  ): boolean {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      for (const obstacle of obstacles) {
        if (this.segmentIntersectsRect(a.x, a.y, b.x, b.y, obstacle)) {
          return false;
        }
      }
    }

    return true;
  }

  /** Convierte una polilínea en datos SVG compactos (V/H cuando sea posible). */
  private polylineToPathData(
    points: Array<{ x: number; y: number }>
  ): string {
    let data = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1];
      const point = points[i];

      if (point.x === previous.x) {
        data += ` V ${point.y}`;
      } else if (point.y === previous.y) {
        data += ` H ${point.x}`;
      } else {
        data += ` L ${point.x} ${point.y}`;
      }
    }

    return data;
  }

  /** Punto medio de una polilínea (para situar el control de borrado). */
  private polylineMidpoint(
    points: Array<{ x: number; y: number }>
  ): { x: number; y: number } {
    if (points.length === 0) {
      return { x: 0, y: 0 };
    }

    let total = 0;
    const lengths: number[] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const length = Math.hypot(
        points[i + 1].x - points[i].x,
        points[i + 1].y - points[i].y
      );
      lengths.push(length);
      total += length;
    }

    if (total === 0) {
      return points[0];
    }

    let remaining = total / 2;

    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i]) {
        const t = lengths[i] === 0 ? 0 : remaining / lengths[i];

        return {
          x: points[i].x + (points[i + 1].x - points[i].x) * t,
          y: points[i].y + (points[i + 1].y - points[i].y) * t
        };
      }

      remaining -= lengths[i];
    }

    return points[points.length - 1];
  }

  /**
   * Trayectoria de una conexión con anclajes dinámicos.
   *
   * Estrategia:
   *  1. Línea recta entre ambos anclajes cuando ningún obstáculo
   *     la atraviesa (los bordes distintos no obligan a codos).
   *  2. Solo si está bloqueada, se prueban carriles ortogonales
   *     en orden (intermedio, por fuera, lateral) hasta encontrar
   *     una ruta libre.
   *  3. Fallback: la recta original (mejor una línea directa con
   *     cruce posible que una ruta sin salidas).
   *
   * Devuelve los datos SVG y los puntos de la polilínea elegida
   * (estos últimos sitúan el control de borrado en el punto medio
   * real de la trayectoria).
   *
   * Coordenadas en el espacio de la superficie. Los obstáculos son
   * las OTRAS tarjetas (las conectadas quedan excluidas: sus
   * anclajes están en sus bordes, documentado como limitación
   * geométrica aceptada).
   */
  private buildConnectionPathData(
    sourceAnchor: { x: number; y: number },
    targetAnchor: { x: number; y: number },
    sourceSide: 'top' | 'bottom' | 'left' | 'right',
    sourceRect: { left: number; top: number; right: number; bottom: number },
    targetRect: { left: number; top: number; right: number; bottom: number },
    obstacles: Array<{ left: number; top: number; right: number; bottom: number }>
  ): { data: string; points: Array<{ x: number; y: number }> } {
    const directPoints = [sourceAnchor, targetAnchor];

    if (this.polylineClear(directPoints, obstacles)) {
      return {
        data: this.polylineToPathData(directPoints),
        points: directPoints
      };
    }

    const vertical = sourceSide === 'top' || sourceSide === 'bottom';

    const candidates: Array<Array<{ x: number; y: number }>> = [];

    if (vertical) {
      const midY = (sourceAnchor.y + targetAnchor.y) / 2;
      const outerY =
        sourceSide === 'bottom'
          ? Math.max(sourceRect.bottom, targetRect.bottom) + 20
          : Math.min(sourceRect.top, targetRect.top) - 20;
      const rightLane = Math.max(sourceRect.right, targetRect.right) + 20;
      const leftLane = Math.min(sourceRect.left, targetRect.left) - 20;

      candidates.push(
        [sourceAnchor, { x: sourceAnchor.x, y: midY }, { x: targetAnchor.x, y: midY }, targetAnchor],
        [sourceAnchor, { x: sourceAnchor.x, y: outerY }, { x: targetAnchor.x, y: outerY }, targetAnchor],
        [sourceAnchor, { x: rightLane, y: sourceAnchor.y }, { x: rightLane, y: targetAnchor.y }, targetAnchor]
      );

      if (leftLane >= 0) {
        candidates.push(
          [sourceAnchor, { x: leftLane, y: sourceAnchor.y }, { x: leftLane, y: targetAnchor.y }, targetAnchor]
        );
      }
    } else {
      const midX = (sourceAnchor.x + targetAnchor.x) / 2;
      const outerX =
        sourceSide === 'right'
          ? Math.max(sourceRect.right, targetRect.right) + 20
          : Math.min(sourceRect.left, targetRect.left) - 20;
      const bottomLane = Math.max(sourceRect.bottom, targetRect.bottom) + 20;
      const topLane = Math.min(sourceRect.top, targetRect.top) - 20;

      candidates.push(
        [sourceAnchor, { x: midX, y: sourceAnchor.y }, { x: midX, y: targetAnchor.y }, targetAnchor],
        [sourceAnchor, { x: outerX, y: sourceAnchor.y }, { x: outerX, y: targetAnchor.y }, targetAnchor],
        [sourceAnchor, { x: sourceAnchor.x, y: bottomLane }, { x: targetAnchor.x, y: bottomLane }, targetAnchor]
      );

      if (topLane >= 0) {
        candidates.push(
          [sourceAnchor, { x: sourceAnchor.x, y: topLane }, { x: targetAnchor.x, y: topLane }, targetAnchor]
        );
      }
    }

    for (const candidate of candidates) {
      if (this.polylineClear(candidate, obstacles)) {
        return {
          data: this.polylineToPathData(candidate),
          points: candidate
        };
      }
    }

    return {
      data: this.polylineToPathData(directPoints),
      points: directPoints
    };
  }

  private renderConnections(): void {
    const surface = this.surface;
    const layer = this.connectionLayer;
    const blockLayer = this.blockLayer;

    if (!surface || !layer || !blockLayer) return;

    const width = Math.max(
      surface.clientWidth,
      surface.scrollWidth,
      blockLayer.scrollWidth
    );
    const height = Math.max(
      surface.clientHeight,
      surface.scrollHeight,
      blockLayer.scrollHeight
    );

    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    layer.setAttribute('width', String(width));
    layer.setAttribute('height', String(height));
    layer.replaceChildren();

    /*
     * Limpieza de la pasada anterior: los puntos ancla y la marca
     * has-connection se recalculan entera cada vez (se llama también
     * en cada frame de arrastre), de modo que nunca quedan puntos
     * duplicados ni anclajes obsoletos tras un movimiento.
     */
    blockLayer
      .querySelectorAll('.fl-board-anchor-dot')
      .forEach((dot) => dot.remove());

    blockLayer
      .querySelectorAll('.fl-board-text-card')
      .forEach((card) => card.removeClass('has-connection'));

    const surfaceRect = surface.getBoundingClientRect();

    const toSurfaceX = (viewportX: number): number =>
      viewportX - surfaceRect.left + surface.scrollLeft;
    const toSurfaceY = (viewportY: number): number =>
      viewportY - surfaceRect.top + surface.scrollTop;

    /*
     * Rectángulos de todas las tarjetas en el espacio de la
     * superficie, una sola vez por pasada: se usan como obstáculos
     * de las rutas (excluyendo las dos tarjetas conectadas).
     */
    /*
     * Extremos de conexión: TARJETAS (data-board-block-id) y
     * CONTENEDORES DE GRUPO (data-board-group-id). Geometría
     * compartida: rects de ambas entidades; las cajas de grupo
     * también actúan como obstáculos de trazado.
     */
    type Endpoint = { kind: 'block' | 'group'; id: string };

    const resolveEndpointElement = (
      endpoint: Endpoint
    ): HTMLElement | null =>
      blockLayer.querySelector(
        endpoint.kind === 'block'
          ? `[data-board-block-id="${endpoint.id}"]`
          : `[data-board-group-id="${endpoint.id}"]`
      );

    const endpointOf = (connection: BoardConnection): {
      source: Endpoint | null;
      target: Endpoint | null;
    } => ({
      source: connection.sourceGroupId
        ? { kind: 'group', id: connection.sourceGroupId }
        : connection.sourceBlockId
          ? { kind: 'block', id: connection.sourceBlockId }
          : null,
      target: connection.targetGroupId
        ? { kind: 'group', id: connection.targetGroupId }
        : connection.targetBlockId
          ? { kind: 'block', id: connection.targetBlockId }
          : null
    });

    const toSurfaceRect = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        left: toSurfaceX(rect.left),
        top: toSurfaceY(rect.top),
        right: toSurfaceX(rect.right),
        bottom: toSurfaceY(rect.bottom)
      };
    };

    const cardElements = Array.from(
      blockLayer.querySelectorAll<HTMLElement>('.fl-board-text-card')
    );

    const boxElements = Array.from(
      blockLayer.querySelectorAll<HTMLElement>('.fl-board-group-box')
    );

    for (const connection of this.connections) {
      const endpoints = endpointOf(connection);

      if (!endpoints.source || !endpoints.target) continue;

      const source = resolveEndpointElement(endpoints.source);
      const target = resolveEndpointElement(endpoints.target);

      if (!source || !target) continue;

      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();

      const sides = this.computeAnchorSides(sourceRect, targetRect);
      const sourceAnchor = this.computeAnchorPoint(
        sourceRect,
        sides.source
      );
      const targetAnchor = this.computeAnchorPoint(
        targetRect,
        sides.target
      );

      const obstacles = cardElements
        .concat(boxElements)
        .filter((element) => element !== source && element !== target)
        .map(toSurfaceRect);

      const route = this.buildConnectionPathData(
        {
          x: toSurfaceX(sourceAnchor.x),
          y: toSurfaceY(sourceAnchor.y)
        },
        {
          x: toSurfaceX(targetAnchor.x),
          y: toSurfaceY(targetAnchor.y)
        },
        sides.source,
        toSurfaceRect(source),
        toSurfaceRect(target),
        obstacles
      );

      /*
       * Cada conexión se compone como un grupo:
       *   hit (zona de clic) + línea + control de borrado (cruz)
       */
      const group = layer.createSvg('g', {
        cls: 'fl-board-connection-group'
      });

      const hitPath = group.createSvg('path', {
        cls: 'fl-board-connection-hit',
        attr: { d: route.data }
      });
      hitPath.addEventListener('click', (event) => {
        event.stopPropagation();
        this.removeConnection(connection.id);
      });

      group.createSvg('path', {
        cls: 'fl-board-connection-line',
        attr: { d: route.data }
      });

      const midpoint = this.polylineMidpoint(route.points);

      const deleteControl = group.createSvg('g', {
        cls: 'fl-board-connection-delete',
        attr: {
          transform: `translate(${midpoint.x} ${midpoint.y})`
        }
      });
      deleteControl.addEventListener('click', (event) => {
        event.stopPropagation();
        this.removeConnection(connection.id);
      });

      deleteControl.createSvg('circle', {
        cls: 'fl-board-connection-delete-bg',
        attr: { r: '8' }
      });

      deleteControl.createSvg('path', {
        cls: 'fl-board-connection-delete-x',
        attr: { d: 'M -3 -3 L 3 3 M 3 -3 L -3 3' }
      });

      // Puntos en los extremos (tarjeta o contenedor)
      this.renderEndpointDot(
        source,
        endpoints.source,
        sourceAnchor,
        sourceRect
      );
      this.renderEndpointDot(
        target,
        endpoints.target,
        targetAnchor,
        targetRect
      );
    }

    // Los contenedores de grupo siguen la geometría de sus miembros.
    this.updateGroupGeometries();
  }

  // ============================================================
  // LIENZO
  // ============================================================

  private updateCanvasSize(): void {
    const surface = this.surface;
    const blockLayer = this.blockLayer;

    if (!surface || !blockLayer) return;

    let maxRight = surface.clientWidth;
    let maxBottom = surface.clientHeight;

    for (const block of this.blocks) {
      const element: HTMLElement | null = blockLayer.querySelector(
        `[data-board-block-id="${block.id}"]`
      );

      const width = element?.offsetWidth ?? 240;
      const height = element?.offsetHeight ?? 120;

      maxRight = Math.max(maxRight, block.x + width + 32);
      maxBottom = Math.max(maxBottom, block.y + height + 32);
    }

    blockLayer.style.width = `${maxRight}px`;
    blockLayer.style.height = `${maxBottom}px`;
  }

  private updateEmptyState(): void {
    this.emptyState?.toggleClass(
      'is-hidden',
      this.blocks.length > 0
    );
  }

  // ============================================================
  // INSTANCIA 2: ARQUITECTURA (BoardArchitectureHost)
  // ============================================================

  getBlocks(): BoardBlock[] {
    return this.blocks;
  }

  getArchitectureNodes(): BoardArchNode[] {
    return this.architecture;
  }

  getFragmentOverrides(): BoardFragmentOverride[] {
    return this.fragmentOverrides;
  }

  addArchNode(afterIndex: number | null, level: number): void {
    const node: BoardArchNode = {
      id: `board-arch-${crypto.randomUUID()}`,
      level: Math.max(0, Math.min(3, level)),
      title: '',
      blockIds: []
    };

    if (
      afterIndex === null ||
      afterIndex < 0 ||
      afterIndex >= this.architecture.length
    ) {
      this.architecture.push(node);
    } else {
      this.architecture.splice(afterIndex + 1, 0, node);
    }

    this.scheduleSave();
    this.rerender();
  }

  updateArchNode(
    id: string,
    patch: Partial<Pick<BoardArchNode, 'title' | 'level'>>
  ): void {
    const node = this.architecture.find(entry => entry.id === id);

    if (!node) {
      return;
    }

    if (patch.title !== undefined) {
      node.title = patch.title;
    }

    if (patch.level !== undefined) {
      node.level = Math.max(0, Math.min(3, patch.level));
    }

    this.scheduleSave();
    this.rerender();
  }

  moveArchNode(id: string, direction: -1 | 1): void {
    const index = this.architecture.findIndex(
      entry => entry.id === id
    );

    if (index === -1) {
      return;
    }

    const target = index + direction;

    if (target < 0 || target >= this.architecture.length) {
      return;
    }

    const [node] = this.architecture.splice(index, 1);
    this.architecture.splice(target, 0, node);

    this.scheduleSave();
    this.rerender();
  }

  removeArchNode(id: string): void {
    const index = this.architecture.findIndex(
      entry => entry.id === id
    );

    if (index === -1) {
      return;
    }

    /*
     * Eliminar un elemento estructural NO elimina sus bloques:
     * vuelven a la bandeja de material sin asignar.
     */
    this.architecture.splice(index, 1);

    this.scheduleSave();
    this.rerender();
  }

  assignBlockToNode(nodeId: string, blockId: string): void {
    const node = this.architecture.find(entry => entry.id === nodeId);
    const block = this.blocks.find(entry => entry.id === blockId);

    if (!node || !block) {
      return;
    }

    const alreadyAssigned = this.architecture.some(entry =>
      entry.blockIds.includes(blockId)
    );

    if (alreadyAssigned) {
      return;
    }

    node.blockIds.push(blockId);

    this.scheduleSave();
    this.rerender();
  }

  unassignBlockFromNode(nodeId: string, blockId: string): void {
    const node = this.architecture.find(entry => entry.id === nodeId);

    if (!node) {
      return;
    }

    node.blockIds = node.blockIds.filter(id => id !== blockId);

    this.scheduleSave();
    this.rerender();
  }

  moveAssignedBlock(
    nodeId: string,
    blockId: string,
    direction: -1 | 1
  ): void {
    const node = this.architecture.find(entry => entry.id === nodeId);

    if (!node) {
      return;
    }

    const index = node.blockIds.indexOf(blockId);

    if (index === -1) {
      return;
    }

    const target = index + direction;

    if (target < 0 || target >= node.blockIds.length) {
      return;
    }

    const [id] = node.blockIds.splice(index, 1);
    node.blockIds.splice(target, 0, id);

    this.scheduleSave();
    this.rerender();
  }

  requestBoardRender(): void {
    this.rerender();
  }

  // ============================================================
  // INSTANCIA 3: DOCUMENTO (BoardDocumentHost)
  // ============================================================

  getDisplayedText(block: BoardBlock): string {
    const override = this.fragmentOverrides.find(
      entry => entry.blockId === block.id
    );

    if (override?.useOverride) {
      return override.overrideText;
    }

    return block.text;
  }

  setFragmentOverride(blockId: string, text: string): void {
    const existing = this.fragmentOverrides.find(
      entry => entry.blockId === blockId
    );

    if (existing) {
      existing.overrideText = text;
      existing.useOverride = true;
    } else {
      this.fragmentOverrides.push({
        id: `block:${blockId}`,
        blockId,
        overrideText: text,
        useOverride: true
      });
    }

    this.scheduleSave();
  }

  clearFragmentOverride(blockId: string): void {
    this.fragmentOverrides = this.fragmentOverrides.filter(
      entry => entry.blockId !== blockId
    );

    this.scheduleSave();
  }

  toggleFragmentOverride(blockId: string): void {
    const override = this.fragmentOverrides.find(
      entry => entry.blockId === blockId
    );

    if (!override) {
      return;
    }

    override.useOverride = !override.useOverride;

    this.scheduleSave();
    this.rerender();
  }

  openPolishModal(blockId: string): void {
    const block = this.blocks.find(entry => entry.id === blockId);

    if (!block) {
      return;
    }

    const override = this.fragmentOverrides.find(
      entry => entry.blockId === blockId
    );

    const modal = new BoardPolishModal(
      this.deps.app,
      block.text,
      this.getDisplayedText(block),
      !!override,
      (result) => {
        const text = result.text.trim();

        if (!text) {
          return;
        }

        if (text === block.text.trim()) {
          // El texto personal coincide con el original:
          // no hace falta mantener una versión alternativa.
          this.clearFragmentOverride(block.id);
        } else {
          this.setFragmentOverride(block.id, text);
        }

        this.rerender();
      },
      () => {
        this.clearFragmentOverride(block.id);
        this.rerender();
      }
    );

    modal.open();
  }
}
