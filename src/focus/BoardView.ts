import {
  WorkspaceLeaf,
  TextFileView
} from 'obsidian';

import { Board, BoardDependencies } from './Board';
import { BoardRepository } from '../storage/BoardRepository';
import { WidgetManager } from './WidgetManager';
import { WidgetController } from './controllers/WidgetController';
import { BOARD_VIEW_TYPE } from '../constants/view-types';

// Re-export (fuente única: constants/view-types; Corrección B).
export { BOARD_VIEW_TYPE };

export interface BoardViewDependencies {
  widgetManager: WidgetManager;
  repository: BoardRepository;
  controller?: WidgetController;
}

export class BoardView extends TextFileView {

  private board: Board | null = null;
  private readonly deps: BoardViewDependencies;

  /*
   * setViewData es async (await load) y Obsidian puede invocarlo de
   * forma superpuesta. El token de generación garantiza que solo la
   * última petición llegue a renderizar: una continuación obsoleta
   * nunca dibuja un segundo Board sobre el DOM.
   */
  private renderGeneration = 0;

  constructor(
    leaf: WorkspaceLeaf,
    deps: BoardViewDependencies
  ) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string {
    return BOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Board';
  }

  async setViewData(
    data: string,
    clear: boolean
  ): Promise<void> {

    const generation = ++this.renderGeneration;

    /*
     * P1-2A: el destroy anterior esperaba (await) el guardado
     * pendiente. Hacerlo aquí también evita que el load() de un
     * Board nuevo lea el almacén ANTES de que termine el flush
     * del Board anterior.
     */
    await this.board?.destroy();
    this.board = null;

    this.contentEl.empty();

    if (!this.file) {
      return;
    }

    const boardDeps: BoardDependencies = {
      app: this.app,
      widgetManager: this.deps.widgetManager,
      repository: this.deps.repository,
      notePath: this.file.path,
      controller: this.deps.controller
    };

    const board = new Board(boardDeps);

    await board.load();

    if (generation !== this.renderGeneration) {
      // Llegó una petición más reciente: esta queda obsoleta.
      await board.destroy();
      return;
    }

    this.board = board;

    board.render(this.contentEl);
  }

  getViewData(): string {
    return '';
  }

  clear(): void {
    this.contentEl.empty();
  }

  async onClose(): Promise<void> {
    /*
     * P1-2A: Obsidian espera la promesa de onClose. destroy()
     * espera el guardado pendiente o en vuelo, de modo que un
     * cierre por Focus, por el botón Board/Nota o por cierre
     * del panel no descarta cambios sin persistir.
     */
    await this.board?.destroy();
    this.board = null;

    this.contentEl.empty();
  }
}
