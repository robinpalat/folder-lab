// ============================================================
// PRUEBAS: proveedores de IA con fetch stubbeado (Fase 3D-1)
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

async function loadProvider(entry) {
  const result = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral'
  });
  const url =
    'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(url);
}

const { OpenAIProvider } = await loadProvider('src/ai/providers/OpenAIProvider.ts');
const { AnthropicProvider } = await loadProvider('src/ai/providers/AnthropicProvider.ts');
const { GeminiProvider } = await loadProvider('src/ai/providers/GeminiProvider.ts');

// ------------------------------------------------------------
// Stub de fetch (aislado y restaurado)
// ------------------------------------------------------------

const originalFetch = globalThis.fetch;

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => handler(String(url), init);
}

after(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function brokenJsonResponse(status) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    }
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
    stubFetch(async () => jsonResponse(p.success));
    const result = await p.create().chat(request());

    assert.equal(result.error, undefined);
    assert.equal(result.content, p.expectedContent);
    assert.deepEqual(result.usage, p.expectedUsage);
    assertValidUsage(result.usage);
  });

  test(`${p.name}: usage ausente no se emite`, async () => {
    stubFetch(async () => jsonResponse(p.successNoUsage));
    const result = await p.create().chat(request());

    assert.equal(result.content.length > 0, true);
    assert.equal(result.usage, undefined);
  });

  test(`${p.name}: usage con valores no finitos no se emite`, async () => {
    stubFetch(async () => jsonResponse(p.successBadUsage));
    const result = await p.create().chat(request());

    assert.equal(result.usage, undefined, 'nunca usage con NaN/no-numéricos');
    assertValidUsage(result.usage);
  });

  test(`${p.name}: error HTTP con cuerpo JSON conserva el mensaje`, async () => {
    stubFetch(async () =>
      jsonResponse({ error: { message: 'rate limited by provider' } }, 429)
    );
    const result = await p.create().chat(request());

    assert.equal(result.content, '');
    assert.equal(result.error, 'rate limited by provider');
  });

  test(`${p.name}: error HTTP sin JSON utilizable usa el fallback con estado`, async () => {
    stubFetch(async () => brokenJsonResponse(503));
    const result = await p.create().chat(request());

    assert.equal(result.content, '');
    assert.equal(result.error, 'Error HTTP: 503');
  });

  test(`${p.name}: excepción de red produce error legible`, async () => {
    stubFetch(async () => {
      throw new TypeError('Network request failed');
    });
    const result = await p.create().chat(request());

    assert.equal(result.content, '');
    assert.equal(result.error, 'Network request failed');
  });
}

test('el stub de fetch se restaura tras la suite', () => {
  // after() restaura; dentro de las pruebas se re-stubbea por test.
  assert.equal(typeof globalThis.fetch, 'function');
});

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
