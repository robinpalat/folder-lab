// ============================================================
// PRUEBAS: proveedores de IA con requestUrl stubbeado (Fase 4-1)
// ============================================================
// Ejecutar con: npm test
//
// Sin red real. Cubre, por cada proveedor:
// 1. Éxito con contenido y métricas válidas.
// 2. usage ausente.
// 3. usage con valores no finitos (nunca se emite usage inválido).
// 4. Error HTTP con cuerpo JSON con mensaje.
// 5. Error HTTP con cuerpo no JSON (fallback con estado).
// 6. Excepción de red.
// ============================================================

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Stub de obsidian: requestUrl delega en un handler global
// que cada prueba instala (bloque 4-1).
const OBSIDIAN_STUB = `
export function requestUrl(params) {
  return globalThis.__requestUrlStub(params);
}
export default {};
`;

async function loadProvider(entry) {
  const result = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    plugins: [
      {
        name: 'obsidian-stub',
        setup(b) {
          b.onResolve({ filter: /^obsidian$/ }, () => ({
            path: 'obsidian',
            namespace: 'obsidian-stub'
          }));
          b.onLoad({ filter: /.*/, namespace: 'obsidian-stub' }, () => ({
            contents: OBSIDIAN_STUB,
            loader: 'js'
          }));
        }
      }
    ]
  });
  const url =
    'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(url);
}

const { OpenAIProvider } = await loadProvider('src/ai/providers/OpenAIProvider.ts');
const { AnthropicProvider } = await loadProvider('src/ai/providers/AnthropicProvider.ts');
const { GeminiProvider } = await loadProvider('src/ai/providers/GeminiProvider.ts');
const { GroqProvider } = await loadProvider('src/ai/providers/GroqProvider.ts');
const { LLMProviderFactory } = await loadProvider('src/ai/providers/LLMProviderFactory.ts');

// ------------------------------------------------------------
// Stub de requestUrl (aislado y restaurado en after)
// ------------------------------------------------------------

function stubRequestUrl(handler) {
  globalThis.__requestUrlStub = handler;
}

after(() => {
  delete globalThis.__requestUrlStub;
});

