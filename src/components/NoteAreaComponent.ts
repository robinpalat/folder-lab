// src/components/NoteAreaComponent.ts

// ============================================================
// COMPONENTE: NoteAreaComponent
// ============================================================
// Área pequeña para apuntes rápidos.
// No es un editor de notas completo.
// ============================================================

import { FolderLabController } from '../core/FolderLabController';
import { i18n } from '../i18n/I18nService';
export class NoteAreaComponent {
  private container: HTMLElement;
  private controller: FolderLabController;
  private element: HTMLElement;
  private textarea: HTMLTextAreaElement | null = null;
  private saveTimer: number | null = null;

  constructor(
    container: HTMLElement,
    controller: FolderLabController
  ) {
    this.container = container;
    this.controller = controller;
  }

  render(): void {
    if (this.element) {
      this.element.remove();
    }

    // ============================================================
    // ÁREA DE APUNTES
    // ============================================================

    this.element = this.container.createDiv({
      cls: 'folder-order-note-wrapper'
    });

    this.textarea = this.element.createEl('textarea', {
      cls: 'folder-order-note-textarea',
      attr: {
        placeholder: i18n.t('notes.quickAreaPlaceholder'),
        spellcheck: 'false'
      }
    });

    // ============================================================
    // GUARDADO AUTOMÁTICO
    // ============================================================

    this.textarea.addEventListener('input', () => {
      if (this.saveTimer) {
        window.clearTimeout(this.saveTimer);
      }

      this.saveTimer = window.setTimeout(
        () => {
          void this.saveNote().catch((error) => {
            console.error('[FolderLab] Error guardando la nota:', error);
          });
        },
        500
      );
    });

    this.textarea.addEventListener('blur', () => {
      if (this.saveTimer) {
        window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }

      void this.saveNote().catch((error) => {
        console.error('[FolderLab] Error guardando la nota:', error);
      });
    });

    void this.loadNote().catch((error) => {
      console.error('[FolderLab] Error cargando la nota:', error);
    });
  }

  async loadNote(): Promise<void> {
    if (!this.textarea) return;

    const state = this.controller.getState();
    const noteType = state.currentNoteType || 'general';

    const content =
      await this.controller.loadNote(noteType);

    this.textarea.value = content || '';
  }

  async saveNote(): Promise<void> {
    if (!this.textarea) return;

    await this.controller.saveNote(
      this.textarea.value
    );
  }

  destroy(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    this.element?.remove();
    this.textarea = null;
  }
}