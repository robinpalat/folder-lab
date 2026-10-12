// src/views/AllNotesView.ts

import { App, TFolder, TFile } from 'obsidian';
import { FolderLabState } from '../core/FolderLabState';
import { OrderService } from '../services/OrderService';
import { NoteService } from '../services/NoteService';
import { NoteListComponent, ListItem } from '../components/NoteListComponent';
import { FolderLabItem } from '../models/FolderLabItem';
import { INTERNAL_FOLDER } from '../constants/view-types';
import { FolderLabController } from '../core/FolderLabController';
import { NavigationTree, NavigationNode } from '../models/Navigation';
import { isHiddenFolderName } from '../utils/folderUtils';

export class AllNotesView {
  private app: App;
  private state: FolderLabState;
  private controller: FolderLabController;
  private orderService: OrderService;
  private noteService: NoteService;
  private listComponent: NoteListComponent;
  private container: HTMLElement;


  constructor(
    app: App,
    state: FolderLabState,
    controller: FolderLabController,
    orderService: OrderService,
    noteService: NoteService,
    container: HTMLElement,
    onNoteSelect: (item: FolderLabItem) => void,
    onFolderSelect: (path: string) => void,
    onReorder: (newOrder: string[]) => void
  ) {
    this.app = app;
    this.state = state;
    this.orderService = orderService;
    this.noteService = noteService;
    this.controller = controller;
    this.container = container;

    this.listComponent = new NoteListComponent(
      app,
      state,
      controller,
      controller.filterService,
      orderService,
      noteService,
      container,
      onNoteSelect,
      onFolderSelect,
      onReorder
    );
  }

private async calculateStatsFromItems(
  items: ListItem[]
): Promise<{ totalNotes: number; percentage: number }> {

  const files: TFile[] = [];

  for (const item of items) {
    if (item.type !== 'note') continue;

    const data = item.data as FolderLabItem;

    if (data.file instanceof TFile) {
      files.push(data.file);
    }
  }

  const stats =
    await this.controller.statsService.calculateNoteStats(files);

  return {
    totalNotes: stats.total,
    percentage: stats.percentage
  };
}

  // Modo filesystem (comportamiento actual)
async render(
  folderPath: string
): Promise<{ totalNotes: number; percentage: number }> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      await this.listComponent.render([]);
return {
  totalNotes: 0,
  percentage: 0
};
    }

    const items: ListItem[] = [];
    await this.walkTree(folder, 0, items);

    await this.listComponent.render(items);
    return this.calculateStatsFromItems(items);
  }

  //  Modo properties (NavigationTree con contexto)
