// ============================================================
// COMPONENTE: NoteListComponent
// ============================================================
// Renderiza cualquier lista de items (notas, carpetas o ambos)
// Reutilizado por todas las vistas
// SIN ESTILOS EN LÍNEA
// ============================================================

import { App, TFile, Menu } from 'obsidian';
import { FolderLabState } from '../core/FolderLabState';
import { OrderService } from '../services/OrderService';
import { NoteService } from '../services/NoteService';
import { FilterService } from '../services/FilterService';
import { FolderLabItem } from '../models/FolderLabItem';
import { NoteItemRenderer } from './NoteItemRenderer';
import { FolderLabController } from '../core/FolderLabController';
import { PropertyOrderService } from '../services/navigation/PropertyOrderService';
import { i18n } from '../i18n/I18nService';
export interface ListItem {
  type: 'note' | 'folder';
  data: FolderLabItem | FolderHeaderData;
  level: number;
  number?: number;
}

export interface FolderHeaderData {
  name: string;
  path: string;
  level: number;
  noteCount?: number;
  resetNumbering?: boolean;
}

export interface NoteListRenderOptions {
  applyFilter?: boolean;
  enableDragAndDrop?: boolean;
}

export class NoteListComponent {
  private app: App;
  private state: FolderLabState;
  private controller: FolderLabController;
  private filterService: FilterService;
  private orderService: OrderService;
  private noteService: NoteService;
  private container: HTMLElement;
  private onNoteSelect: (item: FolderLabItem) => void;
  private onFolderSelect: (path: string) => void;
  private onReorder: (newOrder: string[]) => void;
  private propertyOrderService: PropertyOrderService;
  
  private element: HTMLElement | null = null;
  private noteRenderer: NoteItemRenderer;
  private noteCounter: number = 0;
  private noteElementsCache: Map<string, HTMLElement> = new Map();
  private lastRenderedPath: string = '';

  constructor(
    app: App,
    state: FolderLabState,
    controller: FolderLabController,
    filterService: FilterService,
    orderService: OrderService,
    noteService: NoteService,
    container: HTMLElement,
    onNoteSelect: (item: FolderLabItem) => void,
    onFolderSelect: (path: string) => void,
    onReorder: (newOrder: string[]) => void
  ) {
    this.app = app;
    this.state = state;
    this.propertyOrderService = controller.propertyOrderService;
    this.filterService = filterService;
    this.orderService = orderService;
    this.noteService = noteService;
    this.container = container;
    this.onNoteSelect = onNoteSelect;
    this.onFolderSelect = onFolderSelect;
    this.onReorder = onReorder;
this.controller = controller;
    this.noteRenderer = new NoteItemRenderer(
      app,
      state,
      controller,
      noteService,
      onNoteSelect,
      {
onStatusChange: async (file: TFile, status: string) => {
  await noteService.setNoteStatusByFile(file, status);

  const element =
    this.noteElementsCache.get(file.path);

  if (element) {
    this.noteRenderer.updateStatus(
      element,
      status
    );
  }
},

        onDelete: (file: TFile) => {
          const folderPath = this.controller.getCurrentPath() || '';
          noteService.deleteNote(folderPath, file);
          this.refreshCurrentView();
        }
      }
    );
  }

  // ============================================================
  // RENDERIZADO PRINCIPAL
  // ============================================================

  async render(
    items: ListItem[],
    options?: NoteListRenderOptions
  ): Promise<void> {
    this.noteCounter = 0;
    this.noteElementsCache.clear();

    const applyFilter = options?.applyFilter ?? true;
    const enableDragAndDrop =
      options?.enableDragAndDrop ?? true;

    if (this.element) {
      this.element.remove();
    }

    this.element = this.container.createEl('div', {
      cls: 'folder-lab-items'
    });

    if (!items || items.length === 0) {
      this.showEmptyState(i18n.t('empty.noElements'));
      return;
    }

    const noteItems = items
      .filter(item => item.type === 'note')
      .map(item => item.data as FolderLabItem);

    let itemsToRender = items;

    // ------------------------------------------------------------
    // FILTROS
    // ------------------------------------------------------------
    //
    // Las vistas normales utilizan el filtro activo.
    //
    // Recientes puede desactivarlo porque su propio ranking
    // determina exactamente qué notas deben aparecer.
    //
    if (applyFilter) {
      const activeFilter = this.state.activeFilter;

      const filteredNotes =
        this.filterService.applyFilter(
          noteItems,
          activeFilter
        );

      const filteredPaths = new Set(
        filteredNotes.map(item => item.path)
      );

      if (
        activeFilter !== null &&
        filteredNotes.length > 0
      ) {
        itemsToRender = items.filter(item => {
          if (item.type === 'folder') {
            return true;
          }

          return filteredPaths.has(
            (item.data as FolderLabItem).path
          );
        });
      } else if (
        activeFilter !== null &&
        filteredNotes.length === 0
      ) {
        this.showEmptyState(
          i18n.t('empty.noFilterMatch')
        );
        return;
      }
    }

    // ------------------------------------------------------------
    // RENDERIZAR
    // ------------------------------------------------------------

    for (const item of itemsToRender) {
      if (item.type === 'folder') {
        this.renderFolder(
          item.data as FolderHeaderData
        );
      } else {
        this.renderNote(
          item.data as FolderLabItem,
          item.level,
          item.number
        );
      }
    }

    // ------------------------------------------------------------
    // DRAG & DROP
    // ------------------------------------------------------------

    //
    // En Recientes no queremos permitir reordenamiento:
    // el orden lo determina RecentActivityService.
    //
    if (enableDragAndDrop) {
      this.setupDragAndDropForAllItems();
    }

    this.updateActiveNote();
  }

  // ============================================================
  // RENDERIZADO DE ELEMENTOS
  // ============================================================

  private renderFolder(
    data: FolderHeaderData
  ): void {
    if (!this.element) return;

    const {
      name,
      path,
      level,
      noteCount
    } = data;

    const header = this.element.createEl('div', {
      cls: 'folder-lab-folder-header',
      attr: {
        'data-indent': Math.min(level, 5).toString(),
        'data-path': path,
        'data-level': level.toString()
      }
    });

    const nameSpan = header.createEl('span', {
      cls: 'folder-lab-folder-name'
    });

    nameSpan.textContent = name;

    if (
      noteCount !== undefined &&
      noteCount > 0
    ) {
      const countSpan = header.createEl('span', {
        cls: 'folder-lab-folder-count'
      });

      countSpan.textContent = `(${noteCount})`;
    }

    header.onclick = () =>
      this.onFolderSelect(path);
  }

  private renderNote(
    item: FolderLabItem,
    level: number,
    number?: number
  ): void {
    if (!this.element) return;

    const isActive =
      this.isNoteActive(item.file);

    // Si number es undefined, no mostramos número.
    const showNumber =
      number !== undefined;

    const el = this.noteRenderer.render(
      this.element,
      item,
      {
        index: number ?? 0,
        showNumber,
        numberingStyle:
          this.state.settings.numberingStyle ||
          'arabic',
        isActive,
        indentLevel: level
      }
    );

    if (item.isOwnPage) {
      el.setAttribute(
        'data-own-page',
        'true'
      );
    }

    this.noteElementsCache.set(
      item.path,
      el
    );

    this.noteCounter++;
  }

  // ============================================================
  // DRAG & DROP
  // ============================================================

  private setupDragAndDropForAllItems(): void {
    if (!this.element) return;

    const allItems =
      this.element.querySelectorAll(
        '.folder-lab-item:not([data-special="true"]):not([data-own-page="true"])'
      );

    allItems.forEach((el, index) => {
      if (el instanceof HTMLElement) {
        el.setAttribute(
          'data-normal-index',
          index.toString()
        );

        this.setupDragAndDrop(
          el,
          index
        );
      }
    });
  }

  // ============================================================
  // ACTUALIZACIÓN RÁPIDA
  // ============================================================

  public updateActiveNote(): void {
    if (!this.element) return;

    const activeFile =
      this.app.workspace.getActiveFile();

    this.noteElementsCache.forEach(
      el => {
        el.removeClass('is-active');
      }
    );

    if (!activeFile) return;

    const activeEl =
      this.noteElementsCache.get(
        activeFile.path
      );

    if (activeEl) {
      activeEl.addClass('is-active');
    }
  }

  private isNoteActive(
    file: TFile | null
  ): boolean {
    if (!file) return false;

    const active =
      this.app.workspace.getActiveFile();

    return active?.path === file.path;
  }

