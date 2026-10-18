import { App, TFile } from 'obsidian';
import { UserRequest, ExecutableContext } from '../types';
import { WidgetController, type WidgetRecord } from '../../focus/controllers/WidgetController';
import { WidgetManager } from '../../focus/WidgetManager';
import { NotesController } from '../../focus/controllers/NotesController';
import type { WidgetSemanticDefinition } from '../../focus/WidgetDefinition';
/*
 * 3B: se usa el tipo del plugin del proyecto (type-only, sin
 * import en runtime) porque NotesController exige `Plugin` en su
 * constructor y una interfaz local mínima no satisfaría ese
 * contrato sin modificar consumidores. Los miembros usados aquí
 * son `settings` (FolderOrderSettings) y `aiService` (AIService
 * | null en el plugin; el flujo actual ya lo transportaba sin
 * comprobar nulidad).
 */
import type FolderLabPlugin from '../../main';

/**
 * Fuente de widget resuelta para el contexto ejecutable (3A).
 *
 * Es la forma que produce `ContextResolver.resolveWidgetSource` y
 * la que consumen `PromptBuilder` y las capacidades: un envoltorio
 * por instancia de widget con sus ítems persistidos. Los ítems
 * son registros heterogéneos (el widget dueña de su forma); las
 * fuentes de texto leen `text` con tolerancia.
 */
export interface ResolvedWidgetSource {
  instanceId: string;
  name: string;
  semantic?: WidgetSemanticDefinition;
  items: WidgetRecord[];
}


export interface WorkspaceContext {
  note: {
    path: string;
    name: string;
    content: string;
    metadata: Record<string, unknown>;
  };
  folder: {
    path: string;
    name: string;
  };
  book?: {
    path: string;
    name: string;
  };
  selection?: string;
}

export interface SessionContext {
  sessionId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  maxHistory: number;
}

export interface ExecutionContext {
  temperature: number;
  maxTokens: number;
}

export interface UserContext {
  preferences: {
    language: string;
    tone: "formal" | "neutral" | "casual";
    detailLevel: "concise" | "balanced" | "detailed";
  };
}

export interface AIContext {
  workspace: WorkspaceContext;
  session: SessionContext;
  execution: ExecutionContext;
  user: UserContext;
}

export class ContextResolver {
  private app: App;
  private plugin: FolderLabPlugin;
  private widgetManager: WidgetManager;
  private widgetController: WidgetController;
  private notesController: NotesController;

  constructor(
    app: App,
    plugin: FolderLabPlugin,
    widgetController: WidgetController,
    widgetManager: WidgetManager
  ) {
    this.app = app;
    this.plugin = plugin;
    this.widgetController = widgetController;
    this.widgetManager = widgetManager;
    this.notesController = new NotesController(plugin);
  }

  // ============================================================
  // MÉTODOS EXISTENTES (mantener)
  // ============================================================

  async resolveWorkspace(options: {
    notePath: string;
    noteName: string;
    noteContent: string;
    noteMetadata?: Record<string, unknown>;
    folderPath: string;
    folderName: string;
    resolveBook?: boolean;
    selection?: string;
  }): Promise<WorkspaceContext> {
    const workspace: WorkspaceContext = {
      note: {
        path: options.notePath,
        name: options.noteName,
        content: options.noteContent,
        metadata: options.noteMetadata || {}
      },
      folder: {
        path: options.folderPath,
        name: options.folderName
      },
      book: undefined,
      selection: options.selection
    };

    if (options.resolveBook !== false) {
      workspace.book = await this.resolveBook(options.folderPath);
    }

    return workspace;
  }

  private async resolveBook(
    folderPath: string
  ): Promise<{ path: string; name: string } | undefined> {
    const rootPath = this.plugin?.settings?.bookRootPath;

    if (rootPath && folderPath.startsWith(rootPath)) {
      return {
        path: rootPath,
        name: rootPath.split('/').pop() || 'Libro'
      };
    }

    return undefined;
  }

  resolveSession(sessionId?: string): SessionContext {
    return {
      sessionId: sessionId || `session-${Date.now()}`,
      history: [],
      maxHistory: 20
    };
  }

