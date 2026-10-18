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
  // MODO WIDGETS: instancias seleccionadas en el segundo menú
  // ==========================================================
  //
  // Cuando el Asistente opera en modo «Widgets» (`contextMode`),
  // el contexto se construye EXCLUSIVAMENTE a partir de las
  // instancias elegidas. `additional.widgetInstances` contiene el
  // contenido ya filtrado por ContextResolver (solo bloques
  // activos de cada instancia).
  //
  // En este modo NO se usa el mecanismo heredado de
  // additional.notes/tasks/snips ni contextType, INCLUSO cuando
  // no hay instancias seleccionadas o ninguna aporta contenido
  // elegible tras el filtrado. El prompt queda con contexto
  // vacío de widgets (la selección de capacidades sigue
  // determinando la operación, no el contenido contextual).
  //
  // La selección de capacidades (sources) sigue determinando la
  // operación del Assistant, pero no sustituye ni filtra las
  // instancias elegidas.

  const contextMode: unknown =
    this.context.additional?.contextMode;

  if (contextMode === 'widget') {
    const widgetInstances: unknown =
      this.context.additional?.widgetInstances;

    const sections: string[] = [];

    if (Array.isArray(widgetInstances)) {
      for (const entry of widgetInstances) {
        if (
          typeof entry !== 'object' ||
          entry === null
        ) {
          continue;
        }

        const record = entry as {
          name?: unknown;
          items?: unknown;
        };

        const name =
          typeof record.name === 'string' && record.name
            ? record.name
            : 'Instancia';

        const items: unknown[] = Array.isArray(record.items)
          ? record.items
          : [];

        const texts = items
          .map((item) => {
            if (
              typeof item === 'object' &&
              item !== null
            ) {
              const text = (item as { text?: unknown }).text;
              return typeof text === 'string' ? text : '';
            }
            return '';
          })
          .filter((text: string) => !!text.trim());

        if (texts.length === 0) continue;

        sections.push(`[${name}]\n${texts.join('\n\n')}`);
      }
    }

    if (sections.length > 0) {
      content = sections.join('\n\n---\n\n');
      target = 'Contexto de widgets seleccionados:';
    }
    // Sin contenido elegible → contexto vacío de widgets. NO se
    // recurre al mecanismo heredado (notes/tasks/snips/note).

    if (hasSelection) {
      content = this.context.selection!;
      target = 'Selección del usuario:';
    }

    if (content) {
      user += `\n\n${target}\n${content}`;
    }

    return user;
  }

  // ==========================================================
  // DETERMINAR LA FUENTE DEL CONTEXTO (modo heredado)
  // ==========================================================

  switch (this.context.contextType) {

    case 'snips': {
      /*
       * 3A: las fuentes llegan como envoltorios por instancia
       * ({ instanceId, name, items }) producidos por
       * ContextResolver.resolveWidgetSource; el contenido real
       * está en `items[].text`. No existen productores del formato
       * plano heredado (additional.snips solo se construye en
       * resolve), por lo que no se mantiene compatibilidad con él.
       */
      const sources: unknown = this.context.additional?.snips;

      content = (Array.isArray(sources) ? sources : [])
        .flatMap((entry) => {
          if (typeof entry !== 'object' || entry === null) return [];
          const items = (entry as { items?: unknown }).items;
          return Array.isArray(items) ? (items as unknown[]) : [];
        })
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            const text = (item as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          }
          return '';
        })
        .filter((text: string) => !!text.trim())
        .join('\n\n---\n\n');

      target = 'Snips seleccionados:';
      break;
    }

    case 'notes': {
      const notes: unknown = this.context.additional?.notes;
      content = typeof notes === 'string' ? notes : '';
      target = 'Apuntes:';
      break;
    }

    case 'tasks': {
      /*
       * 3A: ídem snips — envoltorios por instancia; el texto de
       * cada tarea está en `items[].text` (con `title` como
       * alternativa heredada de formas de ítem). Sin productores
       * de string o plano, esas ramas se retiran.
       */
      const sources: unknown = this.context.additional?.tasks;

      content = (Array.isArray(sources) ? sources : [])
        .flatMap((entry) => {
          if (typeof entry !== 'object' || entry === null) return [];
          const items = (entry as { items?: unknown }).items;
          return Array.isArray(items) ? (items as unknown[]) : [];
        })
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            const record = item as { text?: unknown; title?: unknown };
            if (typeof record.text === 'string' && record.text) {
              return record.text;
            }
            if (typeof record.title === 'string' && record.title) {
              return record.title;
            }
          }
          return '';
        })
        .filter((text: string) => !!text.trim())
        .join('\n');

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
