import { Plugin } from 'obsidian';

interface NotesBlock {
  id: string;
  text: string;
  active: boolean;
}

export class NotesController {
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async getActiveSource(notePath: string): Promise<string> {
    if (!notePath) {
      return '';
    }

    try {
      // --------------------------------------------------------
      // 1. DRAFT ACTUAL
      // --------------------------------------------------------

      const draftKey =
        `focus-notes-draft-${notePath}`;

      const draft =
        localStorage.getItem(draftKey);

      if (draft?.trim()) {
        return draft.trim();
      }

      // --------------------------------------------------------
      // 2. FRAGMENTO ACTIVO
      // --------------------------------------------------------

      const blocksKey =
        `focus-notes-blocks-${notePath}`;

      const serialized =
        localStorage.getItem(blocksKey);

      if (!serialized) {
        return '';
      }

      const parsed = JSON.parse(serialized);

      if (!Array.isArray(parsed)) {
        return '';
      }

      const activeBlock = parsed.find(
        (block: NotesBlock) =>
          block &&
          block.active === true &&
          typeof block.text === 'string'
      );

      if (activeBlock?.text?.trim()) {
        return activeBlock.text.trim();
      }

      return '';

    } catch {
      return '';
    }
  }
}
