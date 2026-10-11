import type {
  WidgetDefinition,
  WidgetDefinitionsFile
} from './WidgetDefinition';


export interface WidgetValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}


export class DeclarativeRuntime {

  private readonly definitions:
    Record<string, WidgetDefinition>;


  constructor(
    data: WidgetDefinitionsFile
  ) {

    this.definitions =
      data.widgets ?? {};
  }


  // ============================================================
  // LOAD
  // ============================================================

  static fromData(
    data: unknown
  ): DeclarativeRuntime {

    if (
      !data ||
      typeof data !== 'object'
    ) {

      throw new Error(
        '[DeclarativeRuntime] La definición debe ser un objeto.'
      );
    }

    const source =
      data as Record<string, unknown>;

    const definitions:
      Record<string, WidgetDefinition> = {};

    DeclarativeRuntime.scanObject(
      source,
      definitions
    );
    return new DeclarativeRuntime({
      widgets: definitions
    });
  }


  private static scanObject(
    object: Record<string, unknown>,
    definitions: Record<string, WidgetDefinition>
  ): void {

    for (
      const key of Object.keys(object)
    ) {

      const value =
        object[key];

      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        continue;
      }

      const candidate =
        value as Record<string, unknown>;


      if (
        DeclarativeRuntime.isWidgetDefinition(
          candidate
        )
      ) {

        const definition =
          candidate as unknown as WidgetDefinition;

        definitions[definition.id] =
          definition;

        continue;
      }


      this.scanObject(
        candidate,
        definitions
      );
    }
  }


  private static isWidgetDefinition(
    object: Record<string, unknown>
  ): boolean {

    if (
      typeof object.id !== 'string' ||
      object.id.trim() === ''
    ) {
      return false;
    }


    if (
      !object.identity ||
      typeof object.identity !== 'object' ||
      Array.isArray(object.identity)
    ) {
      return false;
    }


    const identity =
      object.identity as Record<string, unknown>;


    if (
      typeof identity.label !== 'string' ||
      identity.label.trim() === ''
    ) {
      return false;
    }


    if (
      object.cardinality !== 'singleton' &&
      object.cardinality !== 'multiple'
    ) {
      return false;
    }


    return true;
  }


  // ============================================================
  // DEFINITIONS
  // ============================================================

  getDefinition(
    widgetId: string
  ): WidgetDefinition | undefined {

    return this.definitions[
      widgetId
    ];
  }


  getDefinitions():
    WidgetDefinition[] {

    return Object.keys(
      this.definitions
    ).map(
      key =>
        this.definitions[key]
    );
  }


  hasDefinition(
    widgetId: string
  ): boolean {

    return (
      widgetId in
      this.definitions
    );
  }


  // ============================================================
  // CAPABILITIES
  // ============================================================

  getCapabilities(
    widgetId: string
  ): string[] {

    const definition =
      this.getDefinition(
        widgetId
      );

    if (!definition) {
      return [];
    }


    const capabilities:
      string[] = [];


    if (definition.entity) {
      capabilities.push(
        'entity'
      );
    }


    if (definition.state) {
      capabilities.push(
        'state'
      );
    }


    if (definition.selection) {
      capabilities.push(
        'selection'
      );
    }


    if (definition.ordering) {
      capabilities.push(
        'ordering'
      );
    }


    if (
      definition.controls &&
      definition.controls.length > 0
    ) {

      capabilities.push(
        'controls'
      );
    }


    if (
      definition.itemActions &&
      definition.itemActions.length > 0
    ) {

      capabilities.push(
        'item-actions'
      );
    }


    if (definition.transfer) {
      capabilities.push(
        'transfer'
      );
    }


    if (
      definition.metrics &&
      Object.keys(
        definition.metrics
      ).length > 0
    ) {

      capabilities.push(
        'metrics'
      );
    }


    if (definition.storage) {
      capabilities.push(
        'storage'
      );
    }


    return capabilities;
  }


  // ============================================================
  // VALIDATION
  // ============================================================

  validate(
    widgetId: string
  ): WidgetValidationResult {

    const definition =
      this.getDefinition(
        widgetId
      );


    if (!definition) {

      return {
        valid: false,

        errors: [
          `[DeclarativeRuntime] No existe el widget "${widgetId}".`
        ],

        warnings: []
      };
    }


    return this.validateDefinition(
      definition
    );
  }


  private validateDefinition(
    definition: WidgetDefinition
  ): WidgetValidationResult {

    const errors:
      string[] = [];

    const warnings:
      string[] = [];

    const widgetId =
      definition.id;


    // --------------------------------------------------
    // identity
    // --------------------------------------------------

    if (
      !definition.identity.label.trim()
    ) {

      errors.push(
        `[${widgetId}] identity.label no puede estar vacío.`
      );
    }


    // --------------------------------------------------
    // cardinality
    // --------------------------------------------------

    if (
      definition.cardinality !== 'singleton' &&
      definition.cardinality !== 'multiple'
    ) {

      errors.push(
        `[${widgetId}] cardinality inválida.`
      );
    }


    // --------------------------------------------------
    // storage
    // --------------------------------------------------

    if (definition.storage) {

      const validScopes = [
        'note-instance',
        'note',
        'folder',
        'vault',
        'session'
      ];


      if (
        validScopes.indexOf(
          definition.storage.scope
        ) === -1
      ) {

        errors.push(
          `[${widgetId}] storage.scope inválido: ${definition.storage.scope}`
        );
      }
    }


    // --------------------------------------------------
    // state
    // --------------------------------------------------

    if (definition.state) {

      if (
        !definition.state.field.trim()
      ) {

        errors.push(
          `[${widgetId}] state.field no puede estar vacío.`
        );
      }
    }


    // --------------------------------------------------
    // selection
    // --------------------------------------------------

    if (definition.selection) {

      const mode =
        definition.selection.mode;


      if (
        mode !== 'none' &&
        mode !== 'single' &&
        mode !== 'multiple'
      ) {

        errors.push(
          `[${widgetId}] selection.mode inválido: ${mode}`
        );
      }


      if (
        mode !== 'none' &&
        !definition.selection.field
      ) {

        warnings.push(
          `[${widgetId}] selection.field no está definido.`
        );
      }
    }


    // --------------------------------------------------
    // ordering
    // --------------------------------------------------

    if (definition.ordering) {

      const direction =
        definition.ordering.primary?.direction;


      if (
        direction !== undefined &&
        direction !== 'ascending' &&
        direction !== 'descending'
      ) {

        errors.push(
          `[${widgetId}] ordering.direction inválido: ${direction}`
        );
      }


      if (
        definition.ordering.priority
      ) {

        if (
          !definition.ordering.priority.field.trim()
        ) {

          errors.push(
            `[${widgetId}] ordering.priority.field no puede estar vacío.`
          );
        }
      }
    }


    // --------------------------------------------------
    // controls
    // --------------------------------------------------

    if (definition.controls) {

      const validControlTypes = [
        'widget-selector',
        'source-selector',
        'select',
        'picker',
        'action',
        'icon-action',
        'status'
      ];


      definition.controls.forEach(
        (
          control,
          index
        ) => {

          if (
            validControlTypes.indexOf(
              control.type
            ) === -1
          ) {

            errors.push(
              `[${widgetId}] controls[${index}] tiene un type inválido: ${control.type}`
            );
          }


          if (
            (
              control.type === 'action' ||
              control.type === 'icon-action' ||
              control.type === 'status'
            ) &&
            !control.id
          ) {

            errors.push(
              `[${widgetId}] controls[${index}] requiere id.`
            );
          }


          if (
            control.type === 'status' &&
            !control.metric
          ) {

            warnings.push(
              `[${widgetId}] status "${control.id}" no declara metric.`
            );
          }

        }
      );
    }


    // --------------------------------------------------
    // item actions
    // --------------------------------------------------

    if (definition.itemActions) {

      definition.itemActions.forEach(
        (
          action,
          index
        ) => {

          if (
            !action.id.trim()
          ) {

            errors.push(
              `[${widgetId}] itemActions[${index}] requiere id.`
            );
          }


          if (
            !action.type.trim()
          ) {

            errors.push(
              `[${widgetId}] itemActions[${index}] requiere type.`
            );
          }

        }
      );
    }


    // --------------------------------------------------
    // transfer
    // --------------------------------------------------

    if (definition.transfer) {

      const validTransferTypes = [
        'text',
        'file'
      ];


      const inputs =
        definition.transfer.inputs ?? [];


      const outputs =
        definition.transfer.outputs ?? [];


      inputs.forEach(
        type => {

          if (
            validTransferTypes.indexOf(
              type
            ) === -1
          ) {

            errors.push(
              `[${widgetId}] transfer input inválido: ${type}`
            );
          }
        }
      );


      outputs.forEach(
        type => {

          if (
            validTransferTypes.indexOf(
              type
            ) === -1
          ) {

            errors.push(
              `[${widgetId}] transfer output inválido: ${type}`
            );
          }
        }
      );


      const board =
        definition.transfer.board;

      if (board) {

        if (
          board.participation !== undefined &&
          board.participation !== 'composition' &&
          board.participation !== 'context'
        ) {

          errors.push(
            `[${widgetId}] transfer.board.participation inválido: ${board.participation}`
          );
        }
      }
    }


    // --------------------------------------------------
    // metrics
    // --------------------------------------------------

    if (definition.metrics) {

      for (
        const id of Object.keys(
          definition.metrics
        )
      ) {

        const metric =
          definition.metrics[id];


        if (
          !metric ||
          typeof metric !== 'object'
        ) {

          errors.push(
            `[${widgetId}] metrics.${id}: definición inválida`
          );

          continue;
        }


        if (
          metric.type !== 'count'
        ) {

          errors.push(
            `[${widgetId}] metrics.${id}: type debe ser "count"`
          );
        }


        if (
          metric.field !== undefined &&
          typeof metric.field !== 'string'
        ) {

          errors.push(
            `[${widgetId}] metrics.${id}: field debe ser string`
          );
        }
      }
    }


    return {
      valid:
        errors.length === 0,

      errors,

      warnings
    };
  }


  // ============================================================
  // DEBUG
  // ============================================================

  debug(): void {


    for (
      const definition
      of this.getDefinitions()
    ) {

      const result =
        this.validateDefinition(
          definition
        );


          }
  }
}