async renderNavigation(
  tree: NavigationTree,
  contextNode: NavigationNode | null = null
): Promise<{ totalNotes: number; percentage: number }> {
    const items: ListItem[] = [];

    // Si hay contexto, mostrar solo el contexto + descendientes
    if (contextNode) {
      await this.walkNavigationContext(contextNode, items);
    } else {
      // Si no hay contexto, mostrar raíz
      await this.walkNavigationTree(tree.root, 0, items);
    }

    await this.listComponent.render(items);
    return this.calculateStatsFromItems(items);
    
  }

  // Filesystem walk (existente)
  private async walkTree(
    folder: TFolder,
    level: number,
    items: ListItem[]
  ): Promise<void> {
    let localNumber = 0;
    const subfolders: TFolder[] = [];
    const noteFiles: TFile[] = [];

    for (const child of folder.children) {
      if (child instanceof TFolder) {
        if (isHiddenFolderName(child.name)) continue; // TODO

        subfolders.push(child);
      } else if (child instanceof TFile && child.extension === 'md') {

        if (child.name === `${folder.name}.md`) continue;
        if (child.path.includes(`/${INTERNAL_FOLDER}/`)) continue;
        if (isHiddenFolderName(child.name)) continue;

        noteFiles.push(child);
      }
    }

    /*
     * El orden persistido por carpeta es la fuente de verdad
     * (mismo contrato que la vista normal). Alfabético solo
     * como fallback determinista cuando no hay lista guardada.
     */
    const persistedOrder =
      await this.orderService.getOrderForFolder(folder.path);

    const rankByPersistedOrder = (
      name: string
    ): number => {
      const index = persistedOrder.indexOf(name);

      return index === -1
        ? Number.MAX_SAFE_INTEGER
        : index;
    };

    const compareByPersistedOrder = (
      a: { name: string },
      b: { name: string }
    ): number => {
      const rankA = rankByPersistedOrder(a.name);
      const rankB = rankByPersistedOrder(b.name);

      if (rankA !== rankB) {
        return rankA - rankB;
      }

      return a.name.localeCompare(b.name);
    };

    subfolders.sort(compareByPersistedOrder);
    noteFiles.sort(compareByPersistedOrder);

    for (const file of noteFiles) {
      const isEmpty = await this.noteService.isNoteEmpty(file);
      const status = await this.noteService.getNoteStatusByFile(file);

      items.push({
        type: 'note',
        data: {
          name: file.name,
          path: file.path,
          isSpecial: false,
          file: file,
          isEmpty,
          status: status || undefined
        },
        level: level,
        number: localNumber++
      });
    }

    for (const subfolder of subfolders) {
      items.push({
        type: 'folder',
        data: {
          name: subfolder.name,
          path: subfolder.path,
          level: level,
          resetNumbering: true
        },
        level: level
      });

      await this.walkTree(subfolder, level + 1, items);
    }
  }

  private async walkNavigationTree(
  nodes: NavigationNode[],
  level: number,
  items: ListItem[]
): Promise<void> {

  // ============================================================
  // En cada nivel:
  //
  // 1. Primero todas las notas directas.
  // 2. Después todos los contenedores y sus descendientes.
  //
  // Esto evita que las notas del ROOT queden intercaladas
  // entre las jerarquías de sus subcarpetas.
  // ============================================================

  let localNumber = 0;

  const directNotes: NavigationNode[] = [];
  const containers: NavigationNode[] = [];

  // ------------------------------------------------------------
  // Separar notas directas de contenedores
  // ------------------------------------------------------------

  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      containers.push(node);
    } else {
      directNotes.push(node);
    }
  }

  // ------------------------------------------------------------
  // 1. NOTAS DIRECTAS
  // ------------------------------------------------------------

  for (const node of directNotes) {

const file = node.filePath
  ? this.app.vault.getAbstractFileByPath(node.filePath)
  : null;

if (!(file instanceof TFile)) continue;

const isEmpty =
  await this.noteService.isNoteEmpty(file);

const status =
  await this.noteService.getNoteStatusByFile(file);

    items.push({
      type: 'note',
      data: {
        name: node.title + '.md',
        path: node.path,
        isSpecial: false,
        isOwnPage: false,
        file: file,
        isEmpty,
status: status || undefined
      },
      level: level,

      // Numeración consecutiva dentro del nivel.
      number: localNumber++
    });
  }

  // ------------------------------------------------------------
  // 2. CONTENEDORES
  // ------------------------------------------------------------

  for (const node of containers) {

    // Buscar la OWN PAGE del nodo.
    const ownPage = node.children?.find(
      child => child.metadata?.isOwnPage === true
    );

    // ----------------------------------------------------------
    // OWN PAGE
    // ----------------------------------------------------------

    if (ownPage && ownPage.filePath) {

      const abstractFile = this.app.vault.getAbstractFileByPath(
        ownPage.filePath
      );
      const file = abstractFile instanceof TFile ? abstractFile : null;

      if (file) {
        items.push({
          type: 'note',
          data: {
            name: ownPage.title + '.md',
            path: ownPage.filePath,
            isSpecial: false,
            isOwnPage: true,
            file: file,
            isEmpty: false,
            status: undefined
          },
          level: level,
          number: undefined
        });
      }
    }

    // ----------------------------------------------------------
    // Hijos estructurales
    // ----------------------------------------------------------

    const structuralChildren =
      node.children?.filter(
        child => child.metadata?.isOwnPage !== true
      ) || [];

    /*
     * El nodo sintético virtual:root no cuenta como profundidad
     * jerárquica: sus hijos (las carpetas raíz reales) se procesan
     * en el mismo nivel. Los contenedores reales sí suman un nivel.
     */
    await this.walkNavigationTree(
      structuralChildren,
      node.metadata?.isVirtualRoot ? level : level + 1,
      items
    );
  }

  }

  // NavigationNode contexto (propia página + descendientes)
  private async walkNavigationContext(
    node: NavigationNode,
    items: ListItem[]
  ): Promise<void> {
    // 1. Propia página (sin número)
    if (node.filePath) {
      const abstractFile = this.app.vault.getAbstractFileByPath(node.filePath);
      const file = abstractFile instanceof TFile ? abstractFile : null;
      if (file) {
        items.push({
          type: 'note',
          data: {
            name: node.title + '.md',
            path: node.filePath,
            isSpecial: false,
            isOwnPage: true,
            file: file,
            isEmpty: false,
            status: status || undefined
          },
          level: 0,
          number: undefined
        });
      }
    }

    // 2. Descendientes (con numeración)
    // El virtual:root sintético no suma profundidad: sus hijos
    // (carpetas raíz reales) van en nivel 0.
    if (node.children && node.children.length > 0) {
      await this.walkNavigationTree(
        node.children,
        node.metadata?.isVirtualRoot ? 0 : 1,
        items
      );
    }
  }

  updateActiveNote(): void {
    this.listComponent.updateActiveNote();
  }

  clear(): void {
    this.listComponent.clear();
  }
}
