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
}
