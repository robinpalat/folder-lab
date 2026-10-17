import { requestUrl } from 'obsidian';
import { LLMProvider } from './LLMProvider';
import { AIRequest, AIResponse } from '../types';
import {
  OpenAIChatResponse,
  buildDirectUsage,
  extractHttpErrorMessage,
  parseJsonText
} from './httpJson';

/**
 * Modelos candidato de respaldo. Groq retira modelos con
 * frecuencia (devuelve HTTP 404 "model_not_found"); la cadena se
 * reintenta SOLO ante 404, nunca ante 401 (clave inválida) u
 * otros errores. Actualizar esta lista cuando Groq deprecé un
 * modelo es mantenimiento puntual de este archivo.
 */
const GROQ_FALLBACK_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-120b'
];

/**
 * El fallo indica modelo retirado/inexistente (404). requestUrl
 * lanza en 4xx con mensaje "Request failed, status 404"; si la
 * versión de Obsidian devolviese la respuesta, el cuerpo con
 * code "model_not_found" también identifica el caso.
 */
function isModelGone(error: string): boolean {
  return error.includes('404') || error.includes('model_not_found');
}

/**
 * Groq expone una API compatible con OpenAI
 * (https://api.groq.com/openai/v1/chat/completions), por lo que
 * el cable de respuesta es el mismo (choices[0].message.content
 * y usage con prompt/completion/total tokens).
 */
export class GroqProvider implements LLMProvider {
  id = "groq";
  name = "Groq";

  constructor(
    private apiKey: string,
    private model: string
  ) {}

  getDefaultModel(): string {
    return "llama-3.3-70b-versatile";
  }

  async chat(request: AIRequest): Promise<AIResponse> {
    /*
     * Modelo configurado primero y, si está retirado (404),
     * candidatos en orden. Otros errores (401 clave inválida,
     * 400 solicitud, red) NO reintentan con otro modelo.
     */
    const candidates = [
      this.model,
      ...GROQ_FALLBACK_MODELS.filter((m) => m !== this.model)
    ];

    let lastResult: AIResponse = {
      content: "",
      error: "Error desconocido"
    };

    for (const model of candidates) {
      const result = await this.chatWithModel(model, request);

      if (!result.error) {
        return result;
      }

      lastResult = result;

      if (!isModelGone(result.error)) {
        return result;
      }
    }

    return lastResult;
  }

  private async chatWithModel(
    model: string,
    request: AIRequest
  ): Promise<AIResponse> {
    try {
      // requestUrl evita las restricciones CORS
      // (obligatorio en móvil; isDesktopOnly: false).
      const response = await requestUrl({
        url: "https://api.groq.com/openai/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model,
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
      /*
       * requestUrl LANZA en HTTP 4xx/5xx (el cuerpo del error se
       * pierde; solo queda "Request failed, status NNN"). Se
       * normaliza a "Error HTTP: NNN" para que el isModelGone y
       * los mensajes al usuario sean coherentes con la rama no
       * lanzada (tests y versiones que devuelven la respuesta).
       */
      const message =
        error instanceof Error ? error.message : "Error desconocido";

      const statusMatch = message.match(/status\s+(\d{3})/);

      return {
        content: "",
        error: statusMatch
          ? `Error HTTP: ${statusMatch[1]}`
          : message
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
