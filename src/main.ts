// ============================================================
// 1. IMPORTS
// ============================================================
import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  TFile,
  TFolder,
  Modal,
  setIcon,
  Menu
} from 'obsidian';

import { VIEW_TYPE_FOLDER_ORDER } from './constants/view-types';
import { FolderLabView } from './views/FolderLabView';
import { FolderRepository } from './storage/FolderRepository';
import { FolderOrderSettings, DEFAULT_SETTINGS, DEFAULT_JEKYLL_MAPPING, NavigationPropertyMapping } from './config/settings';

import { FocusWorkspace } from "./focus/FocusWorkspace";
import { FocusWidgetRegistry } from "./focus/FocusWidgetRegistry";
import { ActiveNoteWidgetFactory } from "./focus/widgets/ActiveNoteWidget";
import { NotesWidgetFactory } from "./focus/widgets/NotesWidget";
import { ResourcesWidgetFactory } from "./focus/widgets/ResourcesWidget";
import { MemoryWidgetFactory } from "./focus/widgets/MemoryWidget";
import { createCapabilityRegistry, CapabilityRegistry } from './ai/capabilities';
import { AIService } from './ai/AIService';

import { WidgetManager } from "./focus/WidgetManager";
import { NoteRepository } from './storage/NoteRepository';
import { BoardRepository } from './storage/BoardRepository';
import { PluginDataStore } from './storage/PluginDataStore';
import type { WidgetDefinition } from './focus/WidgetDefinition';
declare const require: (modulePath: string) => unknown;
const definitions = require('./focus/widget-definitions.json')
import { WidgetController } from './focus/controllers/WidgetController';
import type { UserRequest } from './ai/types';

import {
  DeclarativeRuntime
} from './focus/DeclarativeRuntime';

import {
  BoardView,
  BOARD_VIEW_TYPE
} from './focus/BoardView';

const GLOBAL_SNIPS_INSTANCE = 'global';

// ============================================================
// 2. MODAL: FolderSelectModal
// ============================================================
class FolderSelectModal extends Modal {
  private folders: string[];
  private onSelect: (selected: string) => void;

