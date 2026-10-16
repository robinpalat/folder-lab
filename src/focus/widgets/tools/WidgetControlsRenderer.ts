import { Menu, setIcon } from 'obsidian';
import { i18n } from '../../../i18n/I18nService';

import type {
  WidgetControlOption,
  WidgetControlsConfig,
  WidgetDynamicControl
} from './WidgetControlTypes';

import {
  applyWidgetIdentity
} from '../../FocusWidgetsUtils';

export interface WidgetControlsRendererCallbacks {
  onWidgetSelect?: (widgetId: string) => void;

  onSourceSelect?: (sourceId: string) => void;

  onControlSelect?: (
    controlId: string,
    option: WidgetControlOption
  ) => void;

  onPickerOpen?: (
    controlId: string
  ) => void;

  onAction?: (
    controlId: string
  ) => void;
}


export interface WidgetControlsHandle {
  updateStatus(
    controlId: string,
    update: {
      label?: string;
      icon?: string;
      state?: 'default' | 'success' | 'warning' | 'error';
    }
  ): void;
}


export class WidgetControlsRenderer {

  /**
   * Renderiza la barra completa de controles.
   *
   * El renderer NO conoce ningún widget concreto.
   */
static render(
  container: HTMLElement,
  config: WidgetControlsConfig,
  callbacks: WidgetControlsRendererCallbacks = {}
): WidgetControlsHandle {

  const controlsEl = container.createDiv({
    cls: 'fl-widget-controls'
  });

  // ============================================================
  // CONTEXTO — IDENTIDAD DEL WIDGET
  // ============================================================

  const contextEl = controlsEl.createDiv({
    cls: 'fl-widget-toolbar-context'
  });

  this.renderWidgetSelector(
    contextEl,
    config,
    callbacks
  );

  // ============================================================
  // FUENTE — CONTEXTO DE DATOS
  // ============================================================

  if (config.source) {

    const sourceEl = controlsEl.createDiv({
      cls: 'fl-widget-toolbar-source'
    });

    this.renderSourceSelector(
      sourceEl,
      config.source,
      callbacks
    );
  }

  // ============================================================
  // CONFIGURACIÓN — CONTROLES DINÁMICOS - elementos a la izquierda
  // ============================================================
/*
const configurationControls =
  config.dynamic.filter(
    control =>
      control.type === 'action');

  if (configurationControls.length > 0) {

    const configurationEl = controlsEl.createEl('div', {
      cls: 'fl-widget-toolbar-configuration'
    });

    this.renderDynamicControls(
      configurationEl,
      configurationControls,
      callbacks
    );
  }
*/
  // ============================================================
  // EJECUCIÓN — ACCIONES PRINCIPALES - elementos a la derecha
  // ============================================================

const executionControls =
  config.dynamic.filter(
    control =>
      control.type === 'action' ||
      control.type === 'icon-action' ||
      control.type === 'status' ||
      control.type === 'picker' || control.type === 'select'
  
  );

  if (executionControls.length > 0) {

    const executionEl = controlsEl.createDiv({
      cls: 'fl-widget-toolbar-execution'
    });

    this.renderDynamicControls(
      executionEl,
      executionControls,
      callbacks
    );
  }
  
  const handle: WidgetControlsHandle = {
  updateStatus: (controlId, update) => {
    const status = controlsEl.querySelector(
      `[data-control-id="${controlId}"]`
    );

    if (!(status instanceof HTMLElement)) {
      return;
    }

    const label = status.querySelector('.fl-control-label');

    if (label instanceof HTMLElement && update.label !== undefined) {
      label.textContent = update.label;
    }

    status.classList.remove(
      'is-default',
      'is-success',
      'is-warning',
      'is-error'
    );

    status.classList.add(
      `is-${update.state ?? 'default'}`
    );

    const existingIcon =
      status.querySelector('.fl-control-icon');

    if (update.icon) {
      const iconElement =
        existingIcon instanceof HTMLElement
          ? existingIcon
          : status.createSpan({
              cls: 'fl-control-icon'
            });

      iconElement.className = 'fl-control-icon';

      if (!existingIcon) {
        // createEl lo adjunta al final; colocarlo en la posición
        // original (antes de la etiqueta o al principio).
        status.insertBefore(
          iconElement,
          label ?? status.firstChild
        );
      }

      setIcon(iconElement, update.icon);
    } else if (existingIcon) {
      existingIcon.remove();
    }
  }
};

return handle;

}

