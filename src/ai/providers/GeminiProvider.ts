import { LLMProvider } from './LLMProvider';
import { AIRequest, AIResponse } from '../types';

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
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
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
        }
      );

      if (!response.ok) {
        const error = await response.json();
        return {
          content: "",
          error: error.error?.message || `Error HTTP: ${response.status}`
        };
      }

      const data = await response.json();
      return {
        content: data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "",
        usage: data.usageMetadata ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount
        } : undefined
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