  resolveExecution(settings: {
    temperature: number;
    maxTokens: number;
  }): ExecutionContext {
    return {
      temperature: settings.temperature,
      maxTokens: settings.maxTokens
    };
  }

  resolveUser(): UserContext {
    return {
      preferences: {
        language: 'es',
        tone: 'neutral',
        detailLevel: 'balanced'
      }
    };
  }

  async resolveAll(options: {
    note: TFile;
    content: string;
    selection?: string;
    settings: { temperature: number; maxTokens: number };
    resolveBook?: boolean;
  }): Promise<AIContext> {
    const workspace = await this.resolveWorkspace({
      notePath: options.note.path,
      noteName: options.note.basename,
      noteContent: options.content,
      folderPath: options.note.parent?.path || '',
      folderName: options.note.parent?.name || '',
      resolveBook: options.resolveBook,
      selection: options.selection
    });

    const session = this.resolveSession();
    const execution = this.resolveExecution(options.settings);
    const user = this.resolveUser();

    return { workspace, session, execution, user };
  }

  // ============================================================
  // resolve() - UserRequest → ExecutableContext
  // ============================================================

  async resolve(request: UserRequest): Promise<ExecutableContext> {
    // 1. Obtener la nota activa.
    let noteContent = '';
    let noteName = '';
    let notePath = '';
    let noteMetadata: Record<string, unknown> = {};

    if (request.activeNotePath) {
      const abstractFile = this.app.vault.getAbstractFileByPath(request.activeNotePath);
      const file = abstractFile instanceof TFile ? abstractFile : null;

      if (file) {
        noteContent = await this.app.vault.read(file);
        noteName = file.basename;
        notePath = file.path;

        noteMetadata = {
          extension: file.extension,
          size: file.stat?.size,
          modified: file.stat?.mtime
        };
      }
    }

    // 2. Resolver la carpeta.
    const folderPath =
      request.activeNotePath?.split('/').slice(0, -1).join('/') || '';

    const folderName =
      folderPath.split('/').pop() || '';

    // 3. Resolver el libro.
    let book: { path: string; name: string } | undefined;
    const rootPath = this.plugin?.settings?.bookRootPath;

    if (rootPath && request.activeNotePath?.startsWith(rootPath)) {
      book = {
        path: rootPath,
        name: rootPath.split('/').pop() || 'Libro'
      };
    }

    // 4. Construir el contexto ejecutable base.
    const context: ExecutableContext = {
      note: {
        path: notePath,
        name: noteName,
        content: noteContent,
        metadata: noteMetadata
      },

      folder: {
        path: folderPath,
        name: folderName
      },

      book,
      selection: request.selection,
      instructions: request.instructions,
      contextType: request.contextType,

      session: {
        id: `session-${Date.now()}`,
        history: []
      },

      execution: {
        temperature:
          request.temperature ??
          this.plugin?.settings?.aiTemperature ??
          0.3,

        maxTokens:
          request.maxTokens ??
          this.plugin?.settings?.aiMaxTokens ??
          500
      },

      additional: {}
    };

    // 5. Resolver la fuente seleccionada.
    //
    // La nota activa se carga arriba como contexto de workspace, pero
    // NO funciona como fallback de una fuente explícitamente seleccionada.
    // 5. Resolver las fuentes seleccionadas por la capacidad.
    //
    // `request.sources` es ahora la fuente de verdad.
    // `contextType` se conserva únicamente por compatibilidad
    // con capacidades antiguas.

    const sources = request.sources?.length
      ? request.sources
      : [request.contextType];

    const semanticSources: Array<{
      sourceId: string;
      contentType: string;
      role: string;
      properties?: string[];
    }> = [];

    for (const source of sources) {
      switch (source) {
        case 'note':
          // La nota ya está disponible en context.note.
          break;

        case 'snips': {
          context.additional!.snips =
            await this.resolveWidgetSource(
              'snips',
              notePath
            );

          const snipsDefinition =
            this.widgetManager.getDefinition('snips');

          if (snipsDefinition?.semantic) {
            semanticSources.push({
              sourceId: 'snips',
              contentType:
                snipsDefinition.semantic.contentType,
              role:
                snipsDefinition.semantic.role,
              properties:
                snipsDefinition.semantic.properties
            });
          }

          break;


        }
        case 'tasks': {

          context.additional!.tasks =
            await this.resolveWidgetSource(
              'tasks',
              notePath
            );

          const tasksDefinition =
            this.widgetManager.getDefinition('tasks');

          if (tasksDefinition?.semantic) {

            semanticSources.push({
              sourceId: 'tasks',
              contentType:
                tasksDefinition.semantic.contentType,
              role:
                tasksDefinition.semantic.role,
              properties:
                tasksDefinition.semantic.properties
            });
          }

          break;

        }
        case 'notes':
          context.additional!.notes =
            await this.resolveNotes(notePath);
          break;

        default:
          throw new Error(
            `[ContextResolver] Fuente no soportada: ${String(source)}`
          );
      }
    }

    context.additional!.semanticSources =
      semanticSources;

    // 6. Instancias de widgets seleccionadas (selector de contexto).
    //
    // Cuando el Asistente opera en modo «Widgets», el contexto se
    // construye EXCLUSIVAMENTE a partir de las instancias elegidas
    // en el segundo menú (por instancia individual, no por tipo).
    // Se añaden a `additional.widgetInstances` respetando las reglas
    // de contenido activo de cada widget (storage.get devuelve los
    // items persistidos; el filtrado aguas abajo es responsabilidad
    // de cada consumidor).
    //
    // `additional.contextMode` propaga el modo elegido para que
    // PromptBuilder sepa que NO debe caer al contexto heredado
    // aunque widgetInstances esté vacío (sin instancias o sin
    // contenido elegible tras el filtrado).
    if (request.inputSource === 'widget') {
      context.additional!.contextMode = 'widget';
    }

    if (
      request.widgetInstanceIds &&
      request.widgetInstanceIds.length > 0
    ) {
      context.additional!.widgetInstances =
        await this.resolveWidgetInstances(
          request.widgetInstanceIds,
          notePath
        );
    }

    return context;
  }

