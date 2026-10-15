import { FocusWidget, FocusWidgetFactory, WidgetCallbacks } from "../FocusWidget";
import { FocusContext } from "../FocusContext";
import { App, TFile, TFolder, Notice, setIcon, Menu, MenuItem } from "obsidian";
import { ResourceService } from "../resources/ResourceService";
import { AddResourceModal } from "../resources/AddResourceModal";
import { Resource } from "../resources/Resource";
import { FocusListItem } from '../FocusListItem';
import {
  sortPriorityFirst,
  FolderLabDragDrop,
  importDroppedFile
} from '../FocusWidgetsUtils';
import { i18n } from '../../i18n/I18nService';

import { WidgetControls } from "./tools/WidgetControls";
import { WidgetControlsRenderer } from "./tools/WidgetControlsRenderer";

export class ResourcesWidget implements FocusWidget {
  readonly id = "resources";
  get label(): string {
    return i18n.t('widgets.resourcesWidget.label');
  }
  readonly icon = "package";

  private container: HTMLElement | null = null;
  private currentFile: TFile | null = null;
  private app: App;
  private position: 'top' | 'bottom' = 'top';
  private callbacks: WidgetCallbacks = {};
  private resourceService: ResourceService;

  private resources: Resource[] = [];
  private listElement: HTMLElement | null = null;
  private emptyElement: HTMLElement | null = null;
  private dropCleanup: (() => void) | null = null;

  constructor(app: App) {
    this.app = app;
    this.resourceService = new ResourceService(app);
  }

  // ============================================================
  // FOCUS WIDGET INTERFACE
  // ============================================================

  setPosition(position: 'top' | 'bottom'): void {
    this.position = position;
  }

  setCallbacks(callbacks: WidgetCallbacks): void {
    this.callbacks = callbacks;
  }

  render(container: HTMLElement, context: FocusContext): void {
    this.container = container;
    this.currentFile = context.activeFile;

    this.container.empty();
    this.container.addClass('fl-widget-resources');

    if (!this.currentFile) {
      this.renderEmptyState(i18n.t('widgets.resourcesWidget.empty.noteRequired'));
      return;
    }

    if (this.position === 'top') {
      this.renderControls();
      this.renderContent();
    } else {
      this.renderContent();
      this.renderControls();
    }

    void this.loadResources().catch((error) => {
      console.error('[FolderLab] Error cargando recursos:', error);
    });
  }

  // ============================================================
  // RENDER: BARRA DE CONTROLES
  // ============================================================

  private buildControls(): WidgetControls {
    const controls = new WidgetControls();

    // ==========================================================
    // WIDGET
    // ==========================================================

    controls.setWidget({
      id: this.id,
      label: this.label,
      icon: this.icon,
      options: []
    });

    // ==========================================================
    // AGREGAR RECURSO
    // ==========================================================

    controls.iconAction({
      id: "add-resource",
      icon: "plus",
      tooltip: i18n.t('widgets.resourcesWidget.action.addTooltip')
    });

    controls.iconAction({
      id: "open-resources-folder",
      icon: "folder",
      tooltip: i18n.t('widgets.resourcesWidget.action.openFolderTooltip')
    });

    return controls;
  }

  private renderControls(): void {
    if (!this.container) {
      return;
    }

    const controls = this.buildControls();

    WidgetControlsRenderer.render(
      this.container,
      controls.getConfig(),
      {
        onWidgetSelect: () => {
          this.callbacks.onWidgetSelect?.();
        },

        onAction: (controlId) => {
          if (controlId === 'add-resource') {
            this.showAddModal();
            return;
          }

          if (controlId === 'open-resources-folder') {
            this.openResourcesFolder();
            return;
          }
        },
      }
    );
  }

  // ============================================================
  // RENDER: CONTENIDO
  // ============================================================

