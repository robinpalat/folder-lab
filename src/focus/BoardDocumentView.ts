import { setIcon } from 'obsidian';

import {
  BoardArchNode,
  BoardBlock,
  BoardFragmentOverride
} from '../storage/BoardRepository';
import { i18n } from '../i18n/I18nService';

/**
 * Contrato que Board implementa para la instancia Documento.
 */
export interface BoardDocumentHost {
  getBlocks(): BoardBlock[];
  getArchitectureNodes(): BoardArchNode[];
  getFragmentOverrides(): BoardFragmentOverride[];

  /** Texto mostrado para un bloque: versión personal si está activa, si no el original vivo. */
  getDisplayedText(block: BoardBlock): string;

  setFragmentOverride(blockId: string, text: string): void;
  clearFragmentOverride(blockId: string): void;
  toggleFragmentOverride(blockId: string): void;
  openPolishModal(blockId: string): void;
}

/**
 * Instancia 3: Documento continuo.
 *
 * Compone el texto resultante siguiendo el orden editorial de
 * Arquitectura, con los bloques activos asignados. Cada párrafo
 * conserva la referencia a su bloque de origen, de modo que las
 * versiones personales conviven con los originales sin
 * sobrescribirlos.
 */
export class BoardDocumentView {

  render(
    container: HTMLElement,
    host: BoardDocumentHost
  ): void {
    container.empty();
    container.addClass('fl-board-document');

    const nodes = host.getArchitectureNodes();
    const blocks = host.getBlocks();
    const blockById = new Map(
      blocks.map(block => [block.id, block])
    );

    const hasAnyActiveAssignment = nodes.some(node =>
      node.blockIds.some(blockId => {
        const block = blockById.get(blockId);
        return block && block.active !== false;
      })
    );

    if (nodes.length === 0 || !hasAnyActiveAssignment) {
      const empty = container.createDiv({
        cls: 'fl-doc-empty'
      });

      empty.createDiv({
        cls: 'fl-doc-empty-title',
        text: i18n.t('board.document.empty.title')
      });

      empty.createDiv({
        cls: 'fl-doc-empty-hint',
        text: i18n.t('board.document.empty.hint')
      });

      return;
    }

    for (const node of nodes) {
      this.renderNode(container, host, node, blockById);
    }
  }

  private renderNode(
    container: HTMLElement,
    host: BoardDocumentHost,
    node: BoardArchNode,
    blockById: Map<string, BoardBlock>
  ): void {
    const title = node.title.trim() || i18n.t('board.document.heading.untitled');

    if (node.level === 0) {
      container.createEl('h1', {
        cls: 'fl-doc-title',
        text: title
      });
      return;
    }

    const headingTag = node.level === 1
      ? 'h2'
      : node.level === 2
        ? 'h3'
        : 'h4';

    container.createEl(headingTag, {
      cls: `fl-doc-heading fl-doc-heading-level-${node.level}`,
      text: title
    });

    for (const blockId of node.blockIds) {
      const block = blockById.get(blockId);

      // Los bloques inexistentes o desactivados quedan fuera
      // del texto resultante.
      if (!block || block.active === false) {
        continue;
      }

      this.renderParagraph(container, host, block);
    }
  }

  private renderParagraph(
    container: HTMLElement,
    host: BoardDocumentHost,
    block: BoardBlock
  ): void {
    const paragraph = container.createDiv({
      cls: 'fl-doc-paragraph'
    });

    paragraph.setAttr('data-doc-block-id', block.id);

    const overrides = host.getFragmentOverrides();
    const override = overrides.find(
      entry => entry.blockId === block.id
    );

    if (override?.useOverride) {
      paragraph.addClass('has-override');
    }

    const text = paragraph.createDiv({
      cls: 'fl-doc-paragraph-text',
      text: host.getDisplayedText(block)
    });

    text.setAttr('contenteditable', 'true');

    /*
     * Edición directa: cualquier cambio guardado se convierte en
     * una versión personal. El original (texto de la tarjeta) nunca
     * se modifica desde aquí.
     */
    let textAtFocus = text.innerText;

    text.addEventListener('focus', () => {
      textAtFocus = text.innerText;
    });

    text.addEventListener('blur', () => {
      const newText = text.innerText.trim();
      const displayed = textAtFocus.trim();

      if (newText === displayed) {
        return;
      }

      if (newText === block.text.trim()) {
        host.clearFragmentOverride(block.id);
      } else {
        host.setFragmentOverride(block.id, newText);
      }

      this.refreshParagraphControls(paragraph, host, block);
    });

    const controls = paragraph.createDiv({
      cls: 'fl-doc-paragraph-controls'
    });

    this.renderParagraphControls(controls, host, block, override);
  }

  private renderParagraphControls(
    controls: HTMLElement,
    host: BoardDocumentHost,
    block: BoardBlock,
    override: BoardFragmentOverride | undefined
  ): void {
    const polishButton = controls.createEl('button', {
      cls: 'fl-doc-polish-button',
      attr: { type: 'button', 'aria-label': i18n.t('modal.polish.title'), title: i18n.t('modal.polish.title') }
    });

    setIcon(polishButton, 'wand-2');
    polishButton.createSpan({ text: i18n.t('modal.polish.buttonShort') });

    polishButton.addEventListener('click', (event) => {
      event.stopPropagation();
      host.openPolishModal(block.id);
    });

    if (!override) {
      controls.createSpan({
        cls: 'fl-doc-version-badge is-original',
        text: i18n.t('board.document.badge.original')
      });
      return;
    }

    const toggle = controls.createEl('button', {
      cls: 'fl-doc-version-toggle',
      attr: {
        type: 'button',
        'aria-label': i18n.t('board.document.action.toggleVersion'),
        title: i18n.t('board.document.action.toggleVersionTooltip')
      }
    });

    const showOverride = override.useOverride;

    toggle.createSpan({
      cls: 'fl-doc-version-label',
      text: showOverride ? i18n.t('board.document.version.personal') : i18n.t('board.document.version.original')
    });

    setIcon(toggle, showOverride ? 'sparkles' : 'file-text');

    toggle.toggleClass('is-personal-active', showOverride);
    toggle.toggleClass('is-original-active', !showOverride);

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      host.toggleFragmentOverride(block.id);
    });
  }

  /**
   * Refresca los controles de un párrafo tras una edición local,
   * sin reconstruir el documento completo.
   */
  private refreshParagraphControls(
    paragraph: HTMLElement,
    host: BoardDocumentHost,
    block: BoardBlock
  ): void {
    const controls: HTMLElement | null = paragraph.querySelector(
      '.fl-doc-paragraph-controls'
    );

    if (!controls) {
      return;
    }

    const override = host.getFragmentOverrides().find(
      entry => entry.blockId === block.id
    );

    paragraph.toggleClass('has-override', !!override?.useOverride);

    controls.empty();
    this.renderParagraphControls(controls, host, block, override);
  }
}
