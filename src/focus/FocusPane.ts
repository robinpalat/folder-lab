import { App, Menu } from 'obsidian';
import { FocusWidget } from './FocusWidget';
import { FocusContext } from './FocusContext';
import { FocusWidgetRegistry } from './FocusWidgetRegistry';
import { WidgetManager } from './WidgetManager';
import { LibraryBrowser } from './LibraryBrowser';
import type { CapabilityRegistry } from '../ai/capabilities/CapabilityRegistry';
import {
  applyWidgetIdentity
} from './FocusWidgetsUtils';
import { i18n } from '../i18n/I18nService';
export enum FocusPanePosition {
  Top = 'top',
  Bottom = 'bottom'
}

export class FocusPane {
  private element: HTMLElement | null = null;
  private container: HTMLElement;
  private position: FocusPanePosition;
  private registry: FocusWidgetRegistry;
  private context: FocusContext;
  private app: App;
  private onWidgetSelectCallback?: (instanceId: string) => void;

  private widgetManager: WidgetManager;
  private capabilityRegistry: CapabilityRegistry;
  private widgetInstanceId: string;
  private widget: FocusWidget | null = null;
  private widgetContainer: HTMLElement | null = null;

  // Superficies de scroll a las que se aplica el fade visual
  // en los límites superior/inferior del viewport.
  private scrollFadeCleanups: Array<() => void> = [];
  private scrollFadeMutationObserver: MutationObserver | null = null;

  constructor(
    container: HTMLElement,
    position: FocusPanePosition,
    widgetInstanceId: string,
    registry: FocusWidgetRegistry,
    widgetManager: WidgetManager,
    context: FocusContext,
    app: App,
    capabilityRegistry: CapabilityRegistry,
    onWidgetSelect?: (instanceId: string) => void
  ) {
    this.container = container;
    this.position = position;
    this.registry = registry;
    this.widgetManager = widgetManager;
    this.context = context;
    this.app = app;
    this.capabilityRegistry = capabilityRegistry;
    this.widgetInstanceId = widgetInstanceId;
    this.onWidgetSelectCallback = onWidgetSelect;
  }

  render(): void {
    // El contenedor del pane pertenece a FocusWorkspace.
    // FocusPane no debe crear otro .fl-widget-container.
    this.element = this.container;

    // Limpiar cualquier frame anterior que pudiera existir.
    if (this.widgetContainer) {
      this.widgetContainer.remove();
      this.widgetContainer = null;
    }

    // El contenedor del pane ya tiene la geometría asignada por
    // FocusWorkspace. El frame debe heredarla sin introducir otra
    // dimensión independiente.
    // (Presentación estática en CSS: .fl-widget-container y
    // .fl-widget-frame.)

    // Crear únicamente la superficie visual del widget.
    this.widgetContainer = this.container.createDiv({
      cls: `fl-widget-frame fl-widget-frame-${this.position}`
    });

    this.createAndRenderWidget(this.widgetInstanceId);

  }

  private createAndRenderWidget(instanceId: string): void {
    this.destroyWidget();

    if (this.widgetContainer) {
      this.widgetContainer.empty();
    }

    const instance = this.widgetManager.getInstance(instanceId);

    if (!instance) {
      this.showError(
        i18n.t('focus.pane.error.instanceNotFound', { instanceId })
      );
      return;
    }

    const newWidget = this.registry.getWidget(instance.typeId);

    if (!newWidget) {
      this.showError(
        i18n.t('focus.pane.error.widgetNotFound', { typeId: instance.typeId })
      );
      return;
    }

    if (newWidget.setInstanceIdentity) {
      newWidget.setInstanceIdentity(
        instance.instanceId,
        instance.name
      );
    }

    this.widget = newWidget;
    this.widgetInstanceId = instanceId;

    if (this.widget.setPosition) {
      this.widget.setPosition(this.position);
    }

    if (this.widget.setCallbacks) {
      this.widget.setCallbacks({
        onWidgetSelect: () => {
          this.showWidgetMenu();
        },
        onSourceSelect: () => {
                  }
      });
    }

    if (this.widgetContainer) {
      this.widget.render(
        this.widgetContainer,
        this.context
      );

      if (this.widget.load) {
        this.widget.load().then(() => {
          this.installScrollFades();
        }).catch(err => {
          console.warn(
            `Error loading widget "${instance.typeId}":`,
            err
          );
          this.installScrollFades();
        });
      } else {
        this.installScrollFades();
      }
    } else {
      this.installScrollFades();
    }
  }