  // ============================================================
  // MÉTODOS AUXILIARES PARA FUENTES
  // ============================================================

  /**
   * Resuelve los Snips activos asociados a la nota.
   */
  private async resolveWidgetSource(
    widgetId: string,
    notePath: string
  ): Promise<ResolvedWidgetSource[]> {

    if (!notePath) {
      return [];
    }

    const instances =
      this.widgetManager
        .getInstances()
        .filter(
          instance =>
            instance.typeId === widgetId
        );

    const definition =
      this.widgetManager.getDefinition(
        widgetId
      );

    const resolved: ResolvedWidgetSource[] = [];

    for (const instance of instances) {

      const data =
        await this.widgetController.storage.get(
          widgetId,
          notePath,
          instance.instanceId
        );

      // Resultado de almacenamiento externo: validar la forma antes
      // de tiparlo (solo se requiere que items sea un array; el
      // contenido por ítem se filtra aguas abajo en PromptBuilder).
      const rawItems: unknown = data?.items;
      const items: WidgetRecord[] = Array.isArray(rawItems)
        ? (rawItems as WidgetRecord[])
        : [];

      resolved.push({
        instanceId: instance.instanceId,
        name: instance.name,
        semantic: definition?.semantic,
        items
      });
    }

    return resolved;
  }


  /**
   * Resuelve el contenido del widget Apuntes.
   *
   * Mantiene exactamente la estrategia de persistencia que utiliza
   * NotesWidget:
   *
   * 1. localStorage con la clave focus-notes-<notePath>
   * 2. fallback al archivo <nota>.notes.md del Vault
   */
  private async resolveNotes(notePath: string): Promise<string> {
    return this.notesController.getActiveSource(notePath);
  }

