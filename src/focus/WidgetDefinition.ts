import { FocusWidgetFactory } from './FocusWidget';

export type WidgetCardinality =
  'singleton' | 'multiple';

export type WidgetStorageScope =
  | 'note-instance'
  | 'note'
  | 'folder'
  | 'vault'
  | 'session';

export type WidgetSelectionMode =
  | 'none'
  | 'single'
  | 'multiple';

export type WidgetControlType =
  | 'widget-selector'
  | 'source-selector'
  | 'select'
  | 'picker'
  | 'action'
  | 'icon-action'
  | 'status';

export interface WidgetControlDefinition {
  type: WidgetControlType;
  id?: string;
  label?: string;
  icon?: string;
  metric?: string;
}



export interface WidgetActionDefinition {
  id: string;
  type: string;
}

export interface WidgetSemanticDefinition {

  contentType: string;

  role: string;

  properties?: string[];
}

/**
 * TypeIds del bloque FIJO del selector de widgets (Contexto de
 * nota): Apuntes, Asistente y Nota activa. No se agrupan en
 * Contexto/Tarjetas y conservan su mecanismo actual de
 * disponibilidad.
 */
export const NOTE_CONTEXT_FIXED_WIDGET_TYPE_IDS = [
  'notes',
  'memory',
  'active-note'
] as const;

/**
 * Subconjunto de los fijos que se CREAN POR DEFECTO en toda nota
 * (bootstrap de WidgetManager) y por tanto NO se muestran en la
 * biblioteca. Nota activa no está aquí: es agregable desde la
 * biblioteca y, una vez agregada, aparece en el bloque fijo.
 */
export const NOTE_CONTEXT_DEFAULT_WIDGET_TYPE_IDS = [
  'notes',
  'memory'
] as const;

export interface WidgetDefinition {

  id: string;

  identity: {
    label: string;
    icon?: string;
    color?: string;
    description?: string;
  };

  semantic?: WidgetSemanticDefinition;

  cardinality: WidgetCardinality;

  /**
   * Categoría estable del widget para la agrupación del selector
   * («Contexto» / «Tarjetas»). Metadato de la DEFINICIÓN: nunca
   * se deduce del nombre visible de la instancia.
   *
   * - 'context' → widgets de contexto de la nota (default si la
   *              propiedad ausente en definiciones heredadas).
   * - 'card'    → widgets cuyos elementos se materializan como
   *              tarjetas del Board mediante composición.
   */
  category?: 'context' | 'card';

  storage?: {
    scope: WidgetStorageScope;
  };

  entity?: {
    collection?: string;

    content?: {
      fields?: string[];
      renderer?: string;
      editable?: boolean;
      expandable?: boolean;
      previewLines?: number;
    };
  };

  state?: {
    field: string;
    initial?: unknown;
    toggleable?: boolean;

    activeWhen?: {
      value: unknown;
    };
  };

  selection?: {
    mode: WidgetSelectionMode;
    field?: string;
  };

  ordering?: {
    primary?: {
      field: string;
      direction:
      'ascending' |
      'descending';
    };

    priority?: {
      field: string;
      value: unknown;
    };
  };

  controls?: WidgetControlDefinition[];

  itemActions?: WidgetActionDefinition[];

  actions?: WidgetActionDefinition[];

  input?: {
    text?: {
      enabled: boolean;
      placeholder?: string;
    };
  };

  transfer?: {
    inputs?: string[];
    outputs?: string[];

    /**
     * Admite recibir bloques de texto enviados desde Apuntes
     * (Sesión → Enviar a → Instancias).
     *
     * Contrato EXPLÍCITO e independiente de `inputs` (que gobierna
     * las transferencias entre widgets por drag-and-drop):
     * - `true`  → el widget es elegible como destino de Apuntes y
     *             debe declarar `entity.content` para mostrar el
     *             texto recibido (validado en DeclarativeRuntime).
     * - ausente o `false` → NO admite envío directo desde Apuntes.
     *
     * La ausencia en definiciones antiguas es deliberada: el
     * envío es opt-in explícito.
     */
    fromNotes?: boolean;

    /**
     * Participación declarada en el Board.
     *
     * Ausente → 'composition' (comportamiento histórico: los
     * elementos pueden arrastrarse al Board como tarjetas).
     */
    board?: {
      /**
       * 'composition' → sus elementos se incorporan como tarjetas
       *                 mediante drag-and-drop.
       * 'context'     → aporta contexto al Board (indicadores);
       *                 sus elementos NO se arrastran.
       */
      participation?: 'composition' | 'context';
    };
  };

  metrics?: {
    [id: string]: {
      type: 'count';
      field?: string;
      value?: unknown;
    };
  };

  emptyState?: {
    message?: string;
  };
}


export interface WidgetDefinitionsRoot {

  widgets?: Record<
    string,
    WidgetDefinition
  >;

  [key: string]: unknown;
}


export interface WidgetDefinitionsFile {

  root?: WidgetDefinitionsRoot;

  widgets?: Record<
    string,
    WidgetDefinition
  >;

  [key: string]: unknown;
}


/**
 * Instancia concreta de un widget.
 */
export interface WidgetInstance {

  instanceId: string;

  typeId: string;

  name: string;
}


/**
 * Registro físico de una definición en Focus.
 *
 * Esto NO forma parte del JSON.
 * Es información del runtime.
 */
export interface WidgetRegistration {

  typeId: string;

  factory: FocusWidgetFactory;
}