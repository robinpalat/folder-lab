// ============================================================
// CORE: FolderLabController
// ============================================================
// Controlador principal. Orquesta los servicios.
// ============================================================

import { App, TFile, TFolder, Menu, Notice } from 'obsidian';
import { FolderLabState } from './FolderLabState';
import { FolderOrderSettings } from '../config/settings';
import { FolderRepository } from '../storage/FolderRepository';
import { OrderService } from '../services/OrderService';
import { NoteService } from '../services/NoteService';
import { ExportService } from '../services/ExportService';
import { NavigationService } from '../services/NavigationService';
import { StatsService } from '../services/StatsService';
import { FilterService } from '../services/FilterService';
import { FolderLabItem } from '../models/FolderLabItem';

import { WordCountModal } from '../modals/WordCountModal';
import { WordCountService, WordCountResult } from '../services/WordCountService';
import { InputModal } from '../utils/ModalUtils';
import { PropertyOrderService } from '../services/navigation/PropertyOrderService';

export type FolderLabEvent =
  | { type: 'folderChanged'; folderPath: string }
  | { type: 'selectionChanged'; notePath: string }
  | { type: 'itemsChanged' }
  | { type: 'modeChanged'; mode?: string }
  | { type: 'filterChanged'; filter: string | null }
  | { type: 'noteChanged' };

export class FolderLabController {
  private app: App;
  private settings: FolderOrderSettings;
  private state: FolderLabState;
  private repository: FolderRepository;
  private listeners: ((event: FolderLabEvent) => void)[] = [];
  private isInitialized: boolean = false;

  public orderService: OrderService;
  public propertyOrderService: PropertyOrderService;
  public noteService: NoteService;
  public exportService: ExportService;
  public navigationService: NavigationService;
  public statsService: StatsService;
  public filterService: FilterService;
  public wordCountService: WordCountService;
  public getPropertyOrderProperty(): string {
    return this.settings.navigationPropertyMapping.order;
  }

  constructor(
    app: App,
    settings: FolderOrderSettings,
    repository: FolderRepository
  ) {
    this.app = app;
    this.settings = settings;
    this.repository = repository;
    this.state = new FolderLabState(settings);

    this.orderService = new OrderService(app, this.repository, settings);
    this.propertyOrderService = new PropertyOrderService(app);
    this.noteService = new NoteService(app, this.repository, settings);
    this.filterService = new FilterService();
    this.exportService = new ExportService(app, this.repository, settings, this.orderService, this.noteService);
    this.navigationService = new NavigationService(app, this.repository, this.settings);
    this.statsService = new StatsService(app);
    this.wordCountService = new WordCountService(app, settings.bookRootPath);

    if (settings.bookRootPath) {
      this.navigationService.setMasterPath(settings.bookRootPath);
    }
  }

  // ============================================================
  // GESTIÓN DE ESTADO
  // ============================================================

  getState(): FolderLabState {
    return this.state;
  }

  onStateChange(listener: (event: FolderLabEvent) => void): void {
    this.listeners.push(listener);
  }

  private notify(event: FolderLabEvent): void {

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  notifyEvent(event: FolderLabEvent): void {
    this.notify(event);
  }

  // ============================================================
  // INICIALIZACIÓN
  // ============================================================

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const masterPath = this.settings.bookRootPath;

    if (!masterPath) {
      new Notice(
        '❌ No hay carpeta raíz configurada. Ve a Ajustes → Folder Lab'
      );
      return;
    }



    // ============================================================
    // 1. Intentar cargar el JSON existente
    // ============================================================

    let data = await this.repository.loadGlobalOrder(masterPath);



    // ============================================================
    // 2. Si no existe, construirlo desde el filesystem
    // ============================================================

    if (!data) {
      console.log(
        '📂 _folder_order.json no existe. Inicializando proyecto...'
      );

      await this.repository.initGlobalOrder(masterPath);

      // Volver a cargar para obtener el estado persistido
      data = await this.repository.loadGlobalOrder(masterPath);

    }

    // ============================================================
    // 3. Verificar que la inicialización realmente produjo datos
    // ============================================================

    if (!data) {
      new Notice(
        '❌ No fue posible inicializar el proyecto Folder Lab.'
      );
      return;
    }


    this.isInitialized = true;
  }