function response(status, body) {
  return {
    status,
    text: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function nonJsonErrorResponse(status) {
  return {
    status,
    text: '<html>502 Bad Gateway</html>'
  };
}

// ------------------------------------------------------------
// Fixtures por proveedor
// ------------------------------------------------------------

const providers = [
  {
    name: 'OpenAI',
    create: () => new OpenAIProvider('key', 'gpt-4o-mini'),
    success: {
      choices: [{ message: { content: '  hola openai  ' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
    },
    successNoUsage: {
      choices: [{ message: { content: 'sin metricas' } }]
    },
    successBadUsage: {
      choices: [{ message: { content: 'metricas malas' } }],
      usage: { prompt_tokens: 'x', completion_tokens: 2, total_tokens: 3 }
    },
    expectedContent: 'hola openai',
    expectedUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
  },
  {
    name: 'Anthropic',
    create: () => new AnthropicProvider('key', 'claude-3-5-haiku-20241022'),
    success: {
      content: [{ type: 'text', text: '  hola claude  ' }],
      usage: { input_tokens: 4, output_tokens: 6 }
    },
    successNoUsage: {
      content: [{ type: 'text', text: 'sin metricas' }]
    },
    successBadUsage: {
      content: [{ type: 'text', text: 'metricas malas' }],
      usage: { input_tokens: Number.NaN, output_tokens: 6 }
    },
    expectedContent: 'hola claude',
    expectedUsage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 }
  },
  {
    name: 'Gemini',
    create: () => new GeminiProvider('key', 'gemini-1.5-flash'),
    success: {
      candidates: [{ content: { parts: [{ text: '  hola gemini  ' }] } }],
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: 7,
        totalTokenCount: 12
      }
    },
    successNoUsage: {
      candidates: [{ content: { parts: [{ text: 'sin metricas' }] } }]
    },
    successBadUsage: {
      candidates: [{ content: { parts: [{ text: 'metricas malas' }] } }],
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: null,
        totalTokenCount: 12
      }
    },
    expectedContent: 'hola gemini',
    expectedUsage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 }
  },
  {
    // Groq: API compatible con OpenAI (mismo formato de respuesta).
    name: 'Groq',
    create: () => new GroqProvider('key', 'llama-3.3-70b-versatile'),
    success: {
      choices: [{ message: { content: '  hola groq  ' } }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
    },
    successNoUsage: {
      choices: [{ message: { content: 'sin metricas' } }]
    },
    successBadUsage: {
      choices: [{ message: { content: 'metricas malas' } }],
      usage: { prompt_tokens: 2, completion_tokens: null, total_tokens: 5 }
    },
    expectedContent: 'hola groq',
    expectedUsage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 }
  }
];

function request() {
  return { system: 'S', user: 'U' };
}

function assertValidUsage(usage) {
  if (usage === undefined) return;
  for (const key of ['promptTokens', 'completionTokens', 'totalTokens']) {
    assert.equal(typeof usage[key], 'number', `${key} debe ser número`);
    assert.ok(Number.isFinite(usage[key]), `${key} debe ser finito`);
  }
}

// ------------------------------------------------------------
// Pruebas por proveedor
// ------------------------------------------------------------

for (const p of providers) {
  test(`${p.name}: éxito con contenido y métricas válidas`, async () => {
    stubRequestUrl(async () => response(200, p.success));
    const result = await p.create().chat(request());

    assert.equal(result.error, undefined);
    assert.equal(result.content, p.expectedContent);
    assert.deepEqual(result.usage, p.expectedUsage);
    assertValidUsage(result.usage);
  });

  test(`${p.name}: usage ausente no se emite`, async () => {
    stubRequestUrl(async () => response(200, p.successNoUsage));
    const result = await p.create().chat(request());

    assert.equal(result.content.length > 0, true);
    assert.equal(result.usage, undefined);
  });

  test(`${p.name}: usage con valores no finitos no se emite`, async () => {
    stubRequestUrl(async () => response(200, p.successBadUsage));
    const result = await p.create().chat(request());

    assert.equal(result.usage, undefined, 'nunca usage con NaN/no-numéricos');
    assertValidUsage(result.usage);
  });

  test(`${p.name}: error HTTP con cuerpo JSON conserva el mensaje`, async () => {
    stubRequestUrl(async () =>
      response(429, { error: { message: 'rate limited by provider' } })
    );
    const result = await p.create().chat(request());

    assert.equal(result.content, '');
    assert.equal(result.error, 'rate limited by provider');
  });

  test(`${p.name}: error HTTP sin JSON utilizable usa el fallback con estado`, async () => {
    stubRequestUrl(async () => nonJsonErrorResponse(503));
    const result = await p.create().chat(request());

    assert.equal(result.content, '');
    assert.equal(result.error, 'Error HTTP: 503');
  });

  test(`${p.name}: excepción de red produce error legible`, async () => {
    stubRequestUrl(async () => {
      throw new TypeError('Network request failed');
    });
    const result = await p.create().chat(request());

    assert.equal(result.content, '');
    assert.equal(result.error, 'Network request failed');
  });
}

test('buildAnthropicUsage: la suma desbordada no emite métricas inválidas', async () => {
  const result = await loadProvider('src/ai/providers/httpJson.ts');
  const usage = result.buildAnthropicUsage(
    Number.MAX_VALUE,
    Number.MAX_VALUE
  );

  assert.equal(usage, undefined, 'no se emite usage con totalTokens infinito');
  assertValidUsage(usage);

  // Los casos finitos siguen comportándose igual.
  assert.deepEqual(
    result.buildAnthropicUsage(4, 6),
    { promptTokens: 4, completionTokens: 6, totalTokens: 10 }
  );
});

// ------------------------------------------------------------
// FÁBRICA: registro del proveedor Groq
// ------------------------------------------------------------

test('factory: Groq está registrado con su modelo y nombre por defecto', () => {
  const provider = LLMProviderFactory.create({
    provider: 'groq',
    apiKey: 'gsk-test',
    model: '',
    useRecommendedModel: true,
    temperature: 0.3,
    maxTokens: 500
  });

  assert.ok(provider, 'el proveedor groq se crea');
  assert.equal(provider.id, 'groq');
  assert.equal(provider.getDefaultModel(), 'openai/gpt-oss-120b');
  assert.equal(LLMProviderFactory.getDefaultModel('groq'), 'openai/gpt-oss-120b');
  assert.equal(LLMProviderFactory.getProviderName('groq'), 'Groq');
});

// ------------------------------------------------------------
// GROQ: tolerancia a la retirada de modelos (404)
// ------------------------------------------------------------

test('Groq: modelo retirado (404) reintenta con el siguiente candidato', async () => {
  const requests = [];
  stubRequestUrl((params) => {
    requests.push(JSON.parse(params.body));
    if (requests.length === 1) {
      // requestUrl lanza en 4xx en Obsidian real.
      throw new Error('Request failed, status 404');
    }
    return response(200, {
      choices: [{ message: { content: 'OK fallback' } }]
    });
  });

  const provider = new GroqProvider('gsk-test', 'modelo-retirado-2024');
  const result = await provider.chat(request());

  assert.equal(result.error, undefined);
  assert.equal(result.content, 'OK fallback');
  assert.equal(requests.length, 2, 'reintenta una vez con el candidato');
  assert.equal(requests[0].model, 'modelo-retirado-2024');
  assert.equal(
    requests[1].model,
    'openai/gpt-oss-120b',
    'candidato ordenado tras el modelo configurado'
  );
});

test('Groq: clave inválida (401) NO reintenta con otro modelo', async () => {
  let calls = 0;
  stubRequestUrl(() => {
    calls += 1;
    throw new Error('Request failed, status 401');
  });

  const provider = new GroqProvider('gsk-mala', 'llama-3.3-70b-versatile');
  const result = await provider.chat(request());

  assert.ok(result.error.includes('401'));
  assert.equal(calls, 1, 'sin reintento para errores que no son 404');
});

test('Groq: agota los candidatos y devuelve el último error 404', async () => {
  let calls = 0;
  stubRequestUrl(() => {
    calls += 1;
    throw new Error('Request failed, status 404');
  });

  const provider = new GroqProvider('gsk-test', 'llama-3.3-70b-versatile');
  const result = await provider.chat(request());

  assert.ok(result.error.includes('404'));
  // Configurado + 2 candidatos restantes (sin repetir el configurado).
  assert.equal(calls, 3);
});
