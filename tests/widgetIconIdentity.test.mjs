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
  constructor() {
    if (!globalThis.__folderLabMenus) globalThis.__folderLabMenus = [];
    this.__items = [];
    globalThis.__folderLabMenus.push(this);
  }
  addItem(cb) {
    const it = new MenuItem();
    this.__items.push(it);
    cb(it);
    return this;
  }
  addSeparator() { return this; }
  showAtPosition() { globalThis.__folderLabLastMenu = this; }
  onHide() {}
  hide() {}
}
export class MenuItem {
  constructor() { this.title = ''; this.icon = undefined; this.disabled = false; }
  setTitle(t) { this.title = String(t); return this; }
  setIcon(i) { this.icon = i; return this; }
  onClick(fn) { this.onClickFn = fn; return this; }
  setChecked() { return this; }
  setDisabled(d) { this.disabled = !!d; return this; }
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
export function setIcon(el, name) {
  (globalThis.__folderLabIconCalls ??= []).push({ el, name });
}
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

// ------------------------------------------------------------
// 5. MENÚ DEL SELECTOR: POST-PROCESADO (causa raíz #2)
// ------------------------------------------------------------

test('estructural: showWidgetMenu no asocia available[index] a items del DOM', () => {
  const source = read('src/focus/FocusPane.ts');

  // La asociación residual por índice de la colección de
  // instancias era la causa que pisaba «plus» con cpu y
  // cruzaba los iconos de Asistente/Colecciones.
  assert.ok(
    !source.includes('available[index]'),
    'sin mapeo residual available[index]'
  );

  // El post-procesado usa el mapeo 1:1 por orden de creación.
  assert.ok(source.includes('itemVisuals'));
  assert.ok(source.includes('items.length !== itemVisuals.length'));
});

test('funcional: el menú conserva los iconos construidos (plus, cpu, layers) con cabeceras intercaladas', async () => {
  const mod = await bundleWidget('src/focus/FocusPane.ts');
  const FocusPane = mod.FocusPane;
  assert.ok(FocusPane, 'FocusPane exportado');

  // Instancias en un orden HOSTIL respecto de los items del
  // menú: Colecciones primero, pero el menú reordena (bloque
  // fijo antes; Tarjetas al final). Con el mapeo residual
  // antiguo, «Agregar widget…» recibía layers y Asistente el
  // icono de otra instancia.
  const instances = [
    { instanceId: 'collections-1', typeId: 'collections', name: 'Mis Colecciones' },
    { instanceId: 'memory-1', typeId: 'memory', name: 'Asistente' },
    { instanceId: 'notes-1', typeId: 'notes', name: 'Apuntes' }
  ];

  const defs = {
    collections: { identity: { icon: 'layers', color: '#3355aa' }, category: 'card' },
    memory: { identity: { icon: 'cpu' } },
    notes: { identity: { icon: 'pencil' } }
  };

  const widgetManager = {
    getInstances: () => instances.map((i) => ({ ...i })),
    getDefinition: (id) => defs[id]
  };

  const fakeBtn = {
    getBoundingClientRect: () => ({
      left: 10, bottom: 20, top: 10, width: 100, height: 10
    })
  };
  const container = { querySelector: () => fakeBtn };

  // DOM falso del menú: 5 items = [Agregar, Apuntes, Asistente,
  // Tarjetas (cabecera, sin icono), Mis Colecciones].
  const makeIconEl = () => ({
    classes: new Set(),
    attrs: {},
    style: { setProperty() {}, removeProperty() {} },
    addClass(c) { this.classes.add(c); },
    removeClass(c) { this.classes.delete(c); },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; }
  });

  const domItems = [0, 1, 2, 3, 4].map(() => {
    const iconEl = makeIconEl();
    return {
      iconEl,
      querySelector: (sel) => (sel === '.menu-item-icon' ? iconEl : null)
    };
  });
  // La cabecera «Tarjetas» no tiene icono en el DOM.
  domItems[3].querySelector = () => null;

  globalThis.document = {
    querySelectorAll: (sel) => ({
      length: 1,
      item: () => ({ querySelectorAll: () => domItems })
    })
  };
  // showWidgetMenu usa window.setTimeout (runtime Obsidian).
  globalThis.window = {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args)
  };
  globalThis.__folderLabIconCalls = [];

  const pane = new FocusPane(
    container, 'top', 'notes-1',
    {}, widgetManager, {}, {}, {}, undefined
  );

  // this.element solo se asigna en render(); para el test basta
  // con apuntar al contenedor fake (campo accesible en el bundle).
  pane.element = container;

  pane.showWidgetMenu();
  await new Promise((resolve) => setTimeout(resolve, 20));

  const built = globalThis.__folderLabLastMenu.__items;

  // Orden exacto del menú construido (es locale por defecto).
  assert.deepEqual(
    built.map((i) => i.title),
    ['Agregar widget…', 'Apuntes', 'Asistente', 'Tarjetas', 'Mis Colecciones']
  );

  // Iconos registrados EN CONSTRUCCIÓN.
  assert.equal(built[0].icon, 'plus', 'Agregar widget… construido con plus');
  assert.equal(built[1].icon, 'pencil');
  assert.equal(built[2].icon, 'cpu', 'Asistente construido con cpu');
  assert.equal(built[4].icon, 'layers', 'Colecciones construido con layers');

  // Post-procesado (color): solo los items con identidad de
  // instancia reciben setIcon; nunca la acción ni las cabeceras.
  const calls = globalThis.__folderLabIconCalls;
  const callFor = (iconEl) =>
    calls.filter((c) => c.el === iconEl).map((c) => c.name);

  // «Agregar widget…»: sin reaplicación (conserva plus).
  assert.deepEqual(callFor(domItems[0].iconEl), []);
  // Cabecera Tarjetas: sin iconEl y sin reaplicación.
  assert.deepEqual(callFor(domItems[3].iconEl ?? null), []);
  // Apuntes / Asistente / Colecciones: icono de SU tipo.
  assert.deepEqual(callFor(domItems[1].iconEl), ['pencil']);
  assert.deepEqual(callFor(domItems[2].iconEl), ['cpu']);
  assert.deepEqual(callFor(domItems[4].iconEl), ['layers']);

  delete globalThis.document;
  delete globalThis.window;
});
