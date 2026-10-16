import {
  FocusWidget,
  FocusWidgetFactory,
  WidgetCallbacks
} from "../FocusWidget";
import { i18n } from '../../i18n/I18nService';

import { FocusContext } from "../FocusContext";
import { App, Menu, Notice, TFile } from "obsidian";
import { resolveVaultStorageId, vaultStorageKey } from "../../utils/vault-storage";
import type FolderLabPlugin from "../../main";
import type { LocalMirror } from "../../storage/localMirror";

import { FocusListItem } from "../FocusListItem";
import {
  FolderLabDragDrop,
  createExpandableText,
  sortPriorityFirst
} from "../FocusWidgetsUtils";

import type {
  WidgetDefinition,
  WidgetInstance
} from "../WidgetDefinition";

import { WidgetControls } from "./tools/WidgetControls";
import { WidgetControlsRenderer } from "./tools/WidgetControlsRenderer";

interface NoteBlock {
  text: string;
  active: boolean;
}

type SessionQuery = "week" | "month" | "all";

export class NotesWidget implements FocusWidget {
  readonly id = "notes";
  get label(): string {
    return i18n.t('widgets.registered.notes.label');
  }
  readonly icon = "pencil";

  private container: HTMLElement | null = null;
  private lastContext: FocusContext | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private currentFile: TFile | null = null;
  private saveTimeout: number | null = null;

  private app: App;
  private blocksStorageKey: string = "";

  private dropCleanup: (() => void) | null = null;

  private dragCleanups: Array<() => void> = [];
  private draftText: string = "";

  /** Guarda contra pulsaciones repetidas de «Guardar». */
  private isSavingDraft: boolean = false;

  private storageKey: string = "";
  private draftStorageKey: string = "";

  private position: "top" | "bottom" = "top";
  private sessionView: "capture" | "today" = "capture";

  // ------------------------------------------------------------
  // SESIÓN — CAPTURA / CONSULTA / DESTINO
  //
  // Estados separados:
  // - modo de captura: Apuntes (null) o destino de instancia
  // - destino de escritura: captureTargetInstanceId (id estable)
  // - filtro de consulta: sessionQuery (independiente)
  // ------------------------------------------------------------

  /** Destino activo de captura; null = guardado en Apuntes. */
  private captureTargetInstanceId: string | null = null;

  /** Intervalo de consulta del listado (no afecta a la captura). */
  private sessionQuery: SessionQuery = "all";

  /** Transición entre menús (Sesión ↔ Instancias), sin submenús. */
  private pendingMenuTransition: "instances" | "session" | null = null;

  private callbacks: WidgetCallbacks = {};

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Etapa 2: parchea el archivo sincronizable de borradores.
   * localStorage sigue escribiéndose como espejo de emergencia.
   */
  private persistDraftPatch(patch: {
    draft?: string;
    blocks?: NoteBlock[];
  }): void {
    if (!this.currentFile) return;
    const plugin = (this.app as unknown as {
      plugins?: { plugins?: Record<string, FolderLabPlugin | undefined> };
    }).plugins?.plugins?.["folder-lab"];
    plugin?.draftStore
      ?.write(this.currentFile.path, patch)
      .catch((error: unknown) => {
        console.warn(
          "[NotesWidget] Error guardando borrador en bóveda:",
          error
        );
      });
  }

  // ------------------------------------------------------------
  // Espejo de emergencia AISLADO POR IDENTIDAD (Corrección A)
  // ------------------------------------------------------------

  private get localMirror(): LocalMirror | null {
    const plugin = (this.app as unknown as {
      plugins?: { plugins?: Record<string, FolderLabPlugin | undefined> };
    }).plugins?.plugins?.["folder-lab"];
    return plugin?.localMirror ?? null;
  }

  private async mirrorWrite(
    family: string,
    value: string | null
  ): Promise<void> {
    if (!this.currentFile) return;
    const mirror = this.localMirror;
    if (!mirror) return;
    try {
      if (value === null || value === "") {
        await mirror.remove(family, this.currentFile.path);
      } else {
        await mirror.write(family, this.currentFile.path, value);
      }
    } catch (error) {
      console.warn("[NotesWidget] Error escribiendo espejo local:", error);
    }
  }

  private async mirrorRead(family: string): Promise<string | null> {
    if (!this.currentFile) return null;
    const mirror = this.localMirror;
    if (!mirror) return null;
    try {
      const result = await mirror.read(family, this.currentFile.path);
      return result.value && result.value !== "" ? result.value : null;
    } catch (error) {
      console.warn("[NotesWidget] Error leyendo espejo local:", error);
      return null;
    }
  }

  // ============================================================
  // FOCUS WIDGET INTERFACE
  // ============================================================

  setPosition(position: "top" | "bottom"): void {
    this.position = position;
  }

  setCallbacks(callbacks: WidgetCallbacks): void {
    this.callbacks = callbacks;
  }

