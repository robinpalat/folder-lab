// src/storage/quarantine.ts
//
// Cuarentena reversible de huérfanos (E4b). SIN activación automática
// en el arranque y SIN purga: el movimiento solo ocurre cuando un
// componente futuro (o un comando) llame explícitamente.
//
// Elegibilidad (defensa en profundidad): solo JSON de las
// subcarpetas boards|context|drafts|polish bajo `<Master>/Folder
// Lab/`. Jamás .md, _resources/, exports/ ni la propia cuarentena.
//
// Flujo de cuarentena: copia → verificación (relectura + parseo +
// hash de detección) → manifiesto → retiro del original. Cualquier
// error conserva el original. Idempotente: reintentar no duplica.
//
// Restauración: verifica el destino; si existe y su contenido
// cambió respecto al hash registrado en la cuarentena, se RECHAZA
// (no se sobrescribe nada). Idempotente.
//
// Hash: FNV-1a sobre el texto (detección de cambios, no criptográfico).

import { App } from 'obsidian';
import type { OrphanCandidate } from './orphanAudit';
import { joinVaultRoot } from '../utils/rootPath';

export const QUARANTINE_ELIGIBLE_SUBFOLDERS = [
  'boards',
  'context',
  'drafts',
  'polish'
] as const;

export interface QuarantineManifestEntry {
  /** Id estable de la entrada de manifiesto. */
  entryId: string;
  /** Ruta original del archivo (relativa al vault). */
  originPath: string;
  /** Ruta en cuarentena (relativa al vault). */
  quarantinePath: string;
  /** Identidad relacionada, si existía en el sobre. */
  noteId: string;
  subfolder: string;
  reason: string;
  size: number;
  /** FNV-1a del contenido ORIGINAL en el momento de la cuarentena. */
  contentHash: string;
  quarantinedAt: number;
  /** Presente cuando se restauró con éxito. */
  restoredAt?: number;
}

export interface QuarantineManifest {
  version: 1;
  entries: QuarantineManifestEntry[];
}

export type QuarantineResult =
  | { status: 'quarantined'; entry: QuarantineManifestEntry }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

export type RestoreResult =
  | { status: 'restored'; entry: QuarantineManifestEntry }
  | { status: 'not-found'; entryId: string }
  | { status: 'destination-changed'; entry: QuarantineManifestEntry }
  | { status: 'failed'; error: string };

