// ============================================================
// 1. IMPORTS
// ============================================================
import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  TFolder,
  Modal,
  setIcon
} from 'obsidian';

import { VIEW_TYPE_FOLDER_ORDER } from './constants/view-types';
import { FolderLabView } from './views/FolderLabView';
import { FolderRepository } from './storage/FolderRepository';
import { parseIgnoredFolders } from './utils/folderUtils';
import { FolderOrderSettings, DEFAULT_SETTINGS, DEFAULT_JEKYLL_MAPPING } from './config/settings';

import { FocusWidgetRegistry } from "./focus/FocusWidgetRegistry";
import { ActiveNoteWidgetFactory } from "./focus/widgets/ActiveNoteWidget";
import { NotesWidgetFactory } from "./focus/widgets/NotesWidget";
import { ResourcesWidgetFactory } from "./focus/widgets/ResourcesWidget";
import { MemoryWidgetFactory } from "./focus/widgets/MemoryWidget";
import { createCapabilityRegistry, CapabilityRegistry } from './ai/capabilities';
import { AIService } from './ai/AIService';
import { i18n } from './i18n/I18nService';
import { applyObsidianLocale } from './i18n/obsidianLocale';

import { WidgetManager } from "./focus/WidgetManager";
import { NoteRepository } from './storage/NoteRepository';
import { BoardRepository } from './storage/BoardRepository';
import { PluginDataStore } from './storage/PluginDataStore';
import { NoteIdentityRegistry } from './storage/NoteIdentityRegistry';
import { NoteLifecycle } from './storage/NoteLifecycle';
import { DraftStore } from './storage/DraftStore';
import { LocalMirror } from './storage/localMirror';
import { resolveVaultStorageId } from './utils/vault-storage';
import { normalizeRootPath } from './utils/rootPath';
import { runStartupMaintenance } from './storage/startupMaintenance';
import { registerLifecycleListeners } from './storage/vaultLifecycleListeners';
import { ClaimDataModal } from './modals/ClaimDataModal';
declare const require: (modulePath: string) => unknown;
const definitions = require('./focus/widget-definitions.json')
import { WidgetController } from './focus/controllers/WidgetController';

import {
  DeclarativeRuntime
} from './focus/DeclarativeRuntime';

