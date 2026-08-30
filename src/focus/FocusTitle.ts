
import { setIcon } from 'obsidian';

export class FocusTitle {
  private element: HTMLElement | null = null;
  private container: HTMLElement;
  private onClose: () => void;

  constructor(container: HTMLElement, onClose: () => void) {
    this.container = container;
    this.onClose = onClose;
  }

  render(activeFile: any): void {
    if (this.element) {
      this.element.remove();
    }

    this.element = this.container.createEl('div', {
      cls: 'focus-title'
    });

    // 
    const leftContainer = this.element.createEl('div', {
      cls: 'focus-title-left'
    });

    if (!activeFile) {
      const title = leftContainer.createEl('span', {
        cls: 'focus-title-text focus-title-empty',
        text: 'Sin nota activa'
      });
    } else {
      const title = leftContainer.createEl('span', {
        cls: 'focus-title-text',
        text: activeFile.basename
      });
    }

    // Lado derecho: botón cerrar
    const rightContainer = this.element.createEl('div', {
      cls: 'focus-title-right'
    });

    const closeBtn = rightContainer.createEl('button', {
      cls: 'focus-title-close-btn',
      attr: {
        'aria-label': 'Cerrar modo Focus'
      }
    });
    setIcon(closeBtn, 'x');

    closeBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.onClose) {
        this.onClose();
      }
    };
  }

  update(activeFile: any): void {
    this.render(activeFile);
  }

  destroy(): void {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
