// src/utils/vault-storage.ts
//
// Aislamiento de localStorage por bóveda (Fase 8D).
//
// Motivo: las claves `focus-*-<notePath>` no identificaban la bóveda
// y, como el localStorage de Obsidian es por origen (compartido por
// todas las bóvedas de la instalación), dos bóvedas con notas en la
// misma ruta relativa leían/sobrescribían los mismos datos.
//
// Migración: NO se implementa copia automática de las claves antiguas
// (`focus-notes-draft-<path>` y familia). La pertenencia de esos datos
// es ambigua (cualquier bóveda con esa ruta podría ser la autora) y
// atribuirlos arbitrariamente es peor que conservarlos intactos. Las
// claves antiguas permanecen en localStorage sin tocarse; una futura
// fase podría ofrecer recuperación manual/asesorada.

import { App, FileSystemAdapter } from 'obsidian';

/**
 * Identificador estable de bóveda para claves de almacenamiento.
 *
 * - Desktop (`FileSystemAdapter`): hash de `getBasePath()`, único por
 *   bóveda en la máquina aunque dos bóvedas compartan nombre. Varias
 *   ventanas de la misma bóveda comparten el mismo identificador.
 * - Móvil (u otros adaptadores): hash de `getName()`. Residuo
 *   documentado: dos bóvedas móviles con el mismo nombre colisionan
 *   (arista improbable; en móvil se abre una bóveda a la vez aunque
 *   el localStorage persista al cambiar).
 */
export function resolveVaultStorageId(app: App): string {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    return hashVaultId(adapter.getBasePath());
  }
  return hashVaultId(app.vault.getName());
}

/**
 * djb2 → base36. Determinista entre sesiones; no expone la ruta
 * completa de la bóveda en la clave.
 */
export function hashVaultId(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Construye una clave de localStorage aislada por bóveda.
 * Formato: `<familia>-<vaultId>-<notePath>`.
 */
export function vaultStorageKey(
  vaultId: string,
  family: string,
  notePath: string
): string {
  return `${family}-${vaultId}-${notePath}`;
}
