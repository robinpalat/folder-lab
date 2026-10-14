// src/utils/rootPath.ts
//
// Normalización de la raíz Master (M5 + soporte de raíz del vault).
//
// Contrato (tras esta corrección):
// - `null`  → Master NO configurado.
// - `''`    → Master = RAÍZ DEL VAULT (configuración válida: '/').
// - `'X'`   → Master en la subcarpeta X (barras iniciales/finales
//             eliminadas).
//
// Todas las rutas de la arquitectura central se construyen con
// `joinVaultRoot(root, ...segments)` — sin barras dobles ni rutas
// absolutas accidentales. Compatible con minAppVersion 1.4.4.

/**
 * Normaliza bookRootPath al contrato: null = sin configurar;
 * '' = raíz del vault ('/'); 'X' = subcarpeta.
 */
export function normalizeRootPath(
  path: string | null | undefined
): string | null {
  if (path === null || path === undefined) return null;
  const trimmed = path.trim();
  if (trimmed === '') return null; // campo vacío = sin configurar
  const cleaned = trimmed.replace(/^\/+|\/+$/g, "");
  // '/' (o solo barras) = raíz del vault → ''.
  return cleaned;
}

/**
 * Única forma segura de construir rutas relativas al vault a
 * partir de la raíz normalizada. `root === ''` (raíz del vault)
 * no produce barra inicial.
 */
export function joinVaultRoot(
  root: string,
  ...segments: string[]
): string {
  const clean = (s: string) => s.trim().replace(/^\/+|\/+$/g, "");
  const parts = [
    clean(root),
    ...segments.map(clean).filter(Boolean)
  ].filter((p) => p !== "");
  return parts.join("/");
}
