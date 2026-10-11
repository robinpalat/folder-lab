import { App, TFile } from 'obsidian';
import { NavigationProvider, NavigationTree, NavigationNode } from '../../models/Navigation';
import { NavigationPropertyMapping, DEFAULT_JEKYLL_MAPPING } from '../../config/settings';
import { i18n } from '../../i18n/I18nService';

const VIRTUAL_ROOT_ID = 'virtual:root';
const VIRTUAL_ROOT_PATH = '';

export class PropertyNavigationProvider implements NavigationProvider {
  readonly id = 'properties';
  readonly name = 'Propiedades de las notas';

  private mapping: NavigationPropertyMapping;
  private tree: NavigationTree | null = null;

  constructor(
    private app: App,
    mapping: NavigationPropertyMapping = DEFAULT_JEKYLL_MAPPING
  ) {
    this.mapping = mapping;
  }

  /**
   * ✅ Verifica si un archivo debe ser excluido según las reglas configuradas
   */
private isExcluded(frontmatter: Record<string, any>): boolean {
  const exclusions = this.mapping.exclusions || [];
  
  for (const rule of exclusions) {
    const value = frontmatter[rule.property];
    const operator = rule.operator || 'equals';
    
    if (operator === 'exists') {
      if (value !== undefined && value !== null) {
        return true;
      }
    } else if (operator === 'not') {
      if (value === undefined || value === null) {
        return true;
      }
    } else if (operator === 'equals') {
      if (rule.value !== undefined) {
        if (value === rule.value) {
          return true;
        }
      } else {
        if (value !== undefined && value !== null) {
          return true;
        }
      }
    }
  }
  
  return false;
}

  async build(): Promise<NavigationTree> {
    const files = this.app.vault.getMarkdownFiles();

    // ============================================================
    // PASO 1: Leer todas las notas
    // ============================================================
    const allNodes: NavigationNode[] = [];
    const pathToNode = new Map<string, NavigationNode>();
    const titleToPath = new Map<string, string>();

    for (const file of files) {
      // Excluir archivos de infraestructura
      if (file.path.includes('vendor/') ||
          file.path.includes('.bundle/') ||
          file.path.includes('.jekyll-cache/') ||
          file.path.includes('_site/') ||
          file.path.includes('.git/') ||
          file.path.includes('node_modules/')) {
        continue;
      }

      if (file.name.startsWith('_')) continue;
      if (file.parent && file.name === `${file.parent.name}.md`) continue;

      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter || {};

      // ✅ Verificar reglas de exclusión (nav_exclude, etc.)
      if (this.isExcluded(frontmatter)) {
        continue;
      }

      const title = this.getProperty(frontmatter, this.mapping.title) || 
                    file.name.replace(/\.[^/.]+$/, '');
      const parentRef = this.getProperty(frontmatter, this.mapping.parent);
      const order = this.getProperty(frontmatter, this.mapping.order);
      
            const hasChildren = this.getProperty(frontmatter, this.mapping.hasChildren);
      const permalink = this.getProperty(frontmatter, this.mapping.permalink);
      const layout = frontmatter.layout;

      // ✅ Criterio de elegibilidad
      const isEligible = title && (layout === 'page' || order !== undefined || parentRef !== undefined);

      if (!isEligible) {
        continue;
      }

      const node: NavigationNode = {
        id: file.path,
        path: file.path,
        title: title,
        parentPath: null,
        order: order !== undefined ? Number(order) : undefined,
        type: 'note',
        filePath: file.path,
        children: [],
        metadata: {
          frontmatter,
          permalink: permalink,
          hasChildren: hasChildren === 'true' || hasChildren === true,
          parentRef: parentRef,
          layout: layout
        }
      };

      allNodes.push(node);
      pathToNode.set(file.path, node);

      if (!titleToPath.has(title)) {
        titleToPath.set(title, file.path);
      } else {
        console.warn(`⚠️ Título duplicado: "${title}" en ${file.path}`);
      }
    }

    // ============================================================
    // PASO 2: Resolver parents por título
    // ============================================================
    const unresolvedParents: string[] = [];

    for (const node of allNodes) {
      const parentRef = node.metadata?.parentRef as string | undefined;
      
      if (parentRef) {
        const parentPath = titleToPath.get(parentRef);
        if (parentPath) {
          node.parentPath = parentPath;
        } else {
          unresolvedParents.push(`"${parentRef}" para "${node.title}"`);
          node.parentPath = null;
        }
      }
    }

    if (unresolvedParents.length > 0) {
      console.warn('⚠️ Parents no encontrados:', unresolvedParents.join(', '));
    }

    // ============================================================
    // PASO 3: Construir relaciones padre-hijo
    // ============================================================
    for (const node of allNodes) {
      if (node.parentPath) {
        const parent = pathToNode.get(node.parentPath);
        if (parent) {
          if (!parent.children) parent.children = [];
          parent.children.push(node);
        } else {
          console.warn(`⚠️ Padre no encontrado en mapa: ${node.parentPath} para ${node.title}`);
          node.parentPath = null;
        }
      }
    }

    // ============================================================
    // PASO 4: Determinar raíces
    // ============================================================
	const rootNodes: NavigationNode[] = [];

	for (const node of allNodes) {
	  if (!node.parentPath) {
		rootNodes.push(node);
	  }
	}

	// Ordenar nodos raíz por nav_order
	rootNodes.sort((a, b) => {
	  if (a.order !== undefined && b.order !== undefined) {
		return a.order - b.order;
	  }

	  if (a.order !== undefined) return -1;
	  if (b.order !== undefined) return 1;

	  return a.title.localeCompare(b.title);
	});

    // ============================================================
    // PASO 5: Transformar a carpetas virtuales con IDs únicos
    // ============================================================
    const transformedRoots: NavigationNode[] = [];

    const transformToVirtualFolder = (node: NavigationNode): NavigationNode => {
      if (node.children && node.children.length > 0) {
        const virtualId = `virtual:${node.path}`;
        const virtualFolder: NavigationNode = {
          id: virtualId,
          path: node.path,
          title: node.title,
          parentPath: node.parentPath
		  ? `virtual:${node.parentPath}`
		  : 'virtual:root',
          order: node.order,
          type: 'folder',
          filePath: node.filePath,
          children: [],
          metadata: {
            ...node.metadata,
            isVirtualFolder: true,
            isOwnPage: false,
            originalNodeId: node.id
          }
        };

        const ownPageId = `ownpage:${node.path}`;
        const ownPage: NavigationNode = {
          id: ownPageId,
          path: node.path,
          title: node.title,
          parentPath: node.path,
          order: 0,
          type: 'note',
          filePath: node.filePath,
          children: [],
          metadata: {
            ...node.metadata,
            isVirtualFolder: false,
            isOwnPage: true,
            originalParentPath: node.parentPath,
            originalId: node.id
          }
        };

        virtualFolder.children.push(ownPage);

        for (const child of node.children) {
          const transformedChild = transformToVirtualFolder(child);
          virtualFolder.children.push(transformedChild);
        }

        virtualFolder.children.sort((a, b) => {
          if (a.metadata?.isOwnPage) return -1;
          if (b.metadata?.isOwnPage) return 1;
          if (a.order !== undefined && b.order !== undefined) {
            return a.order - b.order;
          }
          if (a.order !== undefined) return -1;
          if (b.order !== undefined) return 1;
          return a.title.localeCompare(b.title);
        });

        return virtualFolder;
      } else {
        return node;
      }
    };

    this.sortNodes(rootNodes);

    for (const root of rootNodes) {
      const transformed = transformToVirtualFolder(root);
      transformed.parentPath = VIRTUAL_ROOT_ID;
      transformedRoots.push(transformed);
    }

    // ============================================================
    // PASO 6: Materializar el root virtual canónico
    // ============================================================
    const virtualRoot: NavigationNode = {
      id: VIRTUAL_ROOT_ID,
      path: VIRTUAL_ROOT_PATH,
      title: i18n.t('navigation.propertiesRootTitle'),
      parentPath: null,
      type: 'folder',
      filePath: null,
      children: transformedRoots,
      metadata: {
        isVirtualFolder: true,
        isOwnPage: false,
        isVirtualRoot: true
      },
      isVirtual: true
    };

    // ============================================================
    // PASO 7: Construir mapa final incluyendo virtual:root
    // ============================================================
    const finalIdMap = new Map<string, NavigationNode>();

    const collectNodes = (node: NavigationNode) => {
      finalIdMap.set(node.id, node);
      if (node.children) {
        for (const child of node.children) {
          collectNodes(child);
        }
      }
    };

    collectNodes(virtualRoot);

    const result: NavigationTree = {
      root: [virtualRoot],
      nodeMap: finalIdMap,
      flatNodes: Array.from(finalIdMap.values())
    };

    this.tree = result;

    return result;
  }

  // ✅ NUEVO: Refresh
  async refresh(): Promise<NavigationTree> {
    this.tree = null;
    return this.build();
  }

  // ✅ NUEVO: Get Node
  async getNode(path: string): Promise<NavigationNode | null> {
    if (!this.tree) {
      await this.build();
    }
    return this.tree?.nodeMap.get(path) || null;
  }

	/**
	 * Obtiene el padre de un nodo por su ID.
	 *
	 * Fuente de verdad:
	 * NavigationNode.parentPath
	 *
	 * En Properties los padres pueden ser:
	 * - otro nodo virtual: virtual:<path>
	 * - virtual:root
	 * - null únicamente para virtual:root
	 */
	getParent(path: string): string | null {
	  if (!this.tree) {
		console.warn('[PROPERTY NAV] No hay tree');
		return null;
	  }

	  let node = this.tree.nodeMap.get(path);

	  // Compatibilidad: permitir búsqueda por path físico
	  if (!node) {
		node = this.tree.flatNodes.find(
		  n => n.path === path || n.id === path
		);
	  }

	  if (!node) {
		console.warn('[PROPERTY NAV] Nodo no encontrado:', path);
		return null;
	  }

	  if (node.id === VIRTUAL_ROOT_ID) {
		return null;
	  }

	  return node.parentPath ?? null;
	}

	/**
	 * Determina si el nodo actual tiene padre.
	 */
	canGoBack(path: string): boolean {
	  return this.getParent(path) !== null;
	}


	private sortNodes(nodes: NavigationNode[]): NavigationNode[] {
	  return nodes.sort((a, b) => {
		if (a.order !== undefined && b.order !== undefined) {
		  return a.order - b.order;
		}

		if (a.order !== undefined) return -1;
		if (b.order !== undefined) return 1;

		return a.title.localeCompare(b.title);
	  });
	}



  private getProperty(frontmatter: Record<string, any>, key: string): any {
    if (!key) return undefined;
    if (key.includes('.')) {
      const parts = key.split('.');
      let value = frontmatter;
      for (const part of parts) {
        if (value === undefined || value === null) return undefined;
        value = value[part];
      }
      return value;
    }
    return frontmatter[key];
  }

}
