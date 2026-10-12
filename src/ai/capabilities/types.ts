
export interface CapabilityMetadata {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: "analysis" | "generation" | "review" | "memory" | "utility";
  version: string;
  priority?: number;
  experimental?: boolean;
  supportsStreaming: boolean;
  supportsSelectionOnly: boolean;
  estimatedCost: "low" | "medium" | "high";
}

export interface CapabilityDefinition {
  metadata: CapabilityMetadata;
  systemPrompt: string;
  userPromptTemplate: string;
  temperature?: number;
  maxTokens?: number;
  pipeline?: string[];
  preprocessors?: string[];
  postprocessors?: string[];
  constraints?: {
    requiresNote?: boolean;
    requiresSelection?: boolean;
    requiresFolder?: boolean;
    maxInputLength?: number;
  };
}

export interface CapabilityResult {
  success: boolean;
  content: string;
  error?: string;
  metadata?: {
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    processingTime?: number;
    wordCount?: number;  // wordCount es válido
    [key: string]: any;  // permitir metadata adicional
  };
}



// === CapabilityGroup ===

export interface CapabilityGroup {
  id: string;
  label: string;
}



// === Interfaz de capacidad para el widget genérico ===
/**
 * Contexto genérico.
 * El executor no sabe qué contiene. Solo lo transporta.
 */
export interface Context {
  [key: string]: any;
}

/**
 * Resultado de una capacidad (alias de CapabilityResult para mantener consistencia).
 */
export type Result = CapabilityResult;

/**
 * Una capacidad es un módulo completamente independiente.
 * 
 * El widget solo conoce esta interfaz.
 * No sabe cómo funciona internamente.
 * No sabe qué contiene el contexto.
 */
export interface Capability {
  // === IDENTIFICACIÓN ===
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
  readonly version: string;
  readonly priority?: number;

  // === EJECUCIÓN ===
  /**
   * Ejecuta la capacidad con el contexto dado.
   * El contexto es genérico: la capacidad sabe qué espera.
   * El executor y el widget no saben qué contiene.
   */
  execute(context: Context): Promise<Result>;
}

/**
 * Manifiesto de una capacidad.
 * Declarativo, sin lógica.
 */
export interface CapabilityManifest {
  id: string;
  label: string;
  description: string;
  group: string;
  version: string;
  priority?: number;
}
