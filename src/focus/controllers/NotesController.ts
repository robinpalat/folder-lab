import { Plugin } from 'obsidian';
import { resolveVaultStorageId, vaultStorageKey } from '../../utils/vault-storage';
import type FolderLabPlugin from '../../main';
import type { DraftData } from '../../storage/DraftStore';

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

      const vaultId = resolveVaultStorageId(this.plugin.app);
      const draftKey = vaultStorageKey(
        vaultId,
        'focus-notes-draft',
        notePath
      );
      const blocksKey = vaultStorageKey(
        vaultId,
        'focus-notes-blocks',
        notePath
      );

      /*
       * Etapa 2: el ARCHIVO sincronizable (Folder Lab/drafts) es la
       * verdad; localStorage es el espejo de emergencia. Si el
       * archivo falta o es ilegible, se usa el espejo; si el espejo
       * tiene datos y no hay archivo, se copia (sin borrar origen).
       */
      const draftStore = (this.plugin as unknown as FolderLabPlugin)
        .draftStore;
      let draft = '';
      let fileBlocks: DraftData['blocks'] | null = null;
      if (draftStore) {
        try {
          const file = await draftStore.read(notePath);
          if (file) {
            draft = file.draft;
            fileBlocks = file.blocks;
          }
        } catch (error) {
          console.error(
            '[NotesController] Borrador de bóveda ilegible; usando espejo local:',
            error
          );
        }
      }

      if (draft === '') {
        draft = localStorage.getItem(draftKey) ?? '';
        if (draft.trim() && draftStore) {
          void draftStore.write(notePath, { draft }).catch(() => {
            /* el espejo local sigue disponible */
          });
        }
      }

      if (draft.trim()) {
        return draft.trim();
      }

      // --------------------------------------------------------
      // 2. FRAGMENTO ACTIVO
      // --------------------------------------------------------

      let serialized: string | null =
        fileBlocks !== null ? JSON.stringify(fileBlocks) : null;
      if (serialized === null) {
        serialized = localStorage.getItem(blocksKey);
        if (serialized && draftStore) {
          try {
            const parsedLs: unknown = JSON.parse(serialized);
            if (Array.isArray(parsedLs)) {
              void draftStore
                .write(notePath, {
                  blocks: parsedLs as DraftData['blocks']
                })
                .catch(() => {
                  /* el espejo local sigue disponible */
                });
            }
          } catch {
            /* espejo corrupto: se ignora igual que antes */
          }
        }
      }

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
