// ============================================================
// UTIL: HEADER STATS
// ============================================================
// Presentación de las estadísticas del encabezado. Módulo puro
// (sin Obsidian ni DOM): CADA VISTA aporta explícitamente su
// modelo; este módulo solo decide cómo se muestra. El encabezado
// nunca deduce el modelo a partir de la carpeta física actual.
//
// - Raíz master: notas directas · notas totales del libro ·
//   carpetas del libro (+ % de la meta si existe y hay conteo).
//   Los conteos cero (directas y carpetas) se omiten; el total
//   del libro y el % nunca se ocultan por esta regla.
// - Subcarpeta (navegación normal): solo conteos positivos
//   («notas» y «carpetas»); si la carpeta está completamente
//   vacía, «0 notas».
// - «Todas las carpetas»: carpetas listadas.
// - «Todas las notas»: notas listadas.
// - «Archivos recientes»: archivos recientes listados.
//
// El encabezado no tiene engranaje ni controles de meta: la meta
// del libro se edita desde el diálogo de conteo de palabras.
// ============================================================

import { i18n } from '../i18n/I18nService';

export interface BookGoalProgress {
  words: number;
  target: number;
}

/**
 * Modelo explícito de estadísticas por vista. Es discriminated
 * union: cada modo aporta SOLO sus valores y el % es exclusivo
 * de 'master-root'.
 */
export type HeaderStatsModel =
  | {
      kind: 'master-root';
      /** Notas Markdown directas y visibles de la raíz master. */
      directNotes: number;
      /** Notas del libro completo (raíz + subcarpetas elegibles). */
      totalNotes: number;
      /** Carpetas del ámbito del libro (sin ignoradas ni internas). */
      totalFolders: number;
      /** Progreso de la meta; solo este modo admite %. */
      goal?: BookGoalProgress | null;
    }
  | {
      kind: 'folder';
      /** Notas Markdown directas de la subcarpeta. */
      notes: number;
      /** Carpetas visibles directas (se muestran como «carpetas»). */
      subfolders: number;
    }
  | {
      kind: 'folders';
      /** Carpetas que aparecen en la lista de la vista. */
      folders: number;
    }
  | {
      kind: 'notes';
      /** Notas que aparecen en la lista de la vista. */
      notes: number;
    }
  | {
      kind: 'recent';
      /** Archivos que aparecen en la lista de recientes. */
      files: number;
    };

export interface HeaderStatsDisplay {
  /** Recuentos del modo (sin el sufijo de porcentaje). */
  noteText: string;
  /** Sufijo « · X % completado» (meta del libro), solo master. */
  suffixText: string | null;
  /** Tooltip del sufijo (palabras / meta) cuando procede. */
  suffixTitle: string | null;
}

/**
 * Limita un porcentaje al rango [0, 100] y lo redondea.
 */
export function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Compose un conteo con concordancia singular/plural según el
 * idioma activo (Intl.PluralRules vía i18n.tn). Misma
 * composición que el formatCount histórico: «N nota(s)».
 */
function formatCount(value: number, pluralKey: string): string {
  return `${value} ${i18n.tn(pluralKey, value)}`;
}

/**
 * Construye la presentación del encabezado para el modelo que la
 * vista activa acaba de aportar.
 */
