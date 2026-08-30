import { LLMProvider } from './LLMProvider';
import { AIRequest, AIResponse } from '../types';

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
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
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

      if (!response.ok) {
        const error = await response.json();
        return {
          content: "",
          error: error.error?.message || `Error HTTP: ${response.status}`
        };
      }

      const data = await response.json();
      return {
        content: data.choices?.[0]?.message?.content?.trim() || "",
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
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
