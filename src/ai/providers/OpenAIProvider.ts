import { requestUrl } from 'obsidian';
import { LLMProvider } from './LLMProvider';
import { AIRequest, AIResponse } from '../types';
import {
  OpenAIChatResponse,
  buildDirectUsage,
  extractHttpErrorMessage,
  parseJsonText
} from './httpJson';

export class OpenAIProvider implements LLMProvider {
  id = "openai";
  name = "OpenAI";

  constructor(
    private apiKey: string,
    private model: string
  ) {}

  getDefaultModel(): string {
    return "gpt-4o-mini";
  }

  async chat(request: AIRequest): Promise<AIResponse> {
    try {
      // Bloque 4-1: requestUrl evita las restricciones CORS
      // (obligatorio en móvil; isDesktopOnly: false).
      const response = await requestUrl({
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user }
          ],
          temperature: request.temperature ?? 0.3,
          max_tokens: request.maxTokens ?? 500
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
      const data = parseJsonText(response.text) as OpenAIChatResponse;

      const text = data.choices?.[0]?.message?.content;

      return {
        content: typeof text === "string" ? text.trim() : "",
        usage: buildDirectUsage(
          data.usage?.prompt_tokens,
          data.usage?.completion_tokens,
          data.usage?.total_tokens
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
