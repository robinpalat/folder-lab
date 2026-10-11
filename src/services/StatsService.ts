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
import { isHiddenFolderName } from '../utils/folderUtils';

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
   * Recuento DIRECTO de una carpeta SIN leer contenidos, para el
   * encabezado de navegación normal.
   *
   * - Notas: mismo filtro que calculateStats (Markdown, sin
   *   internos, sin '_' y sin la nota compilada de la carpeta).
   * - Subcarpetas: visibles y directas, mismo filtro que usa
   *   SubfolderView para la lista (sin ocultas ni internas).
   *
   * No cuenta notas de las subcarpetas: solo el ámbito directo.
   */
  countDirectNotesAndSubfolders(folderPath: string): {
    totalNotes: number;
    totalSubfolders: number;
  } {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);

    if (!(folder instanceof TFolder)) {
      return { totalNotes: 0, totalSubfolders: 0 };
    }

    let totalNotes = 0;
    let totalSubfolders = 0;

    for (const child of folder.children) {
      if (child instanceof TFolder) {
        if (isHiddenFolderName(child.name)) continue;
        if (child.name === INTERNAL_FOLDER) continue;
        totalSubfolders++;
        continue;
      }

      if (
        child instanceof TFile &&
        child.extension === 'md' &&
        !child.path.includes(`/${INTERNAL_FOLDER}/`) &&
        !child.name.startsWith('_') &&
        child.name !== `${folder.name}.md`
      ) {
        totalNotes++;
      }
    }

    return { totalNotes, totalSubfolders };
  }

  /**
   * Recuento del LIBRO COMPLETO desde una raíz, SIN leer
   * contenidos: un solo recorrido de metadatos del árbol.
   *
   * - totalNotes: notas elegibles de la raíz y de todas sus
   *   subcarpetas (mismas reglas que calculateRecursiveStats /
   *   getAllMarkdownFiles y que WordCountService: sin '_',
   *   sin nota compilada, sin internas, sin carpetas '.').
   * - totalFolders: carpetas elegibles con el MISMO criterio que
   *   la navegación (SubfolderView.walkTree → isHiddenFolderName:
   *   sin '.' NI '_'; más la carpeta interna). No incluye la
   *   propia raíz.
   *
   * El contador de carpetas y el descenso para notas se deciden
   * por separado: las carpetas '_' no se contabilizan (no las
   * muestra la navegación), pero sus notas siguen formando parte
   * del total histórico del libro.
   */
  countBookNotesAndFolders(folderPath: string): {
    totalNotes: number;
    totalFolders: number;
  } {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);

    if (!(folder instanceof TFolder)) {
      return { totalNotes: 0, totalFolders: 0 };
    }

    let totalNotes = 0;
    let totalFolders = 0;

    const walk = (current: TFolder): void => {
      for (const child of current.children) {
        if (child instanceof TFolder) {
          // Elegibilidad de carpetas: idéntica a la navegación.
          if (
            !isHiddenFolderName(child.name) &&
            child.name !== INTERNAL_FOLDER
          ) {
            totalFolders++;
          }

          // Descenso para notas: criterio histórico (sin
          // internas ni carpetas '.'); conserva el total de
          // notas existente.
          if (
            child.name === INTERNAL_FOLDER ||
            child.name.startsWith('.')
          ) {
            continue;
          }

          walk(child);
          continue;
        }

        if (
          child instanceof TFile &&
          child.extension === 'md' &&
          !child.name.startsWith('_') &&
          child.name !== `${current.name}.md` &&
          !child.path.includes(`/${INTERNAL_FOLDER}/`)
        ) {
          totalNotes++;
        }
      }
    };

    walk(folder);

    return { totalNotes, totalFolders };
  }

  /**
   * Calcula las estadísticas de un conjunto de notas
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