/** FNV-1a 32-bit (detección de cambios; no es un hash criptográfico). */
export function contentHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class QuarantineManager {
  constructor(
    private app: App,
    private getRootPath: () => string | null
  ) {}

  private root(): string | null {
    const r = this.getRootPath();
    if (r === null || r === undefined) return null;
    return r.replace(/^\/+|\/+$/g, "");
  }

  private manifestPath(): string | null {
    const root = this.root();
    if (root === null) return null;
    return joinVaultRoot(root, 'Folder Lab', 'quarantine', 'manifest.json');
  }

  /** Elegibilidad estricta: solo JSON de las cuatro subcarpetas. */
  static isEligible(candidate: OrphanCandidate): boolean {
    if (!candidate.path.endsWith('.json')) return false;
    return (
      QUARANTINE_ELIGIBLE_SUBFOLDERS as readonly string[]
    ).includes(candidate.subfolder);
  }

  async readManifest(): Promise<QuarantineManifest> {
    const path = this.manifestPath();
    const adapter = this.app.vault.adapter;
    if (path === null || !(await adapter.exists(path))) {
      return { version: 1, entries: [] };
    }
    const raw = await adapter.read(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`[Quarantine] manifiesto ilegible en "${path}"`);
    }
    if (
      !isPlainObject(parsed) ||
      !Array.isArray((parsed as unknown as QuarantineManifest).entries)
    ) {
      throw new Error(`[Quarantine] manifiesto con forma inválida en "${path}"`);
    }
    return parsed as unknown as QuarantineManifest;
  }

  private async writeManifest(manifest: QuarantineManifest): Promise<void> {
    const path = this.manifestPath();
    const adapter = this.app.vault.adapter;
    if (path === null) return;
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (!(await adapter.exists(dir))) {
      await adapter.mkdir(dir);
    }
    await adapter.write(path, JSON.stringify(manifest, null, 2));
  }

  /**
   * Cuarentena de un candidato (movimiento copia-verifica-retira).
   * Idempotente: una entrada ya registrada con destino completo se
   * omite; una copia suelta (reintento) se re-verifica y registra.
   */
  async quarantine(candidate: OrphanCandidate): Promise<QuarantineResult> {
    const root = this.root();
    if (root === null) {
      return { status: 'failed', error: 'sin Master configurado' };
    }
    if (!QuarantineManager.isEligible(candidate)) {
      return {
        status: 'skipped',
        reason: 'no elegible (solo JSON de boards/context/drafts/polish)'
      };
    }
    const adapter = this.app.vault.adapter;
    const origin = candidate.path;
    if (!(await adapter.exists(origin))) {
      return { status: 'skipped', reason: 'el original ya no existe' };
    }

    let manifest: QuarantineManifest;
    try {
      manifest = await this.readManifest();
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }

    // Rutas coherentes con el origen del candidato (que ya incluye
    // la raíz: '<root>/Folder Lab/<sub>/…' o 'Folder Lab/<sub>/…'
    // en la raíz del vault).
    const marker = '/Folder Lab/';
    const markerIdx = origin.indexOf(marker);
    if (markerIdx === -1) {
      return { status: 'skipped', reason: 'ruta fuera de Folder Lab/' };
    }
    const prefix = origin.slice(0, markerIdx);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const quarantineRel = `${prefix}/Folder Lab/quarantine/${stamp}/${candidate.subfolder}/${candidate.noteId}.json`;

    // Idempotencia: entrada previa completa → omitir.
    const existing = manifest.entries.find(
      (e) => e.originPath === origin && !e.restoredAt
    );
    if (existing && (await adapter.exists(existing.quarantinePath))) {
      return { status: 'skipped', reason: 'ya en cuarentena' };
    }

    // Copia + verificación.
    let raw: string;
    try {
      raw = await adapter.read(origin);
      JSON.parse(raw); // verificación de forma
    } catch (error) {
      return {
        status: 'failed',
        error: `lectura/verificación del original: ${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }
    const qDir = quarantineRel.slice(0, quarantineRel.lastIndexOf('/'));
    try {
      if (!(await adapter.exists(qDir))) {
        const parts = qDir.split('/').filter(Boolean);
        let cur = '';
        for (const part of parts) {
          cur = cur ? `${cur}/${part}` : part;
          if (!(await adapter.exists(cur))) await adapter.mkdir(cur);
        }
      }
      await adapter.write(quarantineRel, raw);
      const check = await adapter.read(quarantineRel);
      if (check !== raw) {
        throw new Error('la relectura no coincide con el original');
      }
      JSON.parse(check);
    } catch (error) {
      return {
        status: 'failed',
        error: `copia/verificación: ${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }

    const entry: QuarantineManifestEntry = {
      entryId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      originPath: origin,
      quarantinePath: quarantineRel,
      noteId: candidate.noteId,
      subfolder: candidate.subfolder,
      reason: candidate.reason,
      size: raw.length,
      contentHash: contentHash(raw),
      quarantinedAt: Date.now()
    };
    manifest.entries.push(entry);
    try {
      await this.writeManifest(manifest);
    } catch (error) {
      // Manifiesto fallido: retirar la copia para no dejar estado ambiguo.
      try {
        await adapter.remove(quarantineRel);
      } catch {
        /* se conserva la copia como evidencia */
      }
      return {
        status: 'failed',
        error: `manifiesto: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    // Solo con manifiesto escrito se retira el original.
    try {
      await adapter.remove(origin);
    } catch (error) {
      return {
        status: 'failed',
        error: `retiro del original: ${
          error instanceof Error ? error.message : String(error)
        } (copiado en cuarentena; original intacto)`
      };
    }

    return { status: 'quarantined', entry };
  }

  /**
   * Restauración explícita. Comprueba el destino: si existe y su
   * contenido difiere del hash registrado, se RECHAZA sin tocar nada.
   */
  async restore(
    entryId: string
  ): Promise<RestoreResult> {
    const adapter = this.app.vault.adapter;
    let manifest: QuarantineManifest;
    try {
      manifest = await this.readManifest();
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }
    const entry = manifest.entries.find((e) => e.entryId === entryId);
    if (!entry) {
      return { status: 'not-found', entryId };
    }
    if (!(await adapter.exists(entry.quarantinePath))) {
      return {
        status: 'failed',
        error: 'el archivo en cuarentena ya no existe'
      };
    }

    let raw: string;
    try {
      raw = await adapter.read(entry.quarantinePath);
      JSON.parse(raw);
    } catch (error) {
      return {
        status: 'failed',
        error: `cuarentena ilegible: ${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }
    if (contentHash(raw) !== entry.contentHash) {
      return {
        status: 'failed',
        error: 'el contenido en cuarentena no coincide con el manifiesto'
      };
    }

    // Destino: si existe, solo se sobrescribe si no cambió.
    if (await adapter.exists(entry.originPath)) {
      let current: string;
      try {
        current = await adapter.read(entry.originPath);
      } catch (error) {
        return {
          status: 'failed',
          error: `destino ilegible: ${
            error instanceof Error ? error.message : String(error)
          }`
        };
      }
      if (contentHash(current) !== entry.contentHash) {
        return { status: 'destination-changed', entry };
      }
    }

    try {
      await adapter.write(entry.originPath, raw);
      const check = await adapter.read(entry.originPath);
      if (check !== raw) {
        throw new Error('la relectura del destino no coincide');
      }
    } catch (error) {
      return {
        status: 'failed',
        error: `restauración: ${
          error instanceof Error ? error.message : String(error)
        }`
      };
    }

    entry.restoredAt = Date.now();
    try {
      await this.writeManifest(manifest);
    } catch (error) {
      // El archivo ya está restaurado; el manifiesto se re intenta
      // en la próxima operación (entrada sigue no restaurada → se
      // puede reintentar de forma idempotente).
      return {
        status: 'failed',
        error: `manifiesto tras restaurar: ${
          error instanceof Error ? error.message : String(error)
        } (archivo ya restaurado)`
      };
    }
    return { status: 'restored', entry };
  }
}
