// src/services/navigation/FolderNavigationProvider.ts

import { App, TFolder, TFile } from 'obsidian';
import { NavigationProvider, NavigationTree, NavigationNode } from '../../models/Navigation';
import {
  FolderRepository,
  type FolderOrderData,
  type GlobalOrderData
} from '../../storage/FolderRepository';
import { isHiddenFolderName } from '../../utils/folderUtils';
import { isTechnicalDataPath } from '../../utils/dataPath';
import { joinVaultRoot } from '../../utils/rootPath';

export class FolderNavigationProvider implements NavigationProvider {
  readonly id = 'folders';
  readonly name = 'Carpetas y archivos';

  private tree: NavigationTree | null = null;
  /** Master de la construcción en curso (filtro E1 en walkFolder). */
  private masterPathForFilter: string | null = null;

  constructor(
    private app: App,
    private repository: FolderRepository
  ) {}

  async build(): Promise<NavigationTree> {
    const masterPath = this.repository.getMasterPath();
    this.masterPathForFilter = masterPath;
    // Contrato de raíz: null = sin Master; '' = raíz del vault.
    if (masterPath === null) {
      this.tree = { root: [], nodeMap: new Map(), flatNodes: [] };
      return this.tree;
    }

    const nodes: NavigationNode[] = [];
    const nodeMap = new Map<string, NavigationNode>();

    const globalOrder = this.repository.getGlobalOrder();
    if (globalOrder) {
      await this.buildFromOrder(globalOrder, masterPath, nodes, nodeMap);
    } else {
      const masterFolder =
        masterPath === ''
          ? this.app.vault.getRoot()
          : this.app.vault.getAbstractFileByPath(masterPath);
      if (masterFolder instanceof TFolder) {
        // Corrección: los hijos del master se parentan al nodo raíz
        // (id: masterPath) — con null, canGoBack era false y el
        // botón de volver desaparecía en árboles de filesystem.
        await this.walkFolder(masterFolder, masterPath, nodes, nodeMap);
      }
    }

    const root = this.buildTree(nodes, nodeMap);
    this.tree = { root, nodeMap, flatNodes: nodes };
    return this.tree;
  }

  private async buildFromOrder(
  globalOrder: GlobalOrderData,
  masterPath: string,
  nodes: NavigationNode[],
  nodeMap: Map<string, NavigationNode>
): Promise<void> {
  const rootNode: NavigationNode = {
    id: masterPath,
    path: masterPath,
    title: masterPath.split('/').pop() || 'Raíz',
    parentPath: null,
    type: 'folder',
    filePath: masterPath,
    children: []
  };

  nodes.push(rootNode);
  nodeMap.set(masterPath, rootNode);

  const traverseOrder = (
    orderData: FolderOrderData,
    currentPath: string,
    parentPath: string | null
  ): void => {
    const processed = new Set<string>();
    const folders = orderData.folders;

    // ============================================================
    // 1. PROCESAR EL ORDEN EXPLÍCITO
    // ============================================================
    for (const itemName of orderData.order || []) {
       if (isHiddenFolderName(itemName)) continue;
      // Raíz: currentPath '' no debe producir '/item' (los ids del
      // árbol deben coincidir con las rutas reales del vault).
      const itemPath = joinVaultRoot(currentPath, itemName);
      // E1: excluir la carpeta técnica del orden explícito.
      if (isTechnicalDataPath(itemPath, masterPath)) {
        continue;
      }
      processed.add(itemName);

      const isFolder = !!folders && !!folders[itemName];

      const file = this.app.vault.getAbstractFileByPath(itemPath);

      if (!file) continue;

      const node: NavigationNode = {
        id: itemPath,
        path: itemPath,
        title: itemName,
        parentPath,
        type: isFolder ? 'folder' : 'note',
        filePath: itemPath,
        children: []
      };

      nodes.push(node);
      nodeMap.set(itemPath, node);

      // Si es carpeta, recorrer su estructura interna
      if (isFolder && folders) {
        traverseOrder(
          folders[itemName],
          itemPath,
          itemPath
        );
      }
    }

    // ============================================================
    // 2. PROCESAR CARPETAS DECLARADAS EN "folders"
    //    QUE NO ESTÉN EN "order"
    // ============================================================
    for (const folderName of Object.keys(folders || {})) {
      if (isHiddenFolderName(folderName)) continue;
      const folderPath = joinVaultRoot(currentPath, folderName);
      if (isTechnicalDataPath(folderPath, masterPath)) {
        continue;
      }

      const folderData = folders?.[folderName];

      const file = this.app.vault.getAbstractFileByPath(folderPath);

      if (!file) continue;

      const node: NavigationNode = {
        id: folderPath,
        path: folderPath,
        title: folderName,
        parentPath,
        type: 'folder',
        filePath: folderPath,
        children: []
      };

      nodes.push(node);
      nodeMap.set(folderPath, node);

      // Recorrer contenido de la carpeta
      if (folderData) {
        traverseOrder(
          folderData,
          folderPath,
          folderPath
        );
      }
    }
  };

  traverseOrder(
    globalOrder.root,
    masterPath,
    masterPath
  );
}

