// src/utils/rootPath.ts
//
// Normalización de la raíz Master (M5 de la auditoría adversarial).
//
// bookRootPath puede contener barras iniciales/finales según cómo lo
// haya escrito el usuario; sin normalizar se crearían rutas
// equivalentes con '//' o carpetas duplicadas en los almacenes
// nuevos (Folder Lab/…). Compatible con minAppVersion 1.4.4 (solo
// operaciones de cadena).

export function normalizeRootPath(
  path: string | null | undefined
): string | null {
  if (!path) return null;
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? trimmed : null;
}
