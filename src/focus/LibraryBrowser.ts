import { Modal, setIcon } from 'obsidian';

import { FocusWidgetRegistry } from './FocusWidgetRegistry';
import { CapabilityRegistry } from '../ai/capabilities/CapabilityRegistry';
import type { Capability } from '../ai/capabilities/types';
import { WidgetManager } from './WidgetManager';
import type { WidgetInstance } from './WidgetDefinition';
import {
  applyWidgetIdentity
} from './FocusWidgetsUtils';
import { i18n } from '../i18n/I18nService';
import {
  getWidgetDefinitionLabel,
  getWidgetDefinitionDescription
} from './widgets/definitionTexts';
import {
  getDomainLabel,
  getCapabilityLabel,
  getCapabilityDescription
} from '../ai/capabilities/capabilityTexts';
export interface CapabilitySelection {
  sourceIds: Array<'note' | 'notes' | 'snips' | 'tasks'>;
  groupId: string;
  capabilityId: string;
}

type BrowserTab = 'widgets' | 'assistant' | 'recipes';

export class LibraryBrowser extends Modal {

  private widgetRegistry: FocusWidgetRegistry;
  private capabilityRegistry: CapabilityRegistry;

  private selectedSourceIds: Array<
    'note' | 'notes' | 'snips' | 'tasks'
  > = ['note'];

  private selectedGroupId: string;
  private selectedCapabilityId = '';

  private onSelect!: (
    selection: CapabilitySelection
  ) => void;

  private groupsContainer: HTMLElement | null = null;
  private capabilitiesContainer: HTMLElement | null = null;
  private selectedCapabilityElement: HTMLElement | null = null;

  private selectedTab: BrowserTab = 'assistant';

  private widgetsContent: HTMLElement | null = null;
  private assistantContent: HTMLElement | null = null;
  private recipesContent: HTMLElement | null = null;
  private widgetManager: WidgetManager;
  private draftInstances: WidgetInstance[] = [];

  constructor(
    app: any,
    widgetRegistry: FocusWidgetRegistry,
    capabilityRegistry: CapabilityRegistry,
    widgetManager: WidgetManager
  ) {
    super(app);

    this.widgetRegistry = widgetRegistry;
    this.capabilityRegistry = capabilityRegistry;
    this.widgetManager = widgetManager;

    this.selectedGroupId =
      this.capabilityRegistry.getDefaultGroup();
  }

  onOpen(): void {
    this.modalEl.addClass('fl-capability-browser');

    const content = this.contentEl;

    content.empty();

    this.initializeWidgetDraft();

    // ========================================================
    // PESTAÑAS
    // ========================================================

    const tabs = content.createEl('div', {
      cls: 'fl-capability-browser-tabs'
    });

    const widgetsTab = tabs.createEl('div', {
      cls: 'fl-capability-browser-tab',
      text: i18n.t('library.tab.widgets')
    });

    const assistantTab = tabs.createEl('div', {
      cls: 'fl-capability-browser-tab',
      text: i18n.t('library.tab.assistant')
    });

    const recipesTab = tabs.createEl('div', {
      cls: 'fl-capability-browser-tab',
      text: i18n.t('library.tab.recipes')
    });

    assistantTab.addClass('is-selected');


    // ========================================================
    // CONTENIDO WIDGETS
    // ========================================================

    this.widgetsContent = content.createEl('div', {
      cls: 'fl-capability-browser-tab-content fl-widget-tab-content is-hidden'
    });

    this.renderWidgetsContent();

    // ========================================================
    // CONTENIDO ASISTENTE
    // ========================================================

    this.assistantContent = content.createEl('div', {
      cls: 'fl-capability-browser-tab-content'
    });

    // ========================================================
    // CONTENIDO RECETAS
    // ========================================================

    this.recipesContent = content.createEl('div', {
      cls: 'fl-capability-browser-tab-content is-hidden'
    });

    this.recipesContent.createEl('div', {
      cls: 'fl-capability-browser-empty',
      text: i18n.t('library.recipesEmpty')
    });

    // ========================================================
    // RENDER ASISTENTE
    // ========================================================

    this.renderAssistantContent();

    // ========================================================
    // EVENTOS DE PESTAÑAS
    // ========================================================

    widgetsTab.onclick = () => {
      this.selectTab(
        'widgets',
        widgetsTab,
        assistantTab,
        recipesTab
      );
    };

    assistantTab.onclick = () => {
      this.selectTab(
        'assistant',
        widgetsTab,
        assistantTab,
        recipesTab
      );
    };

    recipesTab.onclick = () => {
      this.selectTab(
        'recipes',
        widgetsTab,
        assistantTab,
        recipesTab
      );
    };
  }

