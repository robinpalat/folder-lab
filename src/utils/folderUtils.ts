
export function isHiddenFolderName(name: string): boolean {
  return (
    name.startsWith('.') ||
    name.startsWith('_')
  );
}

/**
 * Compara dos rutas de carpeta por IDENTIDAD normalizada
 * (barra final ignorada; "" = raíz física del vault). Nunca
 * compara por nombre visible.
 */
export function isSameFolderPath(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const normalize = (p: string | null | undefined): string =>
    (p ?? '').replace(/\/+$/, '');

  return normalize(a) === normalize(b);
}

export type NewFolderNameValidation =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'path-segment' };

/**
 * Valida el nombre de una carpeta a crear dentro de un destino.
 *
 * - Vacío (o solo espacios) → 'empty'.
 * - Con segmentos de ruta (barras, '.', '..') → 'path-segment':
 *   el nombre debe ser un segmento único, nunca salir del
 *   destino previsto.
 */
export function validateNewFolderName(raw: string): NewFolderNameValidation {
  const name = String(raw ?? '').trim();

  if (!name) {
    return { ok: false, reason: 'empty' };
  }

  if (
    name.includes('/') ||
    name.includes('\\') ||
    name === '.' ||
    name === '..'
  ) {
    return { ok: false, reason: 'path-segment' };
  }

  return { ok: true, name };
}

/**
 * Normaliza la lista configurable de carpetas ignoradas:
 * separa por comas o saltos de línea, recorta espacios,
 * elimina vacíos y duplicados. Comparación por NOMBRE de
 * carpeta (no por ruta): vale en cualquier nivel.
 */
export function parseIgnoredFolders(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of String(value ?? '').split(/[,\n]/)) {
    const name = part.trim();

    if (!name || seen.has(name)) continue;

    seen.add(name);
    result.push(name);
  }

  return result;
}

/**
 * Indica si una carpeta debe excluirse del orden global:
 * coincide (nombre exacto) con la lista configurable o sigue
 * las reglas históricas de carpetas ocultas.
 */
export function isIgnoredFolderName(
  name: string,
  ignoredFolders: string[] = []
): boolean {
  if (isHiddenFolderName(name)) return true;

  return ignoredFolders.some(
    (ignored) => ignored.trim() !== '' && ignored.trim() === name
  );
}
