
import { AISettings, AIRequest, AIResponse } from './types';
import { LLMProvider } from './providers/LLMProvider';
import { LLMProviderFactory } from './providers/LLMProviderFactory';
import { i18n } from '../i18n/I18nService';

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
      return { content: "", error: i18n.t('ai.connection.apiKeyNotConfigured') };
    }

    try {
      return await this.provider.chat(request);
    } catch (error) {
      return {
        content: "",
        error: error instanceof Error ? error.message : i18n.t('common.unknownError')
      };
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.provider) {
      return { success: false, message: i18n.t('ai.connection.apiKeyNotConfigured') };
    }

    try {
      const result = await this.provider.testConnection();
      if (result) {
        const name = LLMProviderFactory.getProviderName(this.settings.provider);
        return { 
          success: true, 
          message: i18n.t('ai.connection.connected', {
            name,
            model: this.settings.model || LLMProviderFactory.getDefaultModel(this.settings.provider)
          })
        };
      }
      return { success: false, message: i18n.t('ai.connection.failed') };
    } catch (error) {
      return { 
        success: false, 
        message: error instanceof Error ? error.message : i18n.t('common.unknownError') 
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
