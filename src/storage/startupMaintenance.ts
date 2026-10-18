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
import type { NoteRepository } from './NoteRepository';
import { runOrphanAudit, type OrphanAuditReport } from './orphanAudit';
import {
  LegacyContextMigration,
  type MigrationReport
} from './legacyContextMigration';

export interface MaintenanceReport {
  recoveredJournal: boolean;
  reconcileOrphans: number;
  /** Rutas con datos pendientes cuya nota ya existe (reclamar). */
  reconcilePendingExisting: number;
  reconcileDuplicateIds: number;
  /** E4a: huérfanos elegibles (gracia cumplida); solo reporte. */
  orphanCandidates: number;
  /** Informe completo de la auditoría (E4a); null sin Master. */
  orphanAudit: OrphanAuditReport | null;
  /** Migración de `_note_context.json` legado a entidades. */
  legacyContextMigration: MigrationReport | null;
}

export async function runStartupMaintenance(
  app: App,
  registry: NoteIdentityRegistry,
  lifecycle: NoteLifecycle | null,
  getRootPath?: () => string | null,
  noteRepository?: NoteRepository
): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {
    recoveredJournal: false,
    reconcileOrphans: 0,
    reconcilePendingExisting: 0,
    reconcileDuplicateIds: 0,
    orphanCandidates: 0,
    orphanAudit: null,
    legacyContextMigration: null
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

  let existingPaths: string[] = [];
  try {
    existingPaths = app.vault
      .getMarkdownFiles()
      .map((f) => f.path);
    const reconcile = await registry.reconcile(existingPaths);
    report.reconcileOrphans = reconcile.orphans.length;
    report.reconcilePendingExisting = reconcile.pendingExisting.length;
    report.reconcileDuplicateIds = reconcile.duplicateIds.length;
  } catch (error) {
    console.error('[FolderLab] Reconciliación de identidad fallida:', error);
  }

  // Migración proactiva de `_note_context.json` legado (Etapa 1) →
  // entidades `Folder Lab/context/<id>.json`. No elimina archivos.
  if (noteRepository) {
    try {
      const contextStore = noteRepository.getEntitiesStore();
      if (contextStore) {
        const migration = new LegacyContextMigration(
          app,
          registry,
          contextStore
        );
        report.legacyContextMigration = await migration.run();
      }
    } catch (error) {
      console.error(
        '[FolderLab] Migración de contexto legado fallida:',
        error
      );
    }
  }

  // E4a: auditoría de huérfanos en modo solo lectura (cero escrituras;
  // lee ids.json/journal crudos, sin persistir migraciones).
  if (getRootPath) {
    try {
      const audit = await runOrphanAudit(
        app,
        getRootPath,
        existingPaths
      );
      report.orphanAudit = audit;
      report.orphanCandidates = audit.candidates.length;
    } catch (error) {
      console.error('[FolderLab] Auditoría de huérfanos fallida:', error);
    }
  }

  return report;
}