  private async walkFolder(
    folder: TFolder,
    parentPath: string | null,
    nodes: NavigationNode[],
    nodeMap: Map<string, NavigationNode>
  ): Promise<void> {
    const children = folder.children.sort((a, b) => {
      if (a instanceof TFolder && b instanceof TFile) return -1;
      if (a instanceof TFile && b instanceof TFolder) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const child of children) {
      if (child instanceof TFolder) {
        if (isHiddenFolderName(child.name)) continue;
        // E1: la carpeta técnica de datos no es contenido de usuario.
        if (isTechnicalDataPath(child.path, this.masterPathForFilter)) {
          continue;
        }

        const node: NavigationNode = {
          id: child.path,
          path: child.path,
          title: child.name,
          parentPath: parentPath,
          type: 'folder',
          filePath: child.path,
          children: []
        };

        nodes.push(node);
        nodeMap.set(child.path, node);

        await this.walkFolder(child, child.path, nodes, nodeMap);
      } else if (child instanceof TFile && child.extension === 'md') {
        if (child.name.startsWith('_')) continue;
        if (child.parent && child.name === `${child.parent.name}.md`) continue;
        if (isTechnicalDataPath(child.path, this.masterPathForFilter)) {
          continue;
        }

        const node: NavigationNode = {
          id: child.path,
          path: child.path,
          title: child.name.replace(/\.[^/.]+$/, ''),
          parentPath: parentPath,
          type: 'note',
          filePath: child.path,
          children: []
        };

        nodes.push(node);
        nodeMap.set(child.path, node);
      }
    }
  }

  private buildTree(
    nodes: NavigationNode[],
    nodeMap: Map<string, NavigationNode>
  ): NavigationNode[] {
    const root: NavigationNode[] = [];

    for (const node of nodes) {
      if (node.parentPath) {
        const parent = nodeMap.get(node.parentPath);
        if (parent) {
          if (!parent.children) parent.children = [];
          parent.children.push(node);
        } else {
          root.push(node);
        }
      } else {
        root.push(node);
      }
    }

    const sortNodes = (items: NavigationNode[]) => {
      items.sort((a, b) => {
        if (a.type === 'folder' && b.type === 'note') return -1;
        if (a.type === 'note' && b.type === 'folder') return 1;
        return a.title.localeCompare(b.title);
      });

      for (const item of items) {
        if (item.children && item.children.length > 0) {
          sortNodes(item.children);
        }
      }
    };

    sortNodes(root);
    return root;
  }

  async refresh(): Promise<NavigationTree> {
    this.tree = null;
    return this.build();
  }

  async getNode(path: string): Promise<NavigationNode | null> {
    if (this.tree) {
      return this.tree.nodeMap.get(path) || null;
    }
    return null;
  }

getParent(path: string): string | null {
  if (!this.tree) {
    console.warn('[FOLDER NAV] No hay tree');
    return null;
  }

  const node = this.tree.nodeMap.get(path);

  return node?.parentPath ?? null;
}

canGoBack(path: string): boolean {
  if (!this.tree) {
    console.warn('[FOLDER NAV BACK] No hay tree');
    return false;
  }

  const node = this.tree.nodeMap.get(path);

  if (!node) {
    console.warn('[FOLDER NAV BACK] Nodo NO encontrado:', path);
    return false;
  }

  return node.parentPath !== null &&
         node.parentPath !== undefined;
}
}
