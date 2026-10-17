// ============================================================
// PRUEBAS: Identidad visual canónica de los widgets imperativos
// ============================================================
// Ejecutar con: npm test
//
// Causa original que detecta este contrato: los 4 widgets
// imperativos (notes, memory, active-note, resources) mantenían
// `readonly icon` DUPLICADO respecto del registro en main.ts, y
// el toolbar (controls.setWidget({icon: this.icon})) consumía esa
// propiedad en lugar de la definición canónica — iconos
// divergentes entre menú y toolbar.
//
// Contrato verificado:
// - Las 4 clases NO declaran `readonly icon` (sin duplicación).
// - `setInstanceIdentity` inyecta la identidad visual canónica y
//   `get icon` la devuelve (el toolbar sigue obteniendo el icono
//   tras eliminar la propiedad redundante).
// - Sin inyección, `icon` es '' (sin valor propio residual).
// - FocusPane inyecta la identidad desde la DEFINICIÓN registrada
//   (misma fuente que usa el menú del selector).
// - Coherencia de los 11 ids reales: iconos únicos por tipo.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const definitions = JSON.parse(read('src/focus/widget-definitions.json'));

// ------------------------------------------------------------
// BUNDLE de las 4 clases con stub amplio de obsidian
// ------------------------------------------------------------

const OBSIDIAN_STUB = `
export class App {}
export class TFile {}
export class TFolder {}
export class Plugin {}
export class Modal {
  constructor() { this.contentEl = { empty() {}, createDiv() { return this.contentEl; }, createEl() { return this.contentEl; } }; }
  open() {}
  close() {}
}
export class Setting {
  constructor() {}
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addButton() { return this; }
  addDropdown() { return this; }
  addExtraButton() { return this; }
  addTextArea() { return this; }
  setHeading() { return this; }
  setDisabled() { return this; }
}
export class Component {
  load() {}
  unload() {}
  register() {}
  registerEvent() {}
  registerInterval(v) { return v; }
}
export class MarkdownRenderer {
  static async render() {}
}
export class Menu {
  addItem() { return this; }
  addSeparator() { return this; }
  showAtPosition() {}
  onHide() {}
  hide() {}
}
export class MenuItem {
  setTitle() { return this; }
  setIcon() { return this; }
  onClick() { return this; }
  setChecked() { return this; }
  setDisabled() { return this; }
}
export class Notice {}
export class FileSystemAdapter {
  getBasePath() { return '/stub'; }
}
export class ButtonComponent {}
export class TextComponent {}
export class DropdownComponent {}
export class ToggleComponent {}
export class TextAreaComponent {}
export class FuzzySuggestModal extends Modal {}
export class PluginSettingTab {}
export class EventRef {}
export function setIcon() {}
export function debounce(fn) { return fn; }
export function normalizePath(p) { return p; }
export const Platform = { isDesktop: true, isMobile: false };
export const requestUrl = async () => ({});
export default {};
`;

async function bundleWidget(entryRel) {
  const result = await build({
    entryPoints: [join(root, entryRel)],
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

const cases = [
  {
    entry: 'src/focus/widgets/NotesWidget.ts',
    exportName: 'NotesWidget',
    id: 'notes',
    file: 'src/focus/widgets/NotesWidget.ts'
  },
  {
    entry: 'src/focus/widgets/MemoryWidget.ts',
    exportName: 'MemoryWidget',
    id: 'memory',
    file: 'src/focus/widgets/MemoryWidget.ts'
  },
  {
    entry: 'src/focus/widgets/ActiveNoteWidget.ts',
    exportName: 'ActiveNoteWidget',
    id: 'active-note',
    file: 'src/focus/widgets/ActiveNoteWidget.ts'
  },
  {
    entry: 'src/focus/widgets/ResourcesWidget.ts',
    exportName: 'ResourcesWidget',
    id: 'resources',
    file: 'src/focus/widgets/ResourcesWidget.ts'
  }
];

// ------------------------------------------------------------
// 1. SIN PROPIEDAD REDUNDANTE (eliminación de la duplicación)
// ------------------------------------------------------------

test('sin duplicación: ninguna clase imperativa declara readonly icon', () => {
  for (const { file } of cases) {
    const source = read(file);
    assert.ok(
      !source.includes('readonly icon'),
      `${file} aún declara readonly icon`
    );
  }
});

// ------------------------------------------------------------
// 2. FUNCIONAL: el toolbar obtiene el icono canónico inyectado
// ------------------------------------------------------------

test('identidad inyectada: get icon devuelve el icono canónico de la definición', async () => {
  for (const { entry, exportName, id } of cases) {
    const mod = await bundleWidget(entry);
    const WidgetClass = mod[exportName];
    assert.ok(WidgetClass, `${exportName} exportado`);

    const widget = new WidgetClass({});

    // Sin inyección: sin valor propio (la duplicación se
    // eliminó; no queda ningún icono hardcodeado residual).
    assert.equal(widget.icon, '', `${id}: sin valor residual`);

    // FocusPane inyecta la identidad de la DEFINICIÓN registrada.
    widget.setInstanceIdentity(`${id}-1`, 'Instancia', {
      icon: 'icono-canónico-de-prueba',
      color: '#123456'
    });

    assert.equal(
      widget.icon,
      'icono-canónico-de-prueba',
      `${id}: el toolbar obtiene el icono inyectado`
    );
  }
});

// ------------------------------------------------------------
// 3. FOCUSPANE INYECTA DESDE LA DEFINICIÓN (fuente única)
// ------------------------------------------------------------

test('FocusPane: inyecta la identidad visual desde getDefinition', () => {
  const source = read('src/focus/FocusPane.ts');

  assert.ok(
    source.includes('this.widgetManager.getDefinition('),
    'resuelve la definición del tipo'
  );
  assert.ok(
    source.includes('icon: definitionIdentity?.icon'),
    'pasa el icono de la definición'
  );
  assert.ok(
    source.includes('color: definitionIdentity?.color'),
    'pasa el color de la definición'
  );
});

// ------------------------------------------------------------
// 4. COHERENCIA DE LOS 11 IDS REALES
// ------------------------------------------------------------

test('coherencia: 11 ids reales con iconos de tipo únicos (sin divergencia)', () => {
  const mainSource = read('src/main.ts');

  // Registros imperativos en main.ts: id → icono.
  const imperative = {
    'active-note': 'file-text',
    notes: 'pencil',
    resources: 'folder',
    memory: 'cpu'
  };

  for (const [id, icon] of Object.entries(imperative)) {
    const idx = mainSource.indexOf(`id: '${id}'`);
    assert.ok(idx > -1, `${id} registrado en main.ts`);
    const slice = mainSource.slice(idx, idx + 400);
    assert.ok(slice.includes(`icon: '${icon}'`), `${id}: ${icon}`);
  }

  // Declarativos: identity.icon del JSON.
  const declarative = {
    snips: 'scissors',
    collections: 'layers',
    restrictions: 'shield',
    candidates: 'user-check',
    tasks: 'list-checks',
    issues: 'alert-triangle',
    objectives: 'target'
  };

  for (const [id, icon] of Object.entries(declarative)) {
    assert.equal(definitions.widgets[id].identity.icon, icon, id);
  }

  // Los 11 iconos son únicos: ningún tipo hereda el icono de otro.
  const allIcons = [
    ...Object.values(imperative),
    ...Object.values(declarative)
  ];
  assert.equal(new Set(allIcons).size, allIcons.length, 'iconos únicos');
});