  // ============================================================
  // DRAG & DROP
  // ============================================================

  private setupDragAndDrop(
    el: HTMLElement,
    index: number
  ): void {
    el.setAttribute(
      'data-normal-index',
      index.toString()
    );

    el.setAttribute(
      'draggable',
      'true'
    );

    el.addEventListener(
      'dragstart',
      (e) => {
        el.addClass('is-dragging');

        const data =
          JSON.stringify({
            folder:
              this.controller.getCurrentPath() ||
              '',
            index
          });

        e.dataTransfer?.setData(
          'text/plain',
          data
        );

        e.dataTransfer!.effectAllowed =
          'move';
      }
    );

    el.addEventListener(
      'dragend',
      () => {
        el.removeClass(
          'is-dragging'
        );

        if (this.element) {
          this.element
            .querySelectorAll(
              '.is-drag-over'
            )
            .forEach(
              el =>
                el.removeClass(
                  'is-drag-over'
                )
            );
        }
      }
    );

    el.addEventListener(
      'dragover',
      (e) => {
        e.preventDefault();

        if (this.element) {
          this.element
            .querySelectorAll(
              '.is-drag-over'
            )
            .forEach(
              el =>
                el.removeClass(
                  'is-drag-over'
                )
            );
        }

        el.addClass(
          'is-drag-over'
        );
      }
    );

    el.addEventListener(
      'dragleave',
      () => {
        el.removeClass(
          'is-drag-over'
        );
      }
    );

    el.addEventListener(
      'drop',
      async (e) => {
        e.preventDefault();

        el.removeClass(
          'is-drag-over'
        );

        const targetIndex =
          parseInt(
            el.getAttribute(
              'data-normal-index'
            ) || '0'
          );

        await this.handleDrop(
          e,
          targetIndex
        );
      }
    );
  }

