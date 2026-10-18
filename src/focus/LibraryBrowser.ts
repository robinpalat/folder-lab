import { App, Modal, setIcon } from 'obsidian';

import { FocusWidgetRegistry } from './FocusWidgetRegistry';
import { WidgetManager } from './WidgetManager';
import type { WidgetInstance } from './WidgetDefinition';
import { NOTE_CONTEXT_DEFAULT_WIDGET_TYPE_IDS } from './WidgetDefinition';
import {
  applyWidgetIdentity
} from './FocusWidgetsUtils';
import { i18n } from '../i18n/I18nService';
import {
  getWidgetDefinitionLabel,
  getWidgetDefinitionDescription
} from './widgets/definitionTexts';

/**
 * Administrador de widgets de Focus.
 *
 * Modal dedicado EXCLUSIVAMENTE a la gestión de instancias de
 * widgets: explorar definiciones disponibles, agregar, renombrar
 * y eliminar instancias. La biblioteca de capacidades del
 * Asistente vive en `src/ai/capabilities/browser.ts`.
 */
export class LibraryBrowser extends Modal {

  private widgetRegistry: FocusWidgetRegistry;
  private widgetManager: WidgetManager;
  private draftInstances: WidgetInstance[] = [];

  private widgetsContent: HTMLElement | null = null;

  constructor(
    app: App,
    widgetRegistry: FocusWidgetRegistry,
    widgetManager: WidgetManager
  ) {
    super(app);

    this.widgetRegistry = widgetRegistry;
    this.widgetManager = widgetManager;

    this.modalEl.addClass('fl-capability-browser');
  }

  onOpen(): void {
    const content = this.contentEl;

    content.empty();

    this.initializeWidgetDraft();

    this.widgetsContent = content.createDiv({
      cls: 'fl-capability-browser-tab-content'
    });

    this.renderWidgetsContent();
  }

  private initializeWidgetDraft(): void {
    this.draftInstances =
      this.widgetManager
        .getInstances()
        .map(instance => ({
          ...instance
        }));
  }

  private renderWidgetsContent(): void {
    if (!this.widgetsContent) {
      return;
    }

    this.widgetsContent.empty();

    const container = this.widgetsContent.createDiv({
      cls: 'fl-widget-manager'
    });

    const columns = container.createDiv({
      cls: 'fl-widget-manager-columns'
    });

    const leftColumn = columns.createDiv({
      cls: 'fl-widget-manager-column fl-widget-manager-available'
    });

    const rightColumn = columns.createDiv({
      cls: 'fl-widget-manager-column fl-widget-manager-instances'
    });

    // ─────────────────────────────────────────────
    // Widgets disponibles
    // ─────────────────────────────────────────────

    leftColumn.createDiv({
      cls: 'fl-widget-manager-column-title',
      text: i18n.t('library.widgetsColumn.available')
    });

    const leftScroll = leftColumn.createDiv({
      cls: 'fl-widget-manager-column-scroll'
    });

    const definitions = this.widgetRegistry.getDefinitions();

    for (const definition of definitions) {

      /*
       * Tipos fijos que se crean por defecto (Apuntes,
       * Asistente): no se agregan desde la biblioteca. Nota
       * activa NO está en este conjunto: es agregable desde la
       * biblioteca y aparece en el bloque fijo al existir.
       */
      if (
        (NOTE_CONTEXT_DEFAULT_WIDGET_TYPE_IDS as readonly string[])
          .includes(definition.id)
      ) {
        continue;
      }

      const card = leftScroll.createDiv({
        cls: 'fl-widget-manager-card'
      });

      const header = card.createDiv({
        cls: 'fl-widget-manager-card-header'
      });

      if (definition.identity.icon) {
        const iconEl = header.createSpan({
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

      header.createSpan({
        cls: 'fl-widget-manager-card-name',
        text: getWidgetDefinitionLabel(definition)
      });

      if (definition.identity.description) {
        card.createDiv({
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

    rightColumn.createDiv({
      cls: 'fl-widget-manager-column-title',
      text: i18n.t('library.widgetsColumn.instances')
    });

    const rightScroll = rightColumn.createDiv({
      cls: 'fl-widget-manager-column-scroll'
    });

    if (this.draftInstances.length === 0) {

      rightScroll.createDiv({
        cls: 'fl-widget-manager-empty',
        text: i18n.t('library.widgetsEmpty')
      });

    } else {

      for (const instance of this.draftInstances) {

        const card = rightScroll.createDiv({
          cls: 'fl-widget-manager-instance-card'
        });

        const definition =
          this.widgetRegistry.getDefinition(
            instance.typeId
          );

        const header = card.createDiv({
          cls: 'fl-widget-manager-instance-header'
        });

        if (definition?.identity.icon) {
          const iconEl = header.createSpan({
            cls: 'fl-widget-manager-card-icon'
          });

          setIcon(iconEl, definition.identity.icon);

          if (definition.identity.color) {
            iconEl.style.color =
              definition.identity.color;
          }
        }

        const name = header.createSpan({
          cls: 'fl-widget-manager-instance-name',
          text: instance.name
        });

        name.setAttribute(
          'title',
          i18n.t('library.instanceRenameTooltip')
        );

        name.onclick = () => {

          const input = name.createEl('input', {
            cls: 'fl-widget-manager-instance-name-input',
            attr: { type: 'text' }
          });

          input.value = instance.name;

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

        card.setAttribute(
          'data-instance-id',
          instance.instanceId
        );
      }
    }

    // ─────────────────────────────────────────────
    // Footer
    // ─────────────────────────────────────────────

    const footer = container.createDiv({
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

  private async applyWidgetChanges(): Promise<void> {
    await this.widgetManager.applyInstances(
      this.draftInstances
    );

    this.initializeWidgetDraft();
    this.renderWidgetsContent();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
