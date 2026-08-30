import { Modal } from 'obsidian';
import { CapabilityRegistry } from './CapabilityRegistry';
import type { Capability } from './types';

export interface CapabilitySelection {
  sourceIds: Array<'note' | 'notes' | 'snips' | 'tasks'>;
  groupId: string;
  capabilityId: string;
}

interface CapabilityBrowserOptions {
  registry: CapabilityRegistry;
  selectedSources?: Array<'note' | 'notes' | 'snips' | 'tasks'>;
  selectedGroup?: string;
  selectedCapability?: string;
  onSelect: (selection: CapabilitySelection) => void;
}

export class CapabilityBrowser extends Modal {
  private registry: CapabilityRegistry;
  private selectedSourceIds: Array<'note' | 'notes' | 'snips' | 'tasks'>;
  private selectedGroupId: string;
  private selectedCapabilityId: string;
  private onSelect: (selection: CapabilitySelection) => void;

  private groupsContainer: HTMLElement | null = null;
  private capabilitiesContainer: HTMLElement | null = null;
  private selectedCapabilityElement: HTMLElement | null = null;

  constructor(app: any, options: CapabilityBrowserOptions) {
    super(app);

    this.registry = options.registry;
    this.selectedSourceIds =
      options.selectedSources?.length
        ? [...options.selectedSources]
        : ['note'];
    this.selectedGroupId =
      options.selectedGroup || this.registry.getDefaultGroup();
    this.selectedCapabilityId = options.selectedCapability || '';
    this.onSelect = options.onSelect;
  }

  onOpen(): void {
    this.modalEl.addClass('fl-capability-browser');

    this.titleEl.setText('Trabajo');

    const content = this.contentEl;
    content.empty();

    const layout = content.createEl('div', {
      cls: 'fl-capability-browser-layout'
    });

    // ========================================================
    // LEFT PANEL: FUENTES
    // ========================================================

    const sourcesPanel = layout.createEl('div', {
      cls: 'fl-capability-browser-sources'
    });

    const sourcesTitle = sourcesPanel.createEl('div', {
      cls: 'fl-capability-browser-section-title'
    });
    sourcesTitle.textContent = 'FUENTES';

    const sourcesContainer = sourcesPanel.createEl('div', {
      cls: 'fl-capability-browser-sources-list'
    });

    const sources: Array<{
      id: 'note' | 'notes' | 'snips' | 'tasks';
      label: string;
      icon: string;
    }> = [
      { id: 'note', label: 'Nota', icon: 'file-text' },
      { id: 'notes', label: 'Apuntes', icon: 'pencil' },
      { id: 'snips', label: 'Snips', icon: 'scissors' },
      { id: 'tasks', label: 'Tareas', icon: 'check-square' }
    ];

    for (const source of sources) {
      const sourceEl = sourcesContainer.createEl('div', {
        cls: 'fl-capability-browser-source'
      });

      sourceEl.setAttribute('data-source-id', source.id);

      if (this.selectedSourceIds.includes(source.id)) {
        sourceEl.addClass('is-selected');
      }

      sourceEl.createEl('span', {
        cls: 'fl-capability-browser-source-icon'
      });

      sourceEl.querySelector('.fl-capability-browser-source-icon')?.setAttribute(
        'data-icon',
        source.icon
      );

      sourceEl.createEl('span', {
        cls: 'fl-capability-browser-source-label',
        text: source.label
      });

      sourceEl.onclick = () => {
        const index = this.selectedSourceIds.indexOf(source.id);

        if (index >= 0) {
          // Nunca dejamos la selección completamente vacía.
          if (this.selectedSourceIds.length === 1) {
            return;
          }

          this.selectedSourceIds.splice(index, 1);
          sourceEl.removeClass('is-selected');
        } else {
          this.selectedSourceIds.push(source.id);
          sourceEl.addClass('is-selected');
        }

        this.updateSelectButton();
      };
    }

    // ========================================================
    // LEFT PANEL: DOMINIOS
    // ========================================================

    const groupsPanel = layout.createEl('div', {
      cls: 'fl-capability-browser-groups'
    });

    const groupsTitle = groupsPanel.createEl('div', {
      cls: 'fl-capability-browser-section-title'
    });
    groupsTitle.textContent = 'DOMINIOS';

    this.groupsContainer = groupsPanel.createEl('div', {
      cls: 'fl-capability-browser-groups-list'
    });

    const groups = this.registry.getGroups();

    for (const group of groups) {
      const groupEl = this.groupsContainer.createEl('div', {
        cls: 'fl-capability-browser-group'
      });
      groupEl.textContent = group.label;
      groupEl.setAttribute('data-group-id', group.id);

      if (group.id === this.selectedGroupId) {
        groupEl.addClass('is-selected');
      }

      groupEl.onclick = () => {
        this.selectedGroupId = group.id;
        this.selectedCapabilityId = '';
        this.selectedCapabilityElement = null;

        const allGroupEls = this.groupsContainer!.querySelectorAll('.fl-capability-browser-group');
        allGroupEls.forEach(el => el.removeClass('is-selected'));

        groupEl.addClass('is-selected');

        this.renderCapabilities();
        this.updateSelectButton();
      };
    }

    // ========================================================
    // RIGHT PANEL: CAPACIDADES
    // ========================================================

    const capabilitiesPanel = layout.createEl('div', {
      cls: 'fl-capability-browser-capabilities'
    });

    const capabilitiesTitle = capabilitiesPanel.createEl('div', {
      cls: 'fl-capability-browser-section-title'
    });
    capabilitiesTitle.textContent = 'CAPACIDADES';

    this.capabilitiesContainer = capabilitiesPanel.createEl('div', {
      cls: 'fl-capability-browser-capabilities-list'
    });

    this.renderCapabilities();

    // ========================================================
    // FOOTER
    // ========================================================

    const footer = content.createEl('div', {
      cls: 'fl-capability-browser-footer'
    });

    const cancelButton = footer.createEl('button', {
      text: 'Cancelar',
      cls: 'fl-capability-browser-cancel mod-secondary'
    });

    cancelButton.onclick = () => {
      this.close();
    };

    const selectButton = footer.createEl('button', {
      text: 'Seleccionar',
      cls: 'fl-capability-browser-select mod-cta'
    });

    selectButton.onclick = () => {
      if (!this.selectedCapabilityId) {
        return;
      }

      this.onSelect({
        sourceIds: [...this.selectedSourceIds],
        groupId: this.selectedGroupId,
        capabilityId: this.selectedCapabilityId
      });

      this.close();
    };

    this.updateSelectButton();
  }

