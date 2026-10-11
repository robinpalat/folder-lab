// ============================================================
// CONSTANTS: statuses
// ============================================================

import { i18n } from '../i18n/I18nService';

/**
 * Estados semánticos de las notas
 * Estos son los valores que se guardan en el archivo
 */
export type NoteStatus = 
  | 'draft'
  | 'inProgress'
  | 'completed'
  | 'pending'
  | 'review'
  | 'approved'
  | 'discarded'
  | 'questions'
  | 'highPriority'
  | 'mediumPriority'
  | 'bookmark'
  | 'thumb-down';

/**
 * Mapa de estado semántico → icono de Obsidian
 */
export const STATUS_ICONS: Record<NoteStatus, string> = {
  draft: 'pencil',
  inProgress: 'clock',
  completed: 'check-circle',
  pending: 'alert-circle',
  review: 'eye',
  approved: 'thumb-up',
  discarded: 'x-circle',
  questions: 'help-circle',
  highPriority: 'flag',
  mediumPriority: 'star',
  bookmark: 'bookmark',
  'thumb-down': 'thumb-down'
};

/**
 * Lista de todos los estados con su información.
 *
 * Los `id` son IDENTIFICADORES PERSISTIDOS: no se traducen ni
 * se renombran. El `label` se resuelve en cada acceso con el
 * idioma activo (getter), de modo que cualquier consumidor
 * (menús, filtros, tooltips) muestra la traducción vigente sin
 * congelar el texto en la carga del módulo.
 */
export const STATUSES = [
  { id: 'draft', get label() { return i18n.t('statuses.draft'); }, icon: 'pencil' },
  { id: 'inProgress', get label() { return i18n.t('statuses.inProgress'); }, icon: 'clock' },
  { id: 'completed', get label() { return i18n.t('statuses.completed'); }, icon: 'check-circle' },
  { id: 'pending', get label() { return i18n.t('statuses.pending'); }, icon: 'alert-circle' },
  { id: 'review', get label() { return i18n.t('statuses.review'); }, icon: 'eye' },
  { id: 'approved', get label() { return i18n.t('statuses.approved'); }, icon: 'thumb-up' },
  { id: 'discarded', get label() { return i18n.t('statuses.discarded'); }, icon: 'x-circle' },
  { id: 'questions', get label() { return i18n.t('statuses.questions'); }, icon: 'help-circle' },
  { id: 'highPriority', get label() { return i18n.t('statuses.highPriority'); }, icon: 'flag' },
  { id: 'mediumPriority', get label() { return i18n.t('statuses.mediumPriority'); }, icon: 'star' },
  { id: 'bookmark', get label() { return i18n.t('statuses.bookmark'); }, icon: 'bookmark' },
  { id: 'thumb-down', get label() { return i18n.t('statuses.thumbDown'); }, icon: 'thumb-down' }
] as const;

/**
 * Obtiene el icono para un estado
 */
export function getStatusIcon(status: string | null | undefined): string {
  if (!status) return 'more-vertical';
  return STATUS_ICONS[status as NoteStatus] || 'more-vertical';
}

/**
 * Obtiene la etiqueta para un estado
 */
export function getStatusLabel(statusId: string | null): string {
  if (!statusId) return i18n.t('statuses.noStatus');
  const found = STATUSES.find(s => s.id === statusId);
  return found?.label || statusId;
}
