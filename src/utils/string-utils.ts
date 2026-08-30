// ============================================================
// STRING UTILS
// ============================================================
// Utilidades para manipulación de strings
// ============================================================

/**
 * Limpia un texto eliminando frontmatter, títulos, enlaces y etiquetas
 * Útil para contar palabras o detectar contenido vacío
 */
export function cleanText(text: string): string {
  let clean = text;
  
  // Eliminar frontmatter (--- ... ---)
  const fmMatch = clean.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    clean = clean.replace(fmMatch[0], '');
  }
  
  // Eliminar títulos (#)
  clean = clean.replace(/^#.*$/gm, '');
  
  // Eliminar enlaces [[...]] y ![[...]]
  clean = clean.replace(/\[\[.*?\]\]/g, '');
  clean = clean.replace(/!\[\[.*?\]\]/g, '');
  
  // Eliminar etiquetas #tag
  clean = clean.replace(/#\w+/g, '');
  
  // Eliminar código inline
  clean = clean.replace(/`.*?`/g, '');
  
  // Limpiar espacios múltiples
  clean = clean.replace(/\s+/g, ' ');
  
  return clean.trim();
}

/**
 * Cuenta las palabras en un texto
 */
export function countWords(text: string): number {
  const clean = cleanText(text);
  return clean === '' ? 0 : clean.split(/\s+/).length;
}

/**
 * Detecta si una nota está vacía (sin contenido significativo)
 * @param content Contenido de la nota
 * @param threshold Número mínimo de caracteres para considerar que tiene contenido (default: 10)
 */
export function isNoteEmpty(content: string, threshold: number = 10): boolean {
  const clean = cleanText(content);
  return clean.length < threshold;
}

/**
 * Obtiene el nombre del archivo sin extensión
 */
export function getFileNameWithoutExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

/**
 * Capitaliza la primera letra de un string
 */
export function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Trunca un string a una longitud máxima
 */
export function truncate(str: string, maxLength: number = 100, suffix: string = '...'): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}
