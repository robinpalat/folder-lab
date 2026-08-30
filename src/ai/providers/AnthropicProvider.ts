import { LLMProvider } from './LLMProvider';
import { AIRequest, AIResponse } from '../types';

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
      const response = await fetch("https://api.anthropic.com/v1/messages", {
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

      if (!response.ok) {
        const error = await response.json();
        return {
          content: "",
          error: error.error?.message || `Error HTTP: ${response.status}`
        };
      }

      const data = await response.json();
      return {
        content: data.content?.[0]?.text?.trim() || "",
        usage: data.usage ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens
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
