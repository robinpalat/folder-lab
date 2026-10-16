// src/focus/FocusContext.ts

import { TFile, App } from "obsidian";
import { FolderLabController } from "../core/FolderLabController";
import { FolderLabState } from "../core/FolderLabState";
import type { WidgetManager } from "./WidgetManager";
import type { WidgetController } from "./controllers/WidgetController";

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

  /**
   * Gestor de instancias del modo Contexto (por nota).
   * Permite a los widgets enumerar instancias reales, p. ej.
   * como destinos de captura de Apuntes.
   */
  widgetManager?: WidgetManager;

  /**
   * Controlador de persistencia de widgets (data.json).
   * Permite a los widgets enviar bloques a otras instancias
   * usando el mecanismo existente de cada widget destino.
   */
  widgetController?: WidgetController;
}

/**
 * Crea una nueva instancia de FocusContext.
 * Solo debe llamarse una vez al iniciar el modo Focus.
 */
export function createFocusContext(
  app: App,
  activeFile: TFile | null,
  controller: FolderLabController,
  state: FolderLabState,
  widgetManager?: WidgetManager,
  widgetController?: WidgetController
): FocusContext {
  return {
    app,
    activeFile,
    controller,
    state,
    sessionId: `focus-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    widgetManager,
    widgetController
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