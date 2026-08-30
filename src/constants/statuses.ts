// ============================================================
// CONSTANTS: statuses
// ============================================================

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
 * Lista de todos los estados con su información
 */
export const STATUSES = [
  { id: 'draft', label: 'Borrador', icon: 'pencil' },
  { id: 'inProgress', label: 'En progreso', icon: 'clock' },
  { id: 'completed', label: 'Completado', icon: 'check-circle' },
  { id: 'pending', label: 'Pendiente', icon: 'alert-circle' },
  { id: 'review', label: 'Revisar', icon: 'eye' },
  { id: 'approved', label: 'Aprobado', icon: 'thumb-up' },
  { id: 'discarded', label: 'Descartado', icon: 'x-circle' },
  { id: 'questions', label: 'Dudas', icon: 'help-circle' },
  { id: 'highPriority', label: 'Prioridad alta', icon: 'flag' },
  { id: 'mediumPriority', label: 'Prioridad media', icon: 'star' },
  { id: 'bookmark', label: 'Guardado', icon: 'bookmark' },
  { id: 'thumb-down', label: 'Revisar', icon: 'thumb-down' }
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
  if (!statusId) return 'Sin estado';
  const found = STATUSES.find(s => s.id === statusId);
  return found?.label || statusId;
}
