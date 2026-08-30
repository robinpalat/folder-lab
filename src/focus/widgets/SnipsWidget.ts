import { Notice } from 'obsidian';
import { SnipsController } from '../controllers/SnipsController';
import { SnipFragment } from '../types/snips';
import { FocusWidget, FocusWidgetFactory, WidgetCallbacks } from "../FocusWidget";
import { FocusContext } from "../FocusContext";

import { WidgetControls } from './tools/WidgetControls';
import { WidgetControlsRenderer } from './tools/WidgetControlsRenderer';
import { FocusListItem } from '../FocusListItem';
import {
  sortPriorityFirst,
  FolderLabDragDrop,
  createExpandableText,
  applyDropCap
} from '../FocusWidgetsUtils';


export class SnipsWidget implements FocusWidget {
  readonly id = "snips";
  readonly label = "Snips";
  readonly icon = "scissors";

  private container: HTMLElement | null = null;
  private currentFile: any = null;
  private app: any;
  private controller: SnipsController;
  private position: 'top' | 'bottom' = 'top';
  private callbacks: WidgetCallbacks = {};
  private instanceId: string = '';
  private instanceName: string = '';

  private fragments: SnipFragment[] = [];
  private listElement: HTMLElement | null = null;
  private emptyElement: HTMLElement | null = null;
  private dropCleanup: (() => void) | null = null;


  constructor(app: any, controller: SnipsController) {
    this.app = app;
    this.controller = controller;
  }

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
    this.container.addClass('fl-widget-snips');

    if (!this.currentFile) {
      this.renderEmpty('Abre una nota para usar Snips');
      return;
    }

    if (this.position === 'top') {
      this.renderControls();
      this.renderContent();
    } else {
      this.renderContent();
      this.renderControls();
    }