  // ============================================================
  // CREAR NOTA
  // ============================================================

  async createNewNote(): Promise<void> {
    const currentPath = this.getCurrentPath();
    if (!currentPath) {
      new Notice('No hay carpeta seleccionada');
      return;
    }

    const name = await this.promptForInput('Nombre de la nueva nota:', 'Nueva nota');
    if (!name) return;

    const file = await this.noteService.createNote(currentPath, name);
    if (file) {
      await this.loadFolder(currentPath);
      await this.openNote({
        name: file.name,
        path: file.path,
        isSpecial: false,
        file: file
      } as FolderLabItem);
    }
  }

  private async promptForInput(prompt: string, defaultValue: string = ''): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new InputModal(this.app, prompt, defaultValue, resolve);
      modal.open();
    });
  }

  // ============================================================
  // NAVEGACIÓN - MÉTODOS CORREGIDOS
  // ============================================================

  async loadFolder(folderPath: string): Promise<void> {
    if (!folderPath) return;


    this.navigationService.navigateTo(folderPath);
    this.state.currentNoteType = 'general';

    const orderedFiles = await this.orderService.getOrderForFolder(folderPath);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);

    if (!(folder instanceof TFolder)) {
      this.state.items = [];
      this.notify({ type: 'folderChanged', folderPath });
      return;
    }

    const files = folder.children.filter(child =>
      child instanceof TFile &&
      child.extension === 'md' &&
      !child.path.includes('/.folder-order/')
    ) as TFile[];

    const specialFile = files.find(f => f.name === `${folder.name}.md`);
    const regularFiles = files.filter(f => f.name !== `${folder.name}.md`);

    const items: FolderLabItem[] = [];

    for (const file of regularFiles) {
      const isEmpty = await this.noteService.isNoteEmpty(file);
      const status = await this.noteService.getNoteStatus(folderPath, file.name);

      items.push({
        name: file.name,
        path: file.path,
        isSpecial: false,
        file: file,
        status: status || undefined,
        isEmpty: isEmpty
      });
    }

    let sortedItems: FolderLabItem[] = [];
    if (orderedFiles.length > 0 && this.settings.useManualOrder) {
      for (const fileName of orderedFiles) {
        const item = items.find(i => i.name === fileName);
        if (item) sortedItems.push(item);
      }
      for (const item of items) {
        if (!orderedFiles.includes(item.name)) sortedItems.push(item);
      }
    } else {
      sortedItems = items.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (specialFile) {
      const isEmpty = await this.noteService.isNoteEmpty(specialFile);
      sortedItems.unshift({
        name: specialFile.name,
        path: specialFile.path,
        isSpecial: true,
        file: specialFile,
        isEmpty: isEmpty
      });
    }

    this.state.items = sortedItems;

    this.notify({ type: 'folderChanged', folderPath });
    this.notify({ type: 'noteChanged' });
  }

  /**
   * Navega a la carpeta padre desde el JSON
   * Usa NavigationService.getParent() unificado
   */
  async goToParentInFolderMode(): Promise<void> {


    const currentPath = this.getCurrentPath();
    const parentPath = currentPath ? this.navigationService.getParent(currentPath) : null;

    if (!parentPath) {
      new Notice('Ya estás en la carpeta raíz');
      return;
    }


    await this.loadFolder(parentPath);
    this.state.setFolderTreeMode();
    this.notify({ type: 'modeChanged', mode: 'folder' });
  }

  /**
   * Verifica si se puede ir al padre (usando JSON)
   *  Usa NavigationService.canGoBack() unificado
   */
  canGoToParent(): boolean {
    const currentPath = this.getCurrentPath();
    return currentPath ? this.navigationService.canGoBack(currentPath) : false;
  }

  /**
   *  Navega al padre usando getParent()
   */
  async goBack(): Promise<void> {


    const currentPath = this.getCurrentPath();
    if (!currentPath) {
      new Notice('No hay carpeta actual');
      return;
    }

    const parent = this.navigationService.getParent(currentPath);

    if (!parent) {
      new Notice('Ya estás en la carpeta raíz');
      return;
    }

    await this.loadFolder(parent);
  }

  /**
   * Verifica si se puede ir al padre
   */
  canGoBack(): boolean {
    const currentPath = this.getCurrentPath();
    return currentPath ? this.navigationService.canGoBack(currentPath) : false;
  }

  getCurrentPath(): string | null {
    return this.navigationService.getCurrentPath();
  }

  getMasterPath(): string | null {
    return this.navigationService.getMasterPath();
  }

  getVaultName(): string {
  return this.app.vault.getName();
}

