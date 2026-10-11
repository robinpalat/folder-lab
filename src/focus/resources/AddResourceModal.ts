// src/focus/resources/AddResourceModal.ts


import { Resource, ResourceType } from './Resource';
import { App, Modal, Setting, setIcon, Notice, TFolder, TFile, FuzzySuggestModal, FuzzyMatch } from 'obsidian';
import { i18n } from '../../i18n/I18nService';
export class AddResourceModal extends Modal {
  private resourceType: ResourceType = 'file';
  private title: string = '';
  private description: string = '';
  private sourcePath: string = '';
  private url: string = '';
  private tags: string = '';
  private onSubmit: (resource: Omit<Resource, 'id' | 'createdAt' | 'updatedAt'>) => void;
  private fileInput: HTMLInputElement | null = null;
  private titleInput: HTMLInputElement | null = null;

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

    this.contentEl.createEl('h2', { text: i18n.t('resources.modal.title') });

    // Tipo de recurso
    new Setting(this.contentEl)
      .setName(i18n.t('resources.field.type'))
      .addDropdown(dropdown => {
        dropdown
          .addOption('file', i18n.t('resources.type.file'))
          .addOption('link', i18n.t('resources.type.link'))
          .setValue(this.resourceType)
          .onChange((value) => {
            this.resourceType = value as ResourceType;
            this.updateForm();
          });
      });

    // Nombre
    new Setting(this.contentEl)
      .setName(i18n.t('resources.field.name'))
      .addText(text => {
        text
          .setPlaceholder(i18n.t('resources.placeholder.name'))
          .onChange((value) => {
            this.title = value;
          });
        this.titleInput = text.inputEl;
      });

    // Descripción (opcional)
    new Setting(this.contentEl)
      .setName(i18n.t('resources.field.description'))
      .addTextArea(textarea => {
        textarea
          .setPlaceholder(i18n.t('resources.placeholder.description'))
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

    const cancelBtn = actions.createEl('button', { text: i18n.t('common.cancel') });
    cancelBtn.onclick = () => this.close();

    const addBtn = actions.createEl('button', { 
      text: i18n.t('resources.action.add'),
      cls: 'mod-cta'
    });
    addBtn.onclick = () => this.handleSubmit();
  }

  private renderDynamicFields(container: HTMLElement): void {
    container.empty();

    if (this.resourceType === 'file') {
      // Seleccionar archivo
      const setting = new Setting(container)
        .setName(i18n.t('resources.field.file'))
        .addText(text => {
          text
            .setPlaceholder(i18n.t('resources.placeholder.file'))
            .onChange((value) => {
              this.sourcePath = value;
            });
          this.fileInput = text.inputEl;
        })
        .addButton(button => {
          button
            .setButtonText(i18n.t('resources.action.browse'))
            .onClick(() => {
              this.openFilePicker();
            });
        });
    } else if (this.resourceType === 'link') {
      // URL
      new Setting(container)
        .setName(i18n.t('resources.field.url'))
        .addText(text => {
          text
            .setPlaceholder('https://...')
            .onChange((value) => {
              this.url = value;
            });
        });

      // Etiquetas
      new Setting(container)
        .setName(i18n.t('resources.field.tags'))
        .addText(text => {
          text
            .setPlaceholder(i18n.t('resources.placeholder.tags'))
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
          if (this.titleInput) {
            this.titleInput.value = file.basename;
          }
        }
      }
    });
    modal.open();
  }

  private handleSubmit(): void {
    if (this.resourceType === 'file') {
      if (!this.sourcePath) {
        new Notice(i18n.t('resources.validation.selectFile'));
        return;
      }
      // Verificar que el archivo existe
      const file = this.app.vault.getFileByPath(this.sourcePath);
      if (!file) {
        new Notice(i18n.t('resources.validation.fileMissingInVault'));
        return;
      }
    }

    if (this.resourceType === 'link' && !this.url) {
      new Notice(i18n.t('resources.validation.enterUrl'));
      return;
    }

    if (!this.title) {
      new Notice(i18n.t('resources.validation.enterName'));
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
    this.setPlaceholder(i18n.t('resources.filePickerPlaceholder'));
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
  }

  onChooseItem(file: TFile): void {
    this.onSelect(file);
  }
}
