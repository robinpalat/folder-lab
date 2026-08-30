import {
  Tool,
  ExecutableContext,
  ToolResult,
  PromptCapabilityDefinition
} from '../../../types';

import {
  PromptBuilder,
  PromptLoader
} from '../../../prompt/PromptBuilder';

export class PromptCapabilityTool implements Tool {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
  readonly version: string;
  readonly priority: number;

  private definition: PromptCapabilityDefinition;

  constructor(definition: PromptCapabilityDefinition, group: string) {
    this.id = definition.id;
    this.label = definition.label;
    this.description = definition.description;
    this.group = group;
    this.version = '1.0.0';
    this.priority = definition.priority || 0;
    this.definition = definition;
  }

  async execute(context: ExecutableContext): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // 1. Cargar el template del prompt usando PromptLoader existente
      const template = await PromptLoader.load(this.definition.prompt);

      // 2. Construir el prompt
      const builder = new PromptBuilder(context, template);
      const { system, user } = builder.build();

      // 3. Obtener AIService del contexto
      const aiService = (context as any).aiService;
      if (!aiService) {
        return {
          success: false,
          content: '',
          error: 'AIService no disponible en el contexto'
        };
      }

      // 4. Ejecutar
      const response = await aiService.chat({
        system,
        user,
        temperature: this.definition.temperature ?? context.execution.temperature,
        maxTokens: this.definition.maxTokens ?? context.execution.maxTokens
      });

      if (response.error) {
        return { success: false, content: '', error: response.error };
      }

      // 5. Postprocesar
      let result = response.content.trim();
      if (result && !result.match(/[.!?]$/)) {
        result += '.';
      }

      return {
        success: true,
        content: result,
        metadata: {
          processingTime: Date.now() - startTime,
          wordCount: result.split(/\s+/).length,
          usage: response.usage,
          promptId: this.definition.prompt
        }
      };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Error desconocido'
      };
    }
  }
}