  /**
   * Añade un fade muy sutil a las superficies que realmente tienen
   * scroll vertical. El efecto no participa en el layout: solamente
   * modifica la máscara visual del viewport.
   *
   * Estados:
   *   top    -> solamente fade inferior
   *   middle -> fade superior e inferior
   *   bottom -> solamente fade superior
   *   no-scroll -> sin máscara
   */
  private installScrollFades(): void {
    this.clearScrollFades();

    const root = this.widgetContainer;
    if (!root) return;

    const surfaces = new Set<HTMLElement>();

    const updateSurface = (surface: HTMLElement): void => {
      const maxScroll =
        surface.scrollHeight - surface.clientHeight;

      if (maxScroll <= 1) {
        surface.style.removeProperty('mask-image');
        surface.style.removeProperty('-webkit-mask-image');
        return;
      }

      const atTop = surface.scrollTop <= 1;
      const atBottom = surface.scrollTop >= maxScroll - 1;
      const edge = '32px';

      let mask: string;

      if (atTop && atBottom) {
        mask = 'none';
      } else if (atTop) {
        mask = `linear-gradient(to bottom, black 0%, black calc(100% - ${edge}), transparent 100%)`;
      } else if (atBottom) {
        mask = `linear-gradient(to bottom, transparent 0%, black ${edge}, black 100%)`;
      } else {
        mask = `linear-gradient(to bottom, transparent 0%, black ${edge}, black calc(100% - ${edge}), transparent 100%)`;
      }

      surface.style.maskImage = mask;
      surface.style.setProperty('-webkit-mask-image', mask);
      // Constantes (siempre iguales): en clase CSS, no en línea.
      surface.addClass('fl-focus-surface-mask-fixed');
    };

    const registerSurface = (surface: HTMLElement): void => {
      if (surfaces.has(surface)) {
        updateSurface(surface);
        return;
      }

      const style = getComputedStyle(surface);
      const overflowY = style.overflowY;

      if (overflowY !== 'auto' && overflowY !== 'scroll') {
        return;
      }

      surfaces.add(surface);
      surface.classList.add('fl-scroll-fade-surface');

      const onScroll = () => updateSurface(surface);
      surface.addEventListener('scroll', onScroll, { passive: true });
      updateSurface(surface);

      const resizeObserver = new ResizeObserver(() => {
        updateSurface(surface);
      });
      resizeObserver.observe(surface);

      this.scrollFadeCleanups.push(() => {
        surface.removeEventListener('scroll', onScroll);
        resizeObserver.disconnect();
        surface.style.removeProperty('mask-image');
        surface.style.removeProperty('-webkit-mask-image');
        surface.style.removeProperty('mask-repeat');
        surface.style.removeProperty('-webkit-mask-repeat');
        surface.style.removeProperty('mask-size');
        surface.style.removeProperty('-webkit-mask-size');
        surface.classList.remove('fl-scroll-fade-surface');
      });
    };

    const scan = (): void => {
      for (const surface of Array.from(
        root.querySelectorAll<HTMLElement>('*')
      )) {
        registerSurface(surface);
      }

      for (const surface of surfaces) {
        updateSurface(surface);
      }
    };

    scan();

    this.scrollFadeMutationObserver = new MutationObserver(() => {
      scan();
    });

    this.scrollFadeMutationObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.requestAnimationFrame(scan);
  }

  private clearScrollFades(): void {
    this.scrollFadeMutationObserver?.disconnect();
    this.scrollFadeMutationObserver = null;

    for (const cleanup of this.scrollFadeCleanups) {
      cleanup();
    }

    this.scrollFadeCleanups = [];
  }

  /**
   * Categoría estable de una instancia: se resuelve SIEMPRE a
   * partir de la definición asociada (category: 'context' |
   * 'card'; ausente en definiciones heredadas → 'context').
   * Nunca depende del nombre visible de la instancia.
   */
  private getWidgetCategory(
    typeId: string
  ): 'context' | 'card' {
    return (
      this.widgetManager.getDefinition(typeId)?.category ??
      'context'
    );
  }