export function buildHeaderStatsDisplay(
  model: HeaderStatsModel
): HeaderStatsDisplay {
  switch (model.kind) {
    // ---------------------------------------------------------
    // Raíz master: contrato propio. Notas directas y carpetas
    // omiten el cero; el total del libro y el % se muestran
    // siempre que existan sus datos (no se ocultan por vacíos).
    // ---------------------------------------------------------
    case 'master-root': {
      const parts: string[] = [];

      if (model.directNotes > 0) {
        parts.push(formatCount(model.directNotes, 'stats.note'));
      }

      // El total del libro nunca se oculta por esta regla.
      parts.push(formatCount(model.totalNotes, 'stats.totalNote'));

      if (model.totalFolders > 0) {
        parts.push(formatCount(model.totalFolders, 'stats.folder'));
      }

      const noteText = parts.join(' · ');

      if (model.goal && model.goal.target > 0) {
        const percentage = clampPercentage(
          (model.goal.words / model.goal.target) * 100
        );

        return {
          noteText,
          suffixText: i18n.t('stats.percentCompleted', { percentage }),
          suffixTitle: i18n.t('stats.goalTooltip', {
            words: model.goal.words,
            target: model.goal.target
          })
        };
      }

      return { noteText, suffixText: null, suffixTitle: null };
    }

    // ---------------------------------------------------------
    // Subcarpeta: solo conteos positivos, con «carpetas» (no
    // «subcarpetas»). Excepción: carpeta completamente vacía →
    // «0 notas».
    // ---------------------------------------------------------
    case 'folder': {
      const parts: string[] = [];

      if (model.notes > 0) {
        parts.push(formatCount(model.notes, 'stats.note'));
      }

      if (model.subfolders > 0) {
        parts.push(formatCount(model.subfolders, 'stats.folder'));
      }

      // Único caso en que un cero se muestra: vacío total.
      if (parts.length === 0) {
        parts.push(i18n.t('stats.zeroNotes'));
      }

      return {
        noteText: parts.join(' · '),
        suffixText: null,
        suffixTitle: null
      };
    }

    // ---------------------------------------------------------
    // «Todas las carpetas»: solo el total de carpetas listadas.
    // ---------------------------------------------------------
    case 'folders':
      return {
        noteText: i18n.t('stats.foldersListed', { count: model.folders }),
        suffixText: null,
        suffixTitle: null
      };

    // ---------------------------------------------------------
    // «Todas las notas» (y contextos de properties): solo notas.
    // ---------------------------------------------------------
    case 'notes':
      return {
        noteText: i18n.t('stats.notesListed', { count: model.notes }),
        suffixText: null,
        suffixTitle: null
      };

    // ---------------------------------------------------------
    // «Archivos recientes»: solo los archivos de la lista.
    // ---------------------------------------------------------
    case 'recent':
      return {
        noteText: i18n.t('stats.recentFiles', { count: model.files }),
        suffixText: null,
        suffixTitle: null
      };
  }
}

// ============================================================
// INICIALIZACIÓN DE SESIÓN DEL CONTEO DE PALABRAS
// ============================================================

/**
 * Decide si debe iniciarse automáticamente el conteo de palabras
 * del libro al comenzar la sesión. Reglas:
 *
 * 1. Solo una patada por sesión (alreadyStarted).
 * 2. Solo si hay meta global configurada.
 * 3. Solo si aún no existe un resultado válido en memoria.
 *
 * Las peticiones simultáneas las resuelve además la caché
 * single-flight del controlador.
 */
export function shouldStartSessionWordCount(input: {
  alreadyStarted: boolean;
  goal: number;
  hasCachedResult: boolean;
}): boolean {
  if (input.alreadyStarted) return false;
  if (!(input.goal > 0)) return false;
  if (input.hasCachedResult) return false;
  return true;
}

// ============================================================
// ENTRADA DE LA META (diálogo de conteo de palabras)
// ============================================================

export type GoalInputParse =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'valid'; value: number };

/**
 * Parsea la entrada de la meta de palabras del libro.
 *
 * - Vacío → 'empty' (el diálogo lo interpreta como quitar meta).
 * - Entero positivo → 'valid'.
 * - Cualquier otra cosa (decimales, negativos, texto) → 'invalid'.
 */
export function parseBookGoalInput(raw: string): GoalInputParse {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return { kind: 'empty' };
  }

  // Solo dígitos: rechaza 1.5, 1e3, "-1", "abc", etc.
  if (!/^\d+$/.test(trimmed)) {
    return { kind: 'invalid' };
  }

  const value = Number.parseInt(trimmed, 10);

  if (!Number.isSafeInteger(value) || value <= 0) {
    return { kind: 'invalid' };
  }

  return { kind: 'valid', value };
}
