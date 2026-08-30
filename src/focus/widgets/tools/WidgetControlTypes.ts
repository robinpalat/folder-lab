export interface WidgetControlOption {
  id: string;
  label: string;
  icon?: string;
  children?: WidgetControlOption[];
}

export interface WidgetSelectorControl {
  type: 'widget-selector';

  id: string;
  label: string;
  icon?: string;

  options: WidgetControlOption[];

  disabled?: boolean;
}

export interface WidgetSourceControl {
  type: 'source-selector';

  mode: 'selectable' | 'fixed' | 'none';

  id?: string;
  label?: string;
  icon?: string;

  options?: WidgetControlOption[];

  disabled?: boolean;
}

export interface WidgetSelectControl {
  type: 'select';

  id: string;
  label: string;
  value?: string;

  options: WidgetControlOption[];

  disabled?: boolean;
}

export interface WidgetActionControl {
  type: 'action';

  id: string;
  label: string;

  disabled?: boolean;
  primary?: boolean;

}

export interface WidgetPickerControl {
  type: 'picker';

  id: string;
  label: string;

  icon?: string;

  disabled?: boolean;
}

export interface WidgetIconActionControl {
  type: 'icon-action';

  id: string;

  icon: string;

  label?: string;
  tooltip?: string;

  disabled?: boolean;

}

export interface WidgetStatusControl {
  type: 'status';

  id: string;

  icon?: string;

  label: string;

  state?: 'default' | 'success' | 'warning' | 'error';
}

export type WidgetDynamicControl =
  | WidgetSelectControl
  | WidgetPickerControl
  | WidgetActionControl
  | WidgetIconActionControl
  | WidgetStatusControl;

export interface WidgetControlsConfig {
  widget: WidgetSelectorControl;
  source?: WidgetSourceControl;
  dynamic: WidgetDynamicControl[];
}
