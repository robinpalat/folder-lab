// ============================================================
// CORE: FolderLabController
// ============================================================
// Controlador principal. Orquesta los servicios.
// ============================================================

import { App, TFile, TFolder, Menu, Notice } from 'obsidian';
import { FolderLabState } from './FolderLabState';
import { FolderOrderSettings } from '../config/settings';
import { FolderRepository, GlobalOrderData } from '../storage/FolderRepository';
import { OrderService } from '../services/OrderService';
import { NoteService } from '../services/NoteService';
import { ExportService } from '../services/ExportService';
import { NavigationService } from '../services/NavigationService';
import { BOARD_VIEW_TYPE } from '../constants/view-types';
import { pickLeafStrategy } from '../utils/boardStability';
import { StatsService } from '../services/StatsService';
import { FilterService } from '../services/FilterService';
import { FolderLabItem } from '../models/FolderLabItem';

import { WordCountService, WordCountResult } from '../services/WordCountService';
import { InputModal } from '../utils/ModalUtils';
import { PropertyOrderService } from '../services/navigation/PropertyOrderService';
import { SingleFlightCache } from '../utils/wordCountCache';
import { isSameFolderPath, validateNewFolderName } from '../utils/folderUtils';
import { HeaderStatsModel } from '../utils/headerStats';
import { i18n } from '../i18n/I18nService';

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
    this.statsService = new StatsService(app, settings.bookRootPath);
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
      new Notice(i18n.t('errors.noRootConfigured'));
      return;
    }



    // ============================================================
    // 1. Intentar cargar el JSON existente
    // ============================================================

    /*
     * 3A: «ausente» y «ilegible» son casos distintos. Si el
     * fichero existe pero no puede leerse (JSON corrupto, forma
     * inválida, error del adapter), se aborta con aviso: la
     * regeneración NUNCA sobrescribe datos no recuperables
     * (orden manual y notas particulares).
     */
    let data: GlobalOrderData | null = null;
    try {
      data = await this.repository.loadGlobalOrder(masterPath);
    } catch (error) {
      console.error(
        '[FolderLabController] _folder_order.json ilegible; inicialización abortada:',
        error
      );
      new Notice(i18n.t('errors.folderOrderCorrupt'));
      return;
    }



    // ============================================================
    // 2. Si no existe, construirlo desde el filesystem
    // ============================================================

    if (!data) {
      await this.repository.initGlobalOrder(
        masterPath,
        this.settings.navigationPropertyMapping?.ignoredFolders ?? []
      );

      // Volver a cargar para obtener el estado persistido
      data = await this.repository.loadGlobalOrder(masterPath);

    }

    // ============================================================
    // 3. Verificar que la inicialización realmente produjo datos
    // ============================================================

    if (!data) {
      new Notice(i18n.t('errors.initFailed'));
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
      new Notice(i18n.t('errors.noFolderSelected'));
      return;
    }

    const name = await this.promptForInput(
      i18n.t('notes.create.prompt'),
      i18n.t('notes.create.defaultName')
    );
    if (!name) return;

    const file = await this.noteService.createNote(currentPath, name);
    if (file) {
      await this.loadFolder(currentPath);
      await this.openNote({
        name: file.name,
        path: file.path,
        isSpecial: false,
        file: file
      });
    }
  }

  private async promptForInput(prompt: string, defaultValue: string = ''): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new InputModal(this.app, prompt, defaultValue, resolve);
      modal.open();
    });
  }

  // ============================================================
  // CREAR CARPETA
  // ============================================================

  /**
   * Crea una carpeta dentro de la carpeta actual de navegación.
   *
   * Valida el nombre (sin segmentos de ruta), gestiona
   * duplicados, aplica las reglas existentes de orden y
   * exclusiones (OrderService.updateOrderOnFolderCreate) y
   * refresca la vista en su sitio —sin cambiar de navegación—.
   */
  async createNewFolder(): Promise<void> {
    const currentPath = this.getCurrentPath();
    if (!currentPath) {
      new Notice(i18n.t('errors.noFolderSelected'));
      return;
    }

    const raw = await this.promptForInput(i18n.t('folders.create.prompt'), '');
    const validation = validateNewFolderName(raw ?? '');

    if (!validation.ok) {
      // Cancelación o nombre vacío: sin acción (como createNote).
      if (validation.reason === 'empty') return;

      new Notice(i18n.t('errors.folder.invalidName'));
      return;
    }

    const folderPath = `${currentPath}/${validation.name}`;

    if (this.app.vault.getAbstractFileByPath(folderPath)) {
      new Notice(i18n.t('errors.folder.alreadyExists', { name: validation.name }));
      return;
    }

    try {
      await this.app.vault.createFolder(folderPath);
    } catch (error) {
      console.error('Error al crear la carpeta:', error);
      new Notice(i18n.t('errors.folder.createFailed'));
      return;
    }

    // Reglas existentes de orden y persistencia: dedupe,
    // carpetas ignoradas y orden global (misma ruta que el
    // resto de creaciones de carpetas).
    await this.orderService.updateOrderOnFolderCreate(folderPath);

    new Notice(i18n.t('folders.created', { name: validation.name }));

    // Refresco en su sitio: NO cambia la navegación activa.
    const path = this.getCurrentPath();
    if (path) {
      await this.loadFolder(path);
    }
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

    const files = folder.children.filter(
      (child): child is TFile =>
        child instanceof TFile &&
        child.extension === 'md' &&
        !child.path.includes('/.folder-order/')
    );

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
      new Notice(i18n.t('errors.alreadyAtRoot'));
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
      new Notice(i18n.t('errors.noCurrentFolder'));
      return;
    }

    const parent = this.navigationService.getParent(currentPath);

    if (!parent) {
      new Notice(i18n.t('errors.alreadyAtRoot'));
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

  /**
   * Último resultado válido del conteo del libro, en memoria.
   * El encabezado SOLO lee de aquí; el recorrido completo se
   * ejecuta en tres momentos: la inicialización automática de
   * sesión (si hay meta), la primera apertura del diálogo y el
   * botón «Actualizar estadísticas». Nunca por navegación,
   * edición o renderizado.
   */
  private wordCountCache = new SingleFlightCache<WordCountResult>();

  /**
   * Resultado del conteo en memoria (nunca calcula).
   */
  getCachedWordCountResult(): WordCountResult | null {
    return this.wordCountCache.get();
  }

  /**
   * Obtiene el resultado del conteo.
   *
   * Sin `force` reutiliza el resultado en memoria si existe y
   * solo calcula cuando aún no hay ninguno (inicialización del
   * diálogo). Con `force` fuerza un recorrido nuevo. Las
   * peticiones simultáneas comparten el mismo vuelo: nunca hay
   * dos recorridos duplicados en paralelo.
   */
  async getWordCountResult(options?: {
    force?: boolean;
  }): Promise<WordCountResult | null> {
    return this.wordCountCache.request(
      () => this.wordCountService.countWordsInBook(),
      options?.force === true
    );
  }

  async countWords(): Promise<void> {
    const rootPath = this.settings.bookRootPath;

    if (!rootPath) {
      new Notice(i18n.t('errors.wordCount.noRootConfigured'));
      return;
    }

    // Inicialización mínima: solo calcula si aún no existe
    // resultado en memoria; al reabrir se reutiliza.
    const result = await this.getWordCountResult();

    if (!result) {
      new Notice(i18n.t('errors.wordCount.failed'));
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
      await this.openNoteFileSafely(item.file);
      return;
    }

    if (!item.file) {
      console.warn('Carpeta virtual detectada, no se puede abrir:', item.path);
      return;
    }

    this.state.currentNoteType = item.file.name;
    await this.openNoteFileSafely(item.file);
    this.notify({ type: 'selectionChanged', notePath: item.path });
  }

  /**
   * Corrección B: abrir una nota sin reemplazar la pestaña del
   * Board. Si el leaf activo contiene el Board, se usa una pestaña
   * nueva; en cualquier otro caso se reutiliza el leaf activo
   * (comportamiento previo de navegación).
   */
  private async openNoteFileSafely(file: TFile): Promise<void> {
    const boardLeaves = this.app.workspace.getLeavesOfType(
      BOARD_VIEW_TYPE
    );
    const strategy = pickLeafStrategy(
      this.app.workspace.activeLeaf,
      boardLeaves
    );
    if (strategy === 'new-tab') {
      await this.app.workspace.getLeaf(true).openFile(file);
    } else {
      await this.app.workspace.getLeaf().openFile(file);
    }
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

  /**
   * E3: ciclo de vida administrado de borrado (inyectado por la
   * vista desde el plugin). Si está presente, `deleteNote` delega en
   * el flujo con snapshot + diario + papelera compatible.
   */
  private managedLifecycle: {
    deleteNoteManaged(
      notePath: string,
      updateOrder?: (notePath: string) => Promise<void>
    ): Promise<void>;
  } | null = null;

  setManagedLifecycle(lifecycle: FolderLabController['managedLifecycle']): void {
    this.managedLifecycle = lifecycle;
  }

  /** Elimina la entrada de la nota del orden de la carpeta actual. */
  async removeNoteFromOrder(notePath: string): Promise<void> {
    const currentPath = this.getCurrentPath();
    if (!currentPath) return;
    const fileName = notePath.slice(notePath.lastIndexOf('/') + 1);
    const currentOrder = await this.orderService.getOrderForFolder(currentPath);
    if (currentOrder.length > 0) {
      const newOrder = currentOrder.filter((name: string) => name !== fileName);
      await this.orderService.updateFolderOrder(currentPath, newOrder);
    }
  }

  async deleteNote(file: TFile): Promise<void> {
    if (!file) {
      new Notice(i18n.t('errors.note.invalidFile'));
      return;
    }

    const currentPath = this.getCurrentPath();
    if (!currentPath) {
      new Notice(i18n.t('errors.noFolderSelectedMarked'));
      return;
    }

    // E3: borrado administrado (snapshot + diario + papelera).
    if (this.managedLifecycle) {
      try {
        await this.managedLifecycle.deleteNoteManaged(
          file.path,
          (notePath) => this.removeNoteFromOrder(notePath)
        );
        new Notice(i18n.t('notes.deleted', { name: file.name }));
        await this.loadFolder(currentPath);
      } catch (error) {
        console.error('Error al eliminar nota:', error);
        new Notice(i18n.t('errors.note.deleteFailed'));
      }
      return;
    }

    // Compatibilidad: sin ciclo de vida, el flujo anterior.
    try {
      await this.removeNoteFromOrder(file.path);

      await this.app.vault.delete(file);
      new Notice(i18n.t('notes.deleted', { name: file.name }));

      await this.loadFolder(currentPath);
    } catch (error) {
      console.error('Error al eliminar nota:', error);
      new Notice(i18n.t('errors.note.deleteFailed'));
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
    new Notice(i18n.t('notices.orderUpdated'));
  }

  // ============================================================
  // EXPORTACIÓN
  // ============================================================

  async exportAllNotes(): Promise<void> {
    const currentPath = this.getCurrentPath();
    if (!currentPath) {
      new Notice(i18n.t('errors.noFolderSelectedMarked'));
      return;
    }
    await this.exportService.exportAllNotes(currentPath);
  }

  async showExportMenu(button: HTMLElement): Promise<void> {
    const currentPath = this.getCurrentPath();
    if (!currentPath) {
      new Notice(i18n.t('errors.noFolderSelectedMarked'));
      return;
    }

    const menu = new Menu();
    menu.addItem((i) => i.setTitle(i18n.t('export.copyListTxt'))
      .onClick(() => this.exportService.exportOrderList(currentPath, 'txt', true)));
    menu.addItem((i) => i.setTitle(i18n.t('export.exportAllNotes'))
      .onClick(() => this.exportAllNotes()));
    menu.showAtPosition({ x: button.getBoundingClientRect().right, y: button.getBoundingClientRect().top });
  }

  /**
   * Menú contextual del botón «+»: crear nota o crear carpeta.
   *
   * Usa el menú nativo de Obsidian (Menu): se cierra al
   * seleccionar una opción, al pulsar Escape o al hacer clic
   * fuera, y se ancla a la derecha del botón sin salirse de la
   * pantalla.
   */
  showCreateMenu(button: HTMLElement): void {
    const rect = button.getBoundingClientRect();

    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle(i18n.t('notes.create.menuItem'))
        .setIcon('file-plus')
        .onClick(() => {
          void this.createNewNote();
        })
    );

    menu.addItem((item) =>
      item
        .setTitle(i18n.t('folders.create.menuItem'))
        .setIcon('folder-plus')
        .onClick(() => {
          void this.createNewFolder();
        })
    );

    menu.showAtPosition({
      x: rect.right + 4,
      y: rect.top
    });
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

/**
 * Meta de palabras del libro (carpeta master). 0 = sin meta.
 * Persistida en ajustes (bookWordGoal) por quien la modifica.
 */
getBookGoal(): number {
  const raw = this.settings.bookWordGoal;
  const value = typeof raw === 'number' ? Math.floor(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

setBookGoal(words: number | null): void {
  this.settings.bookWordGoal =
    words !== null && words > 0 && Number.isFinite(words)
      ? Math.floor(words)
      : 0;
}

/**
 * Progreso de cumplimiento de la meta del libro usando el ÚLTIMO
 * conteo válido en memoria. Devuelve null si no hay meta o si
 * aún no existe ningún conteo.
 *
 * Este método NUNCA inicia un recorrido del libro: el encabezado
 * no debe ejecutar conteos de palabras. El recuento se actualiza
 * al usar «Actualizar estadísticas» del diálogo.
 */
getCachedBookGoalProgress(): { words: number; target: number } | null {
  const target = this.getBookGoal();
  if (target <= 0) return null;

  const cached = this.wordCountCache.get();
  if (!cached) return null;

  return { words: cached.totalWords, target };
}

  /**
   * true cuando la carpeta actual ES la raíz master, comparando
   * rutas normalizadas (nunca el nombre visible). En la raíz
   * master —y solo allí— la navegación normal puede mostrar el
   * porcentaje de la meta del libro.
   */
  isAtMasterRoot(): boolean {
    // La raíz master solo aplica al proveedor de carpetas.
    if (this.navigationService.getNavigationType() !== 'folders') {
      return false;
    }

    return isSameFolderPath(
      this.navigationService.getCurrentPath(),
      this.navigationService.getMasterPath()
    );
  }

  /**
   * Modelo de encabezado de la RAÍZ MASTER (contrato propio):
   * notas directas · notas totales del libro · carpetas del
   * libro · % de la meta (solo con conteo en memoria).
   *
   * Sincrónico y barato: recorridos de metadatos del árbol, sin
   * leer contenidos ni contar palabras.
   */
  getMasterRootHeaderStats(): HeaderStatsModel {
    const masterPath = this.navigationService.getMasterPath() ?? '';

    const direct =
      this.statsService.countDirectNotesAndSubfolders(masterPath);
    const book =
      this.statsService.countBookNotesAndFolders(masterPath);

    return {
      kind: 'master-root',
      directNotes: direct.totalNotes,
      totalNotes: book.totalNotes,
      totalFolders: book.totalFolders,
      goal: this.getCachedBookGoalProgress()
    };
  }

  /**
   * Modelo de encabezado de una SUBCARPETA: notas y subcarpetas
   * directas (mismos filtros que las listas visibles). Sin total
   * del libro ni porcentaje.
   *
   * Sincrónico y barato: no lee contenidos ni recorre el libro.
   */
  getFolderHeaderStats(): HeaderStatsModel {
    const currentPath = this.getCurrentPath();

    const counts = currentPath !== null
      ? this.statsService.countDirectNotesAndSubfolders(currentPath)
      : { totalNotes: 0, totalSubfolders: 0 };

    return {
      kind: 'folder',
      notes: counts.totalNotes,
      subfolders: counts.totalSubfolders
    };
  }

  // ============================================================
  // MODO ENFOQUE
  // ============================================================

  async toggleFocusMode(): Promise<void> {
    this.state.isFocusMode = !this.state.isFocusMode;
    this.notify({ type: 'modeChanged' });
    new Notice(i18n.t('notices.focusModeToggled', {
      state: i18n.t(this.state.isFocusMode
        ? 'notices.focusMode.enabled'
        : 'notices.focusMode.disabled')
    }));
  }
}
