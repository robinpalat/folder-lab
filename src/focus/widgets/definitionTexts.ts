// ============================================================
// WIDGET DEFINITION TEXTS
// ============================================================
// Resuelve los textos de PRESENTACIÓN de una definición de
// widget declarativo (label, description, emptyState, placeholder)
// desde el catálogo i18n, usando el id estable del widget
// (widgets.defs.<id>.*). Los ids, iconos, colores, entidades y
// cualquier otro valor funcional del JSON NO se traducen.
//
// Si una clave no existe en el catálogo, se conserva el valor
// heredado del JSON como fallback (identidad intacta; la fuente
// de verdad de la presentación es el catálogo).
// ============================================================

import { i18n } from '../../i18n/I18nService';

/** Vista mínima y estructural de una definición declarativa. */
export interface WidgetDefinitionLike {
  id: string;
  identity?: { label?: string; description?: string };
  emptyState?: { message?: string };
  input?: { text?: { placeholder?: string } };
}

/** Etiqueta visible del widget (selector, menús, tarjetas). */
export function getWidgetDefinitionLabel(
  definition: WidgetDefinitionLike
): string {
  const key = `widgets.defs.${definition.id}.label`;
  if (i18n.has(key)) return i18n.t(key);
  return definition.identity?.label ?? '';
}

/** Descripción visible (Biblioteca / gestor de widgets). */
export function getWidgetDefinitionDescription(
  definition: WidgetDefinitionLike
): string {
  const key = `widgets.defs.${definition.id}.description`;
  if (i18n.has(key)) return i18n.t(key);
  return definition.identity?.description ?? '';
}

/** Mensaje del estado vacío del widget. */
export function getWidgetDefinitionEmptyState(
  definition: WidgetDefinitionLike
): string {
  const key = `widgets.defs.${definition.id}.emptyState`;
  if (i18n.has(key)) return i18n.t(key);
  return definition.emptyState?.message ?? '';
}

/** Placeholder del campo de texto del widget. */
export function getWidgetDefinitionPlaceholder(
  definition: WidgetDefinitionLike
): string {
  const key = `widgets.defs.${definition.id}.placeholder`;
  if (i18n.has(key)) return i18n.t(key);
  return definition.input?.text?.placeholder ?? '';
}