  render(container: HTMLElement, context: FocusContext): void {
    this.container = container;
    this.lastContext = context;
    this.currentFile = context.activeFile;

    const vaultId = resolveVaultStorageId(this.app);
    this.storageKey = this.currentFile
      ? vaultStorageKey(vaultId, "focus-notes", this.currentFile.path)
      : "";

    this.draftStorageKey = this.currentFile
      ? vaultStorageKey(vaultId, "focus-notes-draft", this.currentFile.path)
      : "";

    this.blocksStorageKey = this.currentFile
      ? vaultStorageKey(vaultId, "focus-notes-blocks", this.currentFile.path)
      : "";

    this.container.empty();
    this.container.addClass("fl-widget-notes");

    // El FocusSplitter ya gobierna la altura del frame.
    // Esta cadena hace que el contenido interno herede esa altura.
    // (Presentación en CSS: reglas .fl-widget-notes.)

    /*
     * La posición sigue siendo responsabilidad del widget/frame.
     *
     * TOP:
     *   controles
     *   contenido
     *
     * BOTTOM:
     *   contenido
     *   controles
     */

    if (this.position === "top") {
      this.renderControls();
      this.renderContent();
    } else {
      this.renderContent();
      this.renderControls();
    }
  }

  update(context: FocusContext): void {
    const newFile = context.activeFile;

    if (newFile === this.currentFile) {
      return;
    }

    void this.save();
    this.sessionView = "capture";

    /*
     * Las instancias de widgets son POR NOTA: el destino de
     * captura de la nota anterior no es válido en la nueva.
     */
    this.captureTargetInstanceId = null;

    this.currentFile = newFile;

    const vaultId = resolveVaultStorageId(this.app);
    this.storageKey = this.currentFile
      ? vaultStorageKey(vaultId, "focus-notes", this.currentFile.path)
      : "";

    this.blocksStorageKey = this.currentFile
      ? vaultStorageKey(vaultId, "focus-notes-blocks", this.currentFile.path)
      : "";

    if (this.container) {
      this.render(this.container, context);
    }
  }

  destroy(): void {
    this.cleanupInteractions();

    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    void this.save();

    if (this.container) {
      this.container.empty();
      this.container = null;
    }

    this.textarea = null;
    this.currentFile = null;
  }

  // ============================================================
  // CONTROLES
  // ============================================================

  /**
   * Declara la barra completa de controles de Apuntes.
   *
   * Este método NO crea HTML ni CSS.
   *
   * El widget declara:
   *
   *   [ fuente ] [ widget ] [ controles dinámicos ]
   */
  private buildControls(): WidgetControls {
    const controls = new WidgetControls();

    // ----------------------------------------------------------
    // CONTROL ESTRUCTURAL: WIDGET
    // ----------------------------------------------------------

    controls.setWidget({
      id: this.id,
      label: this.label,
      icon: this.icon,
      options: []
    });

    // ----------------------------------------------------------
    // EJECUCIÓN — derecha del toolbar
    //
    // Orden: [Guardar] [Sesión]
    // El selector de sesiones queda en el extremo derecho.
    //
    // Es un «picker» (no un select): el widget dueño abre su
    // propio menú con secciones y transición a instancias.
    // ----------------------------------------------------------

    controls.action({
      id: "save",
      label: i18n.t('widgets.notesWidget.action.save')
    });

    // ----------------------------------------------------------
    // SESIÓN
    // ----------------------------------------------------------

    controls.picker({
      id: "session",
      label: this.getSessionControlLabel()
    });



    return controls;
  }

  /**
   * Renderiza la barra mediante el Widget Kit.
   *
   * NotesWidget ya no crea botones, spans,
   * flechas ni menús directamente.
   */
  private renderControls(): void {
    if (!this.container) {
      return;
    }

    const controls = this.buildControls();

    WidgetControlsRenderer.render(
      this.container,
      controls.getConfig(),
      {
        onWidgetSelect: () => {
          this.callbacks.onWidgetSelect?.();
        },

        onSourceSelect: (_sourceId) => {

          this.callbacks.onSourceSelect?.();
        },

        onControlSelect: () => {},

        onPickerOpen: (controlId) => {
          if (controlId === "session") {
            this.showSessionMenu();
          }
        },

        onAction: (controlId) => {
          if (controlId === "save") {
            void this.saveDraftFromToolbar();
            return;
          }
        }
      }
    );

    // El DOM de los controles se crea de forma síncrona:
    // la visibilidad de Guardar se aplica sin esperar un frame
    // (evita el destello del botón con el área vacía).
    this.updateSaveActionVisibility();
  }

  private updateSaveActionVisibility(): void {
    if (!this.container) return;

    const hasText = this.draftText.trim().length > 0;

    // Identificar el botón SOLO por su identificador estable
    // (data-control-id). La comparación por texto visible se
    // eliminó: se rompería con la traducción del label.
    const buttons = this.container.querySelectorAll("button");

    buttons.forEach((button) => {
      const controlId = button.getAttribute('data-control-id');

      if (controlId === "save") {
        button.toggleClass("is-hidden", !hasText);
      }
    });
  }

  // ============================================================
  // SESIÓN — MENÚ CON TRANSICIÓN A INSTANCIAS
  //
  // Obsidian no se asume con submenús nativos: «Enviar a»
  // cierra el menú de sesión (hide + onHide) y abre
  // inmediatamente el menú de instancias en la misma posición.
  // «Volver» regresa al menú de sesión por el mismo mecanismo.
  // ============================================================

  private rerender(): void {
    if (this.container && this.lastContext) {
      this.render(this.container, this.lastContext);
    }
  }

  /** Etiqueta del control: modo de captura activo explícito. */
  private getSessionControlLabel(): string {
    const prefix = `${i18n.t('widgets.common.session')}:`;

    if (this.captureTargetInstanceId) {
      return `${prefix} ${i18n.t('widgets.notesWidget.session.sendTo')} ${this.resolveCaptureTargetName()}`;
    }

    return `${prefix} ${i18n.t('widgets.common.sessionToday')}`;
  }