  /**
   * Resuelve instancias de widgets SELECCIONADAS individualmente
   * (segundo menú del selector de contexto).
   *
   * Filtra cada instancia según su modelo de activación real:
   * - `definition.state.field` es el campo que indica si un bloque
   *   está activo (`active` para snips/collections/restrictions/
   *   issues; `completed` para tasks).
   * - `state.activeWhen` (si existe) define el valor exacto que
   *   cuenta como activo; sin él se usa truthiness (convención
   *   `initial: true`).
   * - Widgets SIN `state` no tienen criterio claro de activación:
   *   se excluyen (nunca se envían todos sus datos indiscriminadamente).
   *
   * Notes (typeId 'notes') tiene tratamiento especial: se incluye
   * el texto actual del editor (draft) y solo los bloques guardados
   * con `active: true` (DraftStore).
   *
   * El resultado es el ÚNICO punto de filtrado: PromptBuilder
   * consume el contenido ya elegible sin volver a filtrar.
   */
  async resolveWidgetInstances(
    instanceIds: string[],
    notePath: string
  ): Promise<ResolvedWidgetSource[]> {
    if (!notePath || instanceIds.length === 0) {
      return [];
    }

    const allInstances = this.widgetManager.getInstances();
    const resolved: ResolvedWidgetSource[] = [];

    for (const instanceId of instanceIds) {
      const instance = allInstances.find(
        (i) => i.instanceId === instanceId
      );
      if (!instance) continue;

      const definition = this.widgetManager.getDefinition(
        instance.typeId
      );

      // Notes: texto del editor + bloques activos de DraftStore.
      if (instance.typeId === 'notes') {
        const noteItems = await this.resolveNotesInstance(
          instance.instanceId,
          notePath
        );
        if (noteItems.length > 0) {
          resolved.push({
            instanceId: instance.instanceId,
            name: instance.name,
            semantic: definition?.semantic,
            items: noteItems
          });
        }
        continue;
      }

      // Otros widgets: filtrar por state.field de la definición.
      const stateField = definition?.state?.field;
      if (!stateField || !definition?.state) {
        // Sin criterio claro de activación → no incluir.
        continue;
      }

      const data = await this.widgetController.storage.get(
        instance.typeId,
        notePath,
        instance.instanceId
      );

      const rawItems: unknown = data?.items;
      const allItems: WidgetRecord[] = Array.isArray(rawItems)
        ? (rawItems as WidgetRecord[])
        : [];

      const activeWhen = definition.state.activeWhen?.value;
      const items = allItems.filter((item) => {
        const value: unknown = item[stateField];
        if (activeWhen !== undefined) {
          return value === activeWhen;
        }
        return !!value;
      });

      // Solo incluir la instancia si aporta contenido elegible.
      if (items.length > 0) {
        resolved.push({
          instanceId: instance.instanceId,
          name: instance.name,
          semantic: definition?.semantic,
          items
        });
      }
    }

    return resolved;
  }

  /**
   * Resuelve el contenido elegible de una instancia Notes:
   * el texto actual del editor (draft) y solo los bloques
   * guardados con `active: true`.
   *
   * Se devuelve como items con `text` para que PromptBuilder
   * use el mismo formato que el resto de instancias.
   */
  private async resolveNotesInstance(
    instanceId: string,
    notePath: string
  ): Promise<WidgetRecord[]> {
    const items: WidgetRecord[] = [];

    // 1. Texto actual del editor (draft).
    const draft = await this.notesController.getActiveSource(notePath);
    if (draft && draft.trim()) {
      items.push({ text: draft.trim(), __source: 'editor' });
    }

    // 2. Bloques guardados con active: true (DraftStore).
    const plugin = this.plugin;
    const draftStore = plugin?.draftStore;
    if (draftStore) {
      try {
        const file = await draftStore.read(notePath);
        if (file && Array.isArray(file.blocks)) {
          for (const block of file.blocks) {
            if (
              block &&
              typeof block === 'object' &&
              typeof (block as { text?: unknown }).text === 'string' &&
              (block as { active?: unknown }).active === true
            ) {
              const text = (block as { text: string }).text.trim();
              if (text) {
                items.push({ text, __source: 'block' });
              }
            }
          }
        }
      } catch {
        // DraftStore ilegible: se omite (el draft ya se incluyó).
      }
    }

    return items;
  }
}
