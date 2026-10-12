import { requestUrl } from 'obsidian';
import { LLMProvider } from './LLMProvider';
import { AIRequest, AIResponse } from '../types';
import {
  GeminiGenerateResponse,
  buildDirectUsage,
  extractHttpErrorMessage,
  parseJsonText
} from './httpJson';

export class GeminiProvider implements LLMProvider {
  id = "gemini";
  name = "Google Gemini";

  constructor(
    private apiKey: string,
    private model: string
  ) {}

  getDefaultModel(): string {
    return "gemini-1.5-flash";
  }

  async chat(request: AIRequest): Promise<AIResponse> {
    try {
      // Bloque 4-1: requestUrl evita las restricciones CORS
      // (obligatorio en móvil; isDesktopOnly: false).
      const response = await requestUrl({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: request.user }]
          }],
          system_instruction: {
            parts: [{ text: request.system }]
          },
          generationConfig: {
            maxOutputTokens: request.maxTokens ?? 500,
            temperature: request.temperature ?? 0.3
          }
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
      const data = parseJsonText(response.text) as GeminiGenerateResponse;

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      return {
        content: typeof text === "string" ? text.trim() : "",
        usage: buildDirectUsage(
          data.usageMetadata?.promptTokenCount,
          data.usageMetadata?.candidatesTokenCount,
          data.usageMetadata?.totalTokenCount
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
