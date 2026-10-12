import { requestUrl } from 'obsidian';
import { LLMProvider } from './LLMProvider';
import { AIRequest, AIResponse } from '../types';
import {
  AnthropicMessagesResponse,
  buildAnthropicUsage,
  extractHttpErrorMessage,
  parseJsonText
} from './httpJson';

export class AnthropicProvider implements LLMProvider {
  id = "anthropic";
  name = "Anthropic Claude";

  constructor(
    private apiKey: string,
    private model: string
  ) {}

  getDefaultModel(): string {
    return "claude-3-5-haiku-20241022";
  }

  async chat(request: AIRequest): Promise<AIResponse> {
    try {
      // Bloque 4-1: requestUrl evita las restricciones CORS
      // (obligatorio en móvil; isDesktopOnly: false).
      const response = await requestUrl({
        url: "https://api.anthropic.com/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens ?? 500,
          temperature: request.temperature ?? 0.3,
          system: request.system,
          messages: [
            { role: "user", content: request.user }
          ]
        })
      });

      if (response.status < 200 || response.status >= 300) {
        const body = parseJsonText(response.text);
        return {
          content: "",
          error: extractHttpErrorMessage(body, response.status)
        };
      }

      /*
       * La aserción documenta el contrato del cable; los valores
       * que se usan se comprueban en tiempo de ejecución. El
       * cuerpo se parsea de `text` de forma tolerante.
       */
      const data = parseJsonText(response.text) as AnthropicMessagesResponse;

      const text = data.content?.[0]?.text;

      return {
        content: typeof text === "string" ? text.trim() : "",
        usage: buildAnthropicUsage(
          data.usage?.input_tokens,
          data.usage?.output_tokens
        )
      };
    } catch (error) {
      return {
        content: "",
        error: error instanceof Error ? error.message : "Error desconocido"
      };
    }
  }

  async testConnection(): Promise<boolean> {
    const result = await this.chat({
      system: "Eres un asistente útil.",
      user: "Responde solo con 'OK' si estás funcionando correctamente.",
      maxTokens: 10,
      temperature: 0
    });
    return !result.error && result.content.includes("OK");
  }
}
