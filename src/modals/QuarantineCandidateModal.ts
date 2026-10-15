// src/modals/QuarantineCandidateModal.ts
//
// Confirmación explícita ANTES de mover cada candidato a cuarentena
// (E4b, comando manual). Un botón «Cuarentenar» y uno «Cancelar»;
// sin confirmación no se ejecuta nada.

import { App, Modal, Notice } from 'obsidian';
import type { OrphanCandidate } from '../storage/orphanAudit';

export class QuarantineCandidateModal extends Modal {
  constructor(
    app: App,
    private readonly candidates: OrphanCandidate[],
    private readonly onConfirm: (candidate: OrphanCandidate) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', {
      text: 'Cuarentena de datos huérfanos'
    });
    contentEl.createEl('p', {
      text:
        'Se moverán los siguientes archivos a Folder Lab/quarantine/. ' +
        'La operación es manual y solo debe realizarse en este dispositivo ' +
        '(el manifiesto no está sincronizado entre dispositivos).'
    });

    for (const candidate of this.candidates) {
      const row = contentEl.createEl('div', {
        cls: 'folder-lab-quarantine-candidate'
      });
      row.createEl('code', { text: candidate.path });
      row.createEl('div', {
        text: `identidad: ${candidate.noteId} · motivo: ${candidate.reason}`
      });
      const btnRow = row.createEl('div');
      const confirmBtn = btnRow.createEl('button', {
        text: 'Cuarentenar'
      });
      confirmBtn.onclick = () => {
        confirmBtn.setAttr('disabled', 'true');
        void this.onConfirm(candidate).then(() => {
          row.remove();
          if (this.candidates.every((c) => c !== candidate)) {
            this.close();
          }
        });
      };
    }

    const cancelBtn = contentEl.createEl('button', { text: 'Cancelar' });
    cancelBtn.onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Traduce un resultado de cuarentena a un mensaje de usuario. */
export function describeQuarantineResult(
  result: { status: string; reason?: string; error?: string },
  candidate: OrphanCandidate
): string {
  switch (result.status) {
    case 'quarantined':
      return `Folder Lab: «${candidate.noteId}» movido a cuarentena.`;
    case 'skipped':
      return `Folder Lab: «${candidate.noteId}» no se movió (${result.reason ?? 'rechazado'}).`;
    case 'failed':
      return `Folder Lab: fallo al cuarentenar «${candidate.noteId}» (${result.error ?? 'error'}); el original se conserva.`;
    default:
      return 'Folder Lab: resultado desconocido.';
  }
}

export function notifyQuarantineResult(
  result: { status: string; reason?: string; error?: string },
  candidate: OrphanCandidate
): void {
  new Notice(describeQuarantineResult(result, candidate));
}
