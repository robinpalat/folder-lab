// ============================================================
// STATS SERVICE
// ============================================================
// Calcula estadísticas de progreso de una carpeta:
// - Total de notas
// - Notas completadas
// - Notas vacías
// - Porcentaje de completado
// ============================================================

import { App, TFolder, TFile } from 'obsidian';
import { INTERNAL_FOLDER } from '../constants/view-types';
import { isNoteEmpty } from '../utils/string-utils';

export interface FolderStats {
  totalNotes: number;
  completedNotes: number;
  emptyNotes: number;
  percentage: number;
}

export interface NoteStats {
  total: number;
  completed: number;
  empty: number;
  percentage: number;
}

export class StatsService {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  // ============================================================
  // ESTADÍSTICAS DE UNA CARPETA
  // ============================================================

  /**
   * Calcula las estadísticas de una carpeta (solo notas de primer nivel)
   */
  async calculateStats(folderPath: string): Promise<FolderStats> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      return { totalNotes: 0, completedNotes: 0, emptyNotes: 0, percentage: 0 };
    }
    
    const files = folder.children.filter(child => 
      child instanceof TFile && 
      child.extension === 'md' &&
      !child.path.includes(`/${INTERNAL_FOLDER}/`) &&
      !child.name.startsWith('_') &&
      child.name !== `${folder.name}.md`
    ) as TFile[];
    
    const totalNotes = files.length;
    let completedNotes = 0;
    let emptyNotes = 0;
    
    for (const file of files) {
      const content = await this.app.vault.read(file);
      if (isNoteEmpty(content)) {
        emptyNotes++;
      } else {
        completedNotes++;
      }
    }
    
    const percentage = totalNotes > 0 ? Math.round((completedNotes / totalNotes) * 100) : 0;
    
    return { totalNotes, completedNotes, emptyNotes, percentage };
  }

  /**
   * Calcula estadísticas de un conjunto de notas
   */
  async calculateNoteStats(notes: TFile[]): Promise<NoteStats> {
    const total = notes.length;
    let completed = 0;
    let empty = 0;
    
    for (const note of notes) {
      const content = await this.app.vault.read(note);
      if (isNoteEmpty(content)) {
        empty++;
      } else {
        completed++;
      }
    }
    
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    return { total, completed, empty, percentage };
  }

  /**
   * Calcula estadísticas de todas las notas de una carpeta y subcarpetas
   */
  async calculateRecursiveStats(folderPath: string): Promise<FolderStats> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      return { totalNotes: 0, completedNotes: 0, emptyNotes: 0, percentage: 0 };
    }
    
    const allNotes = await this.getAllMarkdownFiles(folder);
    
    const totalNotes = allNotes.length;
    let completedNotes = 0;
    let emptyNotes = 0;
    
    for (const file of allNotes) {
      const content = await this.app.vault.read(file);
      if (isNoteEmpty(content)) {
        emptyNotes++;
      } else {
        completedNotes++;
      }
    }
    
    const percentage = totalNotes > 0 ? Math.round((completedNotes / totalNotes) * 100) : 0;
    
    return { totalNotes, completedNotes, emptyNotes, percentage };
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

  /**
   * Obtiene todos los archivos Markdown de una carpeta (recursivo)
   */
  private async getAllMarkdownFiles(folder: TFolder): Promise<TFile[]> {
    let result: TFile[] = [];
    
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        if (child.name === INTERNAL_FOLDER || child.name.startsWith('.')) continue;
        const subFiles = await this.getAllMarkdownFiles(child);
        result = result.concat(subFiles);
      } else if (child instanceof TFile && child.extension === 'md') {
        if (child.name.startsWith('_')) continue;
        if (child.name === `${folder.name}.md`) continue;
        result.push(child);
      }
    }
    
    return result;
  }

  /**
   * Obtiene el resumen de estadísticas en formato texto
   */
  getStatsText(stats: FolderStats): string {
    return `${stats.totalNotes} notas  ·  ${stats.percentage}% completado`;
  }

  /**
   * Obtiene el resumen de estadísticas en formato detallado
   */
  getDetailedStatsText(stats: FolderStats): string {
    return `${stats.totalNotes} notas · ${stats.completedNotes} completadas · ${stats.emptyNotes} vacías · ${stats.percentage}%`;
  }

  /**
   * Verifica si una carpeta tiene notas
   */
  async hasNotes(folderPath: string): Promise<boolean> {
    const stats = await this.calculateStats(folderPath);
    return stats.totalNotes > 0;
  }
}
