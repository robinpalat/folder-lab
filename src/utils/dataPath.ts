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

import { normalizeRootPath, joinVaultRoot } from './rootPath';

export const TECHNICAL_FOLDER_NAME = 'Folder Lab';

/**
 * Raíz técnica normalizada o null.
 * Contrato: `masterRoot` llega YA normalizado (null = sin Master;
 * '' = raíz del vault; 'X' = subcarpeta).
 */
export function technicalDataRoot(
  masterRoot: string | null | undefined
): string | null {
  if (masterRoot === null || masterRoot === undefined) return null;
  return joinVaultRoot(masterRoot, TECHNICAL_FOLDER_NAME);
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

/**
 * Decisión de recarga ante `vault.on('modify')` (Corrección del
 * renderizado innecesario).
 *
 * Falso para datos técnicos (`Folder Lab/`, `.folder-lab/`): sus
 * escrituras (activity.log, borradores, entidades, ids.json…) no
 * cambian el CONTENIDO de la carpeta que el explorador muestra y
 * provocaban reconstrucciones innecesarias de la lista al abrir
 * una nota (append del log de actividad del propio registro).
 */
export function shouldReloadFolderOnModify(
  path: string,
  currentPath: string | null | undefined,
  masterRoot: string | null | undefined
): boolean {
  // '' = raíz del vault (currentPath válido); solo null/undefined
  // desactivan la recarga.
  if (!path || currentPath === null || currentPath === undefined) {
    return false;
  }
  if (path.includes(`/.folder-lab/`)) return false;
  if (isTechnicalDataPath(path, masterRoot)) return false;
  return path.startsWith(currentPath);
}