  private renderContent(): void {
    if (!this.container) return;

    // Si el widget se vuelve a renderizar, limpiar el listener
    // asociado al contenedor anterior antes de crear uno nuevo.
    this.dropCleanup?.();
    this.dropCleanup = null;

    const contentEl = this.container.createEl('div', {
      cls: 'fl-widget-content fl-widget-content-expanded'
    });

    const listWrapper = contentEl.createEl('div', {
      cls: 'fl-focus-list-wrapper'
    });

    this.listElement = listWrapper.createEl('div', {
      cls: 'fl-focus-list'
    });

    this.emptyElement = listWrapper.createEl('div', {
      cls: 'fl-resources-empty'
    });

    this.renderEmptyState(i18n.t('widgets.resourcesWidget.empty.noResources'));

    // ----------------------------------------------------------
    // DRAG & DROP DE ARCHIVOS
    // ----------------------------------------------------------

    const dragDrop = FolderLabDragDrop.getInstance(this.app);

    this.dropCleanup = dragDrop.registerFileDropTarget(
      contentEl,
      async ({ file }) => {
        if (!this.currentFile) return;

        try {
          const folderPath = this.currentFile.parent?.path || '';
          const resourcesPath = folderPath
            ? `${folderPath}/_resources`
            : '_resources';

          // Crear _resources si todavía no existe.
          const resourcesFolder =
            this.app.vault.getAbstractFileByPath(resourcesPath);

          if (!resourcesFolder) {
            await this.app.vault.createFolder(resourcesPath);
          }

          // Copiar el archivo externo al vault.
          const imported = await importDroppedFile(
            this.app,
            file,
            resourcesPath
          );

          const now = Date.now();

          // Registrar el recurso en la metadata de Resources.
          const resource: Resource = {
            id: `res-${now}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'file',
            title: imported.basename,
            source: imported.path,
            createdAt: now,
            updatedAt: now
          };

          await this.resourceService.addResource(
            folderPath,
            resource
          );

          await this.loadResources();

          new Notice(i18n.t('resources.notice.added'));
        } catch (error) {
          console.error(
            '[ResourcesWidget] Error importando archivo:',
            error
          );

          new Notice(i18n.t('resources.notice.addFailed'));
        }
      },
      (active) => {
        contentEl.toggleClass(
          'fl-dnd-drop-active',
          active
        );
      }
    );
  }

  private renderEmptyState(text: string): void {
    if (!this.emptyElement) return;

    this.emptyElement.empty();

    this.emptyElement.createEl('div', {
      cls: 'fl-resources-empty-icon',
      text: '🔗'
    });

    this.emptyElement.createEl('div', {
      cls: 'fl-resources-empty-text',
      text: text
    });

    this.emptyElement.createEl('div', {
      cls: 'fl-resources-empty-hint',
      text: i18n.t('widgets.resourcesWidget.empty.hint')
    });
  }

  // ============================================================
  // CARGA DE RECURSOS
  // ============================================================

  private openResourcesFolder(): void {
    if (!this.currentFile) {
      new Notice(i18n.t('notices.noActiveNote'));
      return;
    }

    const folderPath = this.currentFile.parent?.path || '';
    const resourcesPath = folderPath
      ? `${folderPath}/_resources`
      : '_resources';

    const folder = this.app.vault.getAbstractFileByPath(resourcesPath);

    if (folder instanceof TFolder) {
      new Notice(i18n.t('resources.notice.folderAlreadyExists'));
      return;
    }

    new Notice(i18n.t('resources.notice.folderMissing'));
  }

  private async loadResources(): Promise<void> {
    if (!this.currentFile) return;

    const folderPath = this.currentFile.parent?.path || '';
    this.resources = await this.resourceService.getAllResources(folderPath);
    this.renderResources();
  }

  private renderResources(): void {
    if (!this.listElement || !this.emptyElement) return;

    this.listElement.empty();

    if (this.resources.length === 0) {
      this.listElement.addClass('is-hidden');
      this.emptyElement.removeClass('is-hidden');
      return;
    }

    this.listElement.removeClass('is-hidden');
    this.emptyElement.addClass('is-hidden');

    const sortedResources = sortPriorityFirst(
      this.resources,
      resource => resource.active !== false
    );

    for (const resource of sortedResources) {
      this.renderResourceItem(resource);
    }
  }

  private renderResourceItem(resource: Resource): void {
    if (!this.listElement) return;

    const isActive = resource.active !== false;

    const item = new FocusListItem(this.listElement, {
      state: isActive ? 'active' : 'inactive',

      primaryAction: {
        id: 'toggle',
        label: isActive
          ? i18n.t('widgets.resourcesWidget.action.deactivate')
          : i18n.t('widgets.resourcesWidget.action.activate'),
        onClick: () => {
          void this.toggleResourceActive(resource).catch((error) => {
            console.error(
              '[FolderLab] Error alternando recurso:',
              error
            );
          });
        }
      },

      deleteAction: {
        id: 'delete',
        label: i18n.t('widgets.resourcesWidget.action.delete'),
        onClick: () => {
          void this.deleteResource(resource).catch((error) => {
            console.error('[FolderLab] Error eliminando el recurso:', error);
          });
        }
      }
    });

    const content = item.getContentElement();

    const resourceContent = content.createEl('div', {
      cls: 'fl-resource-content'
    });

    // ----------------------------------------------------------
    // ICONO DEL RECURSO
    // ----------------------------------------------------------

    const iconContainer = resourceContent.createEl('div', {
      cls: 'fl-resource-item-icon'
    });

    const iconName =
      resource.type === 'link'
        ? 'link'
        : this.getFileIcon(resource.source || '');

    setIcon(iconContainer, iconName);

    // ----------------------------------------------------------
    // CONTENIDO
    // ----------------------------------------------------------

    const textContainer = resourceContent.createEl('div', {
      cls: 'fl-resource-item-content'
    });

    const title = textContainer.createEl('div', {
      cls: 'fl-resource-item-title'
    });

    title.textContent = resource.title;

    if (resource.description) {
      const desc = textContainer.createEl('div', {
        cls: 'fl-resource-item-description'
      });

      desc.textContent = resource.description;
    }

    // ----------------------------------------------------------
    // META
    // ----------------------------------------------------------

    const meta = textContainer.createEl('div', {
      cls: 'fl-resource-item-meta'
    });

    const typeLabel =
      resource.type === 'link'
        ? 'WEB'
        : this.getFileExtension(resource.source || '');

    meta.textContent = typeLabel;

    // ----------------------------------------------------------
    // ABRIR RECURSO
    // ----------------------------------------------------------

    content.onclick = () => {
      this.openResource(resource);
    };
  }

  // ============================================================
  // ACCIONES DE RECURSOS
  // ============================================================

  private openResource(resource: Resource): void {
    if (resource.type === 'link' && resource.url) {
      window.open(resource.url, '_blank');
    } else if (resource.type === 'file' && resource.source) {
      const abstractFile = this.app.vault.getAbstractFileByPath(resource.source);
      const file = abstractFile instanceof TFile ? abstractFile : null;

      if (file) {
        void this.app.workspace
          .getLeaf()
          .openFile(file)
          .catch((error) => {
            console.error('[FolderLab] Error abriendo el archivo:', error);
            new Notice(i18n.t('errors.note.openFailed'));
          });
      } else {
        new Notice(i18n.t('resources.notice.fileNotFound'));
      }
    }
  }

  private showResourceMenu(resource: Resource): void {
    const menu = new Menu();

    menu.addItem((item: MenuItem) => {
      item
        .setTitle(i18n.t('widgets.resourcesWidget.action.delete'))
        .setIcon('trash-2')
        .onClick(() => {
          void this.deleteResource(resource).catch((error) => {
            console.error('[FolderLab] Error eliminando el recurso:', error);
          });
        });
    });

    menu.showAtPosition({
      x: 0,
      y: 0
    });
  }

  private async toggleResourceActive(
    resource: Resource
  ): Promise<void> {
    if (!this.currentFile) return;

    const folderPath = this.currentFile.parent?.path || '';
    const isActive = resource.active !== false;

    try {
      await this.resourceService.updateResource(
        folderPath,
        resource.id,
        {
          active: !isActive
        }
      );

      await this.loadResources();
    } catch (error) {
      console.error('Error updating resource state:', error);
      new Notice(i18n.t('resources.notice.updateStateError'));
    }
  }

  private async deleteResource(resource: Resource): Promise<void> {
    const folderPath = this.currentFile?.parent?.path || '';

    const metadata = await this.resourceService.loadMetadata(folderPath);
    const exists = metadata?.resources.some(r => r.id === resource.id);

    if (!exists) {
      new Notice(i18n.t('resources.notice.notRegistered'));
      return;
    }

    if (resource.type === 'file') {
      new Notice(i18n.t('resources.notice.removedFromRegistry'));
    }

    await this.resourceService.deleteResource(folderPath, resource.id);
    await this.loadResources();
    new Notice(i18n.t('resources.notice.deleted'));
  }

  // ============================================================
  // MODAL PARA AGREGAR RECURSO
  // ============================================================

  private showAddModal(): void {
    if (!this.currentFile) {
      new Notice(i18n.t('notices.noActiveNote'));
      return;
    }

    const modal = new AddResourceModal(
      this.app,
      (
        newResource: Omit<
          Resource,
          'id' | 'createdAt' | 'updatedAt'
        >
      ) => {
        const folderPath = this.currentFile!.parent?.path || '';

        const resource: Resource = {
          ...newResource,
          id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        this.resourceService.addResource(folderPath, resource)
          .then(() => {
            void this.loadResources().catch((error) => {
      console.error('[FolderLab] Error cargando recursos:', error);
    });
            new Notice(i18n.t('resources.notice.added'));
          })
          .catch((error) => {
            console.error('Error adding resource:', error);
            new Notice(i18n.t('resources.notice.addError'));
          });
      }
    );

    modal.open();
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

  private getFileIcon(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || '';

    const icons: Record<string, string> = {
      pdf: 'file-text',
      doc: 'file-text',
      docx: 'file-text',
      xls: 'file-spreadsheet',
      xlsx: 'file-spreadsheet',
      ppt: 'file-presentation',
      pptx: 'file-presentation',
      png: 'image',
      jpg: 'image',
      jpeg: 'image',
      gif: 'image',
      svg: 'image',
      mp3: 'music',
      mp4: 'video',
      zip: 'archive',
      json: 'code',
      csv: 'file-spreadsheet',
      md: 'file-markdown',
      txt: 'file-text'
    };

    return icons[ext] || 'file';
  }

  private getFileExtension(path: string): string {
    return path.split('.').pop()?.toUpperCase() || 'ARCHIVO';
  }

  // ============================================================
  // FOCUS WIDGET INTERFACE - MÉTODOS RESTANTES
  // ============================================================

  update(context: FocusContext): void {
    const newFile = context.activeFile;

    if (newFile === this.currentFile) return;

    this.currentFile = newFile;

    if (this.container) {
      this.render(this.container, context);
    }
  }

  destroy(): void {
    this.dropCleanup?.();
    this.dropCleanup = null;

    if (this.container) {
      this.container.empty();
      this.container = null;
    }

    this.currentFile = null;
    this.listElement = null;
    this.emptyElement = null;
  }
}

export class ResourcesWidgetFactory implements FocusWidgetFactory {
  readonly widgetId = "resources";
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  create(): FocusWidget {
    return new ResourcesWidget(this.app);
  }
}
