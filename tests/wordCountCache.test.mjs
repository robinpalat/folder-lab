// ============================================================
// PRUEBAS: caché de conteo de palabras (single-flight)
// ============================================================
// Ejecutar con: npm test
//
// Cubre el contrato del conteo eficiente:
// - El primer resultado se calcula solo si no existe.
// - Reabrir reutiliza el resultado en memoria.
// - «Actualizar estadísticas» fuerza un cálculo nuevo.
// - Sin peticiones duplicadas simultáneas.
// - Un fallo conserva el último resultado válido.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, '..', 'src', 'utils', 'wordCountCache.ts'),
  'utf8'
);
const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
const url =
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64');

const { SingleFlightCache } = await import(url);

function makeFactory(result, callLog) {
  return async () => {
    callLog.push(Date.now());
    return result;
  };
}

test('el conteo inicial solo se ejecuta si no existe resultado', async () => {
  const cache = new SingleFlightCache();
  const calls = [];

  const first = await cache.request(makeFactory({ totalWords: 100 }, calls));
  assert.deepEqual(first, { totalWords: 100 });
  assert.equal(calls.length, 1);

  // Reabrir el diálogo / leer el encabezado: sin nuevo cálculo.
  const second = await cache.request(makeFactory({ totalWords: 999 }, calls));
  assert.deepEqual(second, { totalWords: 100 });
  assert.equal(calls.length, 1);
});

test('get() devuelve el resultado en memoria sin calcular', () => {
  const cache = new SingleFlightCache();

  assert.equal(cache.get(), null);

  void cache.request(async () => ({ totalWords: 42 }));
  // Tras completarse, get() refleja el valor sin fábrica.
  return cache.request(async () => ({ totalWords: 42 })).then(() => {
    assert.deepEqual(cache.get(), { totalWords: 42 });
  });
});

test('force (Actualizar estadísticas) fuerza un cálculo nuevo', async () => {
  const cache = new SingleFlightCache();
  const calls = [];

  await cache.request(makeFactory({ totalWords: 100 }, calls));
  const fresh = await cache.request(
    makeFactory({ totalWords: 250 }, calls),
    true
  );

  assert.deepEqual(fresh, { totalWords: 250 });
  assert.equal(calls.length, 2);
  assert.deepEqual(cache.get(), { totalWords: 250 });
});

test('cambiar la meta no requiere nuevo cálculo: el % usa get()', async () => {
  const cache = new SingleFlightCache();
  const calls = [];

  await cache.request(makeFactory({ totalWords: 72000 }, calls));

  // El encabezado/porcentaje lee get(); la meta nueva no toca la
  // fábrica: 72000 / 80000 → 90% sin recorrer notas.
  const cached = cache.get();
  assert.equal(cached.totalWords, 72000);
  assert.equal(calls.length, 1);
});

test('peticiones simultáneas comparten un único vuelo (sin duplicados)', async () => {
  const cache = new SingleFlightCache();
  let executions = 0;

  const factory = () =>
    new Promise((resolve) => {
      executions++;
      setTimeout(() => resolve({ totalWords: 10 }), 10);
    });

  const [a, b, c] = await Promise.all([
    cache.request(factory),
    cache.request(factory),
    cache.request(factory)
  ]);

  assert.equal(executions, 1);
  assert.deepEqual(a, { totalWords: 10 });
  assert.deepEqual(b, { totalWords: 10 });
  assert.deepEqual(c, { totalWords: 10 });
});

test('un fallo (null) conserva el último resultado válido', async () => {
  const cache = new SingleFlightCache();
  const calls = [];

  await cache.request(makeFactory({ totalWords: 100 }, calls));

  const failed = await cache.request(async () => {
    calls.push('fail');
    return null;
  }, true);

  assert.equal(failed, null);
  assert.deepEqual(cache.get(), { totalWords: 100 });
});

test('un fallo inicial no deja valor: el siguiente intento reintenta', async () => {
  const cache = new SingleFlightCache();

  const failed = await cache.request(async () => null);
  assert.equal(failed, null);
  assert.equal(cache.get(), null);

  const ok = await cache.request(async () => ({ totalWords: 7 }));
  assert.deepEqual(ok, { totalWords: 7 });
  assert.deepEqual(cache.get(), { totalWords: 7 });
});
