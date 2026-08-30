import { App } from 'obsidian';
import { UserRequest, ExecutableContext } from '../types';
import { SnipsController } from '../../focus/controllers/SnipsController';
import { TasksController } from '../../focus/controllers/TasksController';
import { NotesController } from '../../focus/controllers/NotesController';

export interface WorkspaceContext {
  note: {
    path: string;
    name: string;
    content: string;
    metadata: Record<string, any>;
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

/**
 * Contexto genérico para el Executor.
 * Es un objeto plano que transporta datos sin estructura fija.
 */
export type GenericContext = Record<string, any>;

export class ContextResolver {
  private app: App;
  private plugin: any;
  private snipsController: SnipsController | null;
  private tasksController: TasksController | null;
  private notesController: NotesController;

  constructor(app: App, plugin: any, tasksController?: TasksController) {
    this.app = app;
    this.plugin = plugin;

    this.snipsController =
      plugin?.snipsController || null;
    this.tasksController =
      tasksController || null;
    this.notesController = new NotesController(plugin);
  }

  // ============================================================
  // MÉTODOS EXISTENTES (mantener)
  // ============================================================

  async resolveWorkspace(options: {
    notePath: string;
    noteName: string;
    noteContent: string;
    noteMetadata?: Record<string, any>;
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
    note: any;
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

  /**
   * Resuelve un contexto genérico para el Executor.
   *
   * Este método devuelve un objeto plano que puede ser extendido
   * por cualquier capacidad sin necesidad de modificar el resolver.
   */
  async resolveGeneric(params: {
    note: any;
    content: string;
    selection?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<GenericContext> {
    const context: GenericContext = {
      aiService: this.plugin.aiService,
      noteContent: params.content,
      noteName: params.note.basename,
      notePath: params.note.path,
      folderName: params.note.parent?.name || '',
      selection: params.selection,
      temperature:
        params.temperature ??
        this.plugin?.settings?.aiTemperature ??
        0.3,
      maxTokens:
        params.maxTokens ??
        this.plugin?.settings?.aiMaxTokens ??
        500
    };

    const rootPath = this.plugin?.settings?.bookRootPath;

    if (rootPath && params.note.path.startsWith(rootPath)) {
      context.bookName = rootPath.split('/').pop();
    }

    return context;
  }

  // ============================================================
  // resolve() - UserRequest → ExecutableContext
  // ============================================================

  /**
   * Transforma una solicitud del usuario en contexto ejecutable.
   *
   * Fuentes actuales:
   * - note  → nota activa de Obsidian
   * - notes → contenido del widget Apuntes
   * - snips → fragmentos del SnipsController
   * - tasks → reservado para la conexión con el proveedor real de Tareas
   */
  async resolve(request: UserRequest): Promise<ExecutableContext> {
    // 1. Obtener la nota activa.
    let noteContent = '';
    let noteName = '';
    let notePath = '';
    let noteMetadata: Record<string, any> = {};

    if (request.activeNotePath) {
      const file = this.app.vault.getFileByPath(request.activeNotePath);

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

for (const source of sources) {
  switch (source) {
    case 'note':
      // La nota ya está disponible en context.note.
      break;

    case 'snips':
      context.additional!.snips =
        await this.resolveSnips(notePath);
      break;

    case 'notes':
      context.additional!.notes =
        await this.resolveNotes(notePath);
      break;

    default:
      throw new Error(
        `[ContextResolver] Fuente no soportada: ${source}`
      );
  }
}

    return context;
  }

  // ============================================================
  // MÉTODOS AUXILIARES PARA FUENTES
  // ============================================================

  /**
   * Resuelve los Snips activos asociados a la nota.
   */
  private async resolveSnips(notePath: string): Promise<any[]> {

    return [];
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
