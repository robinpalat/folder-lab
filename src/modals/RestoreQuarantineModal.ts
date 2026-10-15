// src/modals/RestoreQuarantineModal.ts
//
// Confirmación explícita ANTES de restaurar cada entrada de la
// cuarentena (E4c-4). Un botón «Restaurar» por entrada y uno
// «Cancelar»; sin confirmación no se ejecuta nada. La fila se
// conserva y muestra el resultado (patrón de QuarantineCandidateModal
// tras el QA de E4b).
//
// ADVERTENCIA VISIBLE: restaurar recupera el archivo JSON de la
// entidad, pero NO reactiva la identidad de la nota ni modifica el
// registro de identidades (ids.json). Si el id sigue ausente del
// registro, el archivo restaurado volverá a considerarse huérfano
// en la próxima auditoría.

import { App, Modal, Notice } from 'obsidian';
import type {
  QuarantineManifestEntry,
  RestoreResult
} from '../storage/quarantine';
import type { RestoreCommandOutcome } from '../storage/restoreCommand';

export class RestoreQuarantineModal extends Modal {
  /** Seguimiento de entradas ya procesadas en esta sesión. */
  private processed = new Set<string>();

  constructor(
    app: App,
    private readonly outcome: Extract<
      RestoreCommandOutcome,
      { status: 'needs-confirmation' }
    >,
    private readonly onConfirm: (
      entry: QuarantineManifestEntry
    ) => Promise<RestoreResult | void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', {
      text: 'Restaurar datos en cuarentena'
    });
    contentEl.createEl('p', {
      text:
        'La restauración devuelve cada archivo a su ruta original. ' +
        'La copia en cuarentena se conserva (no se elimina nada).'
    });
    contentEl.createEl('p', {
      cls: 'folder-lab-restore-warning',
      text:
        'Importante: restaurar recupera el archivo JSON, pero NO ' +
        'reactiva la identidad de la nota ni modifica el registro de ' +
        'identidades. Si el id sigue ausente del registro, el archivo ' +
        'volverá a considerarse huérfano en la próxima auditoría.'
    });
    if (this.outcome.restoredCount > 0 || this.outcome.invalidCount > 0) {
      const bits: string[] = [];
      if (this.outcome.restoredCount > 0) {
        bits.push(`${this.outcome.restoredCount} ya restaurada(s)`);
      }
      if (this.outcome.invalidCount > 0) {
        bits.push(`${this.outcome.invalidCount} entrada(s) inválida(s) omitida(s)`);
      }
      contentEl.createEl('p', {
        text: `Manifiesto: ${bits.join('; ')}.`
      });
    }

    for (const entry of this.outcome.pending) {
      const row = contentEl.createEl('div', {
        cls: 'folder-lab-restore-candidate'
      });
      row.createEl('code', { text: entry.originPath });
      row.createEl('div', {
        text: `en cuarentena desde ${new Date(entry.quarantinedAt).toLocaleString()} · identidad: ${entry.noteId}`
      });
      const resultEl = row.createEl('div', {
        cls: 'folder-lab-restore-result'
      });
      const btnRow = row.createEl('div');
      const confirmBtn = btnRow.createEl('button', {
        text: 'Restaurar'
      });
      confirmBtn.onclick = () => {
        confirmBtn.setAttr('disabled', 'true');
        void this.onConfirm(entry)
          .then((result) => {
            resultEl.setText(describeRestoreResult(result, entry));
            this.processed.add(entry.entryId);
            if (this.processed.size >= this.outcome.pending.length) {
              this.close();
            }
          })
          .catch((error) => {
            resultEl.setText(
              `Fallo inesperado: ${error instanceof Error ? error.message : String(error)}; la copia en cuarentena se conserva.`
            );
            this.processed.add(entry.entryId);
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

/** Traduce un resultado de restauración a un mensaje de usuario. */
export function describeRestoreResult(
  result: RestoreResult | void,
  entry: QuarantineManifestEntry
): string {
  if (!result) {
    return 'Resultado desconocido; la copia en cuarentena se conserva.';
  }
  switch (result.status) {
    case 'restored':
      return result.rewrote
        ? 'Restaurado en la ruta original.'
        : 'El destino ya contenía el contenido exacto; restaurado sin reescribir.';
    case 'destination-changed':
      return (
        `No restaurado: ya existe un archivo DISTINTO en «${entry.originPath}». ` +
        'Nada se ha sobrescrito; la copia en cuarentena se conserva. ' +
        'Compare ambos archivos manualmente antes de decidir.'
      );
    case 'not-found':
      return 'Entrada no encontrada en el manifiesto.';
    case 'failed':
      return `No restaurado: ${result.error}; la copia en cuarentena se conserva.`;
    default:
      return 'Resultado desconocido; la copia en cuarentena se conserva.';
  }
}

export function notifyRestoreResult(
  result: RestoreResult | void,
  entry: QuarantineManifestEntry
): void {
  new Notice(`Folder Lab: ${describeRestoreResult(result, entry)}`);
}
