import { Modal, App, ButtonComponent } from 'obsidian';
import { i18n } from '../i18n/I18nService';

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

    contentEl.createEl('h2', { text: i18n.t('modal.polish.title') });

    const originalSection = contentEl.createDiv({
      cls: 'fl-polish-original-section'
    });

    originalSection.createDiv({
      cls: 'fl-polish-section-label',
      text: i18n.t('modal.polish.originalLabel')
    });

    originalSection.createDiv({
      cls: 'fl-polish-original-text',
      text: this.originalText
    });

    const personalSection = contentEl.createDiv({
      cls: 'fl-polish-personal-section'
    });

    personalSection.createDiv({
      cls: 'fl-polish-section-label',
      text: i18n.t('modal.polish.personalLabel')
    });

    this.textarea = personalSection.createEl('textarea', {
      cls: 'fl-polish-textarea',
      attr: { rows: '8' }
    });
    this.textarea.value = this.currentText;

    window.requestAnimationFrame(() => {
      this.textarea?.focus();
      this.textarea?.setSelectionRange(
        this.textarea.value.length,
        this.textarea.value.length
      );
    });

    const actions = contentEl.createDiv({
      cls: 'fl-polish-actions'
    });

    const cancelButton = new ButtonComponent(actions);
    cancelButton.setButtonText(i18n.t('common.cancel'));
    cancelButton.onClick(() => this.close());

    if (this.hasOverride && this.onDiscard) {
      const discardButton = new ButtonComponent(actions);
      discardButton.setButtonText(i18n.t('modal.polish.discard'));
      // setWarning() en lugar de setDestructive() (@since 1.13.0)
      // para mantener minAppVersion 1.4.4; mismo estilo destructivo.
      discardButton.setWarning();
      discardButton.onClick(() => {
        this.onDiscard?.();
        this.close();
      });
    }

    const saveButton = new ButtonComponent(actions);
    saveButton.setButtonText(i18n.t('modal.polish.save'));
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
