// src/modals/ClaimDataModal.ts
//
// Modal de reclamación EXPLÍCITA de identidades pendientes (E2).
//
// Presenta las candidatas (pendientes y archivadas) como opciones
// distinguibles; NO elige arbitrariamente entre varias. El mensaje
// explica que son datos de una nota ANTERIOR (Obsidian no distingue
// restauración de creación nueva).

import { App, FuzzySuggestModal, Notice } from 'obsidian';
import type {
  NoteIdentityRegistry,
  PendingClaim
} from '../storage/NoteIdentityRegistry';

export class ClaimDataModal extends FuzzySuggestModal<PendingClaim> {
  constructor(
    app: App,
    private readonly candidates: PendingClaim[],
    private readonly registry: NoteIdentityRegistry
  ) {
    super(app);
    this.setPlaceholder('Datos de notas anteriores…');
  }

  getItems(): PendingClaim[] {
    return this.candidates;
  }

  getItemText(item: PendingClaim): string {
    const bucket =
      item.bucket === 'pending' ? 'pendiente' : 'archivado';
    const fecha = new Date(item.deletedAt).toLocaleString();
    return `${item.path} — ${bucket} — borrada el ${fecha}`;
  }

  onChooseItem(item: PendingClaim): void {
    void this.registry
      .claim(item.path, item.bucket)
      .then((result) => {
        if (result.status === 'claimed') {
          new Notice(
            `Folder Lab: datos de la nota anterior restaurados en «${item.path}».`
          );
        } else if (result.status === 'conflict') {
          new Notice(
            'Folder Lab: la ruta ya tiene una identidad activa distinta. ' +
              'No se reclamó nada (los datos quedan conservados).'
          );
        } else {
          new Notice('Folder Lab: no se pudo reclamar el dato seleccionado.');
        }
      })
      .catch((error) => {
        console.error('[FolderLab] Error reclamando datos:', error);
        new Notice('Folder Lab: error al reclamar los datos.');
      });
  }
}
