// src/focus/resources/AddResourceModal.ts


import { Resource, ResourceType } from './Resource';
import { App, Modal, Setting, setIcon, Notice, TFolder, TFile, FuzzySuggestModal, FuzzyMatch } from 'obsidian';

export class AddResourceModal extends Modal {
  private resourceType: ResourceType = 'file';
  private title: string = '';
  private description: string = '';
  private sourcePath: string = '';
  private url: string = '';
  private tags: string = '';
  private onSubmit: (resource: Omit<Resource, 'id' | 'createdAt' | 'updatedAt'>) => void;
  private fileInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    onSubmit: (resource: Omit<Resource, 'id' | 'createdAt' | 'updatedAt'>) => void
  ) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass('fl-resource-modal');

    const header = this.contentEl.createEl('h2', { text: 'Agregar recurso' });
    header.style.marginBottom = '16px';

    // Tipo de recurso
    new Setting(this.contentEl)
      .setName('Tipo')
      .addDropdown(dropdown => {
        dropdown
          .addOption('file', 'Archivo')
          .addOption('link', 'Enlace')
          .setValue(this.resourceType)
          .onChange((value) => {
            this.resourceType = value as ResourceType;
            this.updateForm();
          });
      });

    // Nombre
    new Setting(this.contentEl)
      .setName('Nombre')
      .addText(text => {
        text
          .setPlaceholder('Nombre del recurso')
          .onChange((value) => {
            this.title = value;
          });
      });

    // Descripción (opcional)
    new Setting(this.contentEl)
      .setName('Descripción (opcional)')
      .addTextArea(textarea => {
        textarea
          .setPlaceholder('Breve descripción...')
          .onChange((value) => {
            this.description = value;
          });
      });

    // Contenedor para campos dinámicos
    const dynamicContainer = this.contentEl.createEl('div', { cls: 'fl-resource-dynamic-fields' });

    // Inicializar campos dinámicos
    this.renderDynamicFields(dynamicContainer);

    // Botones de acción
    const actions = this.contentEl.createEl('div', {
      cls: 'fl-resource-actions'
    });
    actions.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--background-modifier-border);';

    const cancelBtn = actions.createEl('button', { text: 'Cancelar' });
    cancelBtn.onclick = () => this.close();

    const addBtn = actions.createEl('button', { 
      text: 'Agregar',
      cls: 'mod-cta'
    });
    addBtn.onclick = () => this.handleSubmit();
  }

  private renderDynamicFields(container: HTMLElement): void {
    container.empty();

    if (this.resourceType === 'file') {
      // Seleccionar archivo
      const setting = new Setting(container)
        .setName('Archivo')
        .addText(text => {
          text
            .setPlaceholder('Selecciona un archivo...')
            .onChange((value) => {
              this.sourcePath = value;
            });
          this.fileInput = text.inputEl;
        })
        .addButton(button => {
          button
            .setButtonText('Seleccionar')
            .onClick(() => {
              this.openFilePicker();
            });
        });
    } else if (this.resourceType === 'link') {
      // URL
      new Setting(container)
        .setName('URL')
        .addText(text => {
          text
            .setPlaceholder('https://...')
            .onChange((value) => {
              this.url = value;
            });
        });

      // Etiquetas
      new Setting(container)
        .setName('Etiquetas (opcional)')
        .addText(text => {
          text
            .setPlaceholder('ciencia, sistemas, referencia')
            .onChange((value) => {
              this.tags = value;
            });
        });
    }
  }

  private updateForm(): void {
    const container = this.contentEl.querySelector('.fl-resource-dynamic-fields');
    if (container) {
      this.renderDynamicFields(container as HTMLElement);
    }
  }

  private openFilePicker(): void {
    // Usar FuzzySuggestModal de Obsidian para seleccionar archivos
    const modal = new FileSuggesterModal(this.app, (file: TFile) => {
      if (this.fileInput) {
        this.fileInput.value = file.path;
        this.sourcePath = file.path;
        // Si el título está vacío, usar el nombre del archivo
        if (!this.title) {
          this.title = file.basename;
          // Actualizar el campo de título
          const titleInput = this.contentEl.querySelector('input[placeholder="Nombre del recurso"]') as HTMLInputElement;
          if (titleInput) {
            titleInput.value = file.basename;
          }
        }
      }
    });
    modal.open();
  }

  private handleSubmit(): void {
    if (this.resourceType === 'file') {
      if (!this.sourcePath) {
        new Notice('Selecciona un archivo');
        return;
      }
      // Verificar que el archivo existe
      const file = this.app.vault.getFileByPath(this.sourcePath);
      if (!file) {
        new Notice('El archivo no existe en el vault');
        return;
      }
    }

    if (this.resourceType === 'link' && !this.url) {
      new Notice('Introduce una URL');
      return;
    }

    if (!this.title) {
      new Notice('Introduce un nombre para el recurso');
      return;
    }

    this.onSubmit({
      type: this.resourceType,
      title: this.title,
      description: this.description || undefined,
      source: this.resourceType === 'file' ? this.sourcePath : undefined,
      url: this.resourceType === 'link' ? this.url : undefined,
      tags: this.tags ? this.tags.split(',').map(t => t.trim()).filter(t => t) : undefined
    });

    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ============================================================
// MODAL PARA SELECCIONAR ARCHIVOS
// ============================================================


class FileSuggesterModal extends FuzzySuggestModal<TFile> {
  private onSelect: (file: TFile) => void;

  constructor(app: App, onSelect: (file: TFile) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder('Buscar archivo...');
  }

  getItems(): TFile[] {
    const files: TFile[] = [];
    const root = this.app.vault.getRoot();
    this.collectFiles(root, files);
    return files;
  }

  private collectFiles(folder: TFolder, files: TFile[]): void {
    for (const child of folder.children) {
      if (child instanceof TFile) {
        const extensions = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'md', 'txt', 'csv', 'json', 'mp3', 'mp4', 'zip'];
        if (extensions.includes(child.extension.toLowerCase())) {
          files.push(child);
        }
      } else if (child instanceof TFolder) {
        if (!child.name.startsWith('.')) {
          this.collectFiles(child, files);
        }
      }
    }
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  // renderSuggestion recibe FuzzyMatch<TFile>, no TFile
  renderSuggestion(item: FuzzyMatch<TFile>, el: HTMLElement): void {
    const file = item.item;  // Extraer el TFile del FuzzyMatch
    el.empty();

    const iconMap: Record<string, string> = {
      pdf: 'file-text',
      png: 'image',
      jpg: 'image',
      jpeg: 'image',
      gif: 'image',
      svg: 'image',
      doc: 'file-text',
      docx: 'file-text',
      xls: 'file-spreadsheet',
      xlsx: 'file-spreadsheet',
      ppt: 'file-presentation',
      pptx: 'file-presentation',
      md: 'file-markdown',
      txt: 'file-text',
      csv: 'file-spreadsheet',
      json: 'code',
      mp3: 'music',
      mp4: 'video',
      zip: 'archive'
    };
    const iconName = iconMap[file.extension.toLowerCase()] || 'file';

    const iconSpan = el.createEl('span', { cls: 'fl-suggestion-icon' });
    setIcon(iconSpan, iconName);

    const textSpan = el.createEl('span', { cls: 'fl-suggestion-text' });
    textSpan.textContent = file.path;

    const extSpan = el.createEl('span', { cls: 'fl-suggestion-extension' });
    extSpan.textContent = file.extension.toUpperCase();
    extSpan.style.cssText = 'font-size: 0.7em; color: var(--text-muted); opacity: 0.5; margin-left: 8px;';
  }

  onChooseItem(file: TFile): void {
    this.onSelect(file);
  }
}
