import { Plugin } from 'obsidian';
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

      /*
       * Etapa 2 + Corrección A: el ARCHIVO sincronizable
       * (Folder Lab/drafts) es la verdad; el espejo de emergencia
       * está AISLADO POR IDENTIDAD (LocalMirror). El legado por
       * ruta solo se adopta cuando la propiedad es segura (sin
       * pendientes); una nota nueva en ruta antigua no hereda.
       */
      const plugin = this.plugin as unknown as FolderLabPlugin;
      const draftStore = plugin.draftStore;
      const mirror = plugin.localMirror;
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

      if (draft === '' && mirror) {
        const mirrored = await mirror.read('focus-notes-draft', notePath);
        if (mirrored.value && mirrored.value.trim()) {
          draft = mirrored.value;
          if (draftStore && mirrored.adopted) {
            void draftStore.write(notePath, { draft }).catch(() => {
              /* el espejo local sigue disponible */
            });
          }
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
      if (serialized === null && mirror) {
        const mirrored = await mirror.read('focus-notes-blocks', notePath);
        serialized = mirrored.value;
        if (serialized && draftStore && mirrored.adopted) {
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

      const parsed: unknown = JSON.parse(serialized);

      if (!Array.isArray(parsed)) {
        return '';
      }

      const activeBlock = parsed.find(
        (block): block is NotesBlock =>
          typeof block === 'object' &&
          block !== null &&
          (block as NotesBlock).active === true &&
          typeof (block as NotesBlock).text === 'string'
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
