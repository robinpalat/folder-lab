
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

  /**
   * Prueba la conexión usando el MISMO camino de `chat()`, de modo
   * que el mensaje del proveedor (clave incorrecta, error HTTP,
   * red) se conserva y llega al usuario.
   *
   * El contrato `{ success, message }` es compatible con el único
   * consumidor (el botón de Ajustes) y con i18nStage7.
   *
   * No se emiten secretos: los providers ya sanean el cuerpo y
   * aquí solo se reutiliza el texto devuelto.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.provider) {
      return { success: false, message: i18n.t('ai.connection.apiKeyNotConfigured') };
    }

    const name = LLMProviderFactory.getProviderName(this.settings.provider);
    const model =
      this.settings.model || LLMProviderFactory.getDefaultModel(this.settings.provider);

    let result: AIResponse;

    try {
      result = await this.provider.chat({
        system: "Eres un asistente útil.",
        user: "Responde solo con 'OK' si estás funcionando correctamente.",
        maxTokens: 10,
        temperature: 0
      });
    } catch (error) {
      // Excepción inesperada (p. ej. requestUrl lanzando).
      return {
        success: false,
        message: `${i18n.t('ai.connection.failed')}: ${
          error instanceof Error && error.message
            ? error.message
            : i18n.t('common.unknownError')
        }`
      };
    }

    if (result.error) {
      // El proveedor devolvió un fallo con detalle (clave
      // inválida, error HTTP, red). Se conserva ese texto.
      return {
        success: false,
        message: `${i18n.t('ai.connection.failed')}: ${result.error}`
      };
    }

    const text = result.content ?? "";

    /*
     * El contrato histórico exige confirmar con 'OK'. Un contenido
     * vacío o sin 'OK' no prueba la conexión, pero el texto no es
     * un error del proveedor: se informa sin inventar un motivo.
     */
    if (!text.includes("OK")) {
      return {
        success: false,
        message: i18n.t('ai.connection.failed')
      };
    }

    return {
      success: true,
      message: i18n.t('ai.connection.connected', { name, model })
    };
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