    this.reload();
  }

  private buildControls(): WidgetControls {
    const controls = new WidgetControls();

    // ----------------------------------------------------------
    // WIDGET
    // ----------------------------------------------------------

    controls.setWidget({
      id: this.id,
      label: this.instanceName || this.label,
      icon: this.icon,
      options: []
    });

    // ----------------------------------------------------------
    // SESIÓN
    // ----------------------------------------------------------

    controls.select({
      id: 'session',
      label: 'Sesión',
      value: 'Hoy',
      options: [
        {
          id: 'today',
          label: 'Hoy'
        }
      ],
    });

    // ----------------------------------------------------------
    // COPIAR TODO
    // ----------------------------------------------------------

    controls.iconAction({
      id: 'copy',
      icon: 'copy',
      tooltip: 'Copiar todo'
    });

    // ----------------------------------------------------------
    // VACIAR
    // ----------------------------------------------------------

    controls.iconAction({
      id: 'clear',
      icon: 'trash-2',
      tooltip: 'Vaciar Snips'
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

        onSourceSelect: (sourceId) => {
          // Snips utiliza una fuente fija.
          // Este callback no debería ejecutarse.
          console.log(
            `[SnipsWidget] Fuente: ${sourceId}`
          );
        },

        onControlSelect: (controlId, option) => {
          console.log(
            `[SnipsWidget] Control ${controlId}: ${option.id}`
          );
        },

        onAction: (controlId) => {
          if (controlId === 'copy') {
            this.copyAll();
            return;
          }

          if (controlId === 'clear') {
            this.clearAll();
            return;
          }
        },
      }
    );
  }

  private renderContent(): void {
    // Si render() vuelve a ejecutarse, eliminar primero el listener
    // asociado al contenedor anterior.
    this.dropCleanup?.();
    this.dropCleanup = null;

    const contentWrapper = this.container!.createEl('div', {
      cls: 'fl-widget-content-expanded'
    });

    this.renderList(contentWrapper);

    // ----------------------------------------------------------
    // DRAG & DROP
    // ----------------------------------------------------------

    const dragDrop = FolderLabDragDrop.getInstance(this.app);

    this.dropCleanup = dragDrop.registerTextDropTarget(
      contentWrapper,
      async (payload) => {
        if (!this.currentFile) return;

        await this.controller.addFragment(
          this.currentFile.path,
          this.instanceId,
          this.currentFile.basename,
          payload.text
        );

        await this.reload();

        new Notice('Snip creado');
      },
      (active) => {
        contentWrapper.toggleClass(
          'fl-dnd-drop-active',
          active
        );
      }
    );
  }

  private renderList(container: HTMLElement): void {
    const wrapper = container.createEl('div', { cls: 'fl-focus-list-wrapper' });
    this.listElement = wrapper.createEl('div', { cls: 'fl-focus-list' });
    this.emptyElement = wrapper.createEl('div', {
      cls: 'fl-snips-empty fl-widget-result-placeholder'
    });
    this.emptyElement.textContent = 'No hay fragmentos guardados';
  }

  private renderEmpty(text: string): void {
    const empty = this.container!.createEl('div', { cls: 'fl-widget-empty' });
    empty.createEl('div', { cls: 'fl-widget-empty-text', text });
  }

  async reload(): Promise<void> {
    if (!this.currentFile) return;

    console.log(
      '[SNIPS RELOAD] fragmentos recibidos:',
      this.fragments.map(f => ({
        id: f.id,
        active: f.active,
        text: f.text.substring(0, 40)
      }))
    );

    this.fragments = await this.controller.getFragments(
      this.currentFile.path,
      this.instanceId
    );
    this.renderFragments();
  }

  private renderFragments(): void {
    if (!this.listElement || !this.emptyElement) return;

    this.listElement.empty();

    if (this.fragments.length === 0) {
      this.listElement.style.display = 'none';
      this.emptyElement.style.display = 'block';
      return;
    }

    this.listElement.style.display = 'block';
    this.emptyElement.style.display = 'none';

    const sortedFragments = sortPriorityFirst(
      [...this.fragments].reverse(),
      fragment => fragment.active !== false
    );

    for (const [index, fragment] of sortedFragments.entries()) {
      const isActive = fragment.active !== false;

      const item = new FocusListItem(this.listElement, {
        state: isActive ? 'active' : 'inactive',

        primaryAction: {
          id: 'toggle',
          label: isActive
            ? 'Desactivar Snip'
            : 'Activar Snip',
          onClick: async () => {
            await this.toggleFragmentActive(fragment.id);
          }
        },

        deleteAction: {
          id: 'delete',
          label: 'Eliminar Snip',
          onClick: () => {
            this.deleteFragment(fragment.id);
          }
        }
      });

      const content = item.getContentElement();

      content.addClass('fl-list-item-content');

      const expandable = createExpandableText(content, fragment.text, {
        initiallyExpanded: index < 0,
        previewLines: 3,
        expandedLabel: 'Contraer',
        collapsedLabel: 'Expandir',
        editable: false,
        rootClass: 'fl-snips-expandable',
        contentClass: 'fl-snips-expandable-content',
        actionClass: 'fl-snips-expandable-action'
      });

      applyDropCap(expandable.content, fragment.text);



      // ==========================================================
      // DRAG & DROP — SNIP COMO FUENTE
      // ==========================================================

      content.setAttr('draggable', 'true');

      content.addEventListener('dragstart', (event: DragEvent) => {
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer) return;

        const payload = {
          kind: 'text',
          text: fragment.text
        };

        dataTransfer.setData(
          'application/x-folder-lab',
          JSON.stringify(payload)
        );

        dataTransfer.setData(
          'text/plain',
          fragment.text
        );

        dataTransfer.effectAllowed = 'copy';

        content.addClass('is-dragging');
      });

      content.addEventListener('dragend', () => {
        content.removeClass('is-dragging');
      });


    }
  }

  setInstanceIdentity(
    instanceId: string,
    instanceName: string
  ): void {
    this.instanceId = instanceId;
    this.instanceName = instanceName;
  }

  private async deleteFragment(fragmentId: string): Promise<void> {
    if (!this.currentFile) return;

    await this.controller.deleteFragment(this.currentFile.path, this.instanceId, fragmentId);
    this.fragments = this.fragments.filter(f => f.id !== fragmentId);
    this.renderFragments();
  }

  private async toggleFragmentActive(fragmentId: string): Promise<void> {
    if (!this.currentFile) return;

    const newState = await this.controller.toggleFragmentActive(
      this.currentFile.path,
      this.instanceId,
      fragmentId
    );

    if (newState === null) return;

    const fragment = this.fragments.find(f => f.id === fragmentId);

    if (fragment) {
      fragment.active = newState;
    }

    this.renderFragments();
  }

  private async copyAll(): Promise<void> {
    if (this.fragments.length === 0) {
      new Notice('No hay fragmentos para copiar');
      return;
    }

    const text = this.fragments.map(f => f.text).join('\n\n---\n\n');
    navigator.clipboard.writeText(text)
      .then(() => new Notice(`${this.fragments.length} fragmentos copiados`))
      .catch(() => new Notice('Error al copiar'));
  }

  private async clearAll(): Promise<void> {
    if (this.fragments.length === 0) {
      new Notice('No hay fragmentos para vaciar');
      return;
    }

    if (!this.currentFile) return;

    await this.controller.clearActiveSession(
      this.currentFile.path,
      this.instanceId
    );
    this.fragments = [];
    this.renderFragments();
    new Notice('Sesión vaciada');
  }

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

export class SnipsWidgetFactory implements FocusWidgetFactory {
  readonly widgetId = "snips";

  constructor(
    private app: any,
    private controller: SnipsController
  ) { }

  create(): FocusWidget {
    return new SnipsWidget(this.app, this.controller);
  }
}