  private async handleDrop(
    e: DragEvent,
    targetIndex: number
  ): Promise<void> {
    const dataStr =
      e.dataTransfer?.getData(
        'text/plain'
      );

    if (!dataStr) return;

    const data =
      JSON.parse(dataStr);

    const fromIndex =
      data.index;

    if (
      fromIndex === -1 ||
      fromIndex === targetIndex
    ) {
      return;
    }

    if (!this.element) return;

    const allItems =
      this.element.querySelectorAll(
        '.folder-lab-item:not([data-special="true"]):not([data-own-page="true"])'
      );

    const items: HTMLElement[] = [];

    allItems.forEach(
      el => {
        if (
          el instanceof HTMLElement
        ) {
          items.push(el);
        }
      }
    );

    if (
      fromIndex >= items.length ||
      targetIndex >= items.length
    ) {
      console.warn(
        '❌ Drop: índice fuera de rango',
        {
          fromIndex,
          targetIndex,
          length: items.length
        }
      );

      return;
    }

    // Capturar el elemento movido y el destino ANTES del splice
    // (tras el splice, targetIndex contiene el propio elemento movido)
    const movedElement = items[fromIndex];
    const movedPath =
      movedElement?.getAttribute('data-path') ?? null;

    const targetElementBefore =
      items[targetIndex];

    const targetPathBefore =
      targetElementBefore?.getAttribute('data-path') ?? null;

    const [moved] =
      items.splice(
        fromIndex,
        1
      );

    if (!moved) {
      console.warn(
        '❌ Drop: moved es undefined'
      );

      return;
    }

    items.splice(
      targetIndex,
      0,
      moved
    );

    const newOrder: string[] = [];

    const navigationType =
      this.controller.navigationService
        ?.getNavigationType() ||
      'folders';

    for (const el of items) {
      const path =
        el.getAttribute(
          'data-path'
        );

      if (!path) continue;

      if (
        navigationType ===
        'properties'
      ) {
        newOrder.push(path);
      } else {
        const fileName =
          path.split('/').pop();

        if (fileName) {
          newOrder.push(
            fileName
          );
        }
      }
    }

    try {
      const diagTree =
        this.controller.navigationService?.getTree?.() ?? null;

      const estadoPrevio = items.map((diagEl, diagIndex) => {
        const diagPath = diagEl.getAttribute('data-path') ?? '';
        const diagNode = diagTree?.nodeMap.get(diagPath) ?? null;

        return {
          indice: diagIndex,
          id: diagNode?.id ?? '(sin nodo)',
          ruta: diagPath,
          tipo: diagNode?.type ?? '(desconocido)',
          parentPath: diagNode?.parentPath ?? '(sin padre)',
          parentRef: diagNode?.metadata?.parentRef ?? '(sin parentRef)',
          ordenProveedor: diagNode?.order ?? '(sin orden)'
        };
      });

          } catch (diagError) {
          }

    if (
      navigationType ===
      'properties'
    ) {
      /*
       * Reordenamiento por ÁMBITO DE HERMANOS (properties):
       * - Solo se renumeran las notas del padre del elemento
       *   movido (nunca se mezclan carpetas distintas).
       * - Las páginas contenedoras hermanas se renumeran
       *   después para evitar colisiones de nav_order con el
       *   orden del árbol (que las ordena por hermanos).
       * - Un drop hacia el ámbito de otra carpeta se ignora:
       *   el reordenamiento no convierte en mover archivos.
       */
      const navigationService =
        this.controller.navigationService;

      const provider =
        navigationService?.getProvider?.() ?? null;

      const scopeOf = (path: string): string => {
        if (!provider) return '';

        return (
          provider.getParent(`virtual:${path}`) ??
          provider.getParent(path) ??
          ''
        );
      };

      const targetPath =
        targetPathBefore;

      if (provider && movedPath) {
        const movedScope = scopeOf(movedPath);

        if (
          targetPath &&
          scopeOf(targetPath) !== movedScope
        ) {
          return;
        }

        // Hojas del ámbito, en el nuevo orden visual
        const scopeLeaves = newOrder.filter(
          (path) =>
            scopeOf(path) === movedScope
        );

        // Páginas contenedoras hermanas, en orden del árbol
        const tree =
          navigationService?.getTree?.() ?? null;

        const parentNode =
          tree?.nodeMap.get(movedScope || 'virtual:root');

        const containerPages: string[] = [];

        if (parentNode?.children) {
          for (const child of parentNode.children) {
            if (
              child.metadata?.isOwnPage !== true &&
              child.children &&
              child.children.length > 0 &&
              child.filePath
            ) {
              containerPages.push(child.filePath);
            }
          }
        }

        const sequence = [
          ...scopeLeaves,
          ...containerPages
        ];

        const files: TFile[] = [];

        for (const path of sequence) {
          const file =
            this.app.vault.getFileByPath(path);

          if (file) {
            files.push(file);
          } else {
            console.warn(
              '[PROPERTY ORDER] Archivo no encontrado:',
              path
            );
          }
        }

        if (files.length > 0) {
          const orderProperty =
            this.controller
              .getPropertyOrderProperty();

          if (!orderProperty) {
            console.error(
              '[PROPERTY ORDER] No se pudo determinar la propiedad de orden'
            );

            return;
          }

          await this.controller
            .propertyOrderService
            .reorder(
              files,
              orderProperty
            );

                  } else {
                  }

        return;
      }

      // Sin provider: comportamiento histórico global (compatibilidad)
      const files: TFile[] = [];

      for (const path of newOrder) {
        const file =
          this.app.vault.getFileByPath(path);

        if (file) {
          files.push(file);
        }
      }

      if (files.length > 0) {
        const orderProperty =
          this.controller.getPropertyOrderProperty();

        if (orderProperty) {
          await this.controller.propertyOrderService.reorder(
            files,
            orderProperty
          );
        }
      }

      return;
    }

    /*
     * Rama folders: el orden persistido corresponde EXCLUSIVAMENTE
     * a los hermanos del mismo padre que el elemento movido
     * (mismo contrato que OrderService.getOrderForFolder). Nunca se
     * mezclan nombres de carpetas distintas en una sola lista.
     * Comparación por carpeta padre exacta (dirname), nunca por
     * prefijo de ruta: 'LIBRO2/X.md' no pertenece a 'LIBRO'.
     */
    const scopePath = movedPath && movedPath.includes('/')
      ? movedPath.substring(0, movedPath.lastIndexOf('/'))
      : '';

    const scopeOrder: string[] = [];

    for (const el of items) {
      const path = el.getAttribute('data-path');

      if (!path) continue;

      const parentPath = path.includes('/')
        ? path.substring(0, path.lastIndexOf('/'))
        : '';

      if (parentPath !== scopePath) continue;

      const fileName = path.split('/').pop();

      if (fileName) {
        scopeOrder.push(fileName);
      }
    }

    if (
      scopeOrder.length > 0
    ) {
      const existingOrder =
        await this.orderService.getOrderForFolder(scopePath);

      /*
       * Fusión que preserva las entradas no afectadas (carpetas
       * hermanas incluidas en la lista persistida): solo se
       * sustituye, en su sitio, la subsecuencia de nombres del
       * ámbito con el nuevo orden. Los sobrantes se añaden al
       * final para no perder archivos nuevos.
       */
      const scopeNames = new Set(scopeOrder);
      const mergedOrder: string[] = [];
      let cursor = 0;

      for (const name of existingOrder) {
        if (scopeNames.has(name)) {
          mergedOrder.push(scopeOrder[cursor++]);
        } else {
          mergedOrder.push(name);
        }
      }

      while (cursor < scopeOrder.length) {
        mergedOrder.push(scopeOrder[cursor++]);
      }

      const unchanged =
        mergedOrder.length === existingOrder.length &&
        mergedOrder.every((name, index) => name === existingOrder[index]);

      if (!unchanged) {
        await this.orderService
          .updateFolderOrder(
            scopePath,
            mergedOrder
          );
      }

      this.onReorder(
        mergedOrder
      );

          }
  }

