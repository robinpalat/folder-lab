// src/modals/QuarantineCandidateModal.ts
//
// Confirmación explícita ANTES de mover cada candidato a cuarentena
// (E4b, comando manual). Un botón «Cuarentenar» y uno «Cancelar»;
// sin confirmación no se ejecuta nada.

import { App, Modal, Notice } from 'obsidian';
import type { OrphanCandidate } from '../storage/orphanAudit';
import type { QuarantineResult } from '../storage/quarantine';

export class QuarantineCandidateModal extends Modal {
  /** Seguimiento de candidatos ya procesados en esta sesión. */
  private processed = new Set<OrphanCandidate>();

  constructor(
    app: App,
    private readonly candidates: OrphanCandidate[],
    private readonly onConfirm: (
      candidate: OrphanCandidate
    ) => Promise<QuarantineResult | void>
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
      const row = contentEl.createDiv({
        cls: 'folder-lab-quarantine-candidate'
      });
      row.createEl('code', { text: candidate.path });
      row.createDiv({
        text: `identidad: ${candidate.noteId} · motivo: ${candidate.reason}`
      });
      const resultEl = row.createDiv({
        cls: 'folder-lab-quarantine-result'
      });
      const btnRow = row.createDiv();
      const confirmBtn = btnRow.createEl('button', {
        text: 'Cuarentenar'
      });
      confirmBtn.onclick = () => {
        confirmBtn.setAttr('disabled', 'true');
        void this.onConfirm(candidate)
          .then((result) => {
            // El resultado se muestra en la propia fila (la fila
            // NO desaparece sin dejar constancia).
            resultEl.setText(
              result?.status === 'quarantined'
                ? 'Movido a cuarentena.'
                : result?.status === 'skipped'
                  ? `No se movió: ${result.reason ?? 'rechazado'}.`
                  : result?.status === 'failed'
                    ? `Fallo: ${result.error ?? 'error'}; el original se conserva.`
                    : 'Resultado desconocido; el original se conserva.'
            );
            this.processed.add(candidate);
            if (this.processed.size >= this.candidates.length) {
              this.close();
            }
          })
          .catch((error) => {
            resultEl.setText(
              `Fallo inesperado: ${error instanceof Error ? error.message : String(error)}; el original se conserva.`
            );
            this.processed.add(candidate);
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
