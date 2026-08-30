import {
  WorkspaceLeaf,
  TextFileView
} from 'obsidian';

import { Board } from './Board';

export const BOARD_VIEW_TYPE = 'folder-lab-board';

export class BoardView extends TextFileView {

  private board: Board | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
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

    this.contentEl.empty();

    this.board = new Board();

    this.board.render(this.contentEl);
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
