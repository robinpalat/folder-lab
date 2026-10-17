// ============================================================
// PRUEBAS: ETAPA 7 i18n — configuración, comandos y avisos
// ============================================================
// Ejecutar con: npm test
//
// Verifica el RESULTADO resuelto (es/en + interpolaciones) de las
// claves que consume main.ts (Settings, comandos, ribbon, avisos)
// y AIService.testConnection, más contratos: ids técnicos
// intactos y selectores estables.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const buildResult = await esbuild.build({
  entryPoints: [join(root, 'src', 'i18n', 'I18nService.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent'
});

const { i18n } = await import(
  'data:text/javascript;base64,' +
  Buffer.from(buildResult.outputFiles[0].text).toString('base64')
);

function inEnglish(fn) {
  i18n.setLocale('en');
  try {
    return fn();
  } finally {
    i18n.setLocale('es');
  }
}

// ============================================================
// 1. CONFIGURACIÓN (Settings)
// ============================================================

test('settings: cabecera, carpeta maestra y números', () => {
  assert.equal(i18n.t('settings.header.description'), 'Organiza y trabaja con una carpeta de notas como un espacio de trabajo.');
  assert.equal(i18n.t('settings.general.heading'), 'Opciones generales');
  assert.equal(i18n.t('settings.masterFolder.heading'), 'Carpeta maestra');
  assert.equal(i18n.t('settings.masterFolder.empty.name'), 'Sin carpeta maestra');
  assert.equal(i18n.t('settings.showNumbers.name'), 'Mostrar números');

  /*
   * La opción «Usar orden manual» se retiró de la interfaz, pero
   * la clave de AVISO se conserva: es contrato de i18n
   * (es/en en paridad) y cualquier ruta restante que la emita
   * debe seguir resolviendo.
   */
  assert.equal(
    i18n.t('notices.manualOrderToggled', {
      state: i18n.t('notices.manualOrder.enabled')
    }),
    'Orden manual activado'
  );
  assert.equal(
    inEnglish(() =>
      i18n.t('notices.manualOrderToggled', {
        state: i18n.t('notices.manualOrder.disabled')
      })
    ),
    'Manual order disabled'
  );

  // La opción retirada ya no existe en el catálogo: t() devuelve
  // la propia clave como señal visible de ausencia.
  assert.equal(i18n.t('settings.manualOrder.name'), 'settings.manualOrder.name');
});

test('settings: numeración y carpeta maestra con interpolación de ruta', () => {
  assert.equal(i18n.t('settings.numberingStyle.option.roman'), 'Romanos (I, II, III)');
  assert.equal(i18n.t('settings.masterFolder.heading'), 'Carpeta maestra');
  assert.equal(i18n.t('settings.masterFolder.placeholder'), 'Ej: Libro/');
  assert.equal(i18n.t('settings.masterFolder.selectButton'), 'Seleccionar carpeta');
  assert.equal(
    i18n.t('settings.masterFolder.configuredNotice', { path: 'Libros/MiLibro' }),
    '✅ Carpeta maestra configurada: Libros/MiLibro'
  );
  assert.equal(
    i18n.t('settings.masterFolder.currentFolderInfo', { path: 'Libros/MiLibro' }),
    'Ubicación activa: Libros/MiLibro'
  );

  assert.equal(
    inEnglish(() => i18n.t('settings.masterFolder.currentFolderInfo', { path: 'Books/Main' })),
    'Active location: Books/Main'
  );

  // El literal retirado «Carpeta raíz del libro» ya no existe.
  assert.equal(i18n.t('settings.bookRoot.heading'), 'settings.bookRoot.heading');
});

test('settings: navegación con interpolación anidada del tipo', () => {
  assert.equal(i18n.t('settings.navigation.type.option.folders'), 'Carpetas y archivos');
  assert.equal(
    i18n.t('notices.navTypeChanged', {
      typeName: i18n.t('settings.navigation.type.option.properties')
    }),
    'Navegación cambiada a: Propiedades de las notas'
  );
  assert.equal(
    inEnglish(() =>
      i18n.t('notices.navTypeChanged', {
        typeName: i18n.t('settings.navigation.type.option.folders')
      })
    ),
    'Navigation changed to: Folders and files'
  );
});

