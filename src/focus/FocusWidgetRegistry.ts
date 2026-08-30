import {
  FocusWidget,
  FocusWidgetFactory
} from './FocusWidget';

import {
  WidgetDefinition,
  WidgetRegistration
} from './WidgetDefinition';

import {
  DeclarativeWidgetFactory
} from './DeclarativeWidget';


export class FocusWidgetRegistry {

  private definitions:
    Map<string, WidgetDefinition> =
      new Map();

  private registrations:
    Map<string, WidgetRegistration> =
      new Map();

  private defaultId: string = 'notes';


  constructor(
    private controller?: any,
    private app?: any
  ) {}


  // ============================================================
  // IMPERATIVE / LEGACY REGISTRATION
  // ============================================================

  register(
    factory: FocusWidgetFactory,
    definition: WidgetDefinition
  ): void {

    const widgetId =
      factory.widgetId;

    this.definitions.set(
      widgetId,
      definition
    );

    this.registrations.set(
      widgetId,
      {
        typeId: widgetId,
        factory
      }
    );
  }


  // ============================================================
  // DECLARATIVE REGISTRATION
  // ============================================================

  registerDeclarative(
    definition: WidgetDefinition
  ): void {

    const factory =
      new DeclarativeWidgetFactory(
        definition,
        this.controller,
        this.app
      );

    this.definitions.set(
      definition.id,
      definition
    );

    this.registrations.set(
      definition.id,
      {
        typeId: definition.id,
        factory
      }
    );
  }


  // ============================================================
  // INSTANCE CREATION
  // ============================================================

  getWidget(
    id: string,
    instanceId?: string
  ): FocusWidget | null {

    const registration =
      this.registrations.get(id);

    if (!registration) {

      console.warn(
        `Widget "${id}" no encontrado.`
      );

      return null;
    }

    return registration.factory.create(
      instanceId
    );
  }


  // ============================================================
  // DEFINITIONS
  // ============================================================

  getDefinition(
    typeId: string
  ): WidgetDefinition | undefined {

    return this.definitions.get(
      typeId
    );
  }


  getDefinitions():
    WidgetDefinition[] {

    return Array.from(
      this.definitions.values()
    );
  }


  getAvailableIds():
    string[] {

    return Array.from(
      this.definitions.keys()
    );
  }


  getAvailableWidgetsInfo():
    Array<{
      id: string;
      label: string;
      icon: string;
    }> {

    return Array.from(
      this.definitions.values()
    ).map(
      definition => ({
        id: definition.id,

        label:
          definition.identity.label,

        icon:
          definition.identity.icon ??
          'square'
      })
    );
  }


  // ============================================================
  // DEFAULT
  // ============================================================

  setDefault(
    id: string
  ): void {

    if (
      this.definitions.has(id)
    ) {

      this.defaultId = id;
    }
  }


  getDefaultId(): string {

    return this.defaultId;
  }


  // ============================================================
  // EXISTENCE
  // ============================================================

  has(
    id: string
  ): boolean {

    return this.definitions.has(id);
  }
}