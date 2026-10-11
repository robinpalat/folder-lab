import { Menu, setIcon } from 'obsidian';

import {
  BoardArchNode,
  BoardBlock
} from '../storage/BoardRepository';
import { i18n } from '../i18n/I18nService';
/**
 * Contrato que Board implementa para la instancia Arquitectura.
 *
 * La vista solo renderiza y delega todas las mutaciones en el Board,
 * que es el único propietario del estado y de la persistencia.
 */
export interface BoardArchitectureHost {
  getBlocks(): BoardBlock[];
  getArchitectureNodes(): BoardArchNode[];

  addArchNode(afterIndex: number | null, level: number): void;
  updateArchNode(
    id: string,
    patch: Partial<Pick<BoardArchNode, 'title' | 'level'>>
  ): void;
  moveArchNode(id: string, direction: -1 | 1): void;
  removeArchNode(id: string): void;

  assignBlockToNode(nodeId: string, blockId: string): void;
  unassignBlockFromNode(nodeId: string, blockId: string): void;
  moveAssignedBlock(
    nodeId: string,
    blockId: string,
    direction: -1 | 1
  ): void;

  requestBoardRender(): void;
}

const PREVIEW_LENGTH = 90;

function preview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (normalized.length <= PREVIEW_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, PREVIEW_LENGTH)}…`;
}

/**
 * Instancia 2: Arquitectura del documento.
 *
 * Secuencia vertical de elementos estructurales (outliner con
 * niveles) a la que se asignan los bloques de Explorar por
 * referencia. Aquí NO se crean ni se eliminan tarjetas de
 * contenido: solo estructura y asignaciones.
 */
export class BoardArchitectureView {

  render(
    container: HTMLElement,
    host: BoardArchitectureHost
  ): void {
    const nodes = host.getArchitectureNodes();
    const blocks = host.getBlocks();

    container.empty();
    container.addClass('fl-board-architecture');

    const header = container.createEl('div', {
      cls: 'fl-arch-header'
    });

    header.createEl('div', {
      cls: 'fl-arch-header-title',
      text: i18n.t('board.architecture.title')
    });

    header.createEl('div', {
      cls: 'fl-arch-header-hint',
      text: i18n.t('board.architecture.hint')
    });

    if (nodes.length === 0) {
      this.renderEmptyInvitations(container, host);
    } else {
      this.renderNodeList(container, host, nodes, blocks);
    }

    this.renderTray(container, host, nodes, blocks);
    this.renderAddBar(container, host, nodes.length);
  }

  // ============================================================
  // ESTADO VACÍO
  // ============================================================

  private renderEmptyInvitations(
    container: HTMLElement,
    host: BoardArchitectureHost
  ): void {
    const invitations = container.createEl('div', {
      cls: 'fl-arch-invitations'
    });

    const items: Array<{ label: string; level: number }> = [
      { label: i18n.t('board.architecture.invitation.mainTopic'), level: 0 },
      { label: i18n.t('board.architecture.invitation.addSection'), level: 1 },
      { label: i18n.t('board.architecture.invitation.addItem'), level: 2 }
    ];

    for (const item of items) {
      const row = invitations.createEl('button', {
        cls: 'fl-arch-invitation',
        attr: { type: 'button' }
      });

      setIcon(row, 'plus');
      row.createSpan({ text: item.label });

      row.addEventListener('click', () => {
        host.addArchNode(null, item.level);
      });
    }
  }

  // ============================================================
  // LISTA DE NODOS
  // ============================================================

  private renderNodeList(
    container: HTMLElement,
    host: BoardArchitectureHost,
    nodes: BoardArchNode[],
    blocks: BoardBlock[]
  ): void {
    const list = container.createEl('div', {
      cls: 'fl-arch-list'
    });

    const blockById = new Map(
      blocks.map(block => [block.id, block])
    );

    nodes.forEach((node, index) => {
      this.renderNodeRow(list, host, node, index, nodes.length, blockById);
    });
  }

  private renderNodeRow(
    list: HTMLElement,
    host: BoardArchitectureHost,
    node: BoardArchNode,
    index: number,
    total: number,
    blockById: Map<string, BoardBlock>
  ): void {
    const row = list.createEl('div', {
      cls: 'fl-arch-node'
    });

    row.setAttr('data-arch-node-id', node.id);
    row.style.paddingLeft = `${12 + node.level * 22}px`;

    const main = row.createEl('div', {
      cls: 'fl-arch-node-main'
    });

    const levelTag = main.createEl('span', {
      cls: 'fl-arch-node-level',
      text: node.level === 0 ? i18n.t('board.architecture.level.title') : i18n.t('board.architecture.level.numbered', { level: node.level })
    });
    levelTag.setAttr('aria-hidden', 'true');

    const titleInput = main.createEl('input', {
      cls: 'fl-arch-node-title',
      type: 'text',
      placeholder:
        node.level === 0
          ? i18n.t('board.architecture.placeholder.documentTitle')
          : i18n.t('board.architecture.placeholder.elementTitle')
    });
    titleInput.value = node.title;

    titleInput.addEventListener('change', () => {
      host.updateArchNode(node.id, {
        title: titleInput.value
      });
    });

    titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        titleInput.blur();
      }
    });

    const controls = main.createEl('div', {
      cls: 'fl-arch-node-controls'
    });

    this.iconButton(controls, 'arrow-up', i18n.t('board.architecture.action.moveUp'), () => {
      host.moveArchNode(node.id, -1);
    }, index === 0);

    this.iconButton(controls, 'arrow-down', i18n.t('board.architecture.action.moveDown'), () => {
      host.moveArchNode(node.id, 1);
    }, index === total - 1);

    this.iconButton(controls, 'arrow-left', i18n.t('board.architecture.action.levelUp'), () => {
      if (node.level <= 0) return;
      host.updateArchNode(node.id, { level: node.level - 1 });
    }, node.level === 0);

    this.iconButton(controls, 'arrow-right', i18n.t('board.architecture.action.levelDown'), () => {
      if (node.level >= 3) return;
      host.updateArchNode(node.id, { level: node.level + 1 });
    }, node.level === 3);

    this.iconButton(controls, 'plus', i18n.t('board.architecture.action.addSubelement'), () => {
      host.addArchNode(index, Math.min(node.level + 1, 3));
    });

    this.iconButton(controls, 'x', i18n.t('board.architecture.action.deleteElement'), () => {
      host.removeArchNode(node.id);
    });

    // ---- Bloques asignados ----

    const assigned = row.createEl('div', {
      cls: 'fl-arch-assigned'
    });

    if (node.blockIds.length === 0) {
      assigned.createEl('div', {
        cls: 'fl-arch-assigned-empty',
        text: i18n.t('board.architecture.empty.noMaterial')
      });
    }

    node.blockIds.forEach((blockId, blockIndex) => {
      const block = blockById.get(blockId);

      if (!block) return;

      this.renderAssignedBlock(
        assigned,
        host,
        node,
        block,
        blockIndex,
        node.blockIds.length
      );
    });
  }

  private renderAssignedBlock(
    assigned: HTMLElement,
    host: BoardArchitectureHost,
    node: BoardArchNode,
    block: BoardBlock,
    index: number,
    total: number
  ): void {
    const item = assigned.createEl('div', {
      cls: 'fl-arch-assigned-block'
    });

    if (block.active === false) {
      item.addClass('is-inactive');
    }

    item.createEl('span', {
      cls: 'fl-arch-block-preview',
      text: preview(block.text)
    });

    if (block.active === false) {
      item.createEl('span', {
        cls: 'fl-arch-inactive-badge',
        text: i18n.t('board.architecture.badge.inactive')
      });
    }

    const controls = item.createEl('div', {
      cls: 'fl-arch-block-controls'
    });

    this.iconButton(controls, 'arrow-up', i18n.t('board.architecture.action.moveInSectionUp'), () => {
      host.moveAssignedBlock(node.id, block.id, -1);
    }, index === 0);

    this.iconButton(controls, 'arrow-down', i18n.t('board.architecture.action.moveInSectionDown'), () => {
      host.moveAssignedBlock(node.id, block.id, 1);
    }, index === total - 1);

    this.iconButton(controls, 'x', i18n.t('board.architecture.action.removeFromSection'), () => {
      host.unassignBlockFromNode(node.id, block.id);
    });
  }

  // ============================================================
  // BANDEJA: MATERIAL SIN ASIGNAR
  // ============================================================

  private renderTray(
    container: HTMLElement,
    host: BoardArchitectureHost,
    nodes: BoardArchNode[],
    blocks: BoardBlock[]
  ): void {
    const assignedIds = new Set(
      nodes.flatMap(node => node.blockIds)
    );

    const unassigned = blocks.filter(
      block => !assignedIds.has(block.id)
    );

    if (unassigned.length === 0) {
      return;
    }

    const tray = container.createEl('div', {
      cls: 'fl-arch-tray'
    });

    tray.createEl('div', {
      cls: 'fl-arch-tray-title',
      text: i18n.t('board.architecture.tray.title')
    });

    for (const block of unassigned) {
      const item = tray.createEl('div', {
        cls: 'fl-arch-tray-item'
      });

      if (block.active === false) {
        item.addClass('is-inactive');
      }

      item.createEl('span', {
        cls: 'fl-arch-block-preview',
        text: preview(block.text)
      });

      if (block.active === false) {
        item.createEl('span', {
          cls: 'fl-arch-inactive-badge',
          text: i18n.t('board.architecture.badge.inactive')
        });
      }

      this.iconButton(item, 'plus', i18n.t('board.architecture.action.assignToSection'), (event) => {
        this.showAssignMenu(event, host, nodes, block);
      });
    }
  }

  private showAssignMenu(
    event: MouseEvent,
    host: BoardArchitectureHost,
    nodes: BoardArchNode[],
    block: BoardBlock
  ): void {
    const menu = new Menu();

    for (const node of nodes) {
      const title = node.title.trim() || i18n.t('board.architecture.menu.untitled');

      menu.addItem((item) => {
        item.setTitle(title);
        item.setIcon(node.level === 0 ? 'type' : 'heading');
        item.onClick(() => {
          host.assignBlockToNode(node.id, block.id);
        });
      });
    }

    menu.showAtMouseEvent(event);
  }

  // ============================================================
  // BARRA DE AÑADIDO
  // ============================================================

  private renderAddBar(
    container: HTMLElement,
    host: BoardArchitectureHost,
    nodeCount: number
  ): void {
    const bar = container.createEl('div', {
      cls: 'fl-arch-add-bar'
    });

    const levels: Array<{ label: string; level: number }> = [
      { label: i18n.t('board.architecture.add.title'), level: 0 },
      { label: i18n.t('board.architecture.add.section'), level: 1 },
      { label: i18n.t('board.architecture.add.subsection'), level: 2 },
      { label: i18n.t('board.architecture.add.item'), level: 3 }
    ];

    for (const entry of levels) {
      const button = bar.createEl('button', {
        cls: 'fl-arch-add-button',
        text: entry.label,
        attr: { type: 'button' }
      });

      button.addEventListener('click', () => {
        host.addArchNode(
          nodeCount > 0 ? nodeCount - 1 : null,
          entry.level
        );
      });
    }
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

  private iconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (event: MouseEvent) => void,
    disabled: boolean = false
  ): void {
    const button = parent.createEl('button', {
      cls: 'fl-arch-icon-button',
      attr: { type: 'button', 'aria-label': label, title: label }
    });

    setIcon(button, icon);

    if (disabled) {
      button.setAttr('disabled', 'true');
    }

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick(event);
    });
  }
}
