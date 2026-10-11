import {
  WorkspaceLeaf,
  TextFileView
} from 'obsidian';

import { Board, BoardDependencies } from './Board';
import { BoardRepository } from '../storage/BoardRepository';
import { WidgetManager } from './WidgetManager';
import { WidgetController } from './controllers/WidgetController';

export const BOARD_VIEW_TYPE = 'folder-lab-board';

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

    this.board?.destroy();
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
      board.destroy();
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
    this.board?.destroy();
    this.board = null;

    this.contentEl.empty();
  }
}
