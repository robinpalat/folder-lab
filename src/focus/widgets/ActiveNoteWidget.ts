import { App, EventRef, Notice, TFile } from "obsidian";
import { i18n } from '../../i18n/I18nService';

import {
  FocusWidget,
  FocusWidgetFactory,
  WidgetCallbacks
} from "../FocusWidget";
import { FocusContext } from "../FocusContext";
import { WidgetControls } from "./tools/WidgetControls";
import { WidgetControlsRenderer } from "./tools/WidgetControlsRenderer";

/**
 * Editor liviano para la nota Markdown que está activa en Obsidian.
 *
 * No intenta montar el editor interno de Obsidian: edita el mismo archivo
 * mediante el vault y guarda los cambios tras una pausa breve al escribir.
 *
 * Contrato de guardado (P0-2):
 * - Solo escribe si ha habido cambios locales (`dirty`). Cerrar el
 *   widget sin editar nunca toca la nota.
 * - Antes de escribir compara el disco con el contenido base del
 *   buffer. Si difiere (cambio externo), NO sobrescribe de forma
 *   silenciosa: avisa una vez y retiene el buffer local.
 * - La versión del widget solo se impone tras una edición local
 *   POSTERIOR al aviso (el usuario confirma que quiere su versión).
 *   Sin esa edición posterior, el contenido del disco se conserva.
 * - Con el buffer limpio, un cambio externo recarga el buffer.
 */
export class ActiveNoteWidget implements FocusWidget {
  readonly id = "active-note";
  get label(): string {
    return i18n.t('widgets.activeNote.label');
  }
  readonly icon = "file-pen-line";

  private container: HTMLElement | null = null;
  private editor: HTMLTextAreaElement | null = null;
  private currentFile: TFile | null = null;
  private saveTimer: number | null = null;
  private callbacks: WidgetCallbacks = {};
  private position: "top" | "bottom" = "top";

  /** Contenido con el que el buffer quedó sincronizado (disco o guardado). */
  private baseContent = "";
  /** Ha habido input local desde la última sincronización. */
  private dirty = false;
  /** El disco cambió desde `baseContent` (evento externo o comparación en save). */
  private externalModified = false;
  /** El usuario siguió editando DESPUÉS de detectar el cambio externo. */
  private localEditAfterExternal = false;
  /** El aviso de conflicto ya se mostró (una sola vez por conflicto). */
  private conflictWarned = false;
  private modifyRef: EventRef | null = null;

  constructor(private app: App) {}

  setCallbacks(callbacks: WidgetCallbacks): void {
    this.callbacks = callbacks;
  }

  setPosition(position: "top" | "bottom"): void {
    this.position = position;
  }

  render(container: HTMLElement, context: FocusContext): void {
    this.clearModifyListener();

    this.container = container;
    this.currentFile = context.activeFile;
    this.container.empty();
    this.container.addClass("fl-widget-active-note");

    if (!this.currentFile || this.currentFile.extension !== "md") {
      if (this.position === "top") {
        this.renderControls();
        this.renderEmpty();
      } else {
        this.renderEmpty();
        this.renderControls();
      }
      return;
    }

    if (this.position === "top") {
      this.renderControls();
      this.renderEditor();
    } else {
      this.renderEditor();
      this.renderControls();
    }

    this.registerModifyListener();
    void this.loadFile();
  }

  update(context: FocusContext): void {
    if (context.activeFile === this.currentFile) return;

    void this.save();
    if (this.container) {
      this.render(this.container, context);
    }
  }

  destroy(): void {
    this.clearModifyListener();

    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // save() es un guard condicional (dirty + política de
    // conflicto): cerrar el panel no sobrescribe la nota.
    void this.save();
    this.container?.empty();
    this.container = null;
    this.editor = null;
    this.currentFile = null;
  }

  private renderControls(): void {
    if (!this.container) return;

    const controls = new WidgetControls();
    controls.setWidget({
      id: this.id,
      label: this.label,
      icon: this.icon,
      options: []
    });

    WidgetControlsRenderer.render(this.container, controls.getConfig(), {
      onWidgetSelect: () => this.callbacks.onWidgetSelect?.()
    });
  }