  // ========================================================
  // PESTAÑAS
  // ========================================================

  private selectTab(
    tab: BrowserTab,
    widgetsTab: HTMLElement,
    assistantTab: HTMLElement,
    recipesTab: HTMLElement
  ): void {

    this.selectedTab = tab;

    widgetsTab.removeClass('is-selected');
    assistantTab.removeClass('is-selected');
    recipesTab.removeClass('is-selected');

    if (tab === 'widgets') {
      widgetsTab.addClass('is-selected');
    }

    if (tab === 'assistant') {
      assistantTab.addClass('is-selected');
    }

    if (tab === 'recipes') {
      recipesTab.addClass('is-selected');
    }

    if (this.widgetsContent) {
      this.widgetsContent.toggleClass(
        'is-hidden',
        tab !== 'widgets'
      );
    }

    if (this.assistantContent) {
      this.assistantContent.toggleClass(
        'is-hidden',
        tab !== 'assistant'
      );
    }

    if (this.recipesContent) {
      this.recipesContent.toggleClass(
        'is-hidden',
        tab !== 'recipes'
      );
    }
  }

  private renderWidgetsContent(): void {
    if (!this.widgetsContent) {
      return;
    }

    this.widgetsContent.empty();

    const container = this.widgetsContent.createEl('div', {
      cls: 'fl-widget-manager'
    });

    const columns = container.createEl('div', {
      cls: 'fl-widget-manager-columns'
    });

    const leftColumn = columns.createEl('div', {
      cls: 'fl-widget-manager-column fl-widget-manager-available'
    });

    const rightColumn = columns.createEl('div', {
      cls: 'fl-widget-manager-column fl-widget-manager-instances'
    });

    // ─────────────────────────────────────────────
    // Widgets disponibles
    // ─────────────────────────────────────────────

    leftColumn.createEl('div', {
      cls: 'fl-widget-manager-column-title',
      text: i18n.t('library.widgetsColumn.available')
    });

    const leftScroll = leftColumn.createEl('div', {
      cls: 'fl-widget-manager-column-scroll'
    });

    const definitions = this.widgetRegistry.getDefinitions();

    for (const definition of definitions) {


      const card = leftScroll.createEl('div', {
        cls: 'fl-widget-manager-card'
      });

      const header = card.createEl('div', {
        cls: 'fl-widget-manager-card-header'
      });

      if (definition.identity.icon) {
const iconEl = header.createEl('span', {
  cls: 'fl-widget-manager-card-icon'
});

applyWidgetIdentity(
  iconEl,
  definition.identity
);

if (definition.identity.color) {
  iconEl.style.color =
    definition.identity.color;
}
      }

      header.createEl('span', {
        cls: 'fl-widget-manager-card-name',
        text: getWidgetDefinitionLabel(definition)
      });

      if (definition.identity.description) {
        card.createEl('div', {
          cls: 'fl-widget-manager-card-description',
          text: getWidgetDefinitionDescription(definition)
        });
      }

      const isSingleton =
        definition.cardinality === 'singleton';

      const alreadyExists =
        this.draftInstances.some(
          instance =>
            instance.typeId === definition.id
        );

      if (!isSingleton || !alreadyExists) {

        const addButton = card.createEl('button', {
          cls: 'fl-widget-manager-add-button',
          text: '+'
        });

        addButton.setAttribute(
          'aria-label',
          i18n.t('library.widgetsAction.add')
        );

        addButton.setAttribute(
          'title',
          i18n.t('library.widgetsAction.add')
        );

        addButton.onclick = () => {

          // ----------------------------------------------------------
          // Protección contra duplicación de widgets singleton
          // ----------------------------------------------------------

          if (
            definition.cardinality === 'singleton' &&
            this.draftInstances.some(
              instance =>
                instance.typeId === definition.id
            )
          ) {
            return;
          }

          const instance: WidgetInstance = {
            instanceId:
              `draft-${definition.id}-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 8)}`,

            typeId:
              definition.id,

            // Nombre por defecto al CREAR la instancia (traducible).
            // Los nombres persistidos nunca pasan por aquí.
            name:
              getWidgetDefinitionLabel(definition)
          };

          this.draftInstances.push(
            instance
          );

          this.renderWidgetsContent();
        };
      }

    }
    // ─────────────────────────────────────────────
    // Instancias de la nota
    // ─────────────────────────────────────────────

    rightColumn.createEl('div', {
      cls: 'fl-widget-manager-column-title',
      text: i18n.t('library.widgetsColumn.instances')
    });

    const rightScroll = rightColumn.createEl('div', {
      cls: 'fl-widget-manager-column-scroll'
    });

    if (this.draftInstances.length === 0) {

      rightScroll.createEl('div', {
        cls: 'fl-widget-manager-empty',
        text: i18n.t('library.widgetsEmpty')
      });

    } else {

      for (const instance of this.draftInstances) {

        const card = rightScroll.createEl('div', {
          cls: 'fl-widget-manager-instance-card'
        });

        const definition =
          this.widgetRegistry.getDefinition(
            instance.typeId
          );

        const header = card.createEl('div', {
          cls: 'fl-widget-manager-instance-header'
        });

        // ─────────────────────────────────────────
        // Icono
        // ─────────────────────────────────────────

        if (definition?.identity.icon) {
          const iconEl = header.createEl('span', {
            cls: 'fl-widget-manager-card-icon'
          });

          setIcon(iconEl, definition.identity.icon);

if (definition.identity.color) {
  iconEl.style.color =
    definition.identity.color;
}
        }

        // ─────────────────────────────────────────
        // Nombre
        // ─────────────────────────────────────────

        const name = header.createEl('span', {
          cls: 'fl-widget-manager-instance-name',
          text: instance.name
        });

        name.setAttribute(
          'title',
          i18n.t('library.instanceRenameTooltip')
        );

        name.onclick = () => {

          const input =
            document.createElement('input');

          input.type = 'text';
          input.value = instance.name;

          input.className =
            'fl-widget-manager-instance-name-input';

          name.replaceWith(input);

          input.focus();
          input.select();

          const commit = () => {

            const value =
              input.value.trim();

            if (value) {
              instance.name = value;
            }

            this.renderWidgetsContent();
          };

          input.addEventListener(
            'blur',
            commit
          );

          input.addEventListener(
            'keydown',
            (event) => {

              if (event.key === 'Enter') {
                event.preventDefault();
                input.blur();
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                this.renderWidgetsContent();
              }
            }
          );
        };

        // ─────────────────────────────────────────
        // Eliminar
        // ─────────────────────────────────────────

        const deleteButton = header.createEl('button', {
          cls: 'fl-widget-manager-delete-button',
          text: '🗑'
        });

        deleteButton.setAttribute(
          'aria-label',
          i18n.t('library.widgetsAction.delete')
        );

        deleteButton.setAttribute(
          'title',
          i18n.t('library.widgetsAction.delete')
        );

        deleteButton.onclick = (event) => {
          event.stopPropagation();

          this.draftInstances =
            this.draftInstances.filter(
              draft =>
                draft.instanceId !== instance.instanceId
            );

          this.renderWidgetsContent();
        };
        // ─────────────────────────────────────────
        // ID de instancia
        // ─────────────────────────────────────────

        card.setAttribute(
          'data-instance-id',
          instance.instanceId
        );
      }
    }

    // ─────────────────────────────────────────────
    // Footer de Widgets
    // ─────────────────────────────────────────────


    const footer = container.createEl('div', {
      cls: 'fl-widget-manager-footer'
    });

    const cancelButton = footer.createEl('button', {
      text: i18n.t('common.cancel'),
      cls: 'fl-widget-manager-cancel mod-secondary'
    });

    cancelButton.onclick = () => {
      this.close();
    };

    const applyButton = footer.createEl('button', {
      text: i18n.t('common.apply'),
      cls: 'fl-widget-manager-apply mod-cta'
    });

    applyButton.onclick = async () => {
      await this.applyWidgetChanges();
      this.close();
    };
  }