test('settings: preset, propiedades e ignoradas', () => {
  assert.equal(i18n.t('settings.properties.preset.option.jekyll'), 'Jekyll / Just the Docs');
  assert.equal(i18n.t('settings.properties.preset.appliedNotice'), 'Preset Jekyll aplicado');
  assert.equal(i18n.t('settings.properties.title.name'), 'Propiedad de título');
  assert.equal(i18n.t('settings.properties.hasChildren.desc'), 'Nombre de la propiedad que indica si tiene hijos');
  assert.ok(i18n.t('settings.ignoredFolders.desc').includes('"assets"'));
  assert.equal(
    i18n.t('errors.ignoredFoldersApplyFailed'),
    '❌ No se pudo aplicar carpetas ignoradas al orden global'
  );
  assert.equal(i18n.t('settings.refreshNavigation.button'), '🔄 Refrescar');
  assert.equal(i18n.t('notices.navigationUpdated'), '✅ Navegación actualizada');
  assert.equal(i18n.t('errors.viewNotOpenMarked'), '⚠️ Folder Lab no está abierto');

  assert.equal(inEnglish(() => i18n.t('notices.navigationUpdated')), '✅ Navigation updated');
});

// ============================================================
// 2. IA (configuración y conexión)
// ============================================================

test('settings.ai: sección completa y estados del botón de prueba', () => {
  assert.equal(i18n.t('settings.ai.heading'), 'Inteligencia artificial');
  assert.equal(i18n.t('settings.ai.apiKey.placeholder'), 'Introduce tu API Key');
  assert.equal(i18n.t('settings.ai.customModel.placeholder'), 'Nombre del modelo');
  assert.equal(i18n.t('settings.ai.testConnection.button'), 'Probar');
  assert.equal(i18n.t('settings.ai.testConnection.testing'), 'Probando...');
  assert.equal(i18n.t('settings.ai.testConnection.connected'), 'Conectado');
  assert.equal(i18n.t('settings.ai.testConnection.error'), 'Error');
  assert.equal(i18n.t('errors.ai.notInitialized'), '❌ Servicio de IA no inicializado');
  assert.equal(i18n.t('settings.ai.help.heading'), 'Obtener una API Key');
  assert.equal(i18n.t('settings.ai.help.current'), '(actual)');
  assert.equal(
    i18n.t('settings.ai.help.openKeys', { provider: 'OpenAI' }),
    'Obtener API key en la plataforma oficial de OpenAI'
  );

  assert.equal(inEnglish(() => i18n.t('settings.ai.testConnection.testing')), 'Testing...');
  assert.equal(inEnglish(() => i18n.t('settings.ai.testConnection.connected')), 'Connected');
});

test('ai.connection: mensajes de testConnection/chat en ambos idiomas', () => {
  assert.equal(i18n.t('ai.connection.apiKeyNotConfigured'), 'API Key no configurada');
  assert.equal(
    i18n.t('ai.connection.connected', { name: 'OpenAI', model: 'gpt-4o-mini' }),
    'OpenAI conectado correctamente\nModelo: gpt-4o-mini'
  );
  assert.equal(i18n.t('ai.connection.failed'), 'Error de conexión. Verifica tu API Key');
  assert.equal(i18n.t('common.unknownError'), 'Error desconocido');

  assert.equal(inEnglish(() => i18n.t('ai.connection.apiKeyNotConfigured')), 'API key not configured');
  assert.equal(
    inEnglish(() => i18n.t('ai.connection.connected', { name: 'OpenAI', model: 'gpt-4o-mini' })),
    'OpenAI connected successfully\nModel: gpt-4o-mini'
  );
  assert.equal(inEnglish(() => i18n.t('ai.connection.failed')), 'Connection error. Check your API key');
});

// ============================================================
// 3. COMANDOS Y AVISOS
// ============================================================

