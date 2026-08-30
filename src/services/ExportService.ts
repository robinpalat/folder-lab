// ============================================================
// EXPORT SERVICE
// ============================================================
// Gestiona todas las funcionalidades de exportación:
// - Exportar lista de orden (TXT, Markdown)
// - Exportar todas las notas de una carpeta (compilado)
// - Copiar lista al portapapeles
// ============================================================

import { App, TFolder, TFile, Notice, Menu } from 'obsidian';
import { OrderService } from './OrderService';
import { NoteService } from './NoteService';
import { FolderRepository } from '../storage/FolderRepository';
import { FolderOrderSettings } from '../config/settings';
import { getFileNameWithoutExtension } from '../utils/string-utils';

export class ExportService {
  private app: App;
  private repository: FolderRepository;
  private orderService: OrderService;
  private noteService: NoteService;
  private settings: FolderOrderSettings;

// src/services/ExportService.ts
constructor(
  app: App,
  repository: FolderRepository,
  settings: FolderOrderSettings,
  orderService: OrderService,
  noteService: NoteService
) {
  this.app = app;
  this.repository = repository;
  this.settings = settings;
  this.orderService = orderService;
  this.noteService = noteService;
}

  // ============================================================
  // MENÚ DE EXPORTACIÓN
  // ============================================================

  /**
   * Muestra el menú de exportación
   */
  showExportMenu(button: HTMLElement, folderPath: string): void {
    if (!folderPath) {
      new Notice('No hay carpeta seleccionada');
      return;
    }

    const menu = new Menu();
    
    menu.addItem((item) => {
      item.setTitle('Copiar indice (TXT)')
        .setIcon('copy')
        .onClick(() => this.exportOrderList(folderPath, 'txt', true));
    });
    
    
    menu.addItem((item) => {
      item.setTitle('Exportar todas las notas')
        .setIcon('file-markdown')
        .onClick(() => this.exportAllNotes(folderPath));
    });
    
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ 
      x: rect.right, 
      y: rect.top 
    });
  }

  // ============================================================
  // EXPORTAR LISTA DE ORDEN
  // ============================================================

  /**
   * Exporta la lista de orden (TXT o Markdown)
   */
  async exportOrderList(
    folderPath: string,
    format: 'txt' | 'markdown',
    copyToClipboard: boolean = false
  ): Promise<void> {
    const orderedFiles = await this.orderService.getOrderForFolder(folderPath);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    const folderName = folder instanceof TFolder ? folder.name : folderPath;
    
    let content: string;
    if (format === 'txt') {
      content = orderedFiles.join('\n');
    } else {
      content = `# ${folderName}\n\n${orderedFiles.map((f: string) => `- ${f}`).join('\n')}`;
    }
    
    if (copyToClipboard) {
      await navigator.clipboard.writeText(content);
      new Notice('Lista copiada al portapapeles');
    } else {
      const ext = format === 'txt' ? 'txt' : 'md';
      const fileName = `indice-${folderPath.replace(/\//g, '-')}.${ext}`;
      await this.app.vault.create(fileName, content);
      new Notice(`${fileName} creado`);
    }
  }

  // ============================================================
  // EXPORTAR TODAS LAS NOTAS (COMPILADO)
  // ============================================================

  /**
   * Exporta todas las notas de una carpeta en un solo archivo Markdown
   */
  async exportAllNotes(folderPath: string): Promise<void> {
    if (!folderPath) {
      new Notice('No hay carpeta seleccionada');
      return;
    }

    try {
      new Notice('📚 Generando compilado...');
      
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (!(folder instanceof TFolder)) {
        new Notice('Carpeta no encontrada');
        return;
      }

      const orderedFiles = await this.orderService.getOrderForFolder(folderPath);
      let content = `# ${folder.name}\n\n`;
      let hasContent = false;

      for (const name of orderedFiles) {
        const file = this.app.vault.getFileByPath(`${folderPath}/${name}`);
        if (!file) continue;

        const isEmpty = await this.noteService.isNoteEmpty(file);
        const fileContent = await this.app.vault.read(file);
        const title = getFileNameWithoutExtension(name);
        
        content += `## ${title}\n\n`;
        if (isEmpty) {
          content += '*[Contenido pendiente]*\n\n';
        } else {
          let clean = fileContent.trim();
          const lines = clean.split('\n');
          const filtered = lines.filter((l: string) => {
            const t = l.trim();
            return !t.startsWith('title:') && !t.startsWith('tags:') && 
                   !t.startsWith('date:') && !t.startsWith('---') && 
                   !t.startsWith('#') && t !== '';
          });
          clean = filtered.join('\n').trim() || '*[Contenido pendiente]*';
          content += `${clean}\n\n`;
        }
        content += `---\n\n`;
        hasContent = true;
      }

      if (!hasContent) {
        content += '*No hay notas para compilar*\n\n';
      }

      const outputPath = `${folderPath}/${folder.name}.md`;
      const existing = this.app.vault.getFileByPath(outputPath);
      
      if (existing) {
        await this.app.vault.modify(existing, content);
        new Notice(`Compilado actualizado: ${folder.name}.md`);
      } else {
        await this.app.vault.create(outputPath, content);
        new Notice(`Compilado creado: ${folder.name}.md`);
      }

      // Esperar y recargar
      await new Promise((r) => setTimeout(r, 300));
      
    } catch (error: any) {
      console.error('Error al exportar:', error);
      new Notice(`Error: ${error?.message || 'Error desconocido'}`);
    }
  }

  /**
   * Exporta todas las notas de la carpeta actual y subcarpetas
   */
  async exportAllSubfolderNotes(folderPath: string): Promise<void> {
    // TODO: Implementar exportación recursiva de todas las subcarpetas
    new Notice('Exportando todas las subcarpetas... (próximamente)');
  }

  // ============================================================
  // EXPORTACIÓN POR SELECCIÓN
  // ============================================================

  /**
   * Exporta notas seleccionadas (para futura implementación)
   */
  async exportSelectedNotes(folderPath: string, selectedFiles: TFile[]): Promise<void> {
    if (!folderPath || selectedFiles.length === 0) {
      new Notice('No hay notas seleccionadas');
      return;
    }

    try {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (!(folder instanceof TFolder)) {
        new Notice('Carpeta no encontrada');
        return;
      }

      let content = `# ${folder.name} (selección)\n\n`;

      for (const file of selectedFiles) {
        const fileContent = await this.app.vault.read(file);
        const title = getFileNameWithoutExtension(file.name);
        content += `## ${title}\n\n${fileContent}\n\n---\n\n`;
      }

      const fileName = `seleccion-${folderPath.replace(/\//g, '-')}.md`;
      await this.app.vault.create(fileName, content);
      new Notice(`✅ ${fileName} creado`);
    } catch (error) {
      console.error('Error al exportar selección:', error);
      new Notice('❌ Error al exportar selección');
    }
  }
}
