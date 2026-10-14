// src/storage/orphanAudit.ts
//
// Auditoría de huérfanos en modo solo lectura (E4a).
//
// Escanea boards/, context/, drafts/ y polish/ de
// `<Master>/Folder Lab/` y clasifica cada archivo por su relación
// con `ids.json` y `lifecycle-journal.json` SIN escribir nada (solo
// exists/read/list/stat) y SIN persistir migraciones (lee los JSON
// crudos por adapter; la autoridad de identidad no se toca).
//
// Clases (informe E4 aprobado):
// - Datos de identidad activa, pendiente, archivada o referenciada
//   por un journal: NO son candidatos.
// - Identidad huérfana (id en ids.json cuya nota no existe): solo
//   reporte; sus datos se conservan (restauración las reviviría).
// - Candidato a huérfano: id AUSENTE de todo el registro y de los
//   journals, notePath del sobre inexistente como nota y mtime con
//   al menos ORPHAN_GRACE_MS de gracia.
// - Reciente (gracia sin cumplir) y ambiguo (notePath sí existe):
//   se conservan; nunca pasan a candidatos.
// - Ilegibles: contenido recuperable; jamás huérfanos.

export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export const ORPHAN_SUBFOLDERS = ['boards', 'context', 'drafts', 'polish'] as const;

export interface OrphanCandidate {
  path: string;
  noteId: string;
  subfolder: string;
  reason: string;
  mtime: number | null;
}

export interface OrphanAuditReport {
  /** Recuento de ids con nota existente (contexto del log). */
  activeIdentities: number;
  pendingIds: string[];
  archivedIds: string[];
  journalNoteIds: string[];
  /** Ids en ids.json cuya nota NO existe (solo reporte). */
  identityOrphans: string[];
  /** Huérfanos con la gracia cumplida (elegibles a cuarentena en E4b). */
  candidates: OrphanCandidate[];
  /** Huérfanos con mtime reciente (aún bajo gracia). */
  recentOrphans: OrphanCandidate[];
  /** Casos no resolubles con certeza: se conservan. */
  ambiguous: OrphanCandidate[];
  /** Archivos cuyo JSON no pudo leerse (conservar). */
  unreadable: string[];
}

interface AuditAdapter {
  exists(p: string): Promise<boolean>;
  read(p: string): Promise<string>;
  list(p: string): Promise<{ files: string[] }>;
  stat(p: string): Promise<{ mtime: number } | null>;
}

interface RawRegistry {
  ids?: Record<string, string>;
  pending?: Record<string, { id?: string }>;
  archived?: Record<string, { id?: string }>;
}

interface RawJournalEntry {
  type?: string;
  oldPath?: string;
  noteId?: string;
  snapshotDir?: string;
  steps?: Record<string, boolean>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractNoteIdFromSnapshotDir(dir: string): string | null {
  // `<...>/trash/<fecha>-<noteId>` → noteId (último segmento tras el
  // último guion del nombre de carpeta se asume inseparable; se usa
  // el identificador completo del nombre: `<fecha>-<id>`).
  const name = dir.slice(dir.lastIndexOf('/') + 1);
  const match = name.match(/-[a-z0-9]+$/);
  return match ? name.slice(0, name.length - match[0].length) : null;
}

/**
 * Auditoría determinista y sin escrituras. `existingPaths` debe ser
 * la lista de notas markdown actuales (la aporta el llamante; este
 * módulo no consulta el vault de notas para no depender de TFile).
 */
export async function runOrphanAudit(
  app: { vault: { adapter: AuditAdapter } },
  getRootPath: () => string | null,
  existingPaths: string[],
  now: number = Date.now()
): Promise<OrphanAuditReport> {
  const report: OrphanAuditReport = {
    activeIdentities: 0,
    pendingIds: [],
    archivedIds: [],
    journalNoteIds: [],
    identityOrphans: [],
    candidates: [],
    recentOrphans: [],
    ambiguous: [],
    unreadable: []
  };

  const rootRaw = getRootPath();
  const root = rootRaw && rootRaw.trim() ? rootRaw.replace(/^\/+|\/+$/g, '') : null;
  if (!root) return report;

  const adapter = app.vault.adapter;
  const base = `${root}/Folder Lab`;
  const existing = new Set(existingPaths);

  // --- ids.json crudo (sin persistir) ---
  const allIds = new Set<string>();
  try {
    if (await adapter.exists(`${base}/ids.json`)) {
      const parsed: unknown = JSON.parse(await adapter.read(`${base}/ids.json`));
      if (isPlainObject(parsed)) {
        const raw = parsed as RawRegistry;
        for (const [path, id] of Object.entries(raw.ids ?? {})) {
          allIds.add(id);
          if (existing.has(path)) {
            report.activeIdentities += 1;
          } else {
            report.identityOrphans.push(path);
          }
        }
        for (const entry of Object.values(raw.pending ?? {})) {
          if (entry?.id) {
            report.pendingIds.push(entry.id);
            allIds.add(entry.id);
          }
        }
        for (const entry of Object.values(raw.archived ?? {})) {
          if (entry?.id) {
            report.archivedIds.push(entry.id);
            allIds.add(entry.id);
          }
        }
      }
    }
  } catch (error) {
    report.unreadable.push(`${base}/ids.json`);
    console.error('[orphanAudit] ids.json ilegible (solo lectura):', error);
    return report; // sin autoridad de identidad no se clasifica con certeza
  }

  // --- lifecycle-journal.json crudo ---
  const journalIds = new Set<string>();
  try {
    const journalPath = `${base}/lifecycle-journal.json`;
    if (await adapter.exists(journalPath)) {
      const parsed: unknown = JSON.parse(await adapter.read(journalPath));
      if (Array.isArray(parsed)) {
        for (const raw of parsed as RawJournalEntry[]) {
          if (raw.noteId) journalIds.add(raw.noteId);
          if (raw.snapshotDir) {
            const fromDir = extractNoteIdFromSnapshotDir(raw.snapshotDir);
            if (fromDir) journalIds.add(fromDir);
          }
        }
      }
    }
  } catch (error) {
    // Journal ilegible: conservar todo (ambigüedad máxima).
    console.warn('[orphanAudit] journal ilegible; se conserva todo:', error);
    report.journalNoteIds = [...journalIds].sort();
    return report;
  }
  report.journalNoteIds = [...journalIds].sort();

  // --- Escaneo de las cuatro subcarpetas ---
  for (const subfolder of ORPHAN_SUBFOLDERS) {
    const dir = `${base}/${subfolder}`;
    let files: string[] = [];
    try {
      if (!(await adapter.exists(dir))) continue;
      files = (await adapter.list(dir)).files || [];
    } catch (error) {
      console.warn(`[orphanAudit] No se pudo listar ${dir}:`, error);
      continue;
    }

    for (const filePath of files.sort()) {
      if (!filePath.endsWith('.json')) continue;
      const name = filePath.slice(dir.length + 1, -'.json'.length);

      let envelopeNotePath: string | null = null;
      try {
        const parsed: unknown = JSON.parse(await adapter.read(filePath));
        if (isPlainObject(parsed) && typeof parsed.notePath === 'string') {
          envelopeNotePath = parsed.notePath;
        }
        // Forma mínima válida: parseo correcto.
      } catch {
        report.unreadable.push(filePath);
        continue;
      }

      // Referencias: identidad activa, pending, archived o journal.
      if (allIds.has(name) || journalIds.has(name)) {
        continue;
      }

      // notePath del sobre existe como nota → caso ambiguo.
      if (envelopeNotePath !== null && existing.has(envelopeNotePath)) {
        report.ambiguous.push({
          path: filePath,
          noteId: name,
          subfolder,
          reason:
            'el notePath del sobre corresponde a una nota existente',
          mtime: null
        });
        continue;
      }

      // Candidato real: gracia de 24 h sobre mtime.
      let mtime: number | null = null;
      try {
        const stat = await adapter.stat(filePath);
        mtime = stat ? stat.mtime : null;
      } catch {
        mtime = null;
      }
      const entry: OrphanCandidate = {
        path: filePath,
        noteId: name,
        subfolder,
        reason:
          'id ausente de ids.json (todos los buckets) y de journals',
        mtime
      };
      if (mtime === null || now - mtime < ORPHAN_GRACE_MS) {
        // Sin mtime fiable: tratar como reciente (conservar).
        report.recentOrphans.push(entry);
      } else {
        report.candidates.push(entry);
      }
    }
  }

  // Orden estable para salidas repetibles.
  report.pendingIds.sort();
  report.archivedIds.sort();
  report.identityOrphans.sort();
  report.candidates.sort((a, b) => a.path.localeCompare(b.path));
  report.recentOrphans.sort((a, b) => a.path.localeCompare(b.path));
  report.ambiguous.sort((a, b) => a.path.localeCompare(b.path));
  report.unreadable.sort();
  return report;
}
