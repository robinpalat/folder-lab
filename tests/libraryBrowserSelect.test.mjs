// ============================================================
// PRUEBAS: LibraryBrowser — administrador de widgets puro
// ============================================================
// Ejecutar con: npm test
//
// La biblioteca de capacidades vive ahora en
// src/ai/capabilities/browser.ts (CapabilityBrowser).
// LibraryBrowser es exclusivamente el administrador de widgets.
//
// Contrato verificado:
// - LibraryBrowser NO contiene lógica de capacidades.
// - No tiene pestañas (es un modal dedicado a widgets).
// - No importa CapabilityRegistry ni capabilityTexts.
// - No exporta CapabilitySelection.
// - FocusPane abre LibraryBrowser sin initialTab ni onSelect.
// - MemoryWidget abre CapabilityBrowser para open-capabilities.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('LibraryBrowser no contiene lógica de capacidades', () => {
  const source = read('src/focus/LibraryBrowser.ts');
  assert.ok(!source.includes('CapabilityRegistry'), 'sin CapabilityRegistry');
  assert.ok(!source.includes('capabilityTexts'), 'sin capabilityTexts');
  assert.ok(!source.includes('CapabilitySelection'), 'sin CapabilitySelection');
  assert.ok(!source.includes('renderCapabilities'), 'sin renderCapabilities');
  assert.ok(!source.includes('selectedCapabilityId'), 'sin selectedCapabilityId');
  assert.ok(!source.includes("BrowserTab"), 'sin BrowserTab');
  assert.ok(!source.includes("selectTab"), 'sin selectTab');
});

test('LibraryBrowser no tiene pestañas', () => {
  const source = read('src/focus/LibraryBrowser.ts');
  assert.ok(!source.includes('fl-capability-browser-tabs'), 'sin tabs container');
  assert.ok(!source.includes('fl-capability-browser-tab"'), 'sin tab items');
  assert.ok(!source.includes("assistantTab"), 'sin assistantTab');
  assert.ok(!source.includes("recipesTab"), 'sin recipesTab');
});

test('LibraryBrowser es un modal dedicado a widgets', () => {
  const source = read('src/focus/LibraryBrowser.ts');
  assert.ok(source.includes('extends Modal'), 'es un Modal');
  assert.ok(source.includes('renderWidgetsContent'), 'tiene renderWidgetsContent');
  assert.ok(source.includes('applyWidgetChanges'), 'tiene applyWidgetChanges');
  assert.ok(source.includes('widgetManager'), 'depende de WidgetManager');
});

test('FocusPane abre LibraryBrowser sin initialTab ni onSelect', () => {
  const source = read('src/focus/FocusPane.ts');
  assert.ok(source.includes('new LibraryBrowser('), 'abre LibraryBrowser');
  assert.ok(!source.includes("'widgets'"), 'sin initialTab');
  assert.ok(!source.includes('capabilityRegistry.*LibraryBrowser'), 'sin capabilityRegistry para LibraryBrowser');
  // El constructor solo recibe app, registry, widgetManager.
  assert.ok(source.includes('this.app,\n            this.registry,\n            this.widgetManager'), 'constructor de 3 args');
});

test('MemoryWidget abre CapabilityBrowser para open-capabilities', () => {
  const source = read('src/focus/widgets/MemoryWidget.ts');
  assert.ok(source.includes('new CapabilityBrowser('), 'abre CapabilityBrowser');
  assert.ok(!source.includes('new LibraryBrowser('), 'NO abre LibraryBrowser');
  assert.ok(source.includes("import { CapabilityBrowser }"), 'importa CapabilityBrowser');
  assert.ok(!source.includes("import { LibraryBrowser }"), 'NO importa LibraryBrowser');
});