  // ============================================================
  // FUENTE
  // ============================================================

private static renderSourceSelector(
  container: HTMLElement,
  source: NonNullable<WidgetControlsConfig['source']>,
  callbacks: WidgetControlsRendererCallbacks
): void {

  if (source.mode === 'none') {
    return;
  }

  const wrapper = container.createDiv({
    cls: 'fl-widget-source'
  });

  const btn = wrapper.createEl('button', {
    cls: 'fl-widget-source-btn',
    attr: {
      type: 'button',
      'aria-expanded': 'false',
      'aria-label': source.label || i18n.t('widgets.controls.sourceFallbackLabel')
    }
  });

  // La fuente se representa visualmente por su icono.
  if (source.icon) {
    const iconSpan = btn.createSpan({
      cls: 'fl-widget-source-icon'
    });

    setIcon(iconSpan, source.icon);
  }

  // El nombre queda como tooltip.
  if (source.label) {
    btn.setAttribute('aria-label', source.label);
    btn.setAttribute('title', source.label);
  }

  // Fuente fija: solamente visual.
  if (source.mode === 'fixed') {
    btn.addClass('is-fixed');
    btn.setAttribute('aria-disabled', 'true');
    return;
  }

  // Fuente seleccionable.
  if (source.mode === 'selectable') {

    const arrowSpan = btn.createSpan({
      cls: 'fl-widget-source-arrow'
    });

    setIcon(arrowSpan, 'chevron-down');

    btn.onclick = () => {

      if (source.disabled) {
        return;
      }

      const expanded =
        btn.getAttribute('aria-expanded') === 'true';

      btn.setAttribute(
        'aria-expanded',
        String(!expanded)
      );

      this.showSourceMenu(
        btn,
        source.options ?? [],
        callbacks
      );
    };
  }
}

  // ============================================================
  // SELECTOR DE WIDGET
  // ============================================================

  private static renderWidgetSelector(
    container: HTMLElement,
    config: WidgetControlsConfig,
    callbacks: WidgetControlsRendererCallbacks
  ): void {

    const widget = config.widget;

    const wrapper = container.createDiv({
      cls: 'fl-widget-selector'
    });

    const btn = wrapper.createEl('button', {
      cls: 'fl-widget-selector-btn',
      attr: {
        type: 'button',
        'aria-expanded': 'false'
      }
    });

    /*
     * Indicador de desplegable: chevron hacia abajo ANTES del
     * icono ([chevron][icono][nombre]). Está dentro del MISMO
     * botón: al pulsarlo se ejecuta el onclick existente que abre
     * el menú de selección de widgets (sin menú duplicado ni
     * lógica nueva). El estado abierto/cerrado se refleja en
     * aria-expanded (rotación vía CSS).
     */
    const chevronSpan = btn.createSpan({
      cls: 'fl-widget-selector-arrow fl-widget-selector-chevron'
    });

    setIcon(chevronSpan, 'chevron-down');

    // Icono del widget
    if (widget.icon) {
      const iconSpan = btn.createSpan({
        cls: 'fl-widget-selector-icon'
      });

      applyWidgetIdentity(
        iconSpan,
        {
          icon: widget.icon,
          color: widget.color
        }
      );
    }

    // el botón muestra el nombre
    btn.createSpan({
      cls: 'fl-widget-selector-label',
      text: widget.label
    });

    btn.onclick = () => {

      if (widget.disabled) {
        return;
      }

      const expanded =
        btn.getAttribute('aria-expanded') === 'true';

      btn.setAttribute(
        'aria-expanded',
        String(!expanded)
      );

      if (widget.options.length === 0) {
        // El propietario puede abrir su propio selector.
        callbacks.onWidgetSelect?.(widget.id);
        return;
      }

      this.showWidgetMenu(
        btn,
        widget.options,
        callbacks
      );
    };
  }

  // ============================================================
  // CONTROLES DINÁMICOS
  // ============================================================

  private static renderDynamicControls(
    container: HTMLElement,
    controls: WidgetDynamicControl[],
    callbacks: WidgetControlsRendererCallbacks
  ): void {

    const wrapper = container.createDiv({
      cls: 'fl-widget-dynamic-controls'
    });

    for (const control of controls) {

      switch (control.type) {

        case 'select':
          this.renderSelectControl(
            wrapper,
            control,
            callbacks
          );
          break;
          
        case 'picker':
		this.renderPickerControl(
		  wrapper,
		  control,
		  callbacks
		);
		break;

        case 'action':
          this.renderActionControl(
            wrapper,
            control,
            callbacks
          );
          break;

        case 'icon-action':
          this.renderIconActionControl(
            wrapper,
            control,
            callbacks
          );
          break;

        case 'status':
          this.renderStatusControl(
            wrapper,
            control
          );
          break;
      }
    }
  }

  // ============================================================
  // SELECT
  // ============================================================

  private static renderSelectControl(
    container: HTMLElement,
    control: Extract<WidgetDynamicControl, { type: 'select' }>,
    callbacks: WidgetControlsRendererCallbacks
  ): void {

    const btn = container.createEl('button', {
      cls: 'fl-widget-control-item',
      attr: {
        type: 'button',
        'aria-expanded': 'false'
      }
    });

    btn.createSpan({
      cls: 'fl-control-label',
      text: control.label
    });

    btn.createSpan({
      cls: 'fl-control-separator',
      text: '·'
    });

    btn.createSpan({
      cls: 'fl-control-value',
      text: control.value ?? ''
    });

    const arrow = btn.createSpan({
      cls: 'fl-control-arrow'
    });

    setIcon(arrow, 'chevron-down');

    if (control.disabled) {
      btn.disabled = true;
      return;
    }

    btn.onclick = () => {

      const expanded =
        btn.getAttribute('aria-expanded') === 'true';

      btn.setAttribute(
        'aria-expanded',
        String(!expanded)
      );

      this.showDynamicMenu(
        btn,
        control.options,
		(option) => {
		  callbacks.onControlSelect?.(
			control.id,
			option
		  );
		}
      );
    };
  }


	// ============================================================
	// PICKER
	// ============================================================

	private static renderPickerControl(
	  container: HTMLElement,
	  control: Extract<WidgetDynamicControl, { type: 'picker' }>,
	  callbacks: WidgetControlsRendererCallbacks
	): void {

	  const btn = container.createEl('button', {
		cls: 'fl-widget-control-item',
		attr: {
		  type: 'button',
		  'aria-expanded': 'false',
		  // Identificador estable para que el widget dueño
		  // pueda localizar el control (p. ej. anclar su menú).
		  'data-control-id': control.id
		}
	  });
	  
	  if (control.icon) {
		  const iconSpan = btn.createSpan({
			cls: 'fl-control-icon'
		  });

		  setIcon(iconSpan, control.icon);
		}

	  btn.createSpan({
		cls: 'fl-control-label',
		text: control.label
	  });

	  const arrow = btn.createSpan({
		cls: 'fl-control-arrow'
	  });

	  setIcon(arrow, 'chevron-down');

	  if (control.disabled) {
		btn.disabled = true;
		return;
	  }

	  btn.onclick = () => {

		const expanded =
		  btn.getAttribute('aria-expanded') === 'true';

		btn.setAttribute(
		  'aria-expanded',
		  String(!expanded)
		);

		callbacks.onPickerOpen?.(control.id);
	  };
	}


  // ============================================================
  // ACTION
  // ============================================================

  private static renderActionControl(
    container: HTMLElement,
    control: Extract<WidgetDynamicControl, { type: 'action' }>,
    callbacks: WidgetControlsRendererCallbacks
  ): void {

    const btn = container.createEl('button', {
      cls: 'fl-widget-control-item',
      attr: {
        type: 'button',
        // Identificador estable: permite que el widget dueño
        // localice el botón (p. ej. ocultar «Guardar» sin
        // comparar el texto visible, que cambia con i18n).
        'data-control-id': control.id
      }
    });

    if (control.primary) {
      btn.addClass('is-primary');
    }

    btn.createSpan({
      cls: 'fl-control-label',
      text: control.label
    });

    if (control.disabled) {
      btn.disabled = true;
      return;
    }

    btn.onclick = () => {
      callbacks.onAction?.(control.id);
    };
  }

  // ============================================================
  // ICON ACTION
  // ============================================================

  private static renderIconActionControl(
    container: HTMLElement,
    control: Extract<WidgetDynamicControl, { type: 'icon-action' }>,
    callbacks: WidgetControlsRendererCallbacks
  ): void {

    const btn = container.createEl('button', {
      cls: 'fl-widget-control-item fl-widget-control-icon',
      attr: {
        type: 'button',
        'aria-label': control.label ?? control.tooltip ?? control.id
      }
    });

    const iconSpan = btn.createSpan({
      cls: 'fl-control-icon'
    });

    setIcon(iconSpan, control.icon);

    if (control.tooltip) {
      btn.setAttribute('title', control.tooltip);
    }

    if (control.disabled) {
      btn.disabled = true;
      return;
    }

    btn.onclick = () => {
      callbacks.onAction?.(control.id);
    };
  }

  // ============================================================
  // STATUS
  // ============================================================

  private static renderStatusControl(
    container: HTMLElement,
    control: Extract<WidgetDynamicControl, { type: 'status' }>
  ): void {

    const item = container.createDiv({
	  cls: 'fl-widget-control-status',
	  attr: {
		'data-control-id': control.id
	  }
	});

    if (control.state) {
      item.addClass(`is-${control.state}`);
    }

    if (control.icon) {
      const iconSpan = item.createSpan({
        cls: 'fl-control-icon'
      });

      setIcon(iconSpan, control.icon);
    }

    item.createSpan({
      cls: 'fl-control-label',
      text: control.label
    });
  }

  // ============================================================
  // MENÚ DE FUENTE
  // ============================================================

  private static showSourceMenu(
    anchor: HTMLElement,
    options: WidgetControlOption[],
    callbacks: WidgetControlsRendererCallbacks
  ): void {

    const menu = new Menu();

    for (const option of options) {

      menu.addItem(item => {

        if (option.icon) {
          item.setIcon(option.icon);
        }

        item
          .setTitle(option.label)
          .onClick(() => {
            callbacks.onSourceSelect?.(option.id);
          });
      });
    }

    const rect = anchor.getBoundingClientRect();

    menu.showAtPosition({
      x: rect.left,
      y: rect.bottom + 4
    });
  }

  // ============================================================
  // MENÚ DE WIDGET
  // ============================================================

  private static showWidgetMenu(
    anchor: HTMLElement,
    options: WidgetControlOption[],
    callbacks: WidgetControlsRendererCallbacks
  ): void {

    const menu = new Menu();

    /*
     * Estado del indicador: al cerrarse el menú, el chevron
     * vuelve a apuntar hacia abajo (aria-expanded=false).
     */
    menu.onHide(() => {
      anchor.setAttribute('aria-expanded', 'false');
    });

    for (const option of options) {

      menu.addItem(item => {

        if (option.icon) {
          item.setIcon(option.icon);
        }

        item
          .setTitle(option.label)
          .onClick(() => {
            callbacks.onWidgetSelect?.(option.id);
          });
      });
    }

    const rect = anchor.getBoundingClientRect();

    menu.showAtPosition({
      x: rect.left,
      y: rect.bottom + 4
    });
  }

  // ============================================================
  // MENÚ DINÁMICO
  // ============================================================

  private static showDynamicMenu(
    anchor: HTMLElement,
    options: WidgetControlOption[],
    onSelect: (option: WidgetControlOption) => void
  ): void {

    const menu = new Menu();

    for (const option of options) {

      menu.addItem(item => {

        if (option.icon) {
          item.setIcon(option.icon);
        }

        item
          .setTitle(option.label)
          .onClick(() => {
            onSelect(option);
          });
      });
    }

    const rect = anchor.getBoundingClientRect();

    menu.showAtPosition({
      x: rect.left,
      y: rect.bottom + 4
    });
  }
}