  private renderCapabilities(): void {
    if (!this.capabilitiesContainer) {
      return;
    }

    this.capabilitiesContainer.empty();

    const capabilities = this.registry.getByGroup(this.selectedGroupId);

    if (capabilities.length === 0) {
      const empty = this.capabilitiesContainer.createEl('div', {
        cls: 'fl-capability-browser-empty'
      });
      empty.textContent = 'No hay capacidades disponibles en este dominio.';
      return;
    }

    for (const capability of capabilities) {
      this.renderCapability(capability);
    }

    // Re-select previously selected capability
    if (this.selectedCapabilityId) {
      const items = this.capabilitiesContainer.querySelectorAll('.fl-capability-browser-item');
      items.forEach(el => {
        const dataCapId = (el as HTMLElement).getAttribute('data-capability-id');
        if (dataCapId === this.selectedCapabilityId) {
          this.setSelectedCapability(el as HTMLElement);
        }
      });
    }
  }

  private renderCapability(capability: Capability): void {
    if (!this.capabilitiesContainer) {
      return;
    }

    const item = this.capabilitiesContainer.createEl('div', {
      cls: 'fl-capability-browser-item'
    });
    item.setAttribute('data-capability-id', capability.id);

    const label = item.createEl('div', {
      cls: 'fl-capability-browser-item-label'
    });
    label.textContent = capability.label;

    if (capability.description) {
      const description = item.createEl('div', {
        cls: 'fl-capability-browser-item-description'
      });
      description.textContent = capability.description;
    }

    item.onclick = () => {
      // Deselect previous
      if (this.selectedCapabilityElement) {
        this.deselectCapability(this.selectedCapabilityElement);
      }

      this.selectedCapabilityId = capability.id;
      this.selectedCapabilityElement = item;

      this.setSelectedCapability(item);
      this.updateSelectButton();
    };
  }

  private setSelectedCapability(element: HTMLElement): void {
    element.addClass('is-selected');
  }

  private deselectCapability(element: HTMLElement): void {
    element.removeClass('is-selected');
  }

  private updateSelectButton(): void {
    const selectBtn = this.modalEl.querySelector('.fl-capability-browser-select') as HTMLElement;
    if (!selectBtn) {
      return;
    }

    if (this.selectedCapabilityId) {
      selectBtn.removeClass('is-disabled');
      selectBtn.onclick = () => {
        this.onSelect({
          sourceIds: [...this.selectedSourceIds],
          groupId: this.selectedGroupId,
          capabilityId: this.selectedCapabilityId
        });
        this.close();
      };
    } else {
      selectBtn.addClass('is-disabled');
      selectBtn.onclick = () => {};
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
