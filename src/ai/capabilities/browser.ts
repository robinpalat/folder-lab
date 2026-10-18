import { App, Modal } from 'obsidian';
import { CapabilityRegistry } from './CapabilityRegistry';
import type { Capability } from './types';
import { i18n } from '../../i18n/I18nService';
import {
  getDomainLabel,
  getCapabilityLabel,
  getCapabilityDescription
} from './capabilityTexts';
export interface CapabilitySelection {
  sourceIds: Array<'note' | 'notes' | 'snips' | 'tasks'>;
  groupId: string;
  capabilityId: string;
}

interface CapabilityBrowserOptions {
  registry: CapabilityRegistry;
  selectedGroup?: string;
  selectedCapability?: string;
  onSelect: (selection: CapabilitySelection) => void;
}

export class CapabilityBrowser extends Modal {
  private registry: CapabilityRegistry;
  private selectedGroupId: string;
  private selectedCapabilityId: string;
  private onSelect: (selection: CapabilitySelection) => void;

  private groupsContainer: HTMLElement | null = null;
  private capabilitiesContainer: HTMLElement | null = null;
  private selectedCapabilityElement: HTMLElement | null = null;

  constructor(app: App, options: CapabilityBrowserOptions) {
    super(app);

    this.registry = options.registry;
    this.selectedGroupId =
      options.selectedGroup || this.registry.getDefaultGroup();
    this.selectedCapabilityId = options.selectedCapability || '';
    this.onSelect = options.onSelect;
  }

  onOpen(): void {
    this.modalEl.addClass('fl-capability-browser');

    this.titleEl.setText(i18n.t('ai.browser.title'));

    const content = this.contentEl;
    content.empty();

    const layout = content.createDiv({
      cls: 'fl-capability-browser-layout'
    });

    // ========================================================
    // LEFT PANEL: DOMINIOS
    // ========================================================

    const groupsPanel = layout.createDiv({
      cls: 'fl-capability-browser-groups'
    });

    const groupsTitle = groupsPanel.createDiv({
      cls: 'fl-capability-browser-section-title'
    });
    groupsTitle.textContent = i18n.t('library.section.domains');

    this.groupsContainer = groupsPanel.createDiv({
      cls: 'fl-capability-browser-groups-list'
    });

    const groups = this.registry.getGroups();

    for (const group of groups) {
      const groupEl = this.groupsContainer.createDiv({
        cls: 'fl-capability-browser-group'
      });
      groupEl.textContent = getDomainLabel(group.id, group.label);
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

    const capabilitiesPanel = layout.createDiv({
      cls: 'fl-capability-browser-capabilities'
    });

    const capabilitiesTitle = capabilitiesPanel.createDiv({
      cls: 'fl-capability-browser-section-title'
    });
    capabilitiesTitle.textContent = i18n.t('library.section.capabilities');

    this.capabilitiesContainer = capabilitiesPanel.createDiv({
      cls: 'fl-capability-browser-capabilities-list'
    });

    this.renderCapabilities();

    // ========================================================
    // FOOTER
    // ========================================================

    const footer = content.createDiv({
      cls: 'fl-capability-browser-footer'
    });

    const cancelButton = footer.createEl('button', {
      text: i18n.t('common.cancel'),
      cls: 'fl-capability-browser-cancel mod-secondary'
    });

    cancelButton.onclick = () => {
      this.close();
    };

    const selectButton = footer.createEl('button', {
      text: i18n.t('common.select'),
      cls: 'fl-capability-browser-select mod-cta'
    });

    selectButton.onclick = () => {
      if (!this.selectedCapabilityId) {
        return;
      }

      this.onSelect({
        sourceIds: ['note'],
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
      const empty = this.capabilitiesContainer.createDiv({
        cls: 'fl-capability-browser-empty'
      });
      empty.textContent = i18n.t('library.capabilitiesEmpty');
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

    const item = this.capabilitiesContainer.createDiv({
      cls: 'fl-capability-browser-item'
    });
    item.setAttribute('data-capability-id', capability.id);

    const label = item.createDiv({
      cls: 'fl-capability-browser-item-label'
    });
    label.textContent = getCapabilityLabel(
      capability.id,
      capability.label
    );

    if (capability.description) {
      const description = item.createDiv({
        cls: 'fl-capability-browser-item-description'
      });
      description.textContent = getCapabilityDescription(
        capability.id,
        capability.description
      );
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
          sourceIds: ['note'],
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