  constructor(app: App, folders: string[], onSelect: (selected: string) => void) {
    super(app);
    this.folders = folders;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('folder-select-modal');

    contentEl.createEl('h3', { text: 'Seleccionar carpeta raíz del libro' });

    const p = contentEl.createEl('p', { text: 'Elige la carpeta principal que contiene todo el libro.' });
    p.style.cssText = 'color: var(--text-muted); font-size: 0.85em; margin-bottom: 12px;';

    if (this.folders.length === 0) {
      contentEl.createEl('p', { text: 'No hay carpetas en la raíz del vault' });
      return;
    }

    const list = contentEl.createEl('div', { cls: 'folder-select-list' });
    list.style.maxHeight = '300px';
    list.style.overflow = 'auto';

    for (const folder of this.folders) {
      const item = list.createEl('div', { cls: 'folder-select-item' });
      item.style.padding = '8px 12px';
      item.style.cursor = 'pointer';
      item.style.borderBottom = '1px solid var(--background-modifier-border)';
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.gap = '8px';
      item.style.transition = 'background 0.15s';

      const icon = item.createEl('span');
      setIcon(icon, 'folder');

      item.createEl('span', { text: folder });

      item.onclick = () => {
        this.close();
        this.onSelect(folder);
      };

      item.onmouseenter = () => {
        item.style.background = 'var(--background-modifier-hover)';
      };
      item.onmouseleave = () => {
        item.style.background = 'transparent';
      };
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// ============================================================
// 3. CLASE PRINCIPAL: FolderLabPlugin
// ============================================================
export default class FolderLabPlugin extends Plugin {
  settings: FolderOrderSettings;
  repository: FolderRepository;
  aiService: AIService | null = null;
  capabilityRegistry: CapabilityRegistry | null = null;

  private viewInstance: FolderLabView | null = null;
  private widgetRegistry: FocusWidgetRegistry | null = null;
  private widgetManager: WidgetManager | null = null;
  private widgetController: WidgetController;
  private boardRepository: BoardRepository | null = null;
  private dataStore: PluginDataStore | null = null;


  async onload() {
    await this.loadSettings();

    // ============================================================
    // Inicializar AIService
    // ============================================================
    this.aiService = new AIService({
      provider: this.settings.aiProvider || "openai",
      apiKey: this.settings.aiApiKey || "",
      model: this.settings.aiModel || "",
      useRecommendedModel: this.settings.aiUseRecommendedModel ?? true,
      temperature: this.settings.aiTemperature ?? 0.3,
      maxTokens: this.settings.aiMaxTokens ?? 500
    });

    // ============================================================
    // Inicializar CapabilityRegistry
    // ============================================================
    this.capabilityRegistry = createCapabilityRegistry();

    // ============================================================
    // CREAR REPOSITORY
    // ============================================================
    this.repository = new FolderRepository(this.app);

    // ============================================================
    // INICIALIZAR REGISTRO DE WIDGETS (UNA SOLA VEZ)
    // ============================================================

    /*
     * Pipeline único y serializado de escritura sobre data.json:
     * lo comparten los widgets (WidgetController) y los ajustes.
     * Evita que saveData reescrituras completas se pisen entre sí.
     */
    this.dataStore = new PluginDataStore(this);

    this.widgetController =
      new WidgetController(this, this.dataStore);

    this.widgetRegistry =
      new FocusWidgetRegistry(
        this.widgetController,
        this.app
      );

    const declarativeData =
      (definitions as any).default ?? definitions;

    const declarativeRuntime =
      DeclarativeRuntime.fromData(
        declarativeData
      );

    const declarativeDefinitions =
      declarativeRuntime.getDefinitions();

    for (const definition of declarativeDefinitions) {
      this.widgetRegistry.registerDeclarative(
        definition
      );
    }

    this.widgetRegistry.register(
      new ActiveNoteWidgetFactory(this.app),
      {
        id: 'active-note',

        identity: {
          label: 'Nota activa',
          icon: 'file-text',
          description:
            'Muestra y permite trabajar directamente con la nota actualmente activa en Obsidian.'
        },

        cardinality: 'singleton'
      }
    );


    this.widgetRegistry.register(
      new NotesWidgetFactory(this.app),
      {
        id: 'notes',

        identity: {
          label: 'Apuntes',
          icon: 'pencil',
          description:
            'Captura y organiza apuntes espontáneos asociados al contexto. Es un punto de entrada para alimentar otros widgets con ideas, textos y observaciones.'
        },

        cardinality: 'singleton'
      }
    );


    this.widgetRegistry.register(
      new ResourcesWidgetFactory(this.app),
      {
        id: 'resources',

        identity: {
          label: 'Archivos compartidos de la carpeta',
          icon: 'folder',
          description:
            'Muestra los archivos y recursos compartidos por las notas de la carpeta actual.'
        },

        cardinality: 'singleton'
      }
    );



    // ============================================================
    // INICIALIZAR GESTOR DE INSTANCIAS
    // ============================================================

    const noteRepository =
      new NoteRepository(this.app);

    this.boardRepository =
      new BoardRepository(this.app);

    this.widgetManager =
      new WidgetManager(
        this.widgetRegistry!,
        noteRepository
      );

    // ============================================================
    // REGISTRAR VISTA
    // ============================================================

    this.widgetRegistry.register(
      new MemoryWidgetFactory(
        this.app,
        this.aiService!,
        this.capabilityRegistry!,
        this.widgetController,
        this.widgetManager!
      ),
      {
        id: 'memory',

        identity: {
          label: 'Asistente',
          icon: 'cpu',
          description:
            'Utiliza inteligencia artificial para analizar el contexto de la nota y ejecutar capacidades sobre sus fuentes y contenidos.'
        },

        cardinality: 'singleton'
      }
    );

    this.registerView(
      VIEW_TYPE_FOLDER_ORDER,
      (leaf) => {
        const view = new FolderLabView(
          leaf,
          this,
          this.repository,
          this.widgetRegistry!,
          this.widgetManager!,
        );
        this.viewInstance = view;
        return view;
      }
    );

    this.registerView(
      BOARD_VIEW_TYPE,
      (leaf) => new BoardView(leaf, {
        widgetManager: this.widgetManager!,
        repository: this.boardRepository!,
        controller: this.widgetController
      })
    );

    // ============================================================
    // COMANDOS
    // ============================================================
    this.addCommand({
      id: 'open-folder-lab',
      name: 'Abrir panel de Folder Lab',
      callback: () => this.openFolderLabView()
    });

    this.addCommand({
      id: 'refresh-folder-lab',
      name: 'Refrescar vista',
      callback: () => this.refreshView()
    });

    this.addCommand({
      id: 'toggle-focus-mode',
      name: 'Alternar modo Focus',
      callback: () => this.toggleFocusMode()
    });

    this.addCommand({
      id: 'test-context-resolver',
      name: 'Probar ContextResolver (nota actual)',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('❌ No hay nota activa');
          return;
        }

        const content = await this.app.vault.read(activeFile);
        const { ContextResolver } = await import('./ai/context/ContextResolver');
        const resolver =
          new ContextResolver(
            this.app,
            this,
            this.widgetController,
            this.widgetManager!
          );

        const context = await resolver.resolveAll({
          note: activeFile,
          content: content,
          settings: {
            temperature: this.settings.aiTemperature || 0.3,
            maxTokens: this.settings.aiMaxTokens || 500
          }
        });

        new Notice(`✅ Contexto: ${context.workspace.note.name} (${context.workspace.note.content.length} caracteres)`);
      }
    });



    // ============================================================
    // RIBBON ICON
    // ============================================================
    this.addRibbonIcon('folder', 'Folder Lab', () => {
      this.openFolderLabView();
    });

    // ============================================================
    // SETTINGS TAB
    // ============================================================
    this.addSettingTab(new FolderLabSettingTab(this.app, this));

    // ============================================================
    // FILE MENU (carpetas)
    // ============================================================
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle('Abrir en Folder Lab')
              .setIcon('folder-sync')
              .onClick(() => {
                this.openFolderLabForFolder(file);
              });
          });
        }
      })
    );
  }

  // ============================================================
  // MÉTODOS DE CONFIGURACIÓN
  // ============================================================

  async setBookRootPath(path: string): Promise<void> {
    this.settings.bookRootPath = path;
    await this.saveSettings();

    if (path) {
      try {
        await this.repository.initGlobalOrder(path);
        console.log('📂 Proyecto inicializado en:', path);
      } catch (error) {
        console.error('❌ Error al inicializar proyecto:', error);
        new Notice('❌ Error al inicializar el proyecto');
      }
    }
  }

  // ============================================================
  // MÉTODOS DE VISTA
  // ============================================================

  getView(): FolderLabView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDER_ORDER);
    if (leaves.length === 0) return null;
    return leaves[0].view as FolderLabView;
  }

  private getViewInstance(): FolderLabView | null {
    if (this.viewInstance && !this.viewInstance.isDisposed) {
      return this.viewInstance;
    }

    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDER_ORDER);
    if (leaves.length === 0) {
      this.viewInstance = null;
      return null;
    }

    const view = leaves[0].view;
    if (view instanceof FolderLabView) {
      this.viewInstance = view;
      return view;
    }

    this.viewInstance = null;
    return null;
  }

  async openFolderLabView() {
    const existing = this.getViewInstance();
    if (existing) {
      this.app.workspace.revealLeaf(
        this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDER_ORDER)[0]
      );
      return;
    }

    const leaf = this.app.workspace.getLeftLeaf(false);
    if (!leaf) {
      new Notice('❌ No se pudo abrir el panel lateral');
      return;
    }

    await leaf.setViewState({
      type: VIEW_TYPE_FOLDER_ORDER,
      active: true,
    });

    this.app.workspace.revealLeaf(leaf);

    const view = leaf.view;
    if (view instanceof FolderLabView) {
      this.viewInstance = view;
    }
  }

  async openFolderLabForFolder(folder: TFolder) {
    await this.openFolderLabView();

    setTimeout(() => {
      const view = this.getViewInstance();
      if (view) {
        view.loadFolderOrder(folder.path);
      } else {
        new Notice('No se pudo cargar Folder Lab');
      }
    }, 150);
  }

  refreshView(): void {
    const view = this.getViewInstance();
    if (view) {
      view.refresh();
      new Notice('Folder Lab actualizado');
    }
  }

  // ============================================================
  // MÉTODO: TOGGLE FOCUS MODE
  // ============================================================
  toggleFocusMode(): void {
    const view = this.getViewInstance();
    if (view) {
      view.toggleFocusMode();
    } else {
      this.openFolderLabView();
      setTimeout(() => {
        const newView = this.getViewInstance();
        if (newView) {
          newView.toggleFocusMode();
        }
      }, 200);
    }
  }

  // ============================================================
  // GETTER: WIDGET REGISTRY
  // ============================================================
  getWidgetRegistry(): FocusWidgetRegistry {
    return this.widgetRegistry!;
  }

  // ============================================================
  // SETTINGS
  // ============================================================

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    /*
     * Solo se escriben las claves PROPIAS de los ajustes (las de
     * DEFAULT_SETTINGS más el estado privado del Asistente).
     * Antes se guardaba el objeto settings completo —que arrastraba
     * una copia obsoleta de las claves de los widgets— y cualquier
     * guardado de ajustes BORRABA los datos de widgets escritos
     * durante la sesión.
     */
    const ownedKeys = [
      ...Object.keys(DEFAULT_SETTINGS),
      "_widgetState"
    ];

    /*
     * Si el store no está inicializado, se FALLA DE FORMA VISIBLE:
     * jamás se cae a una escritura completa de data.json con la
     * copia obsoleta de this.settings (eso borraba los datos de
     * los widgets declarativos).
     */
    if (!this.dataStore) {
      console.error(
        '[FolderLab] PluginDataStore no inicializado: ' +
        'guardado de ajustes cancelado para no sobrescribir datos de widgets.'
      );
      throw new Error(
        '[FolderLab] PluginDataStore no inicializado'
      );
    }

    await this.dataStore.saveOwnedSettings(
      this.settings as unknown as Record<string, any>,
      ownedKeys
    );

    if (this.aiService) {
      this.aiService.updateSettings({
        provider: this.settings.aiProvider || "openai",
        apiKey: this.settings.aiApiKey || "",
        model: this.settings.aiModel || "",
        useRecommendedModel: this.settings.aiUseRecommendedModel ?? true,
        temperature: this.settings.aiTemperature ?? 0.3,
        maxTokens: this.settings.aiMaxTokens ?? 500
      });
    }
  }

  onunload() {
    this.viewInstance = null;
    console.log('Folder Lab plugin descargado');
  }
}

