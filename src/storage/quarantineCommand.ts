// src/storage/quarantineCommand.ts
//
// Núcleo del comando manual de cuarentena (E4b, integración).
//
// UI-free y testeable: el comando del plugin solo traduce este
// resultado a modal/Notice. SIN ejecución en el arranque ni efectos
// secundarios de otras operaciones. Uso manual, single-device
// (manifiesto único; la sincronización multi-dispositivo no está
// garantizada — decisión provisional aceptada).
//
// Flujo:
// 1. Sin Master → no-master.
// 2. registry.refresh() (incorpora cambios externos de ids.json).
// 3. Auditoría E4a (solo lectura) → candidatos.
// 4. Sin candidatos → no-candidates (distinto de error de escaneo).
// 5. El llamante CONFIRMA cada candidato (la confirmación vive en
//    la UI; el núcleo expone `quarantineOne` por candidato).
// 6. En cada cuarentena: stillOrphan revalida en vivo (identidad,
//    journal, errores → se conserva el original).

import { App } from 'obsidian';
import type { NoteIdentityRegistry } from './NoteIdentityRegistry';
import type { OrphanAuditReport, OrphanCandidate } from './orphanAudit';
import { runOrphanAudit } from './orphanAudit';
import {
  QuarantineManager,
  type QuarantineResult
} from './quarantine';

export interface QuarantineCommandDeps {
  app: App;
  registry: NoteIdentityRegistry;
  getRootPath: () => string | null;
  /** Lista de notas markdown actuales (vault.getMarkdownFiles). */
  getExistingPaths: () => string[];
  /**
   * Instancia COMPARTIDA de QuarantineManager (una sola por plugin):
   * su cola interna serializa cuarentena/restauración en el
   * dispositivo. NUNCA se crea un manager por invocación (dos
   * managers concurrentes perderían entradas del manifiesto).
   */
  manager: QuarantineManager;
}

export type QuarantineCommandOutcome =
  | { status: 'no-master' }
  | { status: 'no-candidates'; audit: OrphanAuditReport }
  | { status: 'needs-confirmation'; candidates: OrphanCandidate[]; audit: OrphanAuditReport }
  | { status: 'error'; error: string; audit?: OrphanAuditReport };

/**
 * Paso 1 del comando: refresco + auditoría. Devuelve los candidatos
 * que el usuario deberá confirmar UNO A UNO (la UI llama después a
 * `quarantineCandidate`).
 */
export async function prepareQuarantineCommand(
  deps: QuarantineCommandDeps
): Promise<QuarantineCommandOutcome> {
  const root = deps.getRootPath();
  if (root === null || root === undefined) {
    return { status: 'no-master' };
  }

  // Incorpora cambios externos recientes (sync) antes de evaluar.
  deps.registry.refresh();

  let audit: OrphanAuditReport;
  try {
    audit = await runOrphanAudit(
      deps.app as unknown as Parameters<typeof runOrphanAudit>[0],
      deps.getRootPath,
      deps.getExistingPaths()
    );
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    };
  }

  if (audit.unreadable.length > 0) {
    return {
      status: 'error',
      error: `archivos ilegibles: ${audit.unreadable.join(', ')}`,
      audit
    };
  }

  if (audit.candidates.length === 0) {
    return { status: 'no-candidates', audit };
  }
  return { status: 'needs-confirmation', candidates: audit.candidates, audit };
}

/**
 * Paso 2 del comando: cuarentena de UN candidato ya confirmado por
 * el usuario. Delega en el manager COMPARTIDO (su cola serializa
 * incluso confirmaciones simultáneas de varias filas del modal).
 */
export async function quarantineCandidate(
  deps: QuarantineCommandDeps,
  candidate: OrphanCandidate
): Promise<QuarantineResult> {
  return deps.manager.quarantine(candidate);
}