  // ============================================================
  // EVENTOS
  // ============================================================

  private attachEvents(
    el: HTMLElement,
    item: FolderLabItem,
    index: number
  ): void {
    this.attachContextMenu(
      el,
      item
    );

    if (!item.isSpecial) {
      this.setupDragAndDrop(
        el,
        index
      );
    }

    this.attachClickHandler(
      el,
      item
    );
  }

  private attachContextMenu(
    el: HTMLElement,
    item: FolderLabItem
  ): void {
    el.addEventListener(
      'contextmenu',
      (e) => {
        e.preventDefault();
        e.stopPropagation();

        const menu =
          new Menu();

        if (item.isSpecial) {
          menu.addItem(
            (menuItem) => {
              menuItem
                .setTitle(
                  `🔄 ${i18n.t('actions.regenerateCompile')}`
                )
                .setIcon(
                  'refresh-cw'
                )
                .onClick(
                  () => {
                    const event =
                      new CustomEvent(
                        'folder-lab-export',
                        {
                          detail: {
                            folderPath:
                              this.controller
                                .getCurrentPath() ||
                              ''
                          }
                        }
                      );

                    document.dispatchEvent(
                      event
                    );
                  }
                );
            }
          );
        } else {
          menu.addItem(
            (menuItem) => {
              menuItem
                .setTitle(
                  i18n.t('actions.delete')
                )
                .setIcon(
                  'trash-2'
                )
                .onClick(
                  async () => {
                    const currentPath =
                      this.controller
                        .getCurrentPath();

                    if (
                      currentPath &&
                      item.file
                    ) {
                      await this.noteService
                        .deleteNote(
                          currentPath,
                          item.file
                        );

                      this.refreshCurrentView();
                    }
                  }
                );
            }
          );
        }

        menu.showAtPosition({
          x: e.clientX,
          y: e.clientY
        });
      }
    );
  }

  private attachClickHandler(
    el: HTMLElement,
    item: FolderLabItem
  ): void {
    el.onclick = async (e) => {
      if (
        (
          e.target as HTMLElement
        ).closest(
          '.folder-lab-refresh-icon'
        )
      ) {
        return;
      }

      if (
        (
          e.target as HTMLElement
        ).closest(
          '.folder-lab-status'
        )
      ) {
        return;
      }

      this.onNoteSelect(
        item
      );
    };
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

  private refreshCurrentView(): void {
    const event =
      new CustomEvent(
        'folder-lab-refresh',
        {
          detail: {
            folderPath:
              this.controller
                .getCurrentPath() || ''
          }
        }
      );

    document.dispatchEvent(
      event
    );
  }

  private showEmptyState(
    message: string
  ): void {
    if (!this.element) return;

    const el =
      this.element.createEl(
        'p',
        {
          cls: 'folder-lab-empty'
        }
      );

    el.textContent =
      message;
  }

  clear(): void {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }

    this.noteElementsCache.clear();
  }
}
