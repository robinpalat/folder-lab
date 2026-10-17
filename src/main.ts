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
import { makeTrashOp, NoteDataSnapshot } from './storage/managedDelete';
import { resolveVaultStorageId } from './utils/vault-storage';
import { normalizeRootPath } from './utils/rootPath';
import { runStartupMaintenance } from './storage/startupMaintenance';
import { registerLifecycleListeners } from './storage/vaultLifecycleListeners';
import { ClaimDataModal } from './modals/ClaimDataModal';
import { QuarantineCandidateModal, notifyQuarantineResult } from './modals/QuarantineCandidateModal';
import {
  RestoreQuarantineModal,
  notifyRestoreResult
} from './modals/RestoreQuarantineModal';
import {
  prepareQuarantineCommand,
  quarantineCandidate
} from './storage/quarantineCommand';
import {
  prepareRestoreCommand,
  restoreEntry
} from './storage/restoreCommand';
import { QuarantineManager } from './storage/quarantine';
import { createStillOrphanPredicate } from './storage/stillOrphan';
declare const require: (modulePath: string) => unknown;
const definitions = require('./focus/widget-definitions.json') as {
  default?: unknown;
};
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

    const list = contentEl.createDiv({ cls: 'folder-select-list' });

    for (const folder of this.folders) {
      const item = list.createDiv({ cls: 'folder-select-item' });

      const icon = item.createSpan();
      setIcon(icon, 'folder');

      item.createSpan({ text: folder });

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
  widgetController: WidgetController;
  private boardRepository: BoardRepository | null = null;
  private noteRepository: NoteRepository | null = null;
  private dataStore: PluginDataStore | null = null;
  noteLifecycle: NoteLifecycle | null = null;
  draftStore: DraftStore | null = null;
  private noteIdentityRegistry: NoteIdentityRegistry | null = null;
  /**
   * Instancia COMPARTIDA de QuarantineManager (E4c-1): una sola por
   * plugin; su cola serializa cuarentena y restauración. NUNCA se
   * crea un manager por invocación (dos instancias concurrentes
   * perderían entradas del manifiesto por lectura-escritura cruzada).
   */
  private quarantineManagerInstance: QuarantineManager | null = null;
  private startupMaintenanceDone = false;
  /** Espejo LS aislado por identidad (Corrección A). */
  localMirror: LocalMirror | null = null;


  /**
   * Devuelve (creándola la primera vez) la instancia compartida de
   * QuarantineManager. Requiere el registro de identidad ya creado.
   */
  private getQuarantineManager(): QuarantineManager | null {
    if (this.quarantineManagerInstance) return this.quarantineManagerInstance;
    const registry = this.noteIdentityRegistry;
    if (!registry) return null;
    const getRootPath = () => normalizeRootPath(this.settings.bookRootPath);
    this.quarantineManagerInstance = new QuarantineManager(
      this.app,
      getRootPath,
      createStillOrphanPredicate(this.app, registry, getRootPath)
    );
    return this.quarantineManagerInstance;
  }

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
      definitions.default ?? definitions;

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

        category: 'context',

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
      journalApp: this.app,
      // E3: borrado administrado (snapshot + papelera compatible).
      snapshot: new NoteDataSnapshot(this.app, rootPathFn),
      trashFile: makeTrashOp(this.app)
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
              new Notice('No hay datos pendientes.');
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
                      'El reclamo directo no se pudo completar.'
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

    // ============================================================
    // COMANDO MANUAL DE CUARENTENA (E4b) — nunca en el arranque
    // ============================================================
    this.addCommand({
      id: 'quarantine-orphan-data',
      name: 'Cuarentenar datos huérfanos…',
      callback: () => {
        const registry = this.noteIdentityRegistry;
        const rootPathFn = () => normalizeRootPath(this.settings.bookRootPath);
        const manager = this.getQuarantineManager();
        if (!registry || !manager) {
          new Notice('Identidad no inicializada.');
          return;
        }
        const deps = {
          app: this.app,
          registry,
          getRootPath: rootPathFn,
          getExistingPaths: () =>
            this.app.vault.getMarkdownFiles().map((f) => f.path),
          manager
        };
        void prepareQuarantineCommand(deps)
          .then((outcome) => {
            switch (outcome.status) {
              case 'no-master':
                new Notice('Master no configurado.');
                break;
              case 'no-candidates':
                new Notice('No hay datos huérfanos elegibles.');
                break;
              case 'error':
                new Notice(`Folder Lab: auditoría fallida (${outcome.error}).`);
                break;
              case 'needs-confirmation': {
                // Confirmación explícita UNA A UNA antes de mover.
                new QuarantineCandidateModal(
                  this.app,
                  outcome.candidates,
                  async (candidate) => {
                    const result = await quarantineCandidate(
                      deps,
                      candidate
                    );
                    notifyQuarantineResult(result, candidate);
                    return result;
                  }
                ).open();
                break;
              }
            }
          })
          .catch((error) => {
            console.error('[FolderLab] Comando de cuarentena fallido:', error);
            new Notice('Error al preparar la cuarentena.');
          });
      }
    });

    // ============================================================
    // COMANDO MANUAL DE RESTAURACIÓN (E4c) — nunca en el arranque
    // ============================================================
    this.addCommand({
      id: 'restore-quarantine-data',
      name: 'Restaurar datos en cuarentena…',
      callback: () => {
        const rootPathFn = () => normalizeRootPath(this.settings.bookRootPath);
        const manager = this.getQuarantineManager();
        if (!manager) {
          new Notice('Identidad no inicializada.');
          return;
        }
        const deps = {
          app: this.app,
          getRootPath: rootPathFn,
          manager
        };
        void prepareRestoreCommand(deps)
          .then((outcome) => {
            switch (outcome.status) {
              case 'no-master':
                new Notice('Master no configurado.');
                break;
              case 'no-entries':
                new Notice(
                  'No hay datos en cuarentena pendientes de restaurar.'
                );
                break;
              case 'error':
                new Notice(
                  `Folder Lab: manifiesto de cuarentena ilegible (${outcome.error}).`
                );
                break;
              case 'needs-confirmation': {
                // Confirmación explícita UNA A UNA antes de restaurar.
                new RestoreQuarantineModal(
                  this.app,
                  outcome,
                  async (entry) => {
                    const result = await restoreEntry(deps, entry.entryId);
                    notifyRestoreResult(result, entry);
                    return result;
                  }
                ).open();
                break;
              }
            }
          })
          .catch((error) => {
            console.error('[FolderLab] Comando de restauración fallido:', error);
            new Notice('Error al preparar la restauración.');
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
        this.noteLifecycle,
        rootPathFn
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
        this.widgetManager,
        this.widgetRegistry
      ),
      {
        id: 'memory',

        identity: {
          label: i18n.t('widgets.registered.memory.label'),
          // cpu: icono con evidencia de render en produccion;
          // 'bot' (lucide >= 0.263) no es verificable contra el
          // catalogo runtime de la version minima soportada.
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
      void this.openFolderLabView().catch((error) => {
        console.error('[FolderLab] Error abriendo el panel:', error);
        new Notice(i18n.t('errors.openSidePanel'));
      });
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
      // setActiveLeaf (0.16.3+) en lugar de revealLeaf (1.7.2+):
      // compatible con minAppVersion 1.4.4, mismo efecto de foco.
      const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDER_ORDER)[0];
      this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
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

    this.app.workspace.setActiveLeaf(leaf, { focus: true });

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
    const loadedData: unknown = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

    /*
     * Migración no destructiva: los data.json anteriores no traen
     * la lista (el merge es superficial). Se crea un objeto nuevo
     * para no mutar el DEFAULT compartido.
     */
    const currentMapping = this.settings.navigationPropertyMapping;
    // Defensa ante data.json heredado con forma inesperada.
    const legacyIgnored: unknown = (
      currentMapping as { ignoredFolders?: unknown } | null | undefined
    )?.ignoredFolders;

    this.settings.navigationPropertyMapping = {
      ...((currentMapping && typeof currentMapping === 'object')
        ? currentMapping
        : DEFAULT_JEKYLL_MAPPING),
      ignoredFolders: Array.isArray(legacyIgnored)
        ? legacyIgnored.filter(
            (folder): folder is string => typeof folder === 'string'
          )
        : []
    };

    /*
     * Migración de la meta de escritura: la configuración anterior
     * guardaba metas por carpeta (folderWordGoals). La meta del
     * libro es la de la carpeta master; si existía, se conserva.
     */
    if (!(this.settings.bookWordGoal > 0)) {
      const legacyGoals: unknown =
        typeof loadedData === 'object' && loadedData !== null
          ? (loadedData as { folderWordGoals?: unknown }).folderWordGoals
          : undefined;
      const masterPath = this.settings.bookRootPath;
      const legacyMasterGoal =
        masterPath &&
        typeof legacyGoals === 'object' &&
        legacyGoals !== null
          ? (legacyGoals as Record<string, unknown>)[masterPath]
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
      this.settings,
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
/*
 * PluginSettingTab sin getSettingDefinitions (API declarativa
 * @since 1.13.0): es una RECOMENDACIÓN opcional del linter, no un
 * incumplimiento para minAppVersion 1.4.4. Adoptarla exigiría
 * reescribir el renderizado completo de esta pestaña (display() +
 * auto-refresco en 3 puntos) con riesgo real de alterar la
 * pantalla de ajustes del usuario. Mejora futura con alcance
 * propio si se eleva el mínimo soportado.
 */
class FolderLabSettingTab extends PluginSettingTab {
  plugin: FolderLabPlugin;

  constructor(app: App, plugin: FolderLabPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ============================================================
    // CABECERA — identidad del plugin
    // ============================================================
    containerEl.addClass('fl-settings-header');

    const headerTitle = containerEl.createDiv({
      cls: 'fl-settings-header-title'
    });

    headerTitle.createSpan({
      text: this.plugin.manifest.name,
      cls: 'fl-settings-header-name'
    });

    headerTitle.createSpan({
      text: `v${this.plugin.manifest.version}`,
      cls: 'fl-settings-header-version'
    });

    containerEl.createEl('p', {
      text: i18n.t('settings.header.description'),
      cls: 'fl-settings-header-desc'
    });

    // ============================================================
    // SECCIÓN: CARPETA MAESTRA
    // ============================================================

    let rootPathInput: HTMLInputElement | null = null;

    const rootSetting = new Setting(containerEl)
      .setName(i18n.t('settings.masterFolder.desc.name'))
      .setDesc(i18n.t('settings.masterFolder.desc.desc'))
      .addText(text => {
        text
          .setPlaceholder(i18n.t('settings.masterFolder.placeholder'))
          .setValue(this.plugin.settings.bookRootPath || '')
          .onChange(async (value) => {
            await this.plugin.setBookRootPath(value);
          });
        rootPathInput = text.inputEl;
      });

    rootSetting.addButton(button => button
      .setButtonText(i18n.t('settings.masterFolder.selectButton'))
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

              new Notice(i18n.t('settings.masterFolder.configuredNotice', { path: selected }));
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

    const masterPath = this.plugin.settings.bookRootPath;

    if (masterPath) {
      new Setting(containerEl)
        .setName(i18n.t('settings.masterFolder.current.name'))
        .setDesc(i18n.t('settings.masterFolder.currentFolderInfo', { path: masterPath }))
        .setClass('fl-settings-current-folder');
    } else {
      new Setting(containerEl)
        .setName(i18n.t('settings.masterFolder.empty.name'))
        .setDesc(i18n.t('settings.masterFolder.empty.desc'))
        .setClass('fl-settings-current-folder');
    }

    // ============================================================
    // SECCIÓN: NAVEGACIÓN
    // ============================================================
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
    propertySettingsContainer = containerEl.createDiv({
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
        .setPlaceholder('Title')
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
        .setPlaceholder('Parent')
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
        .setPlaceholder('Nav_order')
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
        .setPlaceholder('Has_children')
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
        .setPlaceholder('Permalink')
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
        .setPlaceholder('Assets')
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

    // ============================================================
    // SECCIÓN: OPCIONES GENERALES
    // ============================================================
    new Setting(containerEl)
      .setName(i18n.t('settings.general.heading'))
      .setHeading();

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
      .setClass('fl-settings-sub-option')
      .addDropdown(dropdown => dropdown
        .addOption('roman', i18n.t('settings.numberingStyle.option.roman'))
        .addOption('arabic', i18n.t('settings.numberingStyle.option.arabic'))
        .addOption('none', i18n.t('settings.numberingStyle.option.none'))
        .setValue(this.plugin.settings.numberingStyle)
        .onChange(async (value: 'roman' | 'arabic' | 'none') => {
          this.plugin.settings.numberingStyle = value;
          await this.plugin.saveSettings();
        }));

    // ===== SECCIÓN DE IA =====
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

    /*
     * Enlaces a la página oficial donde cada proveedor soportado
     * permite crear su API key. Misma decisión de apertura que
     * ResourcesWidget (window.open con _blank); la lista de
     * proveedores y sus URL se deriva del dropdown de arriba.
     */
    new Setting(containerEl)
      .setName(i18n.t('settings.ai.help.heading'))
      .setDesc(i18n.t('settings.ai.help.desc'));

    const currentProvider = this.plugin.settings.aiProvider || 'openai';
    const providerApiKeys: Array<{ id: string; name: string; url: string }> = [
      { id: 'openai', name: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
      { id: 'gemini', name: 'Google Gemini', url: 'https://aistudio.google.com/apikey' },
      { id: 'anthropic', name: 'Anthropic Claude', url: 'https://console.anthropic.com/settings/keys' }
    ];

    const apiKeysContainer = containerEl.createDiv({
      cls: 'fl-settings-apikeys'
    });

    for (const p of providerApiKeys) {
      const row = apiKeysContainer.createDiv({
        cls: 'fl-settings-apikey-row'
      });

      row.createSpan({
        text: p.name,
        cls: 'fl-settings-apikey-name'
      });

      if (p.id === currentProvider) {
        row.createSpan({
          text: i18n.t('settings.ai.help.current'),
          cls: 'fl-settings-apikey-current'
        });
      }

      const linkBtn = row.createEl('button', {
        cls: 'fl-settings-apikey-link'
      });
      setIcon(linkBtn, 'globe');
      linkBtn.setAttr('aria-label', i18n.t('settings.ai.help.openKeys', { provider: p.name }));
      linkBtn.setAttr('title', i18n.t('settings.ai.help.openKeys', { provider: p.name }));
      linkBtn.onclick = () => window.open(p.url, '_blank');
    }

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
        const idleText = i18n.t('settings.ai.testConnection.button');
        button
          .setButtonText(idleText)
          .setCta()
          .onClick(async () => {
            if (!this.plugin.aiService) {
              new Notice(i18n.t('errors.ai.notInitialized'));
              return;
            }

            button.setButtonText(i18n.t('settings.ai.testConnection.testing'));
            button.setDisabled(true);

            /*
             * try/finally: el control vuelve a su estado inicial
             * aunque la prueba resuelva o lance. Sin esto, una
             * excepción dejaba el botón bloqueado en «Probando…»
             * y el rechazo quedaba sin gestionar.
             */
            try {
              const result = await this.plugin.aiService.testConnection();

              if (result.success) {
                new Notice(`✅ ${result.message}`);
                button.setButtonText(i18n.t('settings.ai.testConnection.connected'));
                window.setTimeout(() => {
                  button.setButtonText(idleText);
                }, 3000);
              } else {
                new Notice(`❌ ${result.message}`);
                button.setButtonText(i18n.t('settings.ai.testConnection.error'));
                window.setTimeout(() => {
                  button.setButtonText(idleText);
                }, 3000);
              }
            } catch (error) {
              // Rechazo inesperado (nunca debería ocurrir con la
              // versión actual de testConnection, que captura todo,
              // pero el control no debe quedarse bloqueado).
              const detail =
                error instanceof Error && error.message
                  ? error.message
                  : i18n.t('common.unknownError');

              console.error(
                '[FolderLab] Excepción probando la conexión de IA:',
                error
              );
              new Notice(`❌ ${i18n.t('ai.connection.failed')}: ${detail}`);
              button.setButtonText(i18n.t('settings.ai.testConnection.error'));
              window.setTimeout(() => {
                button.setButtonText(idleText);
              }, 3000);
            } finally {
              button.setDisabled(false);
            }
          });
      });

    // ============================================================
    // NOTA INFORMATIVA — cierre de la sección de IA
    // ============================================================
    const aiInfoContainer = containerEl.createDiv({
      cls: 'fl-settings-ai-info'
    });

    const aiInfoHeader = aiInfoContainer.createDiv({
      cls: 'fl-settings-ai-info-header'
    });

    const aiInfoIcon = aiInfoHeader.createSpan({
      cls: 'fl-settings-ai-info-icon'
    });
    setIcon(aiInfoIcon, 'info');

    aiInfoHeader.createSpan({
      text: i18n.t('settings.ai.about.heading'),
      cls: 'fl-settings-ai-info-title'
    });

    const aiInfoBody = aiInfoContainer.createDiv({
      cls: 'fl-settings-ai-info-body'
    });

    aiInfoBody.createEl('p', {
      text: i18n.t('settings.ai.about.intro')
    });

    aiInfoBody.createEl('p', {
      text: i18n.t('settings.ai.about.capabilities')
    });

    aiInfoBody.createEl('p', {
      text: i18n.t('settings.ai.about.requirements')
    });
  }
}
