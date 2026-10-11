import { Modal, App, ButtonComponent } from 'obsidian';

export interface BoardPolishResult {
  text: string;
}

/**
 * Editor de un fragmento del Documento.
 *
 * Muestra el original (solo lectura, nunca se modifica) y un área
 * para la versión personal. Guardar no toca el original: solo crea
 * o actualiza la versión alternativa del fragmento.
 */
export class BoardPolishModal extends Modal {

  private textarea: HTMLTextAreaElement | null = null;

  constructor(
    app: App,
    private readonly originalText: string,
    private readonly currentText: string,
    private readonly hasOverride: boolean,
    private readonly onSave: (result: BoardPolishResult) => void,
    private readonly onDiscard?: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('fl-board-polish-modal');

    contentEl.createEl('h2', { text: 'Pulir fragmento' });

    const originalSection = contentEl.createEl('div', {
      cls: 'fl-polish-original-section'
    });

    originalSection.createEl('div', {
      cls: 'fl-polish-section-label',
      text: 'Original (solo lectura)'
    });

    originalSection.createEl('div', {
      cls: 'fl-polish-original-text',
      text: this.originalText
    });

    const personalSection = contentEl.createEl('div', {
      cls: 'fl-polish-personal-section'
    });

    personalSection.createEl('div', {
      cls: 'fl-polish-section-label',
      text: 'Versión personal'
    });

    this.textarea = personalSection.createEl('textarea', {
      cls: 'fl-polish-textarea',
      attr: { rows: '8' }
    });
    this.textarea.value = this.currentText;

    requestAnimationFrame(() => {
      this.textarea?.focus();
      this.textarea?.setSelectionRange(
        this.textarea.value.length,
        this.textarea.value.length
      );
    });

    const actions = contentEl.createEl('div', {
      cls: 'fl-polish-actions'
    });

    const cancelButton = new ButtonComponent(actions);
    cancelButton.setButtonText('Cancelar');
    cancelButton.onClick(() => this.close());

    if (this.hasOverride && this.onDiscard) {
      const discardButton = new ButtonComponent(actions);
      discardButton.setButtonText('Descartar versión personal');
      discardButton.setWarning();
      discardButton.onClick(() => {
        this.onDiscard?.();
        this.close();
      });
    }

    const saveButton = new ButtonComponent(actions);
    saveButton.setButtonText('Guardar versión');
    saveButton.setCta();
    saveButton.onClick(() => {
      const text = this.textarea?.value ?? '';
      this.onSave({ text });
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.textarea = null;
  }
}
