import type {
  WidgetActionControl,
  WidgetControlsConfig,
  WidgetDynamicControl,
  WidgetIconActionControl,
  WidgetPickerControl,
  WidgetSelectControl,
  WidgetSelectorControl,
  WidgetSourceControl,
  WidgetStatusControl
} from './WidgetControlTypes';

export class WidgetControls {

  private widget?: WidgetSelectorControl;

  private source?: WidgetSourceControl;

  private readonly dynamicControls: WidgetDynamicControl[] = [];

  // ============================================================
  // IDENTIDAD
  // ============================================================

  setWidget(
    control: Omit<WidgetSelectorControl, 'type'>
  ): void {
    this.widget = {
      type: 'widget-selector',
      ...control
    };
  }

  // ============================================================
  // FUENTE
  // ============================================================

  setSource(
    control: Omit<WidgetSourceControl, 'type'>
  ): void {
    this.source = {
      type: 'source-selector',
      ...control
    };
  }

  // ============================================================
  // CONFIGURACIÓN
  // ============================================================

  select(
    control: Omit<WidgetSelectControl, 'type'>
  ): void {
    this.dynamicControls.push({
      type: 'select',
      ...control
    });
  }
  
	picker(
	  control: Omit<WidgetPickerControl, 'type'>
	): void {
	  this.dynamicControls.push({
		type: 'picker',
		...control
	  });
	}
  

  status(
    control: Omit<WidgetStatusControl, 'type'>
  ): void {
    this.dynamicControls.push({
      type: 'status',
      ...control
    });
  }

  // ============================================================
  // EJECUCIÓN
  // ============================================================

  action(
    control: Omit<WidgetActionControl, 'type'>
  ): void {
    this.dynamicControls.push({
      type: 'action',
      ...control
    });
  }
  

  iconAction(
    control: Omit<WidgetIconActionControl, 'type'>
  ): void {
    this.dynamicControls.push({
      type: 'icon-action',
      ...control
    });
  }

  // ============================================================
  // LECTURA
  // ============================================================

  getConfig(): WidgetControlsConfig {
    const config: WidgetControlsConfig = {
      widget: this.widget ?? {
        type: 'widget-selector',
        id: '',
        label: '',
        options: []
      },

      dynamic: [...this.dynamicControls]
    };

    if (this.source) {
      config.source = this.source;
    }

    return config;
  }

	getDynamicControls(): readonly WidgetDynamicControl[] {
	  return [...this.dynamicControls];
	}

  // ============================================================
  // RESET
  // ============================================================

  clear(): void {
    this.widget = undefined;
    this.source = undefined;
    this.dynamicControls.length = 0;
  }
}
