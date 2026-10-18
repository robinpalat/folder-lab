// src/storage/legacyContextMigration.ts
//
// Migración proactiva del almacén legado `_note_context.json` (Etapa 1)
// hacia el store de entidades `Folder Lab/context/<id>.json`.
//
// Reglas:
// - Procesa cada entrada por separado con validación completa.
// - Si la entidad de destino no existe, la crea con verificación.
// - Si ya existe, compara datos; nunca sobrescribe sin reportar.
// - Registra resultados por archivo y entrada.
// - Si una entrada falla, conserva intacto su archivo de origen.
// - No elimina archivos legados hasta verificar TODAS sus entradas.

import type { App } from 'obsidian';
import type { TFile } from 'obsidian';
import type { NoteIdentityRegistry } from './NoteIdentityRegistry';
import type { EntityFileStore } from './EntityFileStore';
import type { NoteContextData } from './NoteRepository';

export type MigrationEntryStatus =
  | 'migrated'
  | 'already_migrated'
  | 'conflict'
  | 'error'
  | 'skipped';

export interface MigrationEntryResult {
  notePath: string;
  status: MigrationEntryStatus;
  reason?: string;
}

export interface MigrationFileResult {
  filePath: string;
  entries: MigrationEntryResult[];
  success: boolean;
}

export interface MigrationReport {
  filesProcessed: number;
  totalEntries: number;
  migrated: number;
  alreadyMigrated: number;
  conflicts: number;
  errors: number;
  skipped: number;
  fileResults: MigrationFileResult[];
}

function isValidNoteContextData(value: unknown): value is NoteContextData {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  if (obj.widgets !== undefined) {
    if (!Array.isArray(obj.widgets)) return false;
    for (const w of obj.widgets) {
      if (typeof w !== 'object' || w === null) return false;
      const widget = w as Record<string, unknown>;
      if (typeof widget.instanceId !== 'string') return false;
      if (typeof widget.typeId !== 'string') return false;
    }
  }

  if (obj.layout !== undefined) {
    if (typeof obj.layout !== 'object' || obj.layout === null) return false;
    const layout = obj.layout as Record<string, unknown>;
    if (layout.top !== undefined && typeof layout.top !== 'string') return false;
    if (layout.bottom !== undefined && typeof layout.bottom !== 'string') return false;
  }

  return true;
}

function isSameData(a: NoteContextData, b: NoteContextData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class LegacyContextMigration {
  constructor(
    private app: App,
    private registry: NoteIdentityRegistry,
    private contextStore: EntityFileStore<NoteContextData>
  ) {}

  async run(): Promise<MigrationReport> {
    const report: MigrationReport = {
      filesProcessed: 0,
      totalEntries: 0,
      migrated: 0,
      alreadyMigrated: 0,
      conflicts: 0,
      errors: 0,
      skipped: 0,
      fileResults: []
    };

    const files = this.app.vault.getFiles();
    const legacyFiles = files.filter((f: TFile) =>
      f.path.endsWith('/.folder-lab/_note_context.json')
    );

    for (const file of legacyFiles) {
      const fileResult = await this.migrateFile(file.path);
      report.fileResults.push(fileResult);
      report.filesProcessed++;

      for (const entry of fileResult.entries) {
        report.totalEntries++;
        switch (entry.status) {
          case 'migrated':
            report.migrated++;
            break;
          case 'already_migrated':
            report.alreadyMigrated++;
            break;
          case 'conflict':
            report.conflicts++;
            break;
          case 'error':
            report.errors++;
            break;
          case 'skipped':
            report.skipped++;
            break;
        }
      }
    }

    return report;
  }

  private async migrateFile(filePath: string): Promise<MigrationFileResult> {
    const result: MigrationFileResult = {
      filePath,
      entries: [],
      success: false
    };

    let raw: string;
    try {
      raw = await this.app.vault.adapter.read(filePath);
    } catch {
      return { ...result, success: false };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...result, success: false };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...result, success: false };
    }
    const store = parsed;
    let hasErrors = false;

    for (const [notePath, entry] of Object.entries(store)) {
      const entryResult = await this.migrateEntry(notePath, entry);
      result.entries.push(entryResult);

      if (entryResult.status === 'error' || entryResult.status === 'conflict') {
        hasErrors = true;
      }
    }

    result.success = !hasErrors;
    return result;
  }

  private async migrateEntry(
    notePath: string,
    entry: unknown
  ): Promise<MigrationEntryResult> {
    if (typeof notePath !== 'string' || !notePath.endsWith('.md')) {
      return { notePath, status: 'error', reason: 'Ruta de nota inválida' };
    }

    if (!isValidNoteContextData(entry)) {
      return { notePath, status: 'error', reason: 'Datos de contexto inválidos' };
    }

    const data = entry;

    let entityId: string | null;
    try {
      entityId = await this.registry.getId(notePath);
    } catch {
      return { notePath, status: 'error', reason: 'Error resolviendo identidad' };
    }

    if (!entityId) {
      return { notePath, status: 'skipped', reason: 'Sin identidad asignada' };
    }

    let existing: NoteContextData | null = null;
    try {
      const envelope = await this.contextStore.read(entityId);
      existing = envelope ? envelope.data : null;
    } catch (e) {
      return {
        notePath,
        status: 'error',
        reason: `Entidad corrupta: ${String(e)}`
      };
    }

    if (existing) {
      if (isSameData(existing, data)) {
        return { notePath, status: 'already_migrated' };
      }
      return {
        notePath,
        status: 'conflict',
        reason: 'Datos difieren de la entidad existente'
      };
    }

    try {
      await this.contextStore.write(entityId, notePath, data);
      const verify = await this.contextStore.read(entityId);
      if (!verify || !isSameData(verify.data, data)) {
        return {
          notePath,
          status: 'error',
          reason: 'Verificación post-escritura fallida'
        };
      }
      return { notePath, status: 'migrated' };
    } catch (e) {
      return {
        notePath,
        status: 'error',
        reason: `Error escribiendo entidad: ${String(e)}`
      };
    }
  }
}