  private renderEditor(): void {
    if (!this.container || !this.currentFile) return;

    const content = this.container.createEl("div", {
      cls: "fl-active-note-content"
    });

    this.editor = content.createEl("textarea", {
      cls: "fl-active-note-editor",
      attr: {
        "aria-label": i18n.t('widgets.activeNote.editorAria', { name: this.currentFile.basename }),
        spellcheck: "true"
      }
    });
    this.editor.placeholder = i18n.t('widgets.activeNote.placeholder');
    this.editor.addEventListener("input", () => {
      this.dirty = true;
      if (this.externalModified) {
        // Edición local tras el cambio externo: confirma la
        // intención de imponer la versión del widget.
        this.localEditAfterExternal = true;
      }
      this.scheduleSave();
    });
  }

  private renderEmpty(): void {
    this.container?.createEl("div", {
      cls: "fl-widget-content-empty",
      text: i18n.t('widgets.activeNote.empty.noteRequired')
    });
  }

  /**
   * Observa cambios EXTERNOS de la nota actual. Con el buffer
   * limpio se recarga desde disco; con el buffer sucio solo se
   * marca la detección: la decisión de escribir (y el aviso)
   * ocurre en save().
   */
  private registerModifyListener(): void {
    const file = this.currentFile;
    if (!file) return;

    this.modifyRef = this.app.vault.on("modify", (modified) => {
      if (!modified || (modified as { path?: string }).path !== file.path) {
        return;
      }
      if (!this.dirty) {
        void this.reloadFromDisk();
      } else {
        this.externalModified = true;
      }
    });
  }

  private clearModifyListener(): void {
    if (this.modifyRef !== null) {
      this.app.vault.offref(this.modifyRef);
      this.modifyRef = null;
    }
  }

  /** Sincroniza el buffer con el disco cuando no hay cambios locales. */
  private async reloadFromDisk(): Promise<void> {
    const file = this.currentFile;
    const editor = this.editor;
    if (!file || !editor) return;

    try {
      const content = await this.app.vault.read(file);
      if (this.currentFile === file && this.editor === editor && !this.dirty) {
        editor.value = content;
        this.baseContent = content;
        this.resetConflictState();
      }
    } catch (error) {
      console.error("[ActiveNoteWidget] No se pudo recargar la nota:", error);
    }
  }

  private async loadFile(): Promise<void> {
    const file = this.currentFile;
    const editor = this.editor;
    if (!file || !editor) return;

    try {
      const content = await this.app.vault.read(file);
      if (this.currentFile === file && this.editor === editor) {
        editor.value = content;
        this.baseContent = content;
        this.dirty = false;
        this.resetConflictState();
      }
    } catch (error) {
      console.error("[ActiveNoteWidget] No se pudo leer la nota:", error);
    }
  }

  private resetConflictState(): void {
    this.externalModified = false;
    this.localEditAfterExternal = false;
    this.conflictWarned = false;
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }

    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, 400);
  }

  async save(): Promise<void> {
    const file = this.currentFile;
    const editor = this.editor;
    if (!file || !editor || file.extension !== "md") return;

    // P0-2: sin cambios locales no se escribe nada. Cerrar el
    // widget sin editar nunca sobrescribe la nota.
    if (!this.dirty) return;

    try {
      const diskContent = await this.app.vault.read(file);

      if (diskContent !== this.baseContent) {
        this.externalModified = true;

        if (!this.conflictWarned) {
          this.conflictWarned = true;
          new Notice(i18n.t("widgets.activeNote.externalConflictNotice"));
        }

        if (!this.localEditAfterExternal) {
          // Sin edición local posterior al cambio externo se
          // conserva el contenido del disco; el buffer local se
          // retiene en memoria y el guardado queda bloqueado.
          return;
        }
        // Edición local tras el aviso: gana la versión del widget.
      }

      await this.app.vault.modify(file, editor.value);
      this.baseContent = editor.value;
      this.dirty = false;
      this.resetConflictState();
    } catch (error) {
      console.error("[ActiveNoteWidget] No se pudo guardar la nota:", error);
    }
  }
}

export class ActiveNoteWidgetFactory implements FocusWidgetFactory {
  readonly widgetId = "active-note";

  constructor(private app: App) {}

  create(): FocusWidget {
    return new ActiveNoteWidget(this.app);
  }
}
