// ============================================================
// MODAL UTILS
// ============================================================

import { App, Modal } from 'obsidian';
import { i18n } from '../i18n/I18nService';

export class InputModal extends Modal {
  private prompt: string;
  private defaultValue: string;
  private onSubmit: (value: string) => void;
  /**
   * Guarda de envío único: da igual cuántos eventos lleguen
   * (Enter repetido, Enter + clic, listeners duplicados): el
   * callback se ejecuta UNA sola vez por apertura del modal.
   */
  private submitted: boolean = false;

  constructor(app: App, prompt: string, defaultValue: string, onSubmit: (value: string) => void) {
    super(app);
    this.prompt = prompt;
    this.defaultValue = defaultValue;
    this.onSubmit = onSubmit;
  }

  /** Envío único: cierra y entrega el valor. Idempotente. */
  private submit(value: string): void {
    if (this.submitted) return;
    this.submitted = true;
    this.close();
    this.onSubmit(value);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('p', { text: this.prompt });

    const input = contentEl.createEl('input', {
      type: 'text',
      value: this.defaultValue,
      cls: 'fo-modal-input'
    });
    input.style.width = '100%';
    input.style.marginBottom = '12px';

    const buttonContainer = contentEl.createEl('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '8px';
    buttonContainer.style.justifyContent = 'flex-end';

    const cancelBtn = buttonContainer.createEl('button', { text: i18n.t('common.cancel') });
    cancelBtn.onclick = () => {
      this.submit('');
    };

    const submitBtn = buttonContainer.createEl('button', {
      text: i18n.t('common.accept'),
      cls: 'mod-cta'
    });
    submitBtn.onclick = () => {
      this.submit(input.value);
    };

    input.focus();
    input.select();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        // Sin default (no hay formulario, pero se bloquea por
        // si acaso) y con guard: un Enter repetido no reenvía.
        e.preventDefault();
        this.submit(input.value);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.submit('');
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class ConfirmModal extends Modal {
  private message: string;
  private onConfirm: (confirmed: boolean) => void;

  constructor(app: App, message: string, onConfirm: (confirmed: boolean) => void) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('p', { text: this.message });

    const buttonContainer = contentEl.createEl('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '8px';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.marginTop = '12px';

    const cancelBtn = buttonContainer.createEl('button', { text: i18n.t('common.cancel') });
    cancelBtn.onclick = () => {
      this.close();
      this.onConfirm(false);
    };

    const confirmBtn = buttonContainer.createEl('button', {
      text: i18n.t('common.confirm'),
      cls: 'mod-warning'
    });
    confirmBtn.onclick = () => {
      this.close();
      this.onConfirm(true);
    };
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