import {
  BoardView,
  BOARD_VIEW_TYPE
} from './focus/BoardView';

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

    contentEl.createEl('h3', { text: i18n.t('modal.selectRoot.title') });

    contentEl.createEl('p', {
      text: i18n.t('modal.selectRoot.description'),
      cls: 'folder-select-description'
    });

    if (this.folders.length === 0) {
      contentEl.createEl('p', { text: i18n.t('empty.noRootFolders') });
      return;
    }

    const list = contentEl.createEl('div', { cls: 'folder-select-list' });

    for (const folder of this.folders) {
      const item = list.createEl('div', { cls: 'folder-select-item' });

      const icon = item.createEl('span');
      setIcon(icon, 'folder');

      item.createEl('span', { text: folder });

      item.onclick = () => {
        this.close();
        this.onSelect(folder);
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
  private noteRepository: NoteRepository | null = null;
  private dataStore: PluginDataStore | null = null;
  noteLifecycle: NoteLifecycle | null = null;
  draftStore: DraftStore | null = null;
  private noteIdentityRegistry: NoteIdentityRegistry | null = null;
  private startupMaintenanceDone = false;
  /** Espejo LS aislado por identidad (Corrección A). */
  localMirror: LocalMirror | null = null;


  async onload() {
    await this.loadSettings();

    /*
     * Idioma de Obsidian ANTES de registrar comandos, vistas o
     * cualquier elemento que muestre textos: los names de
     * addCommand se capturan en este momento. Idempotente; sin
     * preferencia persistida en data.json.
     */
    applyObsidianLocale();

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
          label: i18n.t('widgets.registered.activeNote.label'),
          icon: 'file-text',
          description:
            i18n.t('widgets.registered.activeNote.description')
        },

        cardinality: 'singleton'
      }
    );


    this.widgetRegistry.register(
      new NotesWidgetFactory(this.app),
      {
        id: 'notes',

        identity: {
          label: i18n.t('widgets.registered.notes.label'),
          icon: 'pencil',
          description:
            i18n.t('widgets.registered.notes.description')
        },

        cardinality: 'singleton'
      }
    );


    this.widgetRegistry.register(
      new ResourcesWidgetFactory(this.app),
      {
        id: 'resources',

        identity: {
          label: i18n.t('widgets.registered.resources.label'),
          icon: 'folder',
          description:
            i18n.t('widgets.registered.resources.description')
        },

        cardinality: 'singleton'
      }
    );



    // ============================================================
    // INICIALIZAR GESTOR DE INSTANCIAS
    // ============================================================

    // ============================================================
    // IDENTIDAD Y ALMACENES POR ENTIDAD (Etapas 1 y 3)
    // ============================================================
    const rootPathFn = () => normalizeRootPath(this.settings.bookRootPath);
    const noteIdentityRegistry = new NoteIdentityRegistry(
      this.app,
      rootPathFn
    );
    this.noteIdentityRegistry = noteIdentityRegistry;
    const identityFn = (notePath: string) =>
      noteIdentityRegistry.getId(notePath);
    // Corrección A: propiedad de datos legados = sin pendientes.
    const legacyOwnershipSafe = (notePath: string) =>
      noteIdentityRegistry
        .getPendingFor(notePath)
        .then((candidates) => candidates.length === 0);

    const noteRepository =
      new NoteRepository(this.app, {
        identity: identityFn,
        getRootPath: rootPathFn,
        legacyOwnershipSafe
      });
    this.noteRepository = noteRepository;

    this.boardRepository =
      new BoardRepository(this.app, {
        identity: identityFn,
        getRootPath: rootPathFn,
        legacyOwnershipSafe
      });

    this.widgetManager =
      new WidgetManager(
        this.widgetRegistry,
        noteRepository
      );

    // ============================================================
    // CICLO DE VIDA DE DATOS (Etapa 1)
    // ============================================================
    this.noteLifecycle = new NoteLifecycle({
      registry: noteIdentityRegistry,
      boards: this.boardRepository,
      context: this.noteRepository,
      vaultId: resolveVaultStorageId(this.app),
      storage: typeof localStorage !== 'undefined' ? localStorage : null,
      getRootPath: rootPathFn,
      journalApp: this.app
    });
    this.draftStore = new DraftStore(
      this.app,
      rootPathFn,
      noteIdentityRegistry
    );
    this.localMirror = new LocalMirror({
      storage: typeof localStorage !== 'undefined' ? localStorage : null,
      vaultId: resolveVaultStorageId(this.app),
      getNoteId: identityFn,
      hasSafeOwnership: legacyOwnershipSafe
    });

    // ============================================================
    // CICLO DE VIDA INDEPENDIENTE DE LA VISTA (E2)
    // ============================================================
    registerLifecycleListeners(
      this,
      this.noteLifecycle,
      noteIdentityRegistry,
      rootPathFn
    );

    // Comando de reclamación EXPLÍCITA de identidades pendientes.
    this.addCommand({
      id: 'claim-note-data',
      name: 'Reclamar datos de nota…',
      callback: () => {
        const registry = this.noteIdentityRegistry;
        if (!registry) return;
        void registry
          .listAllPending()
          .then((candidates) => {
            if (candidates.length === 0) {
              new Notice('Folder Lab: no hay datos pendientes.');
              return;
            }
            if (candidates.length === 1) {
              // Un único candidato: reclamo directo (idempotente).
              void registry
                .claim(candidates[0].path, candidates[0].bucket)
                .then((result) => {
                  if (result.status === 'claimed') {
                    new Notice(
                      `Folder Lab: datos restaurados en «${candidates[0].path}».`
                    );
                  } else {
                    new Notice(
                      'Folder Lab: el reclamo directo no se pudo completar.'
                    );
                  }
                });
              return;
            }
            // Varios candidatos: presentar opciones (sin elegir).
            new ClaimDataModal(this.app, candidates, registry).open();
          })
          .catch((error) => {
            console.error(
              '[FolderLab] Error listando datos pendientes:',
              error
            );
          });
      }
    });

    // M1: mantenimiento de arranque (diario M2 + reconcile A3),
    // una vez, tras estar layout y configuración disponibles.
    this.app.workspace.onLayoutReady(() => {
      if (this.startupMaintenanceDone) return;
      this.startupMaintenanceDone = true;
      void runStartupMaintenance(
        this.app,
        noteIdentityRegistry,
        this.noteLifecycle
      ).catch((error) => {
        console.error('[FolderLab] Mantenimiento de arranque fallido:', error);
      });
    });

    // ============================================================
    // REGISTRAR VISTA
    // ============================================================

    this.widgetRegistry.register(
      new MemoryWidgetFactory(
        this.app,
        this.aiService,
        this.capabilityRegistry,
        this.widgetController,
        this.widgetManager
      ),
      {
        id: 'memory',

        identity: {
          label: i18n.t('widgets.registered.memory.label'),
          icon: 'cpu',
          description:
            i18n.t('widgets.registered.memory.description')
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
      name: i18n.t('commands.openFolderLab'),
      callback: () => this.openFolderLabView()
    });

    this.addCommand({
      id: 'refresh-folder-lab',
      name: i18n.t('commands.refreshView'),
      callback: () => this.refreshView()
    });

    this.addCommand({
      id: 'toggle-focus-mode',
      name: i18n.t('commands.toggleFocusMode'),
      callback: () => this.toggleFocusMode()
    });

    this.addCommand({
      id: 'test-context-resolver',
      name: i18n.t('commands.testContextResolver'),
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice(i18n.t('notices.noActiveNoteMarked'));
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

        new Notice(i18n.t('notices.contextTestResult', {
            name: context.workspace.note.name,
            length: context.workspace.note.content.length
          }));
      }
    });



    // ============================================================
    // RIBBON ICON
    // ============================================================
    this.addRibbonIcon('folder', i18n.t('common.appName'), () => {
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
              .setTitle(i18n.t('folders.contextMenu.openInFolderLab'))
              .setIcon('folder-sync')
              .onClick(() => {
                void this.openFolderLabForFolder(file).catch((error) => {
                  console.error('[FolderLab] Error abriendo Folder Lab para la carpeta:', error);
                });
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
        await this.repository.initGlobalOrder(
          path,
          this.settings.navigationPropertyMapping?.ignoredFolders ?? []
        );
              } catch (error) {
        console.error('❌ Error al inicializar proyecto:', error);
        new Notice(i18n.t('errors.initProject'));
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
      new Notice(i18n.t('errors.openSidePanel'));
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

    window.setTimeout(() => {
      const view = this.getViewInstance();
      if (view) {
        void view.loadFolderOrder(folder.path).catch((error) => {
          console.error('[FolderLab] Error cargando la última carpeta:', error);
        });
      } else {
        new Notice(i18n.t('errors.loadView'));
      }
    }, 150);
  }

  refreshView(): void {
    const view = this.getViewInstance();
    if (view) {
      // refresh() es síncrono y gestiona internamente su
      // recarga asíncrona (con manejo de errores en la vista).
      view.refresh();
      new Notice(i18n.t('notices.viewRefreshed'));
    }
  }

  // ============================================================
  // MÉTODO: TOGGLE FOCUS MODE
  // ============================================================
  toggleFocusMode(): void {
    const view = this.getViewInstance();
    if (view) {
      void view.toggleFocusMode().catch((error) => {
        console.error('[FolderLab] Error alternando el modo Contexto:', error);
      });
    } else {
      void this.openFolderLabView().catch((error) => {
        console.error('[FolderLab] Error abriendo Folder Lab:', error);
      });
      window.setTimeout(() => {
        const newView = this.getViewInstance();
        if (newView) {
          newView.toggleFocusMode().catch((error) => {
            console.error('[FolderLab] Error alternando el modo Contexto:', error);
          });
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
    const loadedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

    /*
     * Migración no destructiva: los data.json anteriores no traen
     * la lista (el merge es superficial). Se crea un objeto nuevo
     * para no mutar el DEFAULT compartido.
     */
    const currentMapping = this.settings.navigationPropertyMapping;

    this.settings.navigationPropertyMapping = {
      ...((currentMapping && typeof currentMapping === 'object')
        ? currentMapping
        : DEFAULT_JEKYLL_MAPPING),
      ignoredFolders: Array.isArray((currentMapping as any)?.ignoredFolders)
        ? (currentMapping as any).ignoredFolders
        : []
    };

    /*
     * Migración de la meta de escritura: la configuración anterior
     * guardaba metas por carpeta (folderWordGoals). La meta del
     * libro es la de la carpeta master; si existía, se conserva.
     */
    if (!(this.settings.bookWordGoal > 0)) {
      const legacyGoals = loadedData?.folderWordGoals;
      const masterPath = this.settings.bookRootPath;
      const legacyMasterGoal =
        masterPath && legacyGoals
          ? legacyGoals[masterPath]
          : undefined;

      if (typeof legacyMasterGoal === 'number' && legacyMasterGoal > 0) {
        this.settings.bookWordGoal = Math.floor(legacyMasterGoal);
      }
    }
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


    new Setting(containerEl)
      .setName(i18n.t('settings.title'))
      .setHeading();

    // ===== ORDEN MANUAL =====
    new Setting(containerEl)
      .setName(i18n.t('settings.manualOrder.name'))
      .setDesc(i18n.t('settings.manualOrder.desc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useManualOrder)
        .onChange(async (value) => {
          this.plugin.settings.useManualOrder = value;
          await this.plugin.saveSettings();
          this.app.workspace.trigger('layout-change');
          new Notice(i18n.t('notices.manualOrderToggled', {
            state: i18n.t(value
              ? 'notices.manualOrder.enabled'
              : 'notices.manualOrder.disabled')
          }));
        }));

    // ===== MOSTRAR NÚMEROS =====
    new Setting(containerEl)
      .setName(i18n.t('settings.showNumbers.name'))
      .setDesc(i18n.t('settings.showNumbers.desc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showNumbers)
        .onChange(async (value) => {
          this.plugin.settings.showNumbers = value;
          await this.plugin.saveSettings();
        }));

    // ===== ESTILO DE NUMERACIÓN =====
    new Setting(containerEl)
      .setName(i18n.t('settings.numberingStyle.name'))
      .setDesc(i18n.t('settings.numberingStyle.desc'))
      .addDropdown(dropdown => dropdown
        .addOption('roman', i18n.t('settings.numberingStyle.option.roman'))
        .addOption('arabic', i18n.t('settings.numberingStyle.option.arabic'))
        .addOption('none', i18n.t('settings.numberingStyle.option.none'))
        .setValue(this.plugin.settings.numberingStyle)
        .onChange(async (value: 'roman' | 'arabic' | 'none') => {
          this.plugin.settings.numberingStyle = value;
          await this.plugin.saveSettings();
        }));

    // ===== CARPETA RAÍZ DEL LIBRO =====
    containerEl.createEl('hr');

    new Setting(containerEl)
      .setName(i18n.t('settings.bookRoot.heading'))
      .setHeading();

    let rootPathInput: HTMLInputElement | null = null;

    const rootSetting = new Setting(containerEl)
      .setName(i18n.t('settings.bookRoot.name'))
      .setDesc(i18n.t('settings.bookRoot.desc'))
      .addText(text => {
        text
          .setPlaceholder(i18n.t('settings.bookRoot.placeholder'))
          .setValue(this.plugin.settings.bookRootPath || '')
          .onChange(async (value) => {
            await this.plugin.setBookRootPath(value);
          });
        rootPathInput = text.inputEl;
      });

    rootSetting.addButton(button => button
      .setButtonText(i18n.t('settings.bookRoot.selectButton'))
      .onClick(async () => {
        const folders: string[] = [];
        const root = this.app.vault.getRoot();

        for (const child of root.children) {
          if (child instanceof TFolder) {
            folders.push(child.path);
          }
        }

        if (folders.length === 0) {
          new Notice(i18n.t('empty.noRootFolders'));
          return;
        }

        const modal = new FolderSelectModal(this.app, folders, (selected: string) => {
          // L3b: el callback del modal devuelve void; el aviso de
          // éxito solo se emite cuando la configuración termina.
          void this.plugin.setBookRootPath(selected)
            .then(() => {
              if (rootPathInput) rootPathInput.value = selected;

              new Notice(i18n.t('settings.bookRoot.configuredNotice', { path: selected }));
            })
            .catch((error) => {
              console.error(
                '[FolderLab] Error configurando la carpeta raíz:',
                error
              );
            });
        });
        modal.open();
      }));

    if (this.plugin.settings.bookRootPath) {
      containerEl.createEl('p', {
        text: i18n.t('settings.bookRoot.currentFolderInfo', { path: this.plugin.settings.bookRootPath }),
        cls: 'folder-lab-info-text'
      });
    }

    // ============================================================
    // SECCIÓN: NAVEGACIÓN
    // ============================================================
    containerEl.createEl('hr');
    new Setting(containerEl)
      .setName(i18n.t('settings.navigation.heading'))
      .setHeading();

    let propertySettingsContainer: HTMLElement | null = null;

    new Setting(containerEl)
      .setName(i18n.t('settings.navigation.type.name'))
      .setDesc(i18n.t('settings.navigation.type.desc'))
      .addDropdown(dropdown => dropdown
        .addOption('folders', i18n.t('settings.navigation.type.option.folders'))
        .addOption('properties', i18n.t('settings.navigation.type.option.properties'))
        .setValue(this.plugin.settings.navigationType || 'folders')
        .onChange(async (value: 'folders' | 'properties') => {
          this.plugin.settings.navigationType = value;
          await this.plugin.saveSettings();

          // Actualizar visibilidad de las opciones de properties
          if (propertySettingsContainer) {
            propertySettingsContainer.toggleClass(
              'is-hidden',
              value !== 'properties'
            );
          }

          // Una sola declaración de view
          const view = this.plugin.getView();
          if (view && view.refreshNavigation) {
            await view.refreshNavigation();
          }

          new Notice(i18n.t('notices.navTypeChanged', {
            typeName: i18n.t(value === 'folders'
              ? 'settings.navigation.type.option.folders'
              : 'settings.navigation.type.option.properties')
          }));
        })
      );
    // ============================================================
    // CONFIGURACIÓN DE PROPIEDADES
    // ============================================================
    propertySettingsContainer = containerEl.createEl('div', {
      cls: 'folder-lab-property-settings'
    });
    propertySettingsContainer.toggleClass(
      'is-hidden',
      this.plugin.settings.navigationType !== 'properties'
    );

    new Setting(propertySettingsContainer)
      .setName(i18n.t('settings.properties.preset.name'))
      .setDesc(i18n.t('settings.properties.preset.desc'))
      .addDropdown(dropdown => dropdown
        .addOption('jekyll', i18n.t('settings.properties.preset.option.jekyll'))
        .addOption('custom', i18n.t('settings.properties.preset.option.custom'))
        .setValue('jekyll')
        .onChange(async (value: string) => {
          if (value === 'jekyll') {
            // Usar DEFAULT_JEKYLL_MAPPING en lugar de objeto manual
            this.plugin.settings.navigationPropertyMapping = {
              ...DEFAULT_JEKYLL_MAPPING
            };
            await this.plugin.saveSettings();
            this.display();
            new Notice(i18n.t('settings.properties.preset.appliedNotice'));
          }
        })
      );

    const mapping = this.plugin.settings.navigationPropertyMapping || DEFAULT_JEKYLL_MAPPING;

    new Setting(propertySettingsContainer)
      .setName(i18n.t('settings.properties.title.name'))
      .setDesc(i18n.t('settings.properties.title.desc'))
      .addText(text => text
        .setPlaceholder('title')
        .setValue(mapping.title || 'title')
        .onChange(async (value) => {
          this.plugin.settings.navigationPropertyMapping.title = value || 'title';
          await this.plugin.saveSettings();
        })
      );

    new Setting(propertySettingsContainer)
      .setName(i18n.t('settings.properties.parent.name'))
      .setDesc(i18n.t('settings.properties.parent.desc'))
      .addText(text => text
        .setPlaceholder('parent')
        .setValue(mapping.parent || 'parent')
        .onChange(async (value) => {
          this.plugin.settings.navigationPropertyMapping.parent = value || 'parent';
          await this.plugin.saveSettings();
        })
      );

    new Setting(propertySettingsContainer)
      .setName(i18n.t('settings.properties.order.name'))
      .setDesc(i18n.t('settings.properties.order.desc'))
      .addText(text => text
        .setPlaceholder('nav_order')
        .setValue(mapping.order || 'nav_order')
        .onChange(async (value) => {
          this.plugin.settings.navigationPropertyMapping.order = value || 'nav_order';
          await this.plugin.saveSettings();
        })
      );

    new Setting(propertySettingsContainer)
      .setName(i18n.t('settings.properties.hasChildren.name'))
      .setDesc(i18n.t('settings.properties.hasChildren.desc'))
      .addText(text => text
        .setPlaceholder('has_children')
        .setValue(mapping.hasChildren || 'has_children')
        .onChange(async (value) => {
          this.plugin.settings.navigationPropertyMapping.hasChildren = value || 'has_children';
          await this.plugin.saveSettings();
        })
      );

    new Setting(propertySettingsContainer)
      .setName(i18n.t('settings.properties.permalink.name'))
      .setDesc(i18n.t('settings.properties.permalink.desc'))
      .addText(text => text
        .setPlaceholder('permalink')
        .setValue(mapping.permalink || 'permalink')
        .onChange(async (value) => {
          this.plugin.settings.navigationPropertyMapping.permalink = value || 'permalink';
          await this.plugin.saveSettings();
        })
      );

    new Setting(propertySettingsContainer)
      .setName(i18n.t('settings.ignoredFolders.name'))
      .setDesc(i18n.t('settings.ignoredFolders.desc'))
      .addTextArea(text => text
        .setPlaceholder('assets')
        .setValue((mapping.ignoredFolders ?? []).join(', '))
        .onChange(async (value) => {
          const previous =
            this.plugin.settings.navigationPropertyMapping.ignoredFolders ?? [];
          const next = parseIgnoredFolders(value);

          // Sin cambio efectivo no se reconstruye nada.
          const same =
            previous.length === next.length &&
            previous.every((name, index) => name === next[index]);

          this.plugin.settings.navigationPropertyMapping.ignoredFolders =
            next;
          await this.plugin.saveSettings();

          if (same) return;

          // Aplicar al orden global existente: retira las ramas
          // ignoradas conservando el orden manual superviviente.
          const masterPath =
            this.plugin.settings.bookRootPath;

          if (masterPath) {
            try {
              await this.plugin.repository.reconcileGlobalOrder(
                masterPath,
                next
              );

              const view = this.plugin.getView();

              if (view && view.refreshNavigation) {
                await view.refreshNavigation();
              }
            } catch (error) {
              console.error(
                '❌ No se pudo aplicar carpetas ignoradas al orden global:',
                error
              );
              new Notice(
                i18n.t('errors.ignoredFoldersApplyFailed')
              );
            }
          }
        })
      );

    // ===== BOTÓN REFRESCAR NAVEGACIÓN =====
    new Setting(containerEl)
      .setName(i18n.t('settings.refreshNavigation.name'))
      .setDesc(i18n.t('settings.refreshNavigation.desc'))
      .addButton(button => button
        .setButtonText(i18n.t('settings.refreshNavigation.button'))
        .setCta()
        .onClick(async () => {
          const view = this.plugin.getView();
          if (view && view.refreshNavigation) {
            await view.refreshNavigation();
            new Notice(i18n.t('notices.navigationUpdated'));
          } else {
            new Notice(i18n.t('errors.viewNotOpenMarked'));
          }
        })
      );

    // ===== SECCIÓN DE IA =====
    containerEl.createEl('hr');
    new Setting(containerEl)
      .setName(i18n.t('settings.ai.heading'))
      .setHeading();

    // Proveedor
    new Setting(containerEl)
      .setName(i18n.t('settings.ai.provider.name'))
      .setDesc(i18n.t('settings.ai.provider.desc'))
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
      .setName(i18n.t('settings.ai.apiKey.name'))
      .setDesc(i18n.t('settings.ai.apiKey.desc'))
      .addText(text => {
        text
          .setPlaceholder(i18n.t('settings.ai.apiKey.placeholder'))
          .setValue(this.plugin.settings.aiApiKey || '')
          .onChange(async (value) => {
            this.plugin.settings.aiApiKey = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = 'password';
      });

    // Usar modelo recomendado
    new Setting(containerEl)
      .setName(i18n.t('settings.ai.recommendedModel.name'))
      .setDesc(i18n.t('settings.ai.recommendedModel.desc'))
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
      .setName(i18n.t('settings.ai.customModel.name'))
      .setDesc(i18n.t('settings.ai.customModel.desc'))
      .addText(text => {
        text
          .setPlaceholder(i18n.t('settings.ai.customModel.placeholder'))
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
      .setName(i18n.t('settings.ai.temperature.name'))
      .setDesc(i18n.t('settings.ai.temperature.desc'))
      .addSlider(slider => slider
        .setLimits(0, 2, 0.1)
        .setValue(this.plugin.settings.aiTemperature ?? 0.3)
        .onChange(async (value) => {
          this.plugin.settings.aiTemperature = value;
          await this.plugin.saveSettings();
        }));

    // Máximo de tokens
    new Setting(containerEl)
      .setName(i18n.t('settings.ai.maxTokens.name'))
      .setDesc(i18n.t('settings.ai.maxTokens.desc'))
      .addSlider(slider => slider
        .setLimits(50, 2000, 10)
        .setValue(this.plugin.settings.aiMaxTokens ?? 500)
        .onChange(async (value) => {
          this.plugin.settings.aiMaxTokens = value;
          await this.plugin.saveSettings();
        }));

    // Botón probar conexión
    new Setting(containerEl)
      .setName(i18n.t('settings.ai.testConnection.name'))
      .setDesc(i18n.t('settings.ai.testConnection.desc'))
      .addButton(button => {
        button
          .setButtonText(i18n.t('settings.ai.testConnection.button'))
          .setCta()
          .onClick(async () => {
            if (!this.plugin.aiService) {
              new Notice(i18n.t('errors.ai.notInitialized'));
              return;
            }

            button.setButtonText(i18n.t('settings.ai.testConnection.testing'));
            button.setDisabled(true);

            const result = await this.plugin.aiService.testConnection();

            button.setDisabled(false);
            if (result.success) {
              new Notice(`✅ ${result.message}`);
              button.setButtonText(i18n.t('settings.ai.testConnection.connected'));
              window.setTimeout(() => button.setButtonText(i18n.t('settings.ai.testConnection.button')), 3000);
            } else {
              new Notice(`❌ ${result.message}`);
              button.setButtonText(i18n.t('settings.ai.testConnection.error'));
              window.setTimeout(() => button.setButtonText(i18n.t('settings.ai.testConnection.button')), 3000);
            }
          });
      });

    // Ayuda: cómo obtener API Key
    containerEl.createEl('hr');
    new Setting(containerEl)
      .setName(i18n.t('settings.ai.help.heading'))
      .setHeading();

    const helpDiv = containerEl.createEl('div', { cls: 'fl-settings-help' });

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
    new Setting(containerEl)
      .setName(i18n.t('settings.info.heading'))
      .setHeading();

    containerEl.createEl('p', {
      text: i18n.t('settings.info.orderStorage')
    });

    containerEl.createEl('p', {
      text: i18n.t('settings.info.emptyNotes'),
      cls: 'fl-settings-info'
    });

    containerEl.createEl('p', {
      text: i18n.t('settings.info.wordCountExclusions'),
      cls: 'fl-settings-info'
    });
  }
}
