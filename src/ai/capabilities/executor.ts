// src/ai/capabilities/executor.ts
import { Tool, ExecutableContext, ToolResult } from '../types';
import { CapabilityRegistry } from './CapabilityRegistry';

export class CapabilityExecutor {
  private registry: CapabilityRegistry;

  constructor(registry: CapabilityRegistry) {
    this.registry = registry;
  }

  /**
   * Ejecuta una herramienta por ID con el contexto dado.
   * 
   * El executor NO sabe cómo funciona la herramienta.
   * Solo la obtiene del registro y la ejecuta.
   */
  async execute(toolId: string, context: ExecutableContext): Promise<ToolResult> {
    const tool = this.registry.get(toolId);
    if (!tool) {
      return {
        success: false,
        content: '',
        error: `Herramienta "${toolId}" no encontrada`
      };
    }

    return tool.execute(context);
  }
}
