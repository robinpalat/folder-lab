// ============================================================
// WORD COUNT SERVICE
// ============================================================
// Gestiona el conteo de palabras del libro:
// - Cuenta palabras de toda la carpeta raíz y subcarpetas
// - Excluye archivos compilados y archivos internos
// - Genera estadísticas detalladas
// ============================================================

import { App, TFolder, TFile } from 'obsidian';
import { INTERNAL_FOLDER } from '../constants/view-types';
import { countWords as countWordsUtil } from '../utils/string-utils';

export interface WordCountResult {
  totalWords: number;
  totalNotes: number;
  avgWords: number;
  maxWords: { name: string; words: number };
  minWords: { name: string; words: number };
  details: { name: string; words: number }[];
}

export class WordCountService {
  private app: App;
  private rootPath: string;

  constructor(app: App, rootPath: string = '') {
    this.app = app;
    this.rootPath = rootPath;
  }

  // ============================================================
  // CONFIGURACIÓN
  // ============================================================

  /**
   * Establece la carpeta raíz del libro
   */
  setRootPath(path: string): void {
    this.rootPath = path;
  }

  /**
   * Obtiene la carpeta raíz del libro
   */
  getRootPath(): string {
    return this.rootPath;
  }

  // ============================================================
  // CONTEO DE PALABRAS DEL LIBRO
  // ============================================================

  /**
   * Cuenta las palabras de todo el libro (recursivo)
   */
  async countWordsInBook(): Promise<WordCountResult | null> {
    if (!this.rootPath) {
      return null;
    }

    const rootFolder = this.app.vault.getAbstractFileByPath(this.rootPath);
    if (!(rootFolder instanceof TFolder)) {
      return null;
    }

    return await this.walkFolderForWordCount(rootFolder);
  }

  /**
   * Cuenta palabras de una carpeta específica (recursivo)
   */
  async countWordsInFolder(folderPath: string): Promise<WordCountResult | null> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      return null;
    }

    return await this.walkFolderForWordCount(folder);
  }

  // ============================================================
  // RECORRIDO RECURSIVO
  // ============================================================

  /**
   * Recorre recursivamente una carpeta y cuenta palabras
   */
  private async walkFolderForWordCount(folder: TFolder): Promise<WordCountResult> {
    let totalWords = 0;
    let totalNotes = 0;
    const details: { name: string; words: number }[] = [];

    const items = folder.children;

    for (const item of items) {
      if (item instanceof TFolder) {
        // Saltar carpeta interna del plugin
        if (item.name === INTERNAL_FOLDER || item.name.startsWith('.')) continue;
        
        const subResult = await this.walkFolderForWordCount(item);
        totalWords += subResult.totalWords;
        totalNotes += subResult.totalNotes;
        details.push(...subResult.details);
        continue;
      }

      if (item instanceof TFile && item.extension === 'md') {
        // Saltar archivos internos
        if (item.name.startsWith('_')) continue;
        
        // Saltar nota compilada (mismo nombre que la carpeta padre)
        const parentFolder = item.parent;
        if (parentFolder && item.name === `${parentFolder.name}.md`) continue;
        
        // Saltar archivos dentro de .folder-lab
        if (item.path.includes(`/${INTERNAL_FOLDER}/`)) continue;

        const content = await this.app.vault.read(item);
        const wordCount = countWordsUtil(content);
        
        totalWords += wordCount;
        totalNotes++;
        
        const rootPath = this.rootPath || '';
        const relativePath = item.path.replace(rootPath + '/', '');
        details.push({ name: relativePath || item.name, words: wordCount });
      }
    }

    const maxWords = details.length > 0 
      ? details.reduce((a, b) => a.words > b.words ? a : b) 
      : { name: 'N/A', words: 0 };
    const minWords = details.length > 0 
      ? details.reduce((a, b) => a.words < b.words ? a : b) 
      : { name: 'N/A', words: 0 };

    return {
      totalWords,
      totalNotes,
      avgWords: totalNotes > 0 ? Math.round(totalWords / totalNotes) : 0,
      maxWords,
      minWords,
      details: details.sort((a, b) => b.words - a.words)
    };
  }

  // ============================================================
  // CONTEO SIMPLE
  // ============================================================

  /**
   * Cuenta palabras de un texto (usa la utilidad)
   */
  countWords(text: string): number {
    return countWordsUtil(text);
  }

  /**
   * Cuenta palabras de un archivo específico
   */
  async countWordsInFile(file: TFile): Promise<number> {
    const content = await this.app.vault.read(file);
    return countWordsUtil(content);
  }

  /**
   * Cuenta palabras de una lista de archivos
   */
  async countWordsInFiles(files: TFile[]): Promise<number> {
    let total = 0;
    for (const file of files) {
      total += await this.countWordsInFile(file);
    }
    return total;
  }

  // ============================================================
  // ESTADÍSTICAS DE CONTEO
  // ============================================================

  /**
   * Obtiene el resumen del conteo en formato texto
   */
  getSummaryText(result: WordCountResult): string {
    return `📊 ${result.totalWords.toLocaleString()} palabras en ${result.totalNotes} notas · Promedio: ${result.avgWords}`;
  }

  /**
   * Obtiene el detalle del conteo en formato texto
   */
  getDetailedText(result: WordCountResult): string {
    let text = this.getSummaryText(result);
    text += `\n\n🏆 Más: ${result.maxWords.name} (${result.maxWords.words.toLocaleString()})`;
    text += `\n📉 Menos: ${result.minWords.name} (${result.minWords.words.toLocaleString()})`;
    return text;
  }

  /**
   * Verifica si la carpeta raíz está configurada
   */
  isConfigured(): boolean {
    return this.rootPath !== '';
  }
}
