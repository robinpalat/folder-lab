// src/focus/FocusContext.ts

import { TFile, App } from "obsidian";
import { FolderLabController } from "../core/FolderLabController";
import { FolderLabState } from "../core/FolderLabState";

/**
 * Contexto único del modo Focus.
 * Se mantiene una única instancia durante toda la sesión.
 */
export interface FocusContext {
  /** Instancia de la aplicación Obsidian */
  app: App;
  
  /** Archivo activo actual (se actualiza cuando cambia) */
  activeFile: TFile | null;
  
  /** Controlador de FolderLab */
  controller: FolderLabController;
  
  /** Estado de FolderLab */
  state: FolderLabState;
  
  /** ID único de la sesión Focus */
  sessionId: string;
}

/**
 * Crea una nueva instancia de FocusContext.
 * Solo debe llamarse una vez al iniciar el modo Focus.
 */
export function createFocusContext(
  app: App,
  activeFile: TFile | null,
  controller: FolderLabController,
  state: FolderLabState
): FocusContext {
  return {
    app,
    activeFile,
    controller,
    state,
    sessionId: `focus-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  };
}

/**
 * Actualiza el archivo activo en el contexto.
 * Se llama cada vez que cambia la nota activa.
 */
export function updateFocusContext(
  context: FocusContext,
  activeFile: TFile | null
): void {
  context.activeFile = activeFile;
}