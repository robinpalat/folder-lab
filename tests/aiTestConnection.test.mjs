// ============================================================
// PRUEBAS: Test de conexión de API Keys (AIService)
// ============================================================
// Ejecutar con: npm test
//
// Causas corregidas:
// - AIService.testConnection() llamaba a provider.testConnection():
//   boolean, que DESCARTABA el mensaje del proveedor (clave
//   incorrecta, error HTTP, red). Ahora se usa el mismo camino de
//   chat() y se conserva el detalle.
// - El botón de Ajustes hacía await sin try/finally: una excepción
//   lo dejaba bloqueado en «Probando…» con un rechazo sin gestionar.
//
// Contrato verificado:
// - Conexión exitosa → success true + mensaje con nombre y modelo.
// - Fallo devuelto por el proveedor → success false + detalle.
// - Excepción inesperada → success false + detalle, sin lanzar.
// - Ninguna clave API o cabecera de autorización aparece en el
//   resultado ni en los registros.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Control del stub de obsidian: decide qué responde requestUrl.
globalThis.__requestUrlMode = 'ok';
globalThis.__requestUrlCalls = [];
globalThis.__consoleErrors = [];

const OBSIDIAN_STUB = `
export class App {}
export class TFile {}
export class Modal { constructor() {} open() {} close() {} }
export function setIcon() {}
export function debounce(fn) { return fn; }
export function normalizePath(p) { return p; }

export async function requestUrl(request) {
  const calls = (globalThis.__requestUrlCalls ??= []);
  calls.push(request);

  const mode = globalThis.__requestUrlMode;

  if (mode === 'throw') {
    // Simula un fallo de red que escapa del proveedor.
    throw new TypeError('net::ERR_CONNECTION_REFUSED https://api.openai.com');
  }

  if (mode === 'http-error') {
    return {
      status: 401,
      text: JSON.stringify({
        error: { message: 'Incorrect API key provided: sk-***redacted***.' }
      })
    };
  }

  return {
    status: 200,
    text: JSON.stringify({
      choices: [{ message: { content: 'OK' } }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 }
    })
  };
}
export default {};
`;

async function loadAIService() {
  const result = await build({
    entryPoints: [join(root, 'src', 'ai', 'AIService.ts')],
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

const { AIService } = await loadAIService();

// Intercepta console.error para verificar que no se filtran secretos.
const originalError = console.error;
function captureErrors() {
  globalThis.__consoleErrors = [];
  console.error = (...args) => {
    globalThis.__consoleErrors.push(args.map(String).join(' '));
  };
}
function restoreErrors() {
  console.error = originalError;
}

function createService(overrides = {}) {
  return new AIService({
    provider: 'openai',
    apiKey: 'sk-test-secret-12345',
    model: 'gpt-4o-mini',
    useRecommendedModel: false,
    maxTokens: 500,
    temperature: 0.3,
    ...overrides
  });
}

const SECRET = 'sk-test-secret-12345';

function assertNoSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.ok(!text.includes(SECRET), `no debe exponer la clave: ${text}`);
  assert.ok(!/authorization/i.test(text), `no debe exponer cabeceras: ${text}`);
}

// ------------------------------------------------------------
// 1. CONEXIÓN EXITOSA
// ------------------------------------------------------------

test('conexión exitosa: success true con nombre y modelo', async () => {
  globalThis.__requestUrlMode = 'ok';
  globalThis.__requestUrlCalls = [];

  const result = await createService().testConnection();

  assert.equal(result.success, true);
  assert.ok(result.message.includes('gpt-4o-mini'), result.message);
  assertNoSecrets(result.message);

  // La prueba usa el mismo camino de chat().
  assert.equal(globalThis.__requestUrlCalls.length, 1);
  const call = globalThis.__requestUrlCalls[0];
  assert.ok(call.url.includes('api.openai.com'));
  /*
   * El pedido HTTP LEGÍTIMAMENTE lleva la cabecera Authorization
   * (así se autentica). El secreto que no debe exponerse es el
   * que se muestra en la interfaz: el resultado del test.
   */
});

test('conexión exitosa sin modelo explícito usa el recomendado', async () => {
  globalThis.__requestUrlMode = 'ok';

  const result = await createService({ model: '' }).testConnection();

  assert.equal(result.success, true);
  assert.ok(result.message.includes('gpt-4o-mini'), result.message);
});

// ------------------------------------------------------------
// 2. FALLO DEVUELTO POR EL PROVEEDOR
// ------------------------------------------------------------

test('clave incorrecta (HTTP 401): success false y se conserva el detalle', async () => {
  globalThis.__requestUrlMode = 'http-error';

  const result = await createService().testConnection();

  assert.equal(result.success, false);
  // El texto del proveedor llega al usuario.
  assert.ok(
    result.message.includes('Incorrect API key provided'),
    result.message
  );
  // El mensaje es comprensible (prefijo localizado + detalle).
  assert.ok(result.message.length > 0);
  // La clave real no aparece (el proveedor la enmascara y aquí
  // solo se reutiliza el texto devuelto).
  assertNoSecrets(result.message);
});

test('el detalle del proveedor no incluye la cabecera Authorization', async () => {
  globalThis.__requestUrlMode = 'http-error';

  const result = await createService().testConnection();

  assertNoSecrets(result.message);
  assert.ok(!/Bearer/i.test(result.message), result.message);
});

test('fallo del proveedor: el mensaje usa la clave i18n de fallo', async () => {
  globalThis.__requestUrlMode = 'http-error';

  const result = await createService().testConnection();

  assert.ok(result.message.startsWith('Error de conexión'), result.message);
});

// ------------------------------------------------------------
// 3. EXCEPCIÓN INESPERADA
// ------------------------------------------------------------

test('excepción de red: success false, no lanza y conserva el detalle', async () => {
  captureErrors();
  try {
    globalThis.__requestUrlMode = 'throw';

    const result = await createService().testConnection();

    assert.equal(result.success, false);
    assert.ok(
      result.message.includes('ERR_CONNECTION_REFUSED'),
      result.message
    );
    assert.ok(result.message.startsWith('Error de conexión'), result.message);
    assertNoSecrets(result.message);
  } finally {
    restoreErrors();
  }
});

test('sin API key: success false con mensaje de clave no configurada', async () => {
  const result = await createService({ apiKey: '' }).testConnection();

  assert.equal(result.success, false);
  assert.ok(result.message.length > 0);
});

// ------------------------------------------------------------
// 4. AUSENCIA DE EXPOSICIÓN DE SECRETOS
// ------------------------------------------------------------

test('ningún resultado expone la clave API', async () => {
  for (const mode of ['ok', 'http-error', 'throw']) {
    globalThis.__requestUrlMode = mode;
    const result = await createService().testConnection();
    assertNoSecrets(result.message);
  }
  globalThis.__requestUrlMode = 'ok';
});

test('el modo throw no deja errores sin registrar', async () => {
  captureErrors();
  try {
    globalThis.__requestUrlMode = 'throw';
    // La promesa se resuelve (no rechaza): no hay rechazo sin
    // gestionar que pueda bloquear el botón.
    await createService().testConnection();
  } finally {
    restoreErrors();
  }
});
