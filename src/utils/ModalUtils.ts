// ============================================================
// MODAL UTILS
// ============================================================

import { App, Modal } from 'obsidian';

export class InputModal extends Modal {
  private prompt: string;
  private defaultValue: string;
  private onSubmit: (value: string) => void;

  constructor(app: App, prompt: string, defaultValue: string, onSubmit: (value: string) => void) {
    super(app);
    this.prompt = prompt;
    this.defaultValue = defaultValue;
    this.onSubmit = onSubmit;
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

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancelar' });
    cancelBtn.onclick = () => {
      this.close();
      this.onSubmit('');
    };

    const submitBtn = buttonContainer.createEl('button', {
      text: 'Aceptar',
      cls: 'mod-cta'
    });
    submitBtn.onclick = () => {
      this.close();
      this.onSubmit(input.value);
    };

    input.focus();
    input.select();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.close();
        this.onSubmit(input.value);
      }
      if (e.key === 'Escape') {
        this.close();
        this.onSubmit('');
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

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancelar' });
    cancelBtn.onclick = () => {
      this.close();
      this.onConfirm(false);
    };

    const confirmBtn = buttonContainer.createEl('button', {
      text: 'Confirmar',
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
