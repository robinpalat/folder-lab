import {
  FocusWidget,
  FocusWidgetFactory,
  WidgetCallbacks
} from "../FocusWidget";

import { FocusContext } from "../FocusContext";
import { Notice, TFile } from "obsidian";

import { FocusListItem } from "../FocusListItem";
import {
  FolderLabDragDrop,
  createExpandableText,
  sortPriorityFirst
} from "../FocusWidgetsUtils";

import { WidgetControls } from "./tools/WidgetControls";
import { WidgetControlsRenderer } from "./tools/WidgetControlsRenderer";

interface NoteBlock {
  text: string;
  active: boolean;
}

export class NotesWidget implements FocusWidget {
  readonly id = "notes";
  readonly label = "Apuntes";
  readonly icon = "pencil";

  private container: HTMLElement | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private currentFile: TFile | null = null;
  private saveTimeout: number | null = null;

  private app: any;
  private blocksStorageKey: string = "";

  private dropCleanup: (() => void) | null = null;

  private dragCleanups: Array<() => void> = [];
  private draftText: string = "";

  private storageKey: string = "";
  private draftStorageKey: string = "";

  private position: "top" | "bottom" = "top";
  private sessionView: "capture" | "today" = "capture";

  private callbacks: WidgetCallbacks = {};

  constructor(app: any) {
    this.app = app;
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
    this.currentFile = context.activeFile;

    this.storageKey = this.currentFile
      ? `focus-notes-${this.currentFile.path}`
      : "";

    this.draftStorageKey = this.currentFile
      ? `focus-notes-draft-${this.currentFile.path}`
      : "";

    this.blocksStorageKey = this.currentFile
      ? `focus-notes-blocks-${this.currentFile.path}`
      : "";

    this.container.empty();
    this.container.addClass("fl-widget-notes");

    // El FocusSplitter ya gobierna la altura del frame.
    // Esta cadena hace que el contenido interno herede esa altura.
    Object.assign(this.container.style, {
      height: "100%",
      minHeight: "0",
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box"
    });

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

    this.save();
    this.sessionView = "capture";


    this.currentFile = newFile;

    this.storageKey = this.currentFile
      ? `focus-notes-${this.currentFile.path}`
      : "";

    this.blocksStorageKey = this.currentFile
      ? `focus-notes-blocks-${this.currentFile.path}`
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

    this.save();

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
    // SESIÓN
    // ----------------------------------------------------------

    controls.select({
      id: "session",
      label: "Sesión",
      value: "today",
      options: [
        {
          id: "today",
          label: "Hoy"
        }
      ]
    });

    // ----------------------------------------------------------
    // COPIAR APUNTES
    // ----------------------------------------------------------

    controls.action({
      id: "save",
      label: "Guardar"
    });

    controls.iconAction({
      id: "copy",
      icon: "copy",
      tooltip: "Copiar apuntes"
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

        onSourceSelect: (sourceId) => {

          this.callbacks.onSourceSelect?.();
        },

        onControlSelect: (controlId, option) => {
          if (controlId !== "session") return;

          if (option.id === "today") {
            void this.save();
            this.sessionView = "today";
          }
          if (this.container) {
            this.render(this.container, {
              activeFile: this.currentFile
            } as FocusContext);
          }
        },

        onAction: (controlId) => {
          if (controlId === "save") {
            void this.saveDraftFromToolbar();
            return;
          }

          if (controlId === "copy") {
            this.copyNotes();
            return;
          }
        }
      }
    );

    // Usar setTimeout o requestAnimationFrame para asegurar que el DOM se ha renderizado
    setTimeout(() => {
      this.updateSaveActionVisibility();
    }, 0);
  }

  private updateSaveActionVisibility(): void {
    if (!this.container) return;

    const hasText = this.draftText.trim().length > 0;

    // Buscar el botón por su texto o por cualquier identificador único
    const buttons = this.container.querySelectorAll("button");

    buttons.forEach((button) => {
      // Buscar el botón que tiene "Guardar" como texto
      // o que tiene el control-id en sus atributos
      const buttonText = button.textContent?.trim();
      const controlId = button.getAttribute('data-control-id');

      if (buttonText === "Guardar" || controlId === "save") {
        button.style.display = hasText ? "" : "none";
      }
    });
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

    todayPanel.style.display = "none";
    capturePanel.style.display = "flex";

    const editor = capturePanel.querySelector(
      ".fl-notes-capture-editor"
    ) as HTMLTextAreaElement | null;

    if (editor) {
      requestAnimationFrame(() => {
        editor.focus({ preventScroll: true });
      });
    }
  }

  // ============================================================
  // CONTENIDO — BLOQUES + BORRADOR PERMANENTE
  // ============================================================

