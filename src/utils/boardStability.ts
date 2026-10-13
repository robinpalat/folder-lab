// src/utils/boardStability.ts
//
// Estabilidad del Board (Corrección B).
//
// 1. `boardMustCloseOnExit`: el Board solo se cierra al salir de un
//    modo global REALMENTE activo (foco o navigationMode ≠ normal),
//    no ante cualquier clic/selección/refresco del panel.
// 2. `pickLeafStrategy`: abrir una nota desde Folder Lab no debe
//    reemplazar la pestaña del Board; si el leaf activo ES el
//    Board, se abre en una pestaña nueva.

export interface ModeSnapshot {
  isFocusMode: boolean;
  navigationMode: string;
  normalMode: string;
}

export function boardMustCloseOnExit(state: ModeSnapshot): boolean {
  return state.isFocusMode || state.navigationMode !== state.normalMode;
}

/**
 * 'reuse-active': reutilizar el leaf activo (comportamiento previo).
 * 'new-tab': el leaf activo contiene el Board → abrir en pestaña
 * nueva para no destruir la vista del Board.
 */
export function pickLeafStrategy<T>(
  activeLeaf: T | null | undefined,
  boardLeaves: T[]
): 'reuse-active' | 'new-tab' {
  if (activeLeaf && boardLeaves.includes(activeLeaf)) {
    return 'new-tab';
  }
  return 'reuse-active';
}