test('comandos: names es/en (ids intactos, verificados por fuente)', () => {
  assert.equal(i18n.t('commands.openFolderLab'), 'Abrir panel de Folder Lab');
  assert.equal(i18n.t('commands.refreshView'), 'Refrescar vista');
  assert.equal(i18n.t('commands.toggleFocusMode'), 'Alternar modo Focus');
  assert.equal(i18n.t('commands.testContextResolver'), 'Probar ContextResolver (nota actual)');

  assert.equal(inEnglish(() => i18n.t('commands.openFolderLab')), 'Open Folder Lab panel');
  assert.equal(inEnglish(() => i18n.t('commands.toggleFocusMode')), 'Toggle Focus mode');
});

test('avisos: ribbon, init, contexto y menú de carpetas', () => {
  assert.equal(i18n.t('common.appName'), 'Folder Lab');
  assert.equal(i18n.t('errors.initProject'), '❌ Error al inicializar el proyecto');
  assert.equal(i18n.t('errors.openSidePanel'), '❌ No se pudo abrir el panel lateral');
  assert.equal(i18n.t('errors.loadView'), 'No se pudo cargar Folder Lab');
  assert.equal(i18n.t('notices.viewRefreshed'), 'Folder Lab actualizado');
  assert.equal(i18n.t('notices.noActiveNoteMarked'), '❌ No hay nota activa');
  assert.equal(
    i18n.t('notices.contextTestResult', { name: 'nota.md', length: 1234 }),
    '✅ Contexto: nota.md (1234 caracteres)'
  );
  assert.equal(i18n.t('folders.contextMenu.openInFolderLab'), 'Abrir en Folder Lab');

  assert.equal(
    inEnglish(() => i18n.t('notices.contextTestResult', { name: 'note.md', length: 10 })),
    '✅ Context: note.md (10 characters)'
  );
});

test('settings.info: sección retirada del catálogo (claves ausentes)', () => {
  // La sección «Información» se retiró del panel; sus claves ya no
  // existen y t() devuelve la propia clave como señal de ausencia.
  assert.equal(i18n.t('settings.info.orderStorage'), 'settings.info.orderStorage');
  assert.equal(i18n.t('settings.info.emptyNotes'), 'settings.info.emptyNotes');
  assert.equal(i18n.t('settings.info.wordCountExclusions'), 'settings.info.wordCountExclusions');
});

// ============================================================
// 4. CONTRATOS (fuente)
// ============================================================

test('main.ts: ids de comandos y valores de proveedor intactos', () => {
  const source = readFileSync(join(root, 'src', 'main.ts'), 'utf8');

  assert.ok(source.includes("id: 'open-folder-lab'"));
  assert.ok(source.includes("id: 'refresh-folder-lab'"));
  assert.ok(source.includes("id: 'toggle-focus-mode'"));
  assert.ok(source.includes("id: 'test-context-resolver'"));
  // Proveedor: valores persistidos sin traducir.
  assert.ok(source.includes(".addOption('openai', 'OpenAI')"));
  assert.ok(source.includes(".addOption('gemini', 'Google Gemini')"));
  assert.ok(source.includes(".addOption('anthropic', 'Anthropic Claude')"));
  // Claves de configuración intactas.
  assert.ok(source.includes("navigationPropertyMapping.title = value || 'title'"));
});

test('main.ts: selector por placeholder sustituido por referencia estable', () => {
  const source = readFileSync(join(root, 'src', 'main.ts'), 'utf8');

  assert.ok(!source.includes('querySelector(\'input[placeholder="Ej: Libro/"]\')'));
  assert.ok(source.includes('let rootPathInput'));
  assert.ok(source.includes('rootPathInput = text.inputEl'));
  assert.ok(source.includes('if (rootPathInput) rootPathInput.value = selected'));
});

test('AIService: mensajes visibles localizados; datos técnicos intactos', () => {
  const source = readFileSync(join(root, 'src', 'ai', 'AIService.ts'), 'utf8');

  assert.ok(source.includes("i18n.t('ai.connection.apiKeyNotConfigured')"));
  assert.ok(source.includes("i18n.t('ai.connection.connected'"));
  assert.ok(source.includes("i18n.t('ai.connection.failed')"));
  // Sin cadenas visibles en español directas.
  assert.ok(!source.includes('"API Key no configurada"'));
  assert.ok(!source.includes('"Error de conexión'));
  // Los mensajes técnicos del proveedor (error.message) se
  // interpolan tal cual.
  assert.ok(source.includes('error.message'));
});
