
import { AISettings, AIRequest, AIResponse } from './types';
import { LLMProvider } from './providers/LLMProvider';
import { LLMProviderFactory } from './providers/LLMProviderFactory';

export class AIService {
  private provider: LLMProvider | null = null;
  private settings: AISettings;

  constructor(settings: AISettings) {
    this.settings = settings;
    this.initializeProvider();
  }

  private initializeProvider(): void {
    this.provider = LLMProviderFactory.create(this.settings);
  }

  updateSettings(settings: AISettings): void {
    this.settings = settings;
    this.initializeProvider();
  }

  async chat(request: AIRequest): Promise<AIResponse> {
    if (!this.provider) {
      return { content: "", error: "API Key no configurada" };
    }

    try {
      return await this.provider.chat(request);
    } catch (error) {
      return {
        content: "",
        error: error instanceof Error ? error.message : "Error desconocido"
      };
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.provider) {
      return { success: false, message: "API Key no configurada" };
    }

    try {
      const result = await this.provider.testConnection();
      if (result) {
        const name = LLMProviderFactory.getProviderName(this.settings.provider);
        return { 
          success: true, 
          message: `${name} conectado correctamente\nModelo: ${this.settings.model || LLMProviderFactory.getDefaultModel(this.settings.provider)}`
        };
      }
      return { success: false, message: "Error de conexión. Verifica tu API Key" };
    } catch (error) {
      return { 
        success: false, 
        message: error instanceof Error ? error.message : "Error desconocido" 
      };
    }
  }

  getStatus(): { configured: boolean; provider: string; model: string } {
    const model = this.settings.model || LLMProviderFactory.getDefaultModel(this.settings.provider);
    return {
      configured: !!this.provider,
      provider: this.settings.provider,
      model: model
    };
  }
}