getMasterName(): string {
  const masterPath = this.navigationService.getMasterPath();

  if (masterPath) {
    const folder =
      this.app.vault.getAbstractFileByPath(masterPath);

    if (folder instanceof TFolder) {
      return folder.name;
    }

    const fallback =
      masterPath.split('/').pop();

    if (fallback) {
      return fallback;
    }
  }

  return this.app.vault.getName();
}

  // ============================================================
  // NOTA GENERAL
  // ============================================================

  async loadGeneralNote(): Promise<string> {
    const currentPath = this.getCurrentPath();
    if (!currentPath) {
      console.warn('No hay carpeta seleccionada para cargar Nota General');
      return '';
    }

    const content = await this.noteService.loadGeneralNote(currentPath);

    return content;
  }

  async saveGeneralNote(content: string): Promise<void> {
    const currentPath = this.getCurrentPath();
    if (!currentPath) {
      console.warn('⚠️ No hay carpeta seleccionada para guardar Nota General');
      return;
    }

    await this.noteService.saveGeneralNote(currentPath, content);

  }

  // ============================================================
  // CONTEO DE PALABRAS
  // ============================================================

  async countWords(): Promise<void> {
    const rootPath = this.settings.bookRootPath;

    if (!rootPath) {
      new Notice('❌ Configura la carpeta raíz en Ajustes → Folder Lab');
      return;
    }

    const result = await this.wordCountService.countWordsInBook();

    if (!result) {
      new Notice('❌ Error al contar palabras');
      return;
    }

    try {
      const view = this.getFolderLabView();
      if (view && typeof view.showWordCountModal === 'function') {
        view.showWordCountModal(result);
      }
    } catch (error) {
      console.warn('No se pudo mostrar el modal de conteo de palabras:', error);
    }
  }

  private getFolderLabView(): any {
    const leaves = this.app.workspace.getLeavesOfType('folder-lab-view');
    if (leaves.length === 0) return null;
    return leaves[0].view;
  }

  // ============================================================
  // FILTROS
  // ============================================================

  applyFilter(filterId: string | null): void {
    this.state.setFilter(filterId);
    this.notify({ type: 'filterChanged', filter: filterId });
    this.notify({ type: 'itemsChanged' });
  }

  clearFilter(): void {
    this.state.clearFilter();
    this.notify({ type: 'filterChanged', filter: null });
    this.notify({ type: 'itemsChanged' });
  }

  getActiveFilter(): string | null {
    return this.state.activeFilter;
  }

  // ============================================================
  // NOTAS
  // ============================================================

  async openNote(item: FolderLabItem): Promise<void> {
    if (!item) return;

    if (item.isSpecial && item.file) {
      await this.app.workspace.getLeaf().openFile(item.file);
      return;
    }

    if (!item.file) {
      console.warn('Carpeta virtual detectada, no se puede abrir:', item.path);
      return;
    }

    this.state.currentNoteType = item.file.name;
    await this.app.workspace.getLeaf().openFile(item.file);
    this.notify({ type: 'selectionChanged', notePath: item.path });
  }

  async loadNote(noteType: string): Promise<string> {
    const currentPath = this.getCurrentPath();
    if (!currentPath) return '';

    if (noteType === 'general') {
      return await this.loadGeneralNote();
    } else {
      return await this.noteService.loadNoteContent(currentPath, noteType);
    }
  }

  async saveNote(content: string): Promise<void> {
    const currentPath = this.getCurrentPath();
    if (!currentPath || !this.state.currentNoteType) return;

    if (this.state.currentNoteType === 'general') {
      await this.saveGeneralNote(content);
    } else {
      await this.noteService.saveNoteContent(
        currentPath,
        this.state.currentNoteType,
        content
      );
    }
  }

  async deleteNote(file: TFile): Promise<void> {
    if (!file) {
      new Notice('❌ Archivo no válido');
      return;
    }

    const currentPath = this.getCurrentPath();
    if (!currentPath) {
      new Notice('❌ No hay carpeta seleccionada');
      return;
    }

    try {
      const currentOrder = await this.orderService.getOrderForFolder(currentPath);
      if (currentOrder.length > 0) {
        const newOrder = currentOrder.filter((name: string) => name !== file.name);
        await this.orderService.updateFolderOrder(currentPath, newOrder);
      }

      await this.app.vault.delete(file);
      new Notice(`Nota eliminada: ${file.name}`);

      await this.loadFolder(currentPath);
    } catch (error) {
      console.error('Error al eliminar nota:', error);
      new Notice('❌ Error al eliminar la nota');
    }
  }

  // ============================================================
  // REORDENAR
  // ============================================================

  async reorderItems(newOrder: string[]): Promise<void> {
    const currentPath = this.getCurrentPath();
    if (!currentPath || !newOrder.length) return;

    await this.orderService.updateFolderOrder(currentPath, newOrder);
    await this.loadFolder(currentPath);
    this.notify({ type: 'folderChanged', folderPath: currentPath });
    new Notice('Orden actualizado');
  }

  // ============================================================
  // EXPORTACIÓN
  // ============================================================

  async exportAllNotes(): Promise<void> {
    const currentPath = this.getCurrentPath();
    if (!currentPath) {
      new Notice('❌ No hay carpeta seleccionada');
      return;
    }
    await this.exportService.exportAllNotes(currentPath);
  }

  async showExportMenu(button: HTMLElement): Promise<void> {
    const currentPath = this.getCurrentPath();
    if (!currentPath) {
      new Notice('❌ No hay carpeta seleccionada');
      return;
    }

    const menu = new Menu();
    menu.addItem((i) => i.setTitle('Copiar lista (TXT)')
      .onClick(() => this.exportService.exportOrderList(currentPath, 'txt', true)));
    menu.addItem((i) => i.setTitle('Exportar todas las notas')
      .onClick(() => this.exportAllNotes()));
    menu.showAtPosition({ x: button.getBoundingClientRect().right, y: button.getBoundingClientRect().top });
  }

  // ============================================================
  // ESTADÍSTICAS
  // ============================================================

async getStats(): Promise<{ totalNotes: number; percentage: number } | null> {
  const currentPath = this.getCurrentPath();
  if (currentPath === null) return null;

  const stats = await this.statsService.calculateStats(currentPath);
  return { totalNotes: stats.totalNotes, percentage: stats.percentage };
}

  // ============================================================
  // MODO ENFOQUE
  // ============================================================

  async toggleFocusMode(): Promise<void> {
    this.state.isFocusMode = !this.state.isFocusMode;
    this.notify({ type: 'modeChanged' });
    new Notice(`Modo enfoque ${this.state.isFocusMode ? 'activado' : 'desactivado'}`);
  }
}
