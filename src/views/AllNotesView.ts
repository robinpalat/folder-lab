// src/views/AllNotesView.ts

import { App, TFolder, TFile } from 'obsidian';
import { FolderLabState } from '../core/FolderLabState';
import { OrderService } from '../services/OrderService';
import { NoteService } from '../services/NoteService';
import { NoteListComponent, ListItem, FolderHeaderData } from '../components/NoteListComponent';
import { FolderLabItem } from '../models/FolderLabItem';
import { INTERNAL_FOLDER } from '../constants/view-types';
import { FolderLabController } from '../core/FolderLabController';
import { NavigationTree, NavigationNode } from '../models/Navigation';
import { isHiddenFolderName } from '../utils/folderUtils';

export class AllNotesView {
  private app: App;
  private state: FolderLabState;
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
    this.noteService = noteService;
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

  // Modo filesystem (comportamiento actual)
  async render(folderPath: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      this.listComponent.render([]);
      return;
    }

    const items: ListItem[] = [];
    await this.walkTree(folder, 0, items);

    await this.listComponent.render(items);
  }

  //  Modo properties (NavigationTree con contexto)
  async renderNavigation(tree: NavigationTree, contextNode: NavigationNode | null = null): Promise<void> {
    const items: ListItem[] = [];

    // Si hay contexto, mostrar solo el contexto + descendientes
    if (contextNode) {
      await this.walkNavigationContext(contextNode, items);
    } else {
      // Si no hay contexto, mostrar raíz
      await this.walkNavigationTree(tree.root, 0, items);
    }

    await this.listComponent.render(items);
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

    subfolders.sort((a, b) => a.name.localeCompare(b.name));
    noteFiles.sort((a, b) => a.name.localeCompare(b.name));

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

    // Cada nivel mantiene su propia numeración.
    // El renderer utiliza índices zero-based:
    // 0 -> 1.
    // 1 -> 2.
    let localNumber = 0;

    for (const node of nodes) {

      // ============================================================
      // NODO CON HIJOS
      // ============================================================

      if (node.children && node.children.length > 0) {

        // Buscar la OWN PAGE del nodo.
        const ownPage = node.children.find(
          child => child.metadata?.isOwnPage === true
        );

        // ------------------------------------------------------------
        // OWN PAGE = representación visible del nodo propietario
        // ------------------------------------------------------------
        //
        // NO mostramos el virtual folder como elemento independiente.
        //
        // En su lugar mostramos directamente su OWN PAGE.
        //
        // Resultado:
        //
        // Plano 1 — Experiencia Familiar
        //     1. Contexto humano
        //     Cronologías
        //
        // ------------------------------------------------------------

        if (ownPage && ownPage.filePath) {

          const file = this.app.vault.getFileByPath(
            ownPage.filePath
          );

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
                status: status || undefined
              },
              level: level,
              number: undefined
            });
          }
        }

        // ------------------------------------------------------------
        // Hijos estructurales
        // ------------------------------------------------------------

        const structuralChildren = node.children.filter(
          child => child.metadata?.isOwnPage !== true
        );

        // Los hijos aparecen un nivel por debajo del nodo propietario.
        await this.walkNavigationTree(
          structuralChildren,
          level + 1,
          items
        );

        continue;
      }

      // ============================================================
      // NOTA NORMAL SIN HIJOS
      // ============================================================

      const file = node.filePath
        ? this.app.vault.getFileByPath(node.filePath)
        : null;

      if (file) {
        items.push({
          type: 'note',
          data: {
            name: node.title + '.md',
            path: node.path,
            isSpecial: false,
            isOwnPage: false,
            file: file,
            isEmpty: false,
            status: status || undefined
          },
          level: level,

          // Zero-based.
          number: localNumber++
        });
      }
    }
  }

  // NavigationNode contexto (propia página + descendientes)
  private async walkNavigationContext(
    node: NavigationNode,
    items: ListItem[]
  ): Promise<void> {
    let localNumber = 1;

    // 1. Propia página (sin número)
    if (node.filePath) {
      const file = this.app.vault.getFileByPath(node.filePath);
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
    if (node.children && node.children.length > 0) {
      await this.walkNavigationTree(node.children, 1, items);
    }
  }

  updateActiveNote(): void {
    this.listComponent.updateActiveNote();
  }

  clear(): void {
    this.listComponent.clear();
  }
}