// ============================================================
// 4. PESTAÑA DE CONFIGURACIÓN
// ============================================================
class FolderLabSettingTab extends PluginSettingTab {
  plugin: FolderLabPlugin;

  constructor(app: App, plugin: FolderLabPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();


    console.log('Settings actuales:', {
      navigationType: this.plugin.settings.navigationType,
      navigationPropertyMapping: this.plugin.settings.navigationPropertyMapping
    });

    containerEl.createEl('h2', { text: '📂 Configuración de Folder Lab' });

    // ===== ORDEN MANUAL =====
    new Setting(containerEl)
      .setName('Usar orden manual')
      .setDesc('Activa el orden manual en el explorador de archivos')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useManualOrder)
        .onChange(async (value) => {
          this.plugin.settings.useManualOrder = value;
          await this.plugin.saveSettings();
          this.app.workspace.trigger('layout-change');
          new Notice(`Orden manual ${value ? 'activado' : 'desactivado'}`);
        }));

    // ===== MOSTRAR NÚMEROS =====
    new Setting(containerEl)
      .setName('Mostrar números')
      .setDesc('Muestra números en el índice')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showNumbers)
        .onChange(async (value) => {
          this.plugin.settings.showNumbers = value;
          await this.plugin.saveSettings();
        }));

    // ===== ESTILO DE NUMERACIÓN =====
    new Setting(containerEl)
      .setName('Estilo de numeración')
      .setDesc('Romanos (I, II, III) o arábigos (1, 2, 3)')
      .addDropdown(dropdown => dropdown
        .addOption('roman', 'Romanos (I, II, III)')
        .addOption('arabic', 'Arábigos (1, 2, 3)')
        .addOption('none', 'Sin números')
        .setValue(this.plugin.settings.numberingStyle)
        .onChange(async (value: 'roman' | 'arabic' | 'none') => {
          this.plugin.settings.numberingStyle = value;
          await this.plugin.saveSettings();
        }));

    // ===== CARPETA RAÍZ DEL LIBRO =====
    containerEl.createEl('hr');

    new Setting(containerEl)
      .setName('📚 Carpeta raíz del libro')
      .setHeading();

    const rootSetting = new Setting(containerEl)
      .setName('Carpeta raíz del libro')
      .setDesc('Carpeta principal que contiene todo el libro. Al seleccionarla se inicializará el proyecto.')
      .addText(text => text
        .setPlaceholder('Ej: Libro/')
        .setValue(this.plugin.settings.bookRootPath || '')
        .onChange(async (value) => {
          await this.plugin.setBookRootPath(value);
        }));

    rootSetting.addButton(button => button
      .setButtonText('📁 Seleccionar')
      .onClick(async () => {
        const folders: string[] = [];
        const root = this.app.vault.getRoot();

        for (const child of root.children) {
          if (child instanceof TFolder) {
            folders.push(child.path);
          }
        }

        if (folders.length === 0) {
          new Notice('No hay carpetas en la raíz del vault');
          return;
        }

        const modal = new FolderSelectModal(this.app, folders, async (selected: string) => {
          await this.plugin.setBookRootPath(selected);

          const textInput = containerEl.querySelector('input[placeholder="Ej: Libro/"]') as HTMLInputElement;
          if (textInput) textInput.value = selected;

          new Notice(`✅ Carpeta raíz configurada: ${selected}`);
        });
        modal.open();
      }));

    if (this.plugin.settings.bookRootPath) {
      const info = containerEl.createEl('p', {
        text: `📂 Carpeta actual: ${this.plugin.settings.bookRootPath}`,
        cls: 'folder-lab-info-text'
      });
    }

    // ============================================================
    // SECCIÓN: NAVEGACIÓN
    // ============================================================
    containerEl.createEl('hr');
    containerEl.createEl('h3', { text: '🧭 Navegación' });

    let propertySettingsContainer: HTMLElement | null = null;

    new Setting(containerEl)
      .setName('Tipo de navegación')
      .setDesc('Elige cómo se organiza la navegación en Folder Lab')
      .addDropdown(dropdown => dropdown
        .addOption('folders', 'Carpetas y archivos')
        .addOption('properties', 'Propiedades de las notas')
        .setValue(this.plugin.settings.navigationType || 'folders')
        .onChange(async (value: 'folders' | 'properties') => {
          this.plugin.settings.navigationType = value;
          await this.plugin.saveSettings();

          // Actualizar visibilidad de las opciones de properties
          if (propertySettingsContainer) {
            propertySettingsContainer.style.display = value === 'properties' ? 'block' : 'none';
          }

          // Una sola declaración de view
          const view = this.plugin.getView();
          if (view && view.refreshNavigation) {
            await view.refreshNavigation();
          }

          new Notice(`Navegación cambiada a: ${value === 'folders' ? 'Carpetas y archivos' : 'Propiedades de las notas'}`);
        })
      );
    // ============================================================
    // CONFIGURACIÓN DE PROPIEDADES
    // ============================================================
    propertySettingsContainer = containerEl.createEl('div', {
      cls: 'folder-lab-property-settings'
    });
    propertySettingsContainer.style.display = this.plugin.settings.navigationType === 'properties' ? 'block' : 'none';

    new Setting(propertySettingsContainer)
      .setName('Preset de propiedades')
      .setDesc('Selecciona un esquema predefinido para las propiedades')
      .addDropdown(dropdown => dropdown
        .addOption('jekyll', 'Jekyll / Just the Docs')
        .addOption('custom', 'Personalizado')
        .setValue('jekyll')
        .onChange(async (value: string) => {
          if (value === 'jekyll') {
            // Usar DEFAULT_JEKYLL_MAPPING en lugar de objeto manual
            this.plugin.settings.navigationPropertyMapping = {
              ...DEFAULT_JEKYLL_MAPPING
            };
            await this.plugin.saveSettings();
            this.display();
            new Notice('Preset Jekyll aplicado');
          }
        })
      );

    const mapping = this.plugin.settings.navigationPropertyMapping || DEFAULT_JEKYLL_MAPPING;

    new Setting(propertySettingsContainer)
      .setName('Propiedad de título')
      .setDesc('Nombre de la propiedad que contiene el título de la nota')
      .addText(text => text
        .setPlaceholder('title')
        .setValue(mapping.title || 'title')
        .onChange(async (value) => {
          this.plugin.settings.navigationPropertyMapping.title = value || 'title';
          await this.plugin.saveSettings();
        })
      );

    new Setting(propertySettingsContainer)
      .setName('Propiedad de padre')
      .setDesc('Nombre de la propiedad que contiene el padre de la nota')
      .addText(text => text
        .setPlaceholder('parent')
        .setValue(mapping.parent || 'parent')
        .onChange(async (value) => {
          this.plugin.settings.navigationPropertyMapping.parent = value || 'parent';
          await this.plugin.saveSettings();
        })
      );

    new Setting(propertySettingsContainer)
      .setName('Propiedad de orden')
      .setDesc('Nombre de la propiedad que contiene el orden de la nota')
      .addText(text => text
        .setPlaceholder('nav_order')
        .setValue(mapping.order || 'nav_order')
        .onChange(async (value) => {
          this.plugin.settings.navigationPropertyMapping.order = value || 'nav_order';
          await this.plugin.saveSettings();
        })
      );

    new Setting(propertySettingsContainer)
      .setName('Propiedad de hijos')
      .setDesc('Nombre de la propiedad que indica si tiene hijos')
      .addText(text => text
        .setPlaceholder('has_children')
        .setValue(mapping.hasChildren || 'has_children')
        .onChange(async (value) => {
          this.plugin.settings.navigationPropertyMapping.hasChildren = value || 'has_children';
          await this.plugin.saveSettings();
        })
      );

    new Setting(propertySettingsContainer)
      .setName('Propiedad de permalink')
      .setDesc('Nombre de la propiedad que contiene el permalink')
      .addText(text => text
        .setPlaceholder('permalink')
        .setValue(mapping.permalink || 'permalink')
        .onChange(async (value) => {
          this.plugin.settings.navigationPropertyMapping.permalink = value || 'permalink';
          await this.plugin.saveSettings();
        })
      );

    // ===== BOTÓN REFRESCAR NAVEGACIÓN =====
    new Setting(containerEl)
      .setName('Refrescar navegación')
      .setDesc('Reconstruye el árbol de navegación desde las fuentes actuales')
      .addButton(button => button
        .setButtonText('🔄 Refrescar')
        .setCta()
        .onClick(async () => {
          const view = this.plugin.getView();
          if (view && view.refreshNavigation) {
            await view.refreshNavigation();
            new Notice('✅ Navegación actualizada');
          } else {
            new Notice('⚠️ Folder Lab no está abierto');
          }
        })
      );

    // ===== SECCIÓN DE IA =====
    containerEl.createEl('hr');
    containerEl.createEl('h3', { text: '🤖 Configuración de IA' });

    // Proveedor
    new Setting(containerEl)
      .setName('Proveedor de IA')
      .setDesc('Selecciona el servicio de IA que quieres usar')
      .addDropdown(dropdown => dropdown
        .addOption('openai', 'OpenAI')
        .addOption('gemini', 'Google Gemini')
        .addOption('anthropic', 'Anthropic Claude')
        .setValue(this.plugin.settings.aiProvider || 'openai')
        .onChange(async (value: 'openai' | 'gemini' | 'anthropic') => {
          this.plugin.settings.aiProvider = value;
          switch (value) {
            case 'openai':
              this.plugin.settings.aiModel = 'gpt-4o-mini';
              break;
            case 'gemini':
              this.plugin.settings.aiModel = 'gemini-1.5-flash';
              break;
            case 'anthropic':
              this.plugin.settings.aiModel = 'claude-3-5-haiku-20241022';
              break;
          }
          await this.plugin.saveSettings();
          this.display();
        }));

    // API Key
    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Tu clave de API del servicio seleccionado')
      .addText(text => {
        text
          .setPlaceholder('Introduce tu API Key')
          .setValue(this.plugin.settings.aiApiKey || '')
          .onChange(async (value) => {
            this.plugin.settings.aiApiKey = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = 'password';
      });

    // Usar modelo recomendado
    new Setting(containerEl)
      .setName('Usar modelo recomendado')
      .setDesc('El plugin seleccionará automáticamente el mejor modelo para tu proveedor')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.aiUseRecommendedModel ?? true)
        .onChange(async (value) => {
          this.plugin.settings.aiUseRecommendedModel = value;
          if (value) {
            const provider = this.plugin.settings.aiProvider || 'openai';
            switch (provider) {
              case 'openai': this.plugin.settings.aiModel = 'gpt-4o-mini'; break;
              case 'gemini': this.plugin.settings.aiModel = 'gemini-1.5-flash'; break;
              case 'anthropic': this.plugin.settings.aiModel = 'claude-3-5-haiku-20241022'; break;
            }
          }
          await this.plugin.saveSettings();
          this.display();
        }));

    // Modelo personalizado
    new Setting(containerEl)
      .setName('Modelo personalizado')
      .setDesc('Nombre del modelo (ej: gpt-4o, gemini-1.5-pro, claude-3-5-sonnet-20241022)')
      .addText(text => {
        text
          .setPlaceholder('Nombre del modelo')
          .setValue(this.plugin.settings.aiModel || '')
          .onChange(async (value) => {
            this.plugin.settings.aiModel = value;
            await this.plugin.saveSettings();
          });

        const useRecommended = this.plugin.settings.aiUseRecommendedModel ?? true;
        text.inputEl.disabled = useRecommended;
      });

    // Temperatura
    new Setting(containerEl)
      .setName('Temperatura')
      .setDesc('Creatividad de la IA (0 = preciso, 2 = creativo)')
      .addSlider(slider => slider
        .setLimits(0, 2, 0.1)
        .setValue(this.plugin.settings.aiTemperature ?? 0.3)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.aiTemperature = value;
          await this.plugin.saveSettings();
        }));

    // Máximo de tokens
    new Setting(containerEl)
      .setName('Máximo de tokens')
      .setDesc('Longitud máxima de la respuesta')
      .addSlider(slider => slider
        .setLimits(50, 2000, 10)
        .setValue(this.plugin.settings.aiMaxTokens ?? 500)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.aiMaxTokens = value;
          await this.plugin.saveSettings();
        }));

    // Botón probar conexión
    new Setting(containerEl)
      .setName('🔌 Probar conexión')
      .setDesc('Verifica que tu configuración sea correcta')
      .addButton(button => {
        button
          .setButtonText('Probar')
          .setCta()
          .onClick(async () => {
            if (!this.plugin.aiService) {
              new Notice('❌ Servicio de IA no inicializado');
              return;
            }

            button.setButtonText('⏳ Probando...');
            button.setDisabled(true);

            const result = await this.plugin.aiService.testConnection();

            button.setDisabled(false);
            if (result.success) {
              new Notice(`✅ ${result.message}`);
              button.setButtonText('✅ Conectado');
              setTimeout(() => button.setButtonText('Probar'), 3000);
            } else {
              new Notice(`❌ ${result.message}`);
              button.setButtonText('❌ Error');
              setTimeout(() => button.setButtonText('Probar'), 3000);
            }
          });
      });

    // Ayuda: cómo obtener API Key
    containerEl.createEl('hr');
    containerEl.createEl('h4', { text: '📌 Cómo obtener tu API Key' });

    const helpDiv = containerEl.createEl('div');
    helpDiv.style.cssText = 'padding: 8px 12px; background: var(--background-primary-alt); border-radius: 6px; font-size: 0.85em; color: var(--text-muted);';

    const provider = this.plugin.settings.aiProvider || 'openai';
    const helpLinks: Record<string, string> = {
      openai: 'https://platform.openai.com/api-keys',
      gemini: 'https://aistudio.google.com/apikey',
      anthropic: 'https://console.anthropic.com/settings/keys'
    };

    helpDiv.createEl('p', {
      text: `📎 ${provider === 'openai' ? 'OpenAI' : provider === 'gemini' ? 'Google Gemini' : 'Anthropic Claude'}: ${helpLinks[provider]}`
    });

    // ===== INFORMACIÓN =====
    containerEl.createEl('hr');
    containerEl.createEl('h3', { text: 'ℹ️ Información' });

    containerEl.createEl('p', {
      text: 'El orden se guarda en un archivo _folder_order.json dentro de la carpeta .folder-order (oculta).'
    });

    const infoText = containerEl.createEl('p', {
      text: 'Notas vacías: se detectan automáticamente (< 10 caracteres sin contar el título).'
    });
    infoText.style.cssText = 'color: var(--text-muted); font-size: 0.8em;';

    const infoText2 = containerEl.createEl('p', {
      text: 'El conteo de palabras excluye automáticamente archivos compilados y archivos dentro de .folder-order.'
    });
    infoText2.style.cssText = 'color: var(--text-muted); font-size: 0.8em;';
  }
}
