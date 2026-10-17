import { AISettings } from '../types';
import { LLMProvider } from './LLMProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GeminiProvider } from './GeminiProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GroqProvider } from './GroqProvider';

export class LLMProviderFactory {
  static create(settings: AISettings): LLMProvider | null {
    if (!settings.apiKey) return null;

    const model = settings.useRecommendedModel 
      ? this.getDefaultModel(settings.provider)
      : settings.model;

    switch (settings.provider) {
      case "openai":
        return new OpenAIProvider(settings.apiKey, model || "gpt-4o-mini");
      case "gemini":
        return new GeminiProvider(settings.apiKey, model || "gemini-1.5-flash");
      case "anthropic":
        return new AnthropicProvider(settings.apiKey, model || "claude-3-5-haiku-20241022");
      case "groq":
        return new GroqProvider(settings.apiKey, model || "openai/gpt-oss-120b");
      default:
        return null;
    }
  }

  static getDefaultModel(provider: string): string {
    switch (provider) {
      case "openai": return "gpt-4o-mini";
      case "gemini": return "gemini-1.5-flash";
      case "anthropic": return "claude-3-5-haiku-20241022";
      case "groq": return "openai/gpt-oss-120b";
      default: return "";
    }
  }

  static getProviderName(provider: string): string {
    switch (provider) {
      case "openai": return "OpenAI";
      case "gemini": return "Google Gemini";
      case "anthropic": return "Anthropic Claude";
      case "groq": return "Groq";
      default: return "Desconocido";
    }
  }
}