  private renderContent(): void {
    if (!this.container) return;

    const contentWrapper = this.container.createEl("div", {
      cls: "fl-widget-content-expanded fl-notes-scroll-surface"
    });

    // Este es el ÚNICO propietario del scroll del widget.
    // La sesión no decide si existe scrollbar: el navegador lo determina
    // según el tamaño real del contenido.
    Object.assign(contentWrapper.style, {
      flex: "1 1 0",
      minHeight: "0",
      height: "0",
      overflow: "hidden",
      overscrollBehavior: "contain",
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box"
    });

    if (!this.currentFile) {
      contentWrapper.createEl("div", {
        cls: "fl-widget-content-empty",
        text: "Abre una nota para escribir apuntes"
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

    const capturePanel = contentWrapper.createEl("div", {
      cls: "fl-notes-capture-panel"
    });

    Object.assign(capturePanel.style, {
      flex: "1 1 0",
      minHeight: "0",
      width: "100%",
      display: this.sessionView === "capture" ? "flex" : "none",
      flexDirection: "column",
      overflow: "hidden",
      boxSizing: "border-box",
      paddingRight: "12px"
    });

    const todayPanel = contentWrapper.createEl("div", {
      cls: "fl-notes-today-panel"
    });

    Object.assign(todayPanel.style, {
      flex: "1 1 0",
      minHeight: "0",
      width: "100%",
      display: this.sessionView === "today" ? "flex" : "none",
      flexDirection: "column",
      overflowY: "auto",
      overflowX: "hidden",
      boxSizing: "border-box",
      paddingRight: "12px"
    });



    const draftProxy = todayPanel.createEl("div", {
      cls: "fl-notes-draft-proxy"
    });

    Object.assign(draftProxy.style, {
      flex: "0 0 80px",
      height: "80px",
      minHeight: "80px",
      maxHeight: "80px",
      width: "100%",
      boxSizing: "border-box",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      cursor: "text"
    });



    const draftProxyText = draftProxy.createEl("div", {
      cls: "fl-notes-draft-proxy-text"
    });

    const draftText = this.draftText.trim();

    draftProxyText.setText(
      draftText.length > 0
        ? draftText
        : "Escribe tus apuntes..."
    );

    if (!draftText.length) {
      draftProxyText.addClass("fl-notes-draft-proxy-placeholder");
    }

    Object.assign(draftProxyText.style, {
      flex: "1 1 auto",
      minHeight: "0",
      width: "100%",
      padding: "8px 10px",
      boxSizing: "border-box",
      overflow: "hidden",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      cursor: "text"
    });

    draftProxy.addEventListener("click", () => {
      this.enterCaptureView();
    });



    const todayList = todayPanel.createEl("div", {
      cls: "fl-notes-today-list"
    });

    Object.assign(todayList.style, {
      flex: "0 1 auto",
      minHeight: "0",
      width: "100%",
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box"
    });


    const captureEditor = capturePanel.createEl("textarea", {
      cls: "fl-widget-textarea fl-notes-draft-editor fl-notes-capture-editor",
      attr: {
        placeholder: "Escribe tus apuntes..."
      }
    });


    Object.assign(captureEditor.style, {
      flex: "1 1 0",
      width: "100%",
      height: "100%",
      minHeight: "0",
      maxHeight: "none",
      boxSizing: "border-box",
      resize: "none",
      overflowY: "auto",
      overflowX: "hidden"
    });

    // El estado visual del editor es la fuente de verdad.
    // Si no hay contenido actual, no debe existir un draft persistido.
    if (
      !this.draftText.trim() &&
      this.draftStorageKey
    ) {
      localStorage.removeItem(this.draftStorageKey);
    }

    captureEditor.value = this.draftText;

    captureEditor.addEventListener("input", () => {
      this.draftText = captureEditor.value;

      if (this.draftStorageKey) {
        if (this.draftText.trim()) {
          localStorage.setItem(
            this.draftStorageKey,
            this.draftText
          );
        } else {
          localStorage.removeItem(
            this.draftStorageKey
          );
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
        new Notice("Apunte creado");
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

    const draftContent = draftRoot.querySelector(
      ".fl-notes-draft-item"
    ) as HTMLElement | null;

    const editor = draftRoot.querySelector(
      ".fl-notes-draft-textarea"
    ) as HTMLTextAreaElement | null;

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
    if (!this.currentFile) return;

    const text = this.draftText;

    if (!text.trim()) return;

    await this.appendBlock(text);

    // El texto ya pasó a formar parte de los fragmentos.
    this.draftText = "";
    if (this.draftStorageKey) {
      localStorage.removeItem(this.draftStorageKey);
    }

    // Limpiar el editor real.
    const editor = this.container?.querySelector(
      ".fl-notes-capture-editor"
    ) as HTMLTextAreaElement | null;

    if (editor) {
      editor.value = "";
    }

    // Actualizar inmediatamente la visibilidad de Guardar.
    this.updateSaveActionVisibility();

    new Notice("Apunte guardado");

    // Refrescar solamente la vista de Hoy si estamos allí.
    if (this.sessionView === "today") {
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
      const serialized =
        localStorage.getItem(this.blocksStorageKey);

      if (serialized) {
        const parsed = JSON.parse(serialized);

        if (Array.isArray(parsed)) {
          // Formato actual: [{ text, active }]
          if (
            parsed.every(
              value =>
                value &&
                typeof value.text === "string" &&
                typeof value.active === "boolean"
            )
          ) {
            return parsed as NoteBlock[];
          }

          // Migración del formato anterior string[].
          if (
            parsed.every(
              value => typeof value === "string"
            )
          ) {
            const migrated: NoteBlock[] = parsed.map(
              (text, index) => ({
                text,
                // Solo el último bloque queda activo al migrar.
                active: index === parsed.length - 1
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
            ? "Desactivar apunte"
            : "Activar apunte",
          onClick: async () => {
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
            await this.saveBlocks(
              await this.loadBlocks().then(blocks => {
                if (index >= 0 && index < blocks.length) {
                  blocks[index].active = nextActive;
                }
                return blocks;
              })
            );
          }
        },

        deleteAction: {
          id: "delete",
          label: "Eliminar apunte",
          onClick: async () => {
            await this.deleteBlock(index);
          }
        }
      });

      const content = item.getContentElement();
      content.addClass("fl-notes-item-content");

      const expandable = createExpandableText(
        content,
        block.text,
        {
          initiallyExpanded: false,
          previewLines: 3,
          collapsedLabel: "Expandir",
          expandedLabel: "Contraer",
          editable: true,
          rootClass: "fl-notes-expandable",
          contentClass: "fl-notes-expandable-content",
          actionClass: "fl-notes-expandable-action",
              onExpandedChange: (expanded) => {
      console.log('[NotesWidget] onExpandedChange', expanded, 'item=', item);
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

        requestAnimationFrame(() => {
          this.alignBlockToViewport(
            content,
            listElement
          );
        });
      });

      expandable.content.addEventListener("input", () => {
        void this.updateSavedBlock(
          index,
          expandable.content.innerText
        );
      });
      

      expandable.content.addEventListener("blur", () => {
        void this.updateSavedBlock(
          index,
          expandable.content.innerText
        );
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
    const scrollSurface =
      listElement.closest(
        ".fl-notes-scroll-surface"
      ) as HTMLElement | null;

    if (!scrollSurface) return;

    const blockRoot =
      blockContent.closest(
        ".fl-notes-item-content"
      ) as HTMLElement | null;

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

    await this.saveBlocks(blocks);
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
    if (!this.currentFile) return;

    try {
      localStorage.setItem(
        this.blocksStorageKey,
        JSON.stringify(blocks)
      );

      // La representación textual sigue siendo fiel al contenido.
      // El estado active se conserva en blocksStorageKey.
      localStorage.setItem(
        this.storageKey,
        blocks.map(block => block.text).join("\n\n")
      );
    } catch (error) {
      console.warn(
        "[NotesWidget] Error guardando bloques:",
        error
      );
    }
  }



  private async readNotesSource(): Promise<string> {
    if (!this.currentFile) return "";

    try {
      const saved =
        localStorage.getItem(this.storageKey);

      if (saved !== null) return saved;

      const notesFilePath =
        this.currentFile.path.replace(
          /\.md$/,
          ".notes.md"
        );

      const file =
        this.app.vault.getFileByPath(notesFilePath);

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
    if (!this.container || !this.currentFile) return;

    this.render(
      this.container,
      {
        activeFile: this.currentFile
      } as FocusContext
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

  private async copyNotes(): Promise<void> {
    const text = await this.readNotesSource();

    if (!text.trim()) return;

    try {
      await navigator.clipboard.writeText(text);

    } catch (error) {
      console.warn(
        "[NotesWidget] Error copiando apuntes:",
        error
      );
    }
  }

  // ============================================================
  // PERSISTENCIA
  // ============================================================

  private debounceSave(): void {
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = window.setTimeout(() => {
      this.save();
    }, 500);
  }

  async load(): Promise<void> {
    if (!this.textarea || !this.currentFile) {
      return;
    }

    try {
      const saved = localStorage.getItem(this.storageKey);

      if (saved) {
        this.textarea.value = saved;
      } else {
        const notesFilePath =
          this.currentFile.path.replace(
            /\.md$/,
            ".notes.md"
          );

        const file =
          this.app.vault.getFileByPath(notesFilePath);

        if (file) {
          const content =
            await this.app.vault.read(file);

          this.textarea.value = content;

          localStorage.setItem(
            this.storageKey,
            content
          );
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

      localStorage.setItem(
        this.storageKey,
        content
      );
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

  private app: any;

  constructor(app: any) {
    this.app = app;
  }

  create(): FocusWidget {
    return new NotesWidget(this.app);
  }
}
