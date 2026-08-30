export interface AISettings {
  provider: "openai" | "gemini" | "anthropic";
  apiKey: string;
  model: string;
  useRecommendedModel: boolean;
  temperature: number;
  maxTokens: number;
}

export interface AIRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIResponse {
  content: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// Re-exportar tipos de contexto (existentes)
export type { 
  WorkspaceContext, 
  SessionContext, 
  ExecutionContext, 
  UserContext, 
  AIContext 
} from '../context/ContextResolver';

// ============================================================
// TIPOS EXISTENTES PARA CAPACIDADES (mantener)
// ============================================================

export interface UserRequest {
  toolId: string;

  /**
   * Fuentes seleccionadas desde CapabilityBrowser.
   * Es la nueva fuente de verdad para el contexto.
   */
  sources: Array<'note' | 'notes' | 'snips' | 'tasks'>;

  /**
   * Compatibilidad temporal con el sistema anterior.
   */
  contextType: 'note' | 'notes' | 'snips' | 'tasks';

  instructions?: string;
  activeNotePath?: string;
  selection?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ExecutableContext {
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

  instructions?: string;

  contextType: UserRequest['contextType'];

  session: {
    id: string;
    history: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
  };

  execution: {
    temperature: number;
    maxTokens: number;
  };

  additional?: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface Tool {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
  readonly version: string;
  readonly priority?: number;
  execute(context: ExecutableContext): Promise<ToolResult>;
}

export interface ToolGroup {
  id: string;
  label: string;
}

export interface ToolManifest {
  id: string;
  label: string;
  description: string;
  group: string;
  version: string;
  priority?: number;
}

export interface PromptTemplate {
  system: string;
  user: string;
}

// ============================================================
// NUEVOS TIPOS: DEFINICIONES EXTERNAS
// ============================================================

export interface PromptCapabilityDefinition {
  id: string;
  label: string;
  description: string;
  prompt: string;
  priority?: number;
  temperature?: number;
  maxTokens?: number;
  experimental?: boolean;
}

export interface PromptDomainDefinition {
  id: string;
  label: string;
  description?: string;
  capabilities: PromptCapabilityDefinition[];
}

export interface ExternalCapabilityDefinition {
  domain: string;
  capability: PromptCapabilityDefinition;
}

// ============================================================
// COMPATIBILIDAD (para migración gradual)
// ============================================================

export type { Tool as Capability } from './index';
export type { ToolResult as CapabilityResult } from './index';
export type { ToolGroup as CapabilityGroup } from './index';
export type { ToolManifest as CapabilityManifest } from './index';
