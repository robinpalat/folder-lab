// src/storage/vaultLifecycleListeners.ts
//
// Listeners de ciclo de vida del vault (E2).
//
// Registrados en el PLUGIN (no en FolderLabView) para que la
// identidad y la migración de datos funcionen con la vista cerrada.
// `plugin.registerEvent` garantiza la limpieza al descargar.
//
// Responsabilidades ÚNICAS aquí: identidad (registry) y migración
// de datos por nota (NoteLifecycle). Las actualizaciones de orden y
// la refrescación de la UI siguen siendo responsabilidad de
// FolderLabView (consumidor, no duplicador).

import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import { INTERNAL_FOLDER } from '../constants/view-types';
import { isTechnicalDataPath } from '../utils/dataPath';
import type { NoteLifecycle } from './NoteLifecycle';
import type { NoteIdentityRegistry, PendingClaim } from './NoteIdentityRegistry';

function isInternalPath(path: string, masterRoot: string | null): boolean {
  return (
    path.includes(`/${INTERNAL_FOLDER}/`) ||
    isTechnicalDataPath(path, masterRoot)
  );
}

/**
 * Registra create/delete/rename del vault sobre el ciclo de vida.
 * Devuelve void: la limpieza la hace `plugin.registerEvent`.
 */
export function registerLifecycleListeners(
  plugin: Plugin,
  lifecycle: NoteLifecycle,
  registry: NoteIdentityRegistry,
  getMasterPath: () => string | null
): void {
  plugin.registerEvent(
    plugin.app.vault.on('rename', (file, oldPath) => {
      const master = getMasterPath();
      if (isInternalPath(file.path, master) || isInternalPath(oldPath, master)) {
        return;
      }

      if (file instanceof TFolder) {
        void lifecycle
          .onFolderRenamed(oldPath, file.path)
          .catch((error) => {
            console.error(
              '[FolderLab] Error migrando datos por renombrado de carpeta:',
              error
            );
          });
        return;
      }
      if (!(file instanceof TFile)) return;

      void lifecycle.onFileRenamed(oldPath, file.path).catch((error) => {
        console.error(
          '[FolderLab] Error migrando datos por renombrado:',
          error
        );
      });
    })
  );

  plugin.registerEvent(
    plugin.app.vault.on('delete', (file) => {
      if (!(file instanceof TFile)) return;
      if (isInternalPath(file.path, getMasterPath())) return;

      // E2: el id pasa a `pending`; los datos se conservan.
      void lifecycle.onNoteDeleted(file.path).catch((error) => {
        console.error('[FolderLab] Error registrando borrado:', error);
      });
    })
  );

  plugin.registerEvent(
    plugin.app.vault.on('create', (file) => {
      if (!(file instanceof TFile)) return;
      if (isInternalPath(file.path, getMasterPath())) return;

      // E2: sin auto-reclamo; la nota nueva recibe id nuevo.
      void lifecycle.onNoteCreated(file.path).catch((error) => {
        console.error('[FolderLab] Error procesando creación:', error);
      });

      // Aviso de datos pendientes (acción vía comando).
      void registry
        .getPendingFor(file.path)
        .then((candidates: PendingClaim[]) => {
          if (candidates.length > 0) {
            new Notice(
              `Folder Lab: hay datos de una nota anterior en esta ruta. ` +
                `Ejecuta el comando «Folder Lab: reclamar datos de nota…» ` +
                `para recuperarlos.`,
              12000
            );
          }
        })
        .catch((error) => {
          console.error(
            '[FolderLab] Error consultando datos pendientes:',
            error
          );
        });
    })
  );
}
