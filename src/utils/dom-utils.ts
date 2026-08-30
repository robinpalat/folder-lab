// ============================================================
// DOM UTILS
// ============================================================
// Utilidades para manipulación del DOM sin estilos inline.
// Todas las funciones usan clases CSS en lugar de estilos inline.
// ============================================================

import { setIcon } from 'obsidian';

// ============================================================
// CLASES CSS PREDEFINIDAS
// ============================================================

export const DOM_CLASSES = {
  // Flexbox
  FLEX: 'fo-flex',
  FLEX_COLUMN: 'fo-flex-column',
  FLEX_CENTER: 'fo-flex-center',
  FLEX_ALIGN_CENTER: 'fo-flex-align-center',
  FLEX_SPACE_BETWEEN: 'fo-flex-space-between',
  FLEX_START: 'fo-flex-start',
  FLEX_END: 'fo-flex-end',
  FLEX_1: 'fo-flex-1',
  SHRINK_0: 'fo-shrink-0',
  
  // Gap
  GAP_4: 'fo-gap-4',
  GAP_6: 'fo-gap-6',
  GAP_8: 'fo-gap-8',
  GAP_10: 'fo-gap-10',
  GAP_12: 'fo-gap-12',
  
  // Padding
  P_0: 'fo-p-0',
  P_4: 'fo-p-4',
  P_6: 'fo-p-6',
  P_8: 'fo-p-8',
  P_12: 'fo-p-12',
  P_16: 'fo-p-16',
  PX_4: 'fo-px-4',
  PX_6: 'fo-px-6',
  PX_8: 'fo-px-8',
  PX_12: 'fo-px-12',
  PY_2: 'fo-py-2',
  PY_4: 'fo-py-4',
  PY_6: 'fo-py-6',
  PY_8: 'fo-py-8',
  
  // Margin
  M_0: 'fo-m-0',
  MT_2: 'fo-mt-2',
  MT_4: 'fo-mt-4',
  MT_8: 'fo-mt-8',
  MT_12: 'fo-mt-12',
  MB_2: 'fo-mb-2',
  MB_4: 'fo-mb-4',
  MB_8: 'fo-mb-8',
  ML_AUTO: 'fo-ml-auto',
  
  // Text
  TEXT_CENTER: 'fo-text-center',
  TEXT_LEFT: 'fo-text-left',
  TEXT_RIGHT: 'fo-text-right',
  TEXT_MUTED: 'fo-text-muted',
  TEXT_ACCENT: 'fo-text-accent',
  TEXT_NORMAL: 'fo-text-normal',
  
  // Background
  BG_TRANSPARENT: 'fo-bg-transparent',
  BG_SECONDARY: 'fo-bg-secondary',
  BG_HOVER: 'fo-bg-hover',
  
  // Border
  BORDER_NONE: 'fo-border-none',
  BORDER_TOP: 'fo-border-top',
  BORDER_BOTTOM: 'fo-border-bottom',
  ROUNDED_4: 'fo-rounded-4',
  ROUNDED_6: 'fo-rounded-6',
  ROUNDED_8: 'fo-rounded-8',
  
  // Cursor
  CURSOR_POINTER: 'fo-cursor-pointer',
  CURSOR_DEFAULT: 'fo-cursor-default',
  CURSOR_GRAB: 'fo-cursor-grab',
  CURSOR_GRABBING: 'fo-cursor-grabbing',
  
  // Opacity
  OP_30: 'fo-op-30',
  OP_40: 'fo-op-40',
  OP_50: 'fo-op-50',
  OP_60: 'fo-op-60',
  OP_70: 'fo-op-70',
  OP_80: 'fo-op-80',
  OP_90: 'fo-op-90',
  OP_100: 'fo-op-100',
  
  // Overflow
  OVERFLOW_HIDDEN: 'fo-overflow-hidden',
  OVERFLOW_AUTO: 'fo-overflow-auto',
  
  // Position
  RELATIVE: 'fo-relative',
  ABSOLUTE: 'fo-absolute',
  
  // Width / Height
  W_FULL: 'fo-w-full',
  H_FULL: 'fo-h-full',
  MIN_H_0: 'fo-min-h-0',
  MAX_H_NONE: 'fo-max-h-none',
  
  // Grid
  GRID: 'fo-grid',
  GRID_COLS_3: 'fo-grid-cols-3',
  
  // Hidden
  HIDDEN: 'fo-hidden',
  
  // Transition
  TRANSITION: 'fo-transition',
  
  // Flex Wrap
  FLEX_WRAP: 'fo-flex-wrap',
};

// ============================================================
// FUNCIONES DE MANIPULACIÓN DE CLASES
// ============================================================

/**
 * Añade múltiples clases a un elemento
 */
export function addClasses(element: HTMLElement, ...classes: string[]): void {
  for (const cls of classes) {
    if (cls) element.addClass(cls);
  }
}

/**
 * Elimina múltiples clases de un elemento
 */
export function removeClasses(element: HTMLElement, ...classes: string[]): void {
  for (const cls of classes) {
    if (cls) element.removeClass(cls);
  }
}

