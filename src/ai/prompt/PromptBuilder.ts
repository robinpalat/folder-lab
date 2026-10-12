// src/ai/prompt/PromptBuilder.ts

import {
  ExecutableContext,
  PromptTemplate,
  PromptDomainDefinition,
  ExternalCapabilityDefinition
} from '../types';

// Importar el manifiesto generado (resolveJsonModule + loader JSON de esbuild)
import manifestJson from '../prompts/generated/manifest.json';

/*
 * El JSON importado tipa `templates` como objeto literal cerrado;
 * el acceso por id dinámico (toolId) necesita un índice abierto.
 * `domains` conserva su tipado original.
 */
const MANIFEST = manifestJson as Omit<typeof manifestJson, 'templates'> & {
  templates: Record<string, { system: string; user: string }>;
};

// ============================================================
// PROMPT BUILDER
// ============================================================

export class PromptBuilder {
  private context: ExecutableContext;
  private template: PromptTemplate;

  constructor(context: ExecutableContext, template: PromptTemplate) {
    this.context = context;
    this.template = template;
  }

  buildSystem(): string {
    let system = this.template.system;

    if (this.context.book) {
      system += `\n\nContexto del libro: ${this.context.book.name}`;
    }

    if (this.context.folder.name) {
      system += `\n\nCarpeta: ${this.context.folder.name}`;
    }

    return system;
  }

buildUser(): string {
  let user = this.template.user;

  user = user.replace(
    /\{noteName\}/g,
    this.context.note.name || 'documento'
  );

  user = user.replace(
    /\{folderName\}/g,
    this.context.folder.name || ''
  );

  user = user.replace(
    /\{bookName\}/g,
    this.context.book?.name || ''
  );

  user = user.replace(
    /\{hasSelection\}/g,
    this.context.selection ? 'la selección' : 'el documento'
  );

  if (this.context.instructions) {
    user += `\n\nInstrucciones adicionales:\n${this.context.instructions}`;
  }

  const hasSelection = !!this.context.selection;

  let content = '';
  let target = '';

  // ==========================================================
  // DETERMINAR LA FUENTE DEL CONTEXTO
  // ==========================================================

  switch (this.context.contextType) {

    case 'snips': {
      const snips = this.context.additional?.snips || [];

      content = snips
        .map((snip: any) => snip.text)
        .filter((text: string) => !!text?.trim())
        .join('\n\n---\n\n');

      target = 'Snips seleccionados:';
      break;
    }

    case 'notes': {
      content = this.context.additional?.notes || '';
      target = 'Apuntes:';
      break;
    }

    case 'tasks': {
      const tasks = this.context.additional?.tasks || [];

      if (Array.isArray(tasks)) {
        content = tasks
          .map((task: any) => {
            if (typeof task === 'string') {
              return task;
            }

            return task?.text || task?.content || task?.title || '';
          })
          .filter((text: string) => !!text?.trim())
          .join('\n');
      } else if (typeof tasks === 'string') {
        content = tasks;
      }

      target = 'Tareas:';
      break;
    }

    case 'note':
    default: {
      content = this.context.note.content || '';
      target = `Contenido de "${this.context.note.name}":`;
      break;
    }
  }

  // ==========================================================
  // LA SELECCIÓN EXPLÍCITA TIENE PRIORIDAD
  // ==========================================================

  if (hasSelection) {
    content = this.context.selection!;
    target = 'Selección del usuario:';
  }

  // ==========================================================
  // AGREGAR CONTENIDO AL PROMPT
  // ==========================================================

  if (content) {
    user += `\n\n${target}\n${content}`;
  }
  

  return user;
}
  
  
  
  
  

  build(): { system: string; user: string } {
    return {
      system: this.buildSystem(),
      user: this.buildUser()
    };
  }

  /**
   * Parsea un archivo Markdown en un PromptTemplate
   */
  static parseMarkdown(content: string): PromptTemplate {
    const systemMatch = content.match(/# System\s*\n([\s\S]*?)(?=# User|$)/);
    const userMatch = content.match(/# User\s*\n([\s\S]*?)$/);

    return {
      system: systemMatch ? systemMatch[1].trim() : '',
      user: userMatch ? userMatch[1].trim() : ''
    };
  }
}

// ============================================================
// PROMPT LOADER
// ============================================================

export class PromptLoader {
  private static cache: Map<string, PromptTemplate> = new Map();

  /**
   * Obtiene todas las definiciones de dominio desde el manifiesto
   */
  static loadAllDomains(): PromptDomainDefinition[] {
    return Object.values(MANIFEST.domains);
  }

  /**
   * Obtiene todas las capacidades externas (dominio + capacidad)
   */
  static loadAllExternalCapabilities(): ExternalCapabilityDefinition[] {
    const result: ExternalCapabilityDefinition[] = [];

    for (const [domainId, domain] of Object.entries(MANIFEST.domains) as [string, PromptDomainDefinition][]) {
      for (const capability of domain.capabilities) {
        result.push({
          domain: domainId,
          capability
        });
      }
    }

    return result;
  }

  /**
   * Obtiene una capacidad específica por ID
   */
  static findCapability(toolId: string): ExternalCapabilityDefinition | null {
    for (const [domainId, domain] of Object.entries(MANIFEST.domains) as [string, PromptDomainDefinition][]) {
      for (const capability of domain.capabilities) {
        if (capability.id === toolId) {
          return {
            domain: domainId,
            capability
          };
        }
      }
    }
    return null;
  }

  /**
   * Carga un template por ID de herramienta desde el manifiesto
   */
  static async load(toolId: string): Promise<PromptTemplate> {
    // Verificar cache
    const cached = this.cache.get(toolId);
    if (cached) {
      return cached;
    }

    // Buscar en el manifiesto
    const template = MANIFEST.templates[toolId];
    if (template) {
      this.cache.set(toolId, template);
      return template;
    }

    // Prompt no encontrado → error explícito
    throw new Error(`Prompt no encontrado para la capacidad "${toolId}"`);
  }

  static clearCache(): void {
    this.cache.clear();
  }

  static getStats(): { domains: number; templates: number; cached: number } {
    return {
      domains: Object.keys(MANIFEST.domains).length,
      templates: Object.keys(MANIFEST.templates).length,
      cached: this.cache.size
    };
  }
}
