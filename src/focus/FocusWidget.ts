// src/focus/FocusWidget.ts

import { FocusContext } from "./FocusContext";

/**
 * Interfaz que deben implementar todos los widgets del modo Focus.
 * Cada widget es una instancia independiente asociada a un panel.
 */
export interface FocusWidget {
  /** ID único del widget */
  readonly id: string;
  
  /** Nombre visible en el selector */
  readonly label: string;
  
  /** Icono para el selector (emoticono o nombre de icono) */
  readonly icon: string;
  
  /**
   * Renderiza el widget en el contenedor.
   * Se llama cuando el widget se monta por primera vez.
   */
  render(container: HTMLElement, context: FocusContext): void;
  
  /**
   * Actualiza el widget cuando cambia el contexto.
   * El widget debe conservar su estado interno y solo actualizar lo necesario.
   */
  update(context: FocusContext): void;
  
  /**
   * Limpia y destruye el widget.
   * Se llama cuando el panel cambia de widget o se cierra Focus.
   */
  destroy(): void;
  
  /**
   * Opcional: Carga datos persistentes del widget.
   * Se llama después de render() para restaurar el estado guardado.
   */
  load?(): Promise<void>;
  
  /**
   * Opcional: Guarda datos persistentes del widget.
   * Se llama antes de destroy() o periódicamente.
   */
  save?(): Promise<void>;
  
   // cada widget recibe su posición explícitamente
  setPosition?(position: 'top' | 'bottom'): void;
  
  // cada widget recibe callbacks para orquestación
  setCallbacks?(callbacks: WidgetCallbacks): void;
  
  /** Identidad de la instancia concreta del widget */
  setInstanceIdentity?(
    instanceId: string,
    instanceName: string
 ): void;
  
}


export interface WidgetCallbacks {
  onWidgetSelect?: () => void;
  onSourceSelect?: () => void;
}


/**
 * Fábrica de widgets.
 * Cada fábrica crea una nueva instancia del widget.
 * El registro solo almacena fábricas, nunca instancias.
 */
export interface FocusWidgetFactory {
  widgetId: string;
  create(instanceId?: string): FocusWidget;
}