  private initializeWidgetDraft(): void {
    this.draftInstances =
      this.widgetManager
        .getInstances()
        .map(instance => ({
          ...instance
        }));
  }

  // ========================================================
  // CONTENIDO ASISTENTE
  // ========================================================


  private renderAssistantContent(): void {
    if (!this.assistantContent) {
      return;
    }

    this.assistantContent.empty();

    const layout =
      this.assistantContent.createEl('div', {
        cls: 'fl-capability-browser-layout'
      });

    // ========================================================
    // LEFT PANEL: FUENTES
    // ========================================================

    const sourcesPanel = layout.createEl('div', {
      cls: 'fl-capability-browser-sources'
    });

    const sourcesTitle =
      sourcesPanel.createEl('div', {
        cls: 'fl-capability-browser-section-title'
      });

    sourcesTitle.textContent = i18n.t('library.section.sources');

    const sourcesContainer =
      sourcesPanel.createEl('div', {
        cls: 'fl-capability-browser-sources-list'
      });

    const sources: Array<{
      id: 'note' | 'notes' | 'snips' | 'tasks';
      label: string;
      icon: string;
    }> = [
        {
          id: 'note',
          label: i18n.t('focus.sources.note'),
          icon: 'file-text'
        },
        {
          id: 'notes',
          label: i18n.t('focus.sources.notes'),
          icon: 'pencil'
        },
        {
          id: 'snips',
          label: i18n.t('focus.sources.snips'),
          icon: 'scissors'
        },
        {
          id: 'tasks',
          label: i18n.t('focus.sources.tasks'),
          icon: 'check-square'
        }
      ];

    for (const source of sources) {
      const sourceEl =
        sourcesContainer.createEl('div', {
          cls: 'fl-capability-browser-source'
        });

      sourceEl.setAttribute(
        'data-source-id',
        source.id
      );

      if (
        this.selectedSourceIds.includes(
          source.id
        )
      ) {
        sourceEl.addClass('is-selected');
      }

      sourceEl.createEl('span', {
        cls: 'fl-capability-browser-source-icon'
      });

      sourceEl
        .querySelector(
          '.fl-capability-browser-source-icon'
        )
        ?.setAttribute(
          'data-icon',
          source.icon
        );

      sourceEl.createEl('span', {
        cls: 'fl-capability-browser-source-label',
        text: source.label
      });

      sourceEl.onclick = () => {
        const index =
          this.selectedSourceIds.indexOf(
            source.id
          );

        if (index >= 0) {

          if (
            this.selectedSourceIds.length === 1
          ) {
            return;
          }

          this.selectedSourceIds.splice(
            index,
            1
          );

          sourceEl.removeClass(
            'is-selected'
          );

        } else {

          this.selectedSourceIds.push(
            source.id
          );

          sourceEl.addClass(
            'is-selected'
          );
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

    const groupsTitle =
      groupsPanel.createEl('div', {
        cls: 'fl-capability-browser-section-title'
      });

    groupsTitle.textContent = i18n.t('library.section.domains');

    this.groupsContainer =
      groupsPanel.createEl('div', {
        cls: 'fl-capability-browser-groups-list'
      });

    const groups =
      this.capabilityRegistry.getGroups()

    for (const group of groups) {
      const groupEl =
        this.groupsContainer.createEl(
          'div',
          {
            cls: 'fl-capability-browser-group'
          }
        );

      groupEl.textContent = getDomainLabel(group.id, group.label);

      groupEl.setAttribute(
        'data-group-id',
        group.id
      );

      if (
        group.id === this.selectedGroupId
      ) {
        groupEl.addClass(
          'is-selected'
        );
      }

      groupEl.onclick = () => {
        this.selectedGroupId =
          group.id;

        this.selectedCapabilityId =
          '';

        this.selectedCapabilityElement =
          null;

        const allGroupEls =
          this.groupsContainer!
            .querySelectorAll(
              '.fl-capability-browser-group'
            );

        allGroupEls.forEach(
          el =>
            el.removeClass(
              'is-selected'
            )
        );

        groupEl.addClass(
          'is-selected'
        );

        this.renderCapabilities();

        this.updateSelectButton();
      };
    }

    // ========================================================
    // RIGHT PANEL: CAPACIDADES
    // ========================================================

    const capabilitiesPanel =
      layout.createEl('div', {
        cls:
          'fl-capability-browser-capabilities'
      });

    const capabilitiesTitle =
      capabilitiesPanel.createEl(
        'div',
        {
          cls:
            'fl-capability-browser-section-title'
        }
      );

    capabilitiesTitle.textContent = i18n.t('library.section.capabilities');

    this.capabilitiesContainer =
      capabilitiesPanel.createEl(
        'div',
        {
          cls:
            'fl-capability-browser-capabilities-list'
        }
      );

    this.renderCapabilities();

    // ========================================================
    // FOOTER
    // ========================================================

    const footer =
      this.assistantContent.createEl(
        'div',
        {
          cls:
            'fl-capability-browser-footer'
        }
      );

    const cancelButton =
      footer.createEl('button', {
        text: i18n.t('common.cancel'),
        cls:
          'fl-capability-browser-cancel mod-secondary'
      });

    cancelButton.onclick = () => {
      this.close();
    };

    const selectButton =
      footer.createEl('button', {
        text: i18n.t('common.select'),
        cls:
          'fl-capability-browser-select mod-cta'
      });

    selectButton.onclick = () => {
      if (!this.selectedCapabilityId) {
        return;
      }

      this.onSelect({
        sourceIds: [
          ...this.selectedSourceIds
        ],
        groupId:
          this.selectedGroupId,
        capabilityId:
          this.selectedCapabilityId
      });

      this.close();
    };

    this.updateSelectButton();
  }

  // ========================================================
  // CAPACIDADES
  // ========================================================

  private renderCapabilities(): void {
    if (!this.capabilitiesContainer) {
      return;
    }

    this.capabilitiesContainer.empty();

    const capabilities =
      this.capabilityRegistry.getByGroup(
        this.selectedGroupId
      )
    if (capabilities.length === 0) {
      const empty =
        this.capabilitiesContainer.createEl(
          'div',
          {
            cls:
              'fl-capability-browser-empty'
          }
        );

      empty.textContent =
        i18n.t('library.capabilitiesEmpty');

      return;
    }

    for (const capability of capabilities) {
      this.renderCapability(
        capability
      );
    }

    if (this.selectedCapabilityId) {
      const items =
        this.capabilitiesContainer
          .querySelectorAll(
            '.fl-capability-browser-item'
          );

      items.forEach(el => {
        const dataCapId =
          (
            el as HTMLElement
          ).getAttribute(
            'data-capability-id'
          );

        if (
          dataCapId ===
          this.selectedCapabilityId
        ) {
          this.setSelectedCapability(
            el as HTMLElement
          );

          this.selectedCapabilityElement =
            el as HTMLElement;
        }
      });
    }
  }

  private async applyWidgetChanges(): Promise<void> {
    await this.widgetManager.applyInstances(
      this.draftInstances
    );

    this.initializeWidgetDraft();
    this.renderWidgetsContent();
  }

  private renderCapability(
    capability: Capability
  ): void {

    if (!this.capabilitiesContainer) {
      return;
    }

    const item =
      this.capabilitiesContainer.createEl(
        'div',
        {
          cls:
            'fl-capability-browser-item'
        }
      );

    item.setAttribute(
      'data-capability-id',
      capability.id
    );

    const label =
      item.createEl('div', {
        cls:
          'fl-capability-browser-item-label'
      });

    label.textContent = getCapabilityLabel(
        capability.id,
        capability.label
      )

    if (capability.description) {
      const description =
        item.createEl('div', {
          cls:
            'fl-capability-browser-item-description'
        });

      description.textContent = getCapabilityDescription(
        capability.id,
        capability.description
      )
    }

    item.onclick = () => {

      if (
        this.selectedCapabilityElement
      ) {
        this.deselectCapability(
          this.selectedCapabilityElement
        );
      }

      this.selectedCapabilityId =
        capability.id;

      this.selectedCapabilityElement =
        item;

      this.setSelectedCapability(
        item
      );

      this.updateSelectButton();
    };
  }

  private setSelectedCapability(
    element: HTMLElement
  ): void {
    element.addClass(
      'is-selected'
    );
  }

  private deselectCapability(
    element: HTMLElement
  ): void {
    element.removeClass(
      'is-selected'
    );
  }

  private updateSelectButton(): void {
    const selectBtn =
      this.modalEl.querySelector(
        '.fl-capability-browser-select'
      ) as HTMLElement;

    if (!selectBtn) {
      return;
    }

    if (this.selectedCapabilityId) {
      selectBtn.removeClass(
        'is-disabled'
      );

      selectBtn.onclick = () => {
        this.onSelect({
          sourceIds: [
            ...this.selectedSourceIds
          ],
          groupId:
            this.selectedGroupId,
          capabilityId:
            this.selectedCapabilityId
        });

        this.close();
      };

    } else {

      selectBtn.addClass(
        'is-disabled'
      );

      selectBtn.onclick = () => { };
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}