// ============================================================
// FILE UTILS
// ============================================================
// Utilidades para manipulación de archivos
// ============================================================

import { App, TFile } from 'obsidian';

/**
 * Obtiene la ruta relativa de un archivo con respecto a una carpeta base
 */
export function getRelativePath(filePath: string, basePath: string): string {
  return filePath.replace(basePath + '/', '');
}

/**
 * Obtiene la extensión de un archivo
 */
export function getFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/**
 * Verifica si un archivo es una nota Markdown
 */
export function isMarkdownFile(file: TFile): boolean {
  return file.extension === 'md';
}

/**
 * Verifica si un archivo debe ser ignorado (compilado, oculto, etc.)
 */
export function shouldIgnoreFile(file: TFile, folderName: string, internalFolder: string): boolean {
  // Ignorar nota compilada (mismo nombre que la carpeta)
  if (file.name === `${folderName}.md`) return true;
  
  // Ignorar archivos que empiezan con _
  if (file.name.startsWith('_')) return true;
  
  // Ignorar archivos dentro de la carpeta oculta
  if (file.path.includes(`/${internalFolder}/`)) return true;
  
  return false;
}

/**
 * Obtiene el frontmatter de un archivo como objeto
 */
export async function getFrontmatter(app: App, file: TFile): Promise<Record<string, unknown>> {
  try {
    const content = await app.vault.read(file);
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    
    if (!fmMatch) return {};
    
    const frontmatter = fmMatch[1];
    const lines = frontmatter.split('\n');
    const result: Record<string, unknown> = {};
    
    for (const line of lines) {
      const trimmed = line.trim();
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();
        result[key] = value;
      }
    }
    
    return result;
  } catch {
    return {};
  }
}

/**
 * Actualiza una propiedad en el frontmatter de un archivo
 */
export async function setFrontmatterProperty(
  app: App,
  file: TFile,
  property: string,
  value: string
): Promise<void> {
  const content = await app.vault.read(file);
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  
  let newContent: string;
  
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    const lines = frontmatter.split('\n');
    const updatedLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${property}:`)) {
        return `${property}: ${value}`;
      }
      return line;
    });
    
    if (!lines.some(line => line.trim().startsWith(`${property}:`))) {
      updatedLines.push(`${property}: ${value}`);
    }
    
    const newFrontmatter = updatedLines.join('\n');
    newContent = content.replace(fmMatch[0], `---\n${newFrontmatter}\n---\n`);
  } else {
    newContent = `---\n${property}: ${value}\n---\n\n${content}`;
  }
  
  await app.vault.modify(file, newContent);
}
