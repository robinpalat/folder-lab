// src/views/SubfolderView.ts

import { App, TFolder } from 'obsidian';
import { FolderLabState } from '../core/FolderLabState';
import { OrderService } from '../services/OrderService';
import { NoteService } from '../services/NoteService';
import { NoteListComponent, ListItem } from '../components/NoteListComponent';
import { FolderLabItem } from '../models/FolderLabItem';
import { INTERNAL_FOLDER } from '../constants/view-types';
import { FolderLabController } from '../core/FolderLabController';
import { NavigationNode } from '../models/Navigation';
import { isHiddenFolderName } from '../utils/folderUtils';

export class SubfolderView {
  private app: App;
  private listComponent: NoteListComponent;
  private container: HTMLElement;
  private controller: FolderLabController;

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

  // Modo filesystem (comportamiento actual)
  render(
    folderPath: string
  ): { totalFolders: number } {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      this.listComponent.render([]);
      return {
        totalFolders: 0
      };
    }

    const items: ListItem[] = [];
    this.walkTree(folder, 0, items);

    this.listComponent.render(items);

    // Conteo derivado del MISMO modelo que se acaba de
    // renderizar: carpetas de la lista visible.
    return {
      totalFolders: items.filter(item => item.type === 'folder').length
    };
  }

  //  Modo properties (NavigationNode como contexto - solo contenedores)
  renderNavigationNode(
    node: NavigationNode
  ): { totalFolders: number } {
    const items: ListItem[] = [];

    if (node.children && node.children.length > 0) {
      let localNumber = 1;

      for (const child of node.children) {

        // ------------------------------------------------------------
        // Contenedor
        // ------------------------------------------------------------
        if (
          child.type === 'folder' ||
          (child.children && child.children.length > 0)
        ) {
          this.walkNavigationContainer(child, items, 0);
          continue;
        }

        // ------------------------------------------------------------
        // Nota directa del contexto actual
        // ------------------------------------------------------------
        const file = child.filePath
          ? this.app.vault.getFileByPath(child.filePath)
          : null;

        if (file) {
          items.push({
            type: 'note',
            data: {
              name: child.title + '.md',
              path: child.path,
              isSpecial: false,
              file: file,
              isEmpty: false,
              status: undefined
            },
            level: 0,
            number: localNumber++
          });
        }
      }
    }

    this.listComponent.render(items);

    return {
      totalFolders: items.filter(item => item.type === 'folder').length
    };
  }

  //  Walk de contenedor (carpeta virtual con sus hijos)
  private walkNavigationContainer(
    node: NavigationNode,
    items: ListItem[],
    level: number
  ): void {
    // Este nodo es un contenedor (carpeta virtual)
    items.push({
      type: 'folder',
      data: {
        name: node.title,
        path: node.path,
        level: level,
      },
      level: level
    });

    // Procesar sus hijos (notas y subcarpetas)
    if (node.children && node.children.length > 0) {
      let localNumber = 1;
      for (const child of node.children) {
        const isContainer = child.type === 'folder' || (child.children && child.children.length > 0);

        if (isContainer) {
          // Subcarpeta: recursivo
          this.walkNavigationContainer(child, items, level + 1);
        } else {
          // Nota: renderizar como nota
          const file = child.filePath ? this.app.vault.getFileByPath(child.filePath) : null;
          if (file) {
            items.push({
              type: 'note',
              data: {
                name: child.title + '.md',
                path: child.path,
                isSpecial: false,
                file: file,
                isEmpty: false,
                status: undefined
              },
              level: level + 1,
              number: localNumber++
            });
          }
        }
      }
    }
  }

  // Filesystem walk (existente)
  private walkTree(folder: TFolder, level: number, items: ListItem[]): void {
    const subfolders = folder.children.filter(child =>
      child instanceof TFolder &&
      !isHiddenFolderName(child.name) &&
      child.name !== INTERNAL_FOLDER
    ) as TFolder[];

    subfolders.sort((a, b) => a.name.localeCompare(b.name));

    for (const subfolder of subfolders) {
      items.push({
        type: 'folder',
        data: {
          name: subfolder.name,
          path: subfolder.path,
          level: level
        },
        level: level
      });

      this.walkTree(subfolder, level + 1, items);
    }
  }

  updateActiveNote(): void {
    this.listComponent.updateActiveNote();
  }

  clear(): void {
    this.listComponent.clear();
  }
}
