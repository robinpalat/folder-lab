import { App, TFile } from "obsidian";

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
 */
export class ActiveNoteWidget implements FocusWidget {
  readonly id = "active-note";
  readonly label = "Nota";
  readonly icon = "file-pen-line";

  private container: HTMLElement | null = null;
  private editor: HTMLTextAreaElement | null = null;
  private currentFile: TFile | null = null;
  private saveTimer: number | null = null;
  private callbacks: WidgetCallbacks = {};
  private position: "top" | "bottom" = "top";

  constructor(private app: App) {}

  setCallbacks(callbacks: WidgetCallbacks): void {
    this.callbacks = callbacks;
  }

  setPosition(position: "top" | "bottom"): void {
    this.position = position;
  }

  render(container: HTMLElement, context: FocusContext): void {
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
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

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
        "aria-label": `Editar ${this.currentFile.basename}`,
        spellcheck: "true"
      }
    });
    this.editor.placeholder = "Escribe en la nota activa…";
    this.editor.addEventListener("input", () => this.scheduleSave());
  }

  private renderEmpty(): void {
    this.container?.createEl("div", {
      cls: "fl-widget-content-empty",
      text: "Abre una nota Markdown para editarla aquí"
    });
  }

  private async loadFile(): Promise<void> {
    const file = this.currentFile;
    const editor = this.editor;
    if (!file || !editor) return;

    try {
      const content = await this.app.vault.read(file);
      if (this.currentFile === file && this.editor === editor) {
        editor.value = content;
      }
    } catch (error) {
      console.error("[ActiveNoteWidget] No se pudo leer la nota:", error);
    }
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

    try {
      await this.app.vault.modify(file, editor.value);
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
