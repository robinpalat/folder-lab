// src/storage/startupMaintenance.ts
//
// Mantenimiento de arranque (M1 de la auditoría adversarial).
//
// Punto único de ejecución (onLayoutReady), una vez por sesión:
// 1. Recupera migraciones de renombrado pendientes (diario M2).
// 2. Ejecuta NoteIdentityRegistry.reconcile (detección NO
//    destructiva de inconsistencias; restaura/archiva según la
//    ventana A3; reporta huérfanos y duplicados).
//
// Un fallo en (1) no impide (2). Nunca se borran datos aquí.

import { App } from 'obsidian';
import type { NoteIdentityRegistry } from './NoteIdentityRegistry';
import type { NoteLifecycle } from './NoteLifecycle';

export interface MaintenanceReport {
  recoveredJournal: boolean;
  reconcileOrphans: number;
  /** Rutas con datos pendientes cuya nota ya existe (reclamar). */
  reconcilePendingExisting: number;
  reconcileDuplicateIds: number;
}

export async function runStartupMaintenance(
  app: App,
  registry: NoteIdentityRegistry,
  lifecycle: NoteLifecycle | null
): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {
    recoveredJournal: false,
    reconcileOrphans: 0,
    reconcilePendingExisting: 0,
    reconcileDuplicateIds: 0
  };

  if (lifecycle) {
    try {
      await lifecycle.recoverPending();
      report.recoveredJournal = true;
    } catch (error) {
      console.error(
        '[FolderLab] Recuperación de migraciones pendientes fallida:',
        error
      );
    }
  }

  try {
    const existingPaths = app.vault
      .getMarkdownFiles()
      .map((f) => f.path);
    const reconcile = await registry.reconcile(existingPaths);
    report.reconcileOrphans = reconcile.orphans.length;
    report.reconcilePendingExisting = reconcile.pendingExisting.length;
    report.reconcileDuplicateIds = reconcile.duplicateIds.length;
    if (
      reconcile.orphans.length ||
      reconcile.pendingExisting.length ||
      reconcile.duplicateIds.length
    ) {
      console.info('[FolderLab] Reconciliación de identidad:', reconcile);
    }
  } catch (error) {
    console.error('[FolderLab] Reconciliación de identidad fallida:', error);
  }

  return report;
}