/**
 * Alterna una clase en un elemento
 * @param element Elemento HTML
 * @param cls Nombre de la clase
 * @param force Si es true, fuerza la adición; si es false, fuerza la eliminación
 * @returns El nuevo estado de la clase (true = añadida, false = eliminada)
 */
export function toggleClass(element: HTMLElement, cls: string, force?: boolean): boolean {
  if (force === true) {
    element.addClass(cls);
    return true;
  }
  if (force === false) {
    element.removeClass(cls);
    return false;
  }
  // Alternar manualmente
  if (element.hasClass(cls)) {
    element.removeClass(cls);
    return false;
  } else {
    element.addClass(cls);
    return true;
  }
}

/**
 * Verifica si un elemento tiene una clase
 */
export function hasClass(element: HTMLElement, cls: string): boolean {
  return element.hasClass(cls);
}

// ============================================================
// FUNCIONES DE VISIBILIDAD
// ============================================================

/**
 * Oculta un elemento
 */
export function hideElement(element: HTMLElement): void {
  element.addClass(DOM_CLASSES.HIDDEN);
}

/**
 * Muestra un elemento
 */
export function showElement(element: HTMLElement): void {
  element.removeClass(DOM_CLASSES.HIDDEN);
}

// ============================================================
// FUNCIONES DE CONSTRUCCIÓN DE UI
// ============================================================

/**
 * Crea un contenedor flex con clases predefinidas
 */
export function createFlexContainer(
  parent: HTMLElement,
  direction: 'row' | 'col' = 'row',
  gap: 'sm' | 'md' | 'lg' = 'md',
  className: string = ''
): HTMLElement {
  const gapClass = gap === 'sm' ? DOM_CLASSES.GAP_4 : gap === 'md' ? DOM_CLASSES.GAP_8 : DOM_CLASSES.GAP_12;
  const dirClass = direction === 'row' ? DOM_CLASSES.FLEX : DOM_CLASSES.FLEX_COLUMN;
  
  const classes = [
    dirClass,
    gapClass,
    DOM_CLASSES.FLEX_ALIGN_CENTER
  ];
  
  if (className) classes.push(className);
  
  const el = parent.createEl('div', { cls: classes.join(' ') });
  return el;
}

/**
 * Crea un contenedor flex con alineación específica
 */
export function createFlexContainerWithAlignment(
  parent: HTMLElement,
  direction: 'row' | 'col' = 'row',
  align: 'start' | 'center' | 'end' | 'between' = 'center',
  gap: 'sm' | 'md' | 'lg' = 'md',
  className: string = ''
): HTMLElement {
  const alignClass = align === 'start' 
    ? DOM_CLASSES.FLEX_START 
    : align === 'end' 
      ? DOM_CLASSES.FLEX_END 
      : align === 'between' 
        ? DOM_CLASSES.FLEX_SPACE_BETWEEN 
        : DOM_CLASSES.FLEX_CENTER;
  
  const gapClass = gap === 'sm' ? DOM_CLASSES.GAP_4 : gap === 'md' ? DOM_CLASSES.GAP_8 : DOM_CLASSES.GAP_12;
  const dirClass = direction === 'row' ? DOM_CLASSES.FLEX : DOM_CLASSES.FLEX_COLUMN;
  
  const classes = [
    dirClass,
    alignClass,
    gapClass
  ];
  
  if (className) classes.push(className);
  
  const el = parent.createEl('div', { cls: classes.join(' ') });
  return el;
}

/**
 * Aplica un estado visual a un elemento
 */
export function applyElementState(
  element: HTMLElement,
  stateClass: string,
  active: boolean
): void {
  if (active) {
    element.addClass(stateClass);
  } else {
    element.removeClass(stateClass);
  }
}

// ============================================================
// FUNCIONES DE ICONOS
// ============================================================

/**
 * Crea un botón con icono
 */
export function createIconButton(
  parent: HTMLElement,
  icon: string,
  title: string,
  onClick: (event?: MouseEvent) => void,
  className: string = '',
  size: 'sm' | 'md' | 'lg' = 'md'
): HTMLButtonElement {
  const btn = parent.createEl('button', { 
    cls: `clickable-icon ${className}`,
    attr: { 'aria-label': title, 'title': title }
  });
  
  const iconEl = btn.createEl('span');
  setIcon(iconEl, icon);
  
  if (size === 'sm') {
    iconEl.style.width = '14px';
    iconEl.style.height = '14px';
  } else if (size === 'lg') {
    iconEl.style.width = '20px';
    iconEl.style.height = '20px';
  }
  
  btn.onclick = onClick;
  return btn;
}

// ============================================================
// FUNCIONES DE TEXTO
// ============================================================

/**
 * Obtiene el texto de un elemento de forma segura
 */
export function getElementText(element: HTMLElement | null): string {
  return element?.textContent || '';
}

/**
 * Establece el texto de un elemento de forma segura
 */
export function setElementText(element: HTMLElement | null, text: string): void {
  if (element) element.textContent = text;
}
