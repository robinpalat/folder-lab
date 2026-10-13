// src/utils/dataPath.ts
//
// Raíz de la carpeta técnica de datos (E1).
//
// La carpeta técnica vive en `<Master>/Folder Lab/` (Etapa 5 de la
// reforma de almacenamiento). El explorador de Folder Lab debe
// excluirla y sus descendientes de las vistas de usuario, mientras
// los servicios de almacenamiento siguen accediendo por rutas
// reales (adapter).
//
// Solo se considera técnica la carpeta bajo el Master CONFIGURADO:
// una carpeta de usuario llamada "Folder Lab" en otra ubicación NO
// se oculta. Sin Master configurado no hay raíz técnica.

import { normalizeRootPath } from './rootPath';

export const TECHNICAL_FOLDER_NAME = 'Folder Lab';

/** Raíz técnica normalizada (`<Master>/Folder Lab`) o null. */
export function technicalDataRoot(
  masterRoot: string | null | undefined
): string | null {
  const master = normalizeRootPath(masterRoot);
  return master ? `${master}/${TECHNICAL_FOLDER_NAME}` : null;
}

/**
 * true si `path` ES la carpeta técnica o está dentro de ella.
 * Ambas rutas se normalizan (barras iniciales/finales).
 */
export function isTechnicalDataPath(
  path: string,
  masterRoot: string | null | undefined
): boolean {
  const root = technicalDataRoot(masterRoot);
  if (!root || !path) return false;
  const normalized = path.replace(/^\/+|\/+$/g, "");
  return normalized === root || normalized.startsWith(`${root}/`);
}
