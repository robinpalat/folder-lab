// ============================================================
// UTILIDADES DE RESPUESTA HTTP PARA PROVEEDORES (Fase 3D-1)
// ============================================================
// Tipos del cable de cada API y saneamiento de valores externos.
// Los tipos DOCUMENTAN el contrato; la seguridad de los valores
// que se utilizan se garantiza con comprobaciones en tiempo de
// ejecución (una aserción de TypeScript no valida datos).
// ============================================================

/** Cuerpo de error coincidente en las tres APIs ({ error: { message } }). */
export interface ProviderErrorBody {
  error?: { message?: string };
}

/** Respuesta de /v1/messages (Anthropic). */
export interface AnthropicMessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Respuesta de /v1/chat/completions (OpenAI). */
export interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Respuesta de :generateContent (Gemini). */
export interface GeminiGenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parsea el cuerpo de texto de una respuesta HTTP tolerando
 * cuerpos vacíos o no JSON (devuelve null en ese caso).
 * Se usa con `requestUrl(...).text` (bloque 4-1).
 */
export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Mensaje de error del proveedor si el cuerpo lo contiene;
 * fallback claro con el estado HTTP en caso contrario.
 */
export function extractHttpErrorMessage(
  body: unknown,
  status: number
): string {
  if (isPlainObject(body)) {
    const error = (body as ProviderErrorBody).error;
    if (
      isPlainObject(error) &&
      typeof error.message === 'string' &&
      error.message.trim()
    ) {
      return error.message;
    }
  }
  return `Error HTTP: ${status}`;
}

/**
 * Valor numérico finito o undefined (descarta NaN/Infinity/no-numéricos).
 */
export function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** Métricas válidas: solo se emiten si todos los campos necesarios son finitos. */
export interface SanitizedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Anthropic: emite usage solo con input/output finitos; el total
 * se deriva de ambos (semántica del código actual).
 */
export function buildAnthropicUsage(
  input: unknown,
  output: unknown
): SanitizedUsage | undefined {
  const promptTokens = toFiniteNumber(input);
  const completionTokens = toFiniteNumber(output);
  if (promptTokens === undefined || completionTokens === undefined) {
    return undefined;
  }
  // La suma de dos valores finitos puede desbordar; no se emiten
  // métricas inválidas (política de saneamiento del bloque 3D-1).
  const totalTokens = promptTokens + completionTokens;
  if (!Number.isFinite(totalTokens)) {
    return undefined;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}

/**
 * OpenAI/Gemini: los tres valores provienen de la API; si falta
 * alguno o no es finito, no se emite usage (sin inventar datos).
 */
export function buildDirectUsage(
  prompt: unknown,
  completion: unknown,
  total: unknown
): SanitizedUsage | undefined {
  const promptTokens = toFiniteNumber(prompt);
  const completionTokens = toFiniteNumber(completion);
  const totalTokens = toFiniteNumber(total);
  if (
    promptTokens === undefined ||
    completionTokens === undefined ||
    totalTokens === undefined
  ) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}