  private resolveCaptureTargetName(): string {
    const targetId = this.captureTargetInstanceId;

    if (!targetId) return "";

    const instance =
      this.lastContext?.widgetManager?.getInstance(targetId);

    // Fallback al id estable si la instancia desapareció.
    return instance?.name ?? targetId;
  }

  /**
   * Contrato de recepción desde Apuntes: propiedad EXPLÍCITA de
   * la definición (`transfer.fromNotes === true`), independiente
   * de `inputs` (drag-and-drop entre widgets). La ausencia de la
   * propiedad (definiciones antiguas) no es elegible: el envío
   * es opt-in.
   */
  private isNoteCaptureTarget(
    definition: WidgetDefinition | undefined
  ): definition is WidgetDefinition {
    return definition?.transfer?.fromNotes === true;
  }

  private getReceivableTargets(): Array<{
    instance: WidgetInstance;
    definition: WidgetDefinition;
  }> {
    const manager = this.lastContext?.widgetManager;

    if (!manager) return [];

    const targets: Array<{
      instance: WidgetInstance;
      definition: WidgetDefinition;
    }> = [];

    for (const instance of manager.getInstances()) {
      const definition = manager.getDefinition(instance.typeId);

      if (!definition) continue;

      if (this.isNoteCaptureTarget(definition)) {
        targets.push({ instance, definition });
      }
    }

    return targets;
  }

  private getSessionMenuAnchor():
    | { anchor: HTMLElement; rect: DOMRect }
    | null {
    if (!this.container) return null;

    const anchorCandidate = this.container.querySelector(
      '.fl-widget-control-item[data-control-id="session"]'
    );

    // closest/querySelector devuelven Element; el ancla del menú
    // es siempre el botón (HTMLElement).
    if (!anchorCandidate?.instanceOf(HTMLElement)) return null;

    return {
      anchor: anchorCandidate,
      rect: anchorCandidate.getBoundingClientRect()
    };
  }

  private showSessionMenu(): void {
    /*
     * Limpieza defensiva: un valor residual de la transición
     * (p. ej. si el menú se ocultó antes de invocar el ítem)
     * no debe disparar una transición espuria en este menú.
     */
    this.pendingMenuTransition = null;

    const target = this.getSessionMenuAnchor();

    if (!target) return;

    const { anchor, rect } = target;
    const menu = new Menu();

    // ----------------------------------------------------------
    // SECCIÓN: SESIÓN (modo de captura)
    // ----------------------------------------------------------

    menu.addItem((item) => {
      item
        .setTitle(i18n.t("widgets.common.session"))
        .setDisabled(true);
    });

    menu.addItem((item) => {
      item
        .setTitle(i18n.t("widgets.common.sessionToday"))
        .onClick(() => {
          /*
           * Acción, no opción marcable: vuelve al modo normal
           * de captura y muestra los bloques de la sesión de
           * Apuntes del día actual.
           */
          this.captureTargetInstanceId = null;
          this.sessionView = "today";
          this.rerender();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle(i18n.t("widgets.notesWidget.session.sendTo"))
        .setIcon("send")
        .onClick(() => {
          // Simulación de submenú: cerrar este menú y abrir
          // el de instancias en la misma posición.
          this.pendingMenuTransition = "instances";
          menu.hide();
        });
    });

    // ----------------------------------------------------------
    // SECCIÓN: BROWSER (acciones de consulta del historial)
    //
    // Los ítems son ACCIONES de navegación, no opciones con
    // selección persistente: no llevan palomita. El modo de
    // captura activo se comunica solo en el toolbar.
    // ----------------------------------------------------------

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle(i18n.t("widgets.notesWidget.session.queryHeader"))
        .setDisabled(true);
    });

    const queries: Array<{ id: SessionQuery; label: string }> = [
      { id: "week", label: i18n.t("widgets.notesWidget.session.queryWeek") },
      { id: "month", label: i18n.t("widgets.notesWidget.session.queryMonth") },
      { id: "all", label: i18n.t("widgets.notesWidget.session.queryAll") }
    ];

    for (const query of queries) {
      menu.addItem((item) => {
        item
          .setTitle(query.label)
          .onClick(() => {
            // Navegar por el historial NO altera el modo de
            // captura ni el destino de escritura.
            this.sessionQuery = query.id;
            this.sessionView = "today";
            this.rerender();
          });
      });
    }

    menu.onHide(() => {
      if (this.pendingMenuTransition === "instances") {
        this.pendingMenuTransition = null;

        window.setTimeout(() => {
          this.showInstancesMenu(anchor, rect);
        }, 0);
      }
    });

    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }

  private showInstancesMenu(anchor: HTMLElement, rect: DOMRect): void {
    /*
     * Limpieza defensiva: el valor residual, si lo hubiera, no
     * debe sobrevivir dentro del menú de instancias. La
     * transición legítima ya consumió el estado en el onHide
     * del menú de sesión antes de llegar aquí.
     */
    this.pendingMenuTransition = null;

    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle(i18n.t("widgets.notesWidget.session.instancesHeader"))
        .setDisabled(true);
    });

    menu.addItem((item) => {
      item
        .setTitle(i18n.t("widgets.notesWidget.session.back"))
        .setIcon("arrow-left")
        .onClick(() => {
          this.pendingMenuTransition = "session";
          menu.hide();
        });
    });

    menu.addSeparator();

    const targets = this.getReceivableTargets();

    if (targets.length === 0) {
      menu.addItem((item) => {
        item
          .setTitle(i18n.t("widgets.notesWidget.session.noInstances"))
          .setDisabled(true);
      });
    }

    /*
     * Nombres repetidos entre instancias distintas →
     * desambiguador con el sufijo único del id estable.
     */
    const nameCounts = new Map<string, number>();

    for (const { instance } of targets) {
      nameCounts.set(
        instance.name,
        (nameCounts.get(instance.name) ?? 0) + 1
      );
    }

    for (const { instance, definition } of targets) {
      menu.addItem((item) => {
        let title = instance.name;

        if ((nameCounts.get(instance.name) ?? 0) > 1) {
          const suffix =
            instance.instanceId.split("-").pop() ?? "";
          title = `${instance.name} · ${suffix}`;
        }

        item
          .setTitle(title)
          .setIcon(definition.identity?.icon ?? "square")
          .setChecked(
            this.captureTargetInstanceId === instance.instanceId
          )
          .onClick(() => {
            // Destino activo: se mantiene hasta cambiarlo o
            // volver a «Sesión → Hoy».
            this.captureTargetInstanceId = instance.instanceId;
            this.rerender();
          });
      });
    }

    menu.onHide(() => {
      if (this.pendingMenuTransition === "session") {
        this.pendingMenuTransition = null;

        window.setTimeout(() => {
          this.showSessionMenu();
        }, 0);
      }
    });

    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }

  /**
   * Envía un bloque a la instancia destino usando SU mecanismo
   * de persistencia existente (WidgetController.storage.add,
   * transacción serializada — el mismo camino que el drop
   * entre widgets). No introduce almacenamiento paralelo ni
   * copia el bloque en Apuntes.
   */
  private async sendBlockToInstance(
    instanceId: string,
    text: string
  ): Promise<void> {
    const manager = this.lastContext?.widgetManager;
    const widgetController = this.lastContext?.widgetController;

    if (!manager || !widgetController) {
      throw new Error(
        "[NotesWidget] Contexto sin gestor de widgets: no se puede enviar el bloque"
      );
    }

    const instance = manager.getInstance(instanceId);
    const definition = instance
      ? manager.getDefinition(instance.typeId)
      : undefined;

    /*
     * El envío exige el contrato explícito transfer.fromNotes:
     * un widget no elegible NO puede recibir por esta vía, aunque
     * su id llegue a llamarse directamente.
     */
    if (!instance || !this.isNoteCaptureTarget(definition)) {
      throw new Error(
        `[NotesWidget] Instancia destino no válida: ${instanceId}`
      );
    }

    if (!this.currentFile) {
      throw new Error(
        "[NotesWidget] Sin nota activa: no se puede enviar el bloque"
      );
    }

    const stateField = definition.state?.field;

    await widgetController.storage.add(
      definition.id,
      this.currentFile.path,
      instance.instanceId,
      {
        text,
        ...(stateField
          ? {
              [stateField]: definition.state?.initial ?? false
            }
          : {})
      }
    );
  }


  private enterCaptureView(): void {
    if (this.sessionView === "capture") return;

    this.sessionView = "capture";
    this.draftText = "";

    const capturePanel = this.container?.querySelector(
      ".fl-notes-capture-panel"
    ) as HTMLElement | null;

    const todayPanel = this.container?.querySelector(
      ".fl-notes-today-panel"
    ) as HTMLElement | null;

    if (!capturePanel || !todayPanel) return;

    todayPanel.addClass("is-hidden");
    capturePanel.removeClass("is-hidden");

    const editor: HTMLTextAreaElement | null =
      capturePanel.querySelector(".fl-notes-capture-editor");

    if (editor) {
      window.requestAnimationFrame(() => {
        editor.focus({ preventScroll: true });
      });
    }
  }

  // ============================================================
  // CONTENIDO — BLOQUES + BORRADOR PERMANENTE
  // ============================================================

  private renderContent(): void {
    if (!this.container) return;

    const contentWrapper = this.container.createDiv({
      cls: "fl-widget-content-expanded fl-notes-scroll-surface"
    });

    // Este es el ÚNICO propietario del scroll del widget.
    // La sesión no decide si existe scrollbar: el navegador lo determina
    // según el tamaño real del contenido.
    // (Presentación en CSS: regla .fl-notes-scroll-surface.)

    if (!this.currentFile) {
      contentWrapper.createDiv({
        cls: "fl-widget-content-empty",
        text: i18n.t('widgets.notesWidget.empty.noteRequired')
      });
      return;
    }

    // ============================================================
    // DOS VISTAS INDEPENDIENTES
    //
    // CAPTURE = editor real
    // TODAY   = historial + entrada señuelo
    //
    // En esta etapa solamente construimos la estructura.
    // La lógica de contenido se migrará en las etapas siguientes.
    // ============================================================

    const capturePanel = contentWrapper.createDiv({
      cls: "fl-notes-capture-panel"
    });
    capturePanel.toggleClass(
      "is-hidden",
      this.sessionView !== "capture"
    );

    const todayPanel = contentWrapper.createDiv({
      cls: "fl-notes-today-panel"
    });
    todayPanel.toggleClass(
      "is-hidden",
      this.sessionView !== "today"
    );



    const draftProxy = todayPanel.createDiv({
      cls: "fl-notes-draft-proxy"
    });

    const draftProxyText = draftProxy.createDiv({
      cls: "fl-notes-draft-proxy-text"
    });

    const draftText = this.draftText.trim();

    draftProxyText.setText(
      draftText.length > 0
        ? draftText
        : i18n.t('widgets.notesWidget.placeholder.draft')
    );

    if (!draftText.length) {
      draftProxyText.addClass("fl-notes-draft-proxy-placeholder");
    }

    draftProxy.addEventListener("click", () => {
      this.enterCaptureView();
    });



    const todayList = todayPanel.createDiv({
      cls: "fl-notes-today-list"
    });

    const captureEditor = capturePanel.createEl("textarea", {
      cls: "fl-widget-textarea fl-notes-draft-editor fl-notes-capture-editor",
      attr: {
        placeholder: i18n.t('widgets.notesWidget.placeholder.draft')
      }
    });

    // El estado visual del editor es la fuente de verdad.
    // Si no hay contenido actual, no debe existir un draft persistido.
    if (
      !this.draftText.trim() &&
      this.draftStorageKey
    ) {
      void this.mirrorWrite("focus-notes-draft", null);
      this.persistDraftPatch({ draft: "" });
    }

    captureEditor.value = this.draftText;

    captureEditor.addEventListener("input", () => {
      this.draftText = captureEditor.value;

      if (this.draftStorageKey) {
        if (this.draftText.trim()) {
          void this.mirrorWrite("focus-notes-draft", this.draftText);
          this.persistDraftPatch({ draft: this.draftText });
        } else {
          void this.mirrorWrite("focus-notes-draft", null);
          this.persistDraftPatch({ draft: "" });
        }
      }

      this.updateSaveActionVisibility();
    });

    const dragDrop = FolderLabDragDrop.getInstance(this.app);
    this.cleanupInteractions();

    this.dropCleanup = dragDrop.registerTextDropTarget(
      contentWrapper,
      async (payload) => {
        const text = payload.text ?? "";
        if (!this.currentFile || !text.trim()) return;

        await this.appendBlock(text);
        await this.refreshBlocks();
        new Notice(i18n.t('widgets.notesWidget.notice.created'));
      },
      (active) => {
        contentWrapper.toggleClass("fl-dnd-drop-active", active);
      }
    );

    void this.loadBlocks().then((blocks) => {
      if (this.sessionView !== "today") {
        return;
      }

      this.renderSavedBlocks(todayList, blocks);
    });

  }

  private setDraftCompactLayout(
    draftRoot: HTMLElement | null,
    compact: boolean
  ): void {
    if (!draftRoot) return;

    const draftContent: HTMLElement | null =
      draftRoot.querySelector(".fl-notes-draft-item");

    const editor: HTMLTextAreaElement | null =
      draftRoot.querySelector(".fl-notes-draft-textarea");

    if (compact) {
      // MODO COMPACTO - Para sesión "Hoy"
      Object.assign(draftRoot.style, {
        flex: "0 0 80px",
        height: "80px",
        minHeight: "80px",
        maxHeight: "80px",
        boxSizing: "border-box"
      });

      if (draftContent) {
        Object.assign(draftContent.style, {
          height: "80px",
          minHeight: "80px",
          maxHeight: "80px",
          boxSizing: "border-box",
          overflow: "hidden"
        });
      }

      if (editor) {
        Object.assign(editor.style, {
          height: "80px",
          minHeight: "80px",
          maxHeight: "80px",
          overflowY: "auto",
          boxSizing: "border-box"
        });
      }
    } else {
      // MODO NORMAL - Para sesión "Entrada"
      // Eliminar TODAS las restricciones de altura
      Object.assign(draftRoot.style, {
        flex: "1 1 0",
        height: "auto",
        minHeight: "0",
        maxHeight: "none",
        boxSizing: "border-box"
      });

      if (draftContent) {
        Object.assign(draftContent.style, {
          flex: "1 1 auto",
          height: "auto",
          minHeight: "0",
          maxHeight: "none",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box"
        });
      }

      if (editor) {
        Object.assign(editor.style, {
          height: "100%",
          minHeight: "0",
          maxHeight: "none",
          overflowY: "auto",
          boxSizing: "border-box",
          resize: "none",
          flex: "1 1 auto"
        });
      }
    }
  }

  private async saveDraftFromToolbar(): Promise<void> {
    if (!this.currentFile || this.isSavingDraft) return;

    const text = this.draftText;

    // Nunca guardar entradas vacías.
    if (!text.trim()) return;

    /*
     * Pulsaciones repetidas: mientras la persistencia está en
     * vuelo no se crea un segundo bloque con el mismo texto.
     */
    this.isSavingDraft = true;

    /*
     * Modo de captura activo:
     * - sin destino → guardado normal en Apuntes.
     * - con destino → envío a la instancia seleccionada; el
     *   bloque NO se copia en Apuntes.
     */
    const sending = this.captureTargetInstanceId !== null;

    try {
      if (this.captureTargetInstanceId) {
        await this.sendBlockToInstance(
          this.captureTargetInstanceId,
          text
        );
      } else {
        /*
         * Guardado estricto (espejo + bóveda): si falla, el
         * texto permanece en el área de escritura y se comunica
         * el error. No se limpia el campo hasta confirmar la
         * persistencia.
         */
        await this.appendBlock(text);
      }
    } catch (error) {
      console.error(
        "[NotesWidget] Error guardando apunte:",
        error
      );

      new Notice(
        i18n.t('widgets.notesWidget.notice.saveFailed')
      );

      return;
    } finally {
      this.isSavingDraft = false;
    }

    /*
     * El texto ya pasó a formar parte de los fragmentos.
     * Solo se limpia —en memoria y en el draft persistido
     * (espejo + bóveda)— si el usuario no siguió escribiendo
     * mientras se confirmaba el guardado o el envío.
     */
    if (this.draftText === text) {
      this.draftText = "";

      const editor = this.container?.querySelector(
        ".fl-notes-capture-editor"
      ) as HTMLTextAreaElement | null;

      if (editor) {
        editor.value = "";
      }

      if (this.draftStorageKey) {
        void this.mirrorWrite("focus-notes-draft", null);
      }
      this.persistDraftPatch({ draft: "" });
    }

    // Actualizar inmediatamente la visibilidad de Guardar.
    this.updateSaveActionVisibility();

    new Notice(
      sending
        ? i18n.t('widgets.notesWidget.notice.sent')
        : i18n.t('widgets.notesWidget.notice.saved')
    );

    /*
     * El destino NO vuelve a Hoy automáticamente: el modo de
     * captura se mantiene hasta que el usuario lo cambie.
     * La lista solo se refresca si el bloque se guardó en
     * Apuntes.
     */
    if (!sending && this.sessionView === "today") {
      await this.refreshBlocks();
    }
  }

  /**
   * Las fronteras de bloque se almacenan separadamente del texto.
   * Por eso un bloque puede contener cualquier cantidad de saltos
   * de línea sin convertirse en varios bloques.
   */
  private async loadBlocks(): Promise<NoteBlock[]> {
    if (!this.currentFile) return [];

    try {
      const serialized = await this.mirrorRead("focus-notes-blocks");

      if (serialized) {
        /*
         * 3E-2 (W4): datos externos de localStorage tipados como
         * unknown; la validación de forma es la misma que la
         * anterior, ahora explícita (object + text/active).
         */
        const parsed: unknown = JSON.parse(serialized);

        if (Array.isArray(parsed)) {
          const items: unknown[] = parsed;

          // Formato actual: [{ text, active }]
          const validBlocks = items.filter(
            (value): value is NoteBlock =>
              !!value &&
              typeof value === 'object' &&
              typeof (value as { text?: unknown }).text === 'string' &&
              typeof (value as { active?: unknown }).active === 'boolean'
          );

          if (validBlocks.length === items.length) {
            return validBlocks;
          }

          // Migración del formato anterior string[].
          const texts = items.filter(
            (value): value is string => typeof value === 'string'
          );

          if (texts.length === items.length) {
            const migrated: NoteBlock[] = texts.map(
              (text, index) => ({
                text,
                // Solo el último bloque queda activo al migrar.
                active: index === texts.length - 1
              })
            );

            await this.saveBlocks(migrated);
            return migrated;
          }
        }
      }

      // Migración desde la representación textual anterior.
      // Todo el contenido existente se considera UN bloque.
      const source = await this.readNotesSource();

      if (!source.trim()) return [];

      const blocks: NoteBlock[] = [{
        text: source,
        active: true
      }];

      await this.saveBlocks(blocks);

      return blocks;
    } catch (error) {
      console.warn(
        "[NotesWidget] Error cargando bloques:",
        error
      );
      return [];
    }
  }

  private renderSavedBlocks(
    listElement: HTMLElement,
    blocks: NoteBlock[]
  ): void {
    // Los bloques más recientes aparecen primero, inmediatamente debajo
    // de la entrada. Conservamos el índice original para persistencia.
    const orderedBlocks = sortPriorityFirst(
      blocks
        .map((block, index) => ({ block, index }))
        .reverse(),
      item => item.block.active
    );

    for (const { block, index } of orderedBlocks) {
      const item = new FocusListItem(listElement, {
        state: block.active ? "active" : "inactive",

        primaryAction: {
          id: "toggle",
          label: block.active
            ? i18n.t('widgets.notesWidget.action.deactivate')
            : i18n.t('widgets.notesWidget.action.activate'),
          onClick: () => {
            const nextActive = !block.active;

            // Actualización inmediata del modelo en memoria.
            block.active = nextActive;

            // FocusListItem mantiene el botón/indicador.
            // Solo actualizamos las clases del elemento existente.
            content.toggleClass(
              "is-inactive",
              !nextActive
            );

            content.toggleClass(
              "is-active",
              nextActive
            );

            const root = content.parentElement;

            root?.toggleClass(
              "is-inactive",
              !nextActive
            );

            root?.toggleClass(
              "is-active",
              nextActive
            );

            const indicator =
              root?.querySelector(
                ".fl-focus-list-item-action-indicator"
              ) as HTMLElement | null;

            indicator?.toggleClass(
              "is-active",
              nextActive
            );

            // Persistimos sin reconstruir el widget.
            // L3b: el callback devuelve void; los errores del
            // guardado se registran.
            void (async () => {
              await this.saveBlocks(
                await this.loadBlocks().then(blocks => {
                  if (index >= 0 && index < blocks.length) {
                    blocks[index].active = nextActive;
                  }
                  return blocks;
                })
              );
            })().catch((error) => {
              console.error(
                "[FolderLab] Error guardando bloques:",
                error
              );
            });
          }
        },

        deleteAction: {
          id: "delete",
          label: i18n.t('widgets.notesWidget.action.delete'),
          onClick: () => {
            void this.deleteBlock(index).catch((error) => {
              console.error(
                "[FolderLab] Error eliminando bloque:",
                error
              );
            });
          }
        }
      });

      const content = item.getContentElement();
      content.addClass("fl-notes-item-content");

      /*
       * Último texto confirmado en persistencia. Se usa para
       * evitar escrituras duplicadas entre el guardado en vivo
       * (input/blur) y el guardado al cerrar la vista ampliada.
       */
      let lastSavedText = block.text;

      const persistLiveEdit = (textToSave: string): void => {
        if (textToSave === lastSavedText) return;

        void this.updateSavedBlock(index, textToSave)
          .then(() => {
            lastSavedText = textToSave;
          })
          .catch((error) => {
            console.error(
              "[FolderLab] Error guardando bloque:",
              error
            );
          });
      };

      const expandable = createExpandableText(
        content,
        block.text,
        {
          initiallyExpanded: false,
          previewLines: 3,
          collapsedLabel: i18n.t('widgets.common.expand'),
          expandedLabel: i18n.t('widgets.common.collapse'),
          editable: true,
          expandedEditing: true,
          saveExpandedEdit: async (textToSave) => {
            if (textToSave === lastSavedText) return;

            /*
             * Guardado estricto del cierre: si falla, la vista
             * ampliada permanece abierta y el error se propaga
             * para que no se pierdan cambios en silencio.
             */
            await this.persistExpandedBlockEdit(
              index,
              textToSave
            );

            lastSavedText = textToSave;
          },
          rootClass: "fl-notes-expandable",
          contentClass: "fl-notes-expandable-content",
          actionClass: "fl-notes-expandable-action",
              onExpandedChange: (expanded) => {
            item.setExpanded(expanded);
    }
        }

        
      );

      
      const dragDrop =
        FolderLabDragDrop.getInstance(this.app);

      const cleanupDrag =
        dragDrop
          .registerTextDragSource(
            content,
            () => expandable.content.innerText,
            (active) => {
              content.toggleClass(
                "fl-dnd-drag-active",
                active
              );

              /*
               * Declara la procedencia del arrastre para el Board.
               * El payload JSON no cambia: el drop en otros widgets
               * sigue siendo una copia sin borrar el origen.
               */
              if (active) {
                dragDrop.setActiveDragSource({
                  widgetId: "notes",
                  instanceId: "notes",
                  itemId: String(index),
                  sessionId: "today"
                });
              } else {
                dragDrop.clearActiveDragSource();
              }
            }
          );

      this.dragCleanups.push(cleanupDrag);

      expandable.content.addEventListener("click", () => {
        if (!expandable.expanded()) return;

        window.requestAnimationFrame(() => {
          this.alignBlockToViewport(
            content,
            listElement
          );
        });
      });

      expandable.content.addEventListener("input", () => {
        persistLiveEdit(expandable.content.innerText);
      });
      

      expandable.content.addEventListener("blur", () => {
        persistLiveEdit(expandable.content.innerText);
      });
    }
  }

  /**
   * Lleva el borde superior del bloque expandido al borde superior
   * visible del scroll viewport del widget.
   */
  private alignBlockToViewport(
    blockContent: HTMLElement,
    listElement: HTMLElement
  ): void {
    const scrollSurface: HTMLElement | null =
      listElement.closest(".fl-notes-scroll-surface");

    if (!scrollSurface) return;

    const blockRoot: HTMLElement | null =
      blockContent.closest(".fl-notes-item-content");

    const target =
      blockRoot?.parentElement ?? blockContent;

    const viewportRect =
      scrollSurface.getBoundingClientRect();

    const targetRect =
      target.getBoundingClientRect();

    const delta =
      targetRect.top - viewportRect.top;

    scrollSurface.scrollTop += delta;
  }

  /**
   * FIRMA ESPECIAL DE APUNTES:
   *
   * Este bloque siempre existe mientras el widget tenga una nota
   * activa. Es expandido, editable y NO tiene "Contraer".
   *
   * Enter = salto de línea normal.
   * Scroll/wheel = confirma el contenido como un bloque y crea
   * inmediatamente un nuevo bloque de entrada.
   */

  private async appendBlock(text: string): Promise<void> {
    const blocks = await this.loadBlocks();

    // Comportamiento particular de Apuntes:
    // solo el último apunte agregado permanece activo.
    for (const block of blocks) {
      block.active = false;
    }

    blocks.push({
      text,
      active: true
    });

    // Guardado estricto: los errores se propagan al llamador
    // (toolbar y drop) para no comunicar un éxito falso.
    await this.saveBlocksStrict(blocks);
  }

  private async updateSavedBlock(
    index: number,
    text: string
  ): Promise<void> {
    const blocks = await this.loadBlocks();

    if (index < 0 || index >= blocks.length) return;

    blocks[index].text = text;
    await this.saveBlocks(blocks);
  }

  /**
   * Guardado del texto de un bloque para la vista de edición
   * ampliada. A diferencia de `updateSavedBlock`, propaga los
   * errores para que el cierre no descarte cambios en silencio.
   *
   * Reutiliza el mismo mecanismo de persistencia de los bloques
   * (espejo local + DraftStore en bóveda); no introduce ningún
   * almacenamiento paralelo.
   */
  private async persistExpandedBlockEdit(
    index: number,
    text: string
  ): Promise<void> {
    const blocks = await this.loadBlocks();

    if (index < 0 || index >= blocks.length) {
      throw new Error(
        `[NotesWidget] Índice de bloque fuera de rango: ${index}`
      );
    }

    blocks[index].text = text;
    await this.saveBlocksStrict(blocks);
  }

  private async toggleBlockActive(index: number): Promise<void> {
    const blocks = await this.loadBlocks();

    if (index < 0 || index >= blocks.length) return;

    const block = blocks[index];
    block.active = !block.active;

    /*
     * IMPORTANTE:
     * No hacemos refreshBlocks() aquí.
     *
     * El FocusListItem ya está vivo y su callback ya tiene acceso
     * al DOM del bloque. Cambiamos solamente las clases necesarias
     * y persistimos el nuevo estado.
     */
    await this.saveBlocks(blocks);
  }

  private async deleteBlock(index: number): Promise<void> {
    const blocks = await this.loadBlocks();

    if (index < 0 || index >= blocks.length) return;

    blocks.splice(index, 1);

    await this.saveBlocks(blocks);
    await this.refreshBlocks();
  }

  private async saveBlocks(
    blocks: NoteBlock[]
  ): Promise<void> {
    try {
      await this.saveBlocksStrict(blocks);
    } catch (error) {
      console.warn(
        "[NotesWidget] Error guardando bloques:",
        error
      );
    }
  }

  /**
   * Núcleo de persistencia de bloques con errores propagados.
   *
   * La representación textual sigue siendo fiel al contenido.
   * El estado active se conserva en blocksStorageKey.
   * Etapa 2: además del espejo local, persistir en bóveda.
   */
  private async saveBlocksStrict(
    blocks: NoteBlock[]
  ): Promise<void> {
    if (!this.currentFile) return;

    await this.mirrorWrite(
      "focus-notes-blocks",
      JSON.stringify(blocks)
    );

    await this.mirrorWrite(
      "focus-notes",
      blocks.map(block => block.text).join("\n\n")
    );

    const plugin = (this.app as unknown as {
      plugins?: { plugins?: Record<string, FolderLabPlugin | undefined> };
    }).plugins?.plugins?.["folder-lab"];

    if (plugin?.draftStore) {
      await plugin.draftStore.write(this.currentFile.path, {
        blocks
      });
    }
  }



  private async readNotesSource(): Promise<string> {
    if (!this.currentFile) return "";

    try {
      const saved = await this.mirrorRead("focus-notes");

      if (saved !== null) return saved;

      const notesFilePath =
        this.currentFile.path.replace(
          /\.md$/,
          ".notes.md"
        );

      const abstractFile =
        this.app.vault.getAbstractFileByPath(notesFilePath);
      const file = abstractFile instanceof TFile ? abstractFile : null;

      if (!file) return "";

      return await this.app.vault.read(file);
    } catch (error) {
      console.warn(
        "[NotesWidget] Error leyendo apuntes:",
        error
      );
      return "";
    }
  }

  private async refreshBlocks(): Promise<void> {
    if (!this.container || !this.currentFile || !this.lastContext) return;

    this.render(
      this.container,
      this.lastContext
    );
  }

  private cleanupInteractions(): void {
    this.dropCleanup?.();
    this.dropCleanup = null;

    // NO limpiar pendingScrollTop aquí.
    // renderContent() llama cleanupInteractions() durante un refresh;
    // si lo borramos aquí, se pierde la posición que toggleBlockActive()
    // acaba de guardar antes de reconstruir el DOM.

    for (const cleanup of this.dragCleanups) {
      cleanup();
    }

    this.dragCleanups = [];

  }

  // ============================================================
  // PERSISTENCIA
  // ============================================================

  private debounceSave(): void {
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = window.setTimeout(() => {
      void this.save();
    }, 500);
  }

  async load(): Promise<void> {
    if (!this.textarea || !this.currentFile) {
      return;
    }

    try {
      const saved = await this.mirrorRead("focus-notes");

      if (saved) {
        this.textarea.value = saved;
      } else {
        const notesFilePath =
          this.currentFile.path.replace(
            /\.md$/,
            ".notes.md"
          );

        const abstractFile =
          this.app.vault.getAbstractFileByPath(notesFilePath);
        const file = abstractFile instanceof TFile ? abstractFile : null;

        if (file) {
          const content =
            await this.app.vault.read(file);

          this.textarea.value = content;

          await this.mirrorWrite("focus-notes", content);
        }
      }
    } catch (error) {
      console.warn(
        "Error cargando apuntes:",
        error
      );
    }
  }

  async save(): Promise<void> {
    if (!this.textarea || !this.currentFile) {
      return;
    }

    try {
      const content = this.textarea.value;

      await this.mirrorWrite("focus-notes", content);
    } catch (error) {
      console.warn(
        "Error guardando apuntes:",
        error
      );
    }
  }
}

// ============================================================
// FACTORY
// ============================================================

export class NotesWidgetFactory
  implements FocusWidgetFactory {

  readonly widgetId = "notes";

  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  create(): FocusWidget {
    return new NotesWidget(this.app);
  }
}