  private showWidgetMenu(): void {
    const menu = new Menu();

    // ─────────────────────────────────────────────
    // 1. Añadir widget… (biblioteca, pestaña widgets)
    // ─────────────────────────────────────────────

    menu.addItem((item) => {
      item
        .setTitle(i18n.t('focus.widgetMenu.addWidget'))
        .setIcon('plus')
        .onClick(() => {
          /*
           * La biblioteca es el ÚNICO punto de entrada para
           * agregar instancias: aquí solo se abre; el alta
           * ocurre al aplicar en la biblioteca (applyInstances).
           */
          const browser = new LibraryBrowser(
            this.app,
            this.registry,
            this.capabilityRegistry,
            this.widgetManager,
            'widgets'
          );

          browser.open();
        });
    });

    // ─────────────────────────────────────────────
    // 2. Instancias agrupadas: Contexto / Tarjetas
    // ─────────────────────────────────────────────

    const available =
      this.widgetManager.getInstances();

    const contextInstances = available.filter(
      instance =>
        this.getWidgetCategory(instance.typeId) === 'context'
    );

    const cardInstances = available.filter(
      instance =>
        this.getWidgetCategory(instance.typeId) === 'card'
    );

    const addInstanceItem = (
      instance: (typeof available)[number]
    ): void => {

      const definition =
        this.widgetManager.getDefinition(
          instance.typeId
        );

      if (!definition) {
        return;
      }

      const isActive =
        instance.instanceId ===
        this.widgetInstanceId;

      menu.addItem((item) => {

        item
          .setTitle(instance.name)
          .setIcon(
            definition.identity.icon || 'blank'
          )
          .setChecked(isActive);

        item.onClick(() => {

          this.createAndRenderWidget(
            instance.instanceId
          );

          if (this.onWidgetSelectCallback) {
            this.onWidgetSelectCallback(
              instance.instanceId
            );
          }
        });
      });
    };

    if (contextInstances.length > 0) {

      menu.addSeparator();

      // Encabezado deshabilitado: no seleccionable.
      menu.addItem((item) => {
        item
          .setTitle(i18n.t('focus.widgetMenu.groupContext'))
          .setDisabled(true);
      });

      for (const instance of contextInstances) {
        addInstanceItem(instance);
      }
    }

    if (cardInstances.length > 0) {

      menu.addSeparator();

      menu.addItem((item) => {
        item
          .setTitle(i18n.t('focus.widgetMenu.groupCards'))
          .setDisabled(true);
      });

      for (const instance of cardInstances) {
        addInstanceItem(instance);
      }
    }

  const selectorBtn =
    this.element?.querySelector(
      '.fl-widget-selector-btn'
    );

  let x: number;
  let y: number;

  if (selectorBtn) {

    const rect =
      selectorBtn.getBoundingClientRect();

    x = rect.left;
    y = rect.bottom + 4;

  } else {

    const rect =
      this.element?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    x =
      rect.left +
      rect.width / 2;

    y =
      rect.top +
      rect.height / 2;
  }

  menu.showAtPosition({
    x,
    y
  });

  window.setTimeout(() => {

    const menus =
      document.querySelectorAll('.menu');

    const menuEl =
  menus.item(menus.length - 1) as HTMLElement | null;

    if (!menuEl) {
      return;
    }

    const items =
      Array.from(
        menuEl.querySelectorAll(
          '.menu-scroll .menu-item'
        )
      );

    items.forEach(
      (itemEl, index) => {

        const instance =
          available[index];

        if (!instance) {
          return;
        }

        const definition =
          this.widgetManager.getDefinition(
            instance.typeId
          );

        if (!definition) {
          return;
        }

        const iconEl: HTMLElement | null =
          itemEl.querySelector('.menu-item-icon');

        if (!iconEl) {
          return;
        }

        applyWidgetIdentity(
          iconEl,
          definition.identity
        );
      }
    );

  }, 0);
}

  private destroyWidget(): void {
    this.clearScrollFades();

    if (this.widget) {

      if (this.widget.save) {
        this.widget.save().catch(err => {
          console.warn(
            `Error saving widget "${this.widgetInstanceId}":`,
            err
          );
        });
      }


      this.widget.destroy();
      this.widget = null;
    }
  }

  private showError(message: string): void {
    if (!this.widgetContainer) return;
    this.widgetContainer.empty();
    const error = this.widgetContainer.createDiv({
      cls: 'fl-widget-error'
    });
    error.createDiv({ cls: 'fl-widget-error-icon', text: '⚠️' });
    error.createDiv({ text: message });
  }

  updateContext(context: FocusContext): void {
    this.context = context;
    if (this.widget) {
      this.widget.update(context);
    }
  }

  setWidget(instanceId: string): void {
    if (instanceId === this.widgetInstanceId) return;

    this.createAndRenderWidget(instanceId);
  }

  getWidgetInstanceId(): string {
    return this.widgetInstanceId;
  }

  getWidget(): FocusWidget | null {
    return this.widget;
  }

  destroy(): void {
    this.destroyWidget();

    // FocusPane NO es propietario de this.element.
    // El contenedor pertenece a FocusWorkspace.
    if (this.widgetContainer) {
      this.widgetContainer.remove();
      this.widgetContainer = null;
    }

    this.element = null;
  }
}