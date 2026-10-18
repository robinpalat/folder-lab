import { WidgetDefinition, WidgetInstance } from './WidgetDefinition';
import { FocusWidgetRegistry } from './FocusWidgetRegistry';
import { TFile } from 'obsidian';
import {
  NoteRepository,
  NoteContextLayout
} from '../storage/NoteRepository';
import { i18n } from '../i18n/I18nService';
import { getWidgetDefinitionLabel } from './widgets/definitionTexts';

export class WidgetManager {

  private readonly registry: FocusWidgetRegistry;
  private instances: WidgetInstance[] = [];
  private layout: NoteContextLayout = {
    top: '',
    bottom: ''
  };
  private readonly noteRepository: NoteRepository;
  private currentNotePath: string | null = null;
  /**
   * P2-B: token de generación de loadForNote. Dos cargas
   * superpuestas (A y B) pueden resolver en orden inverso; el
   * resultado obsoleto se descarta para no asignar instancias
   * de A al contexto de B ni guardarlas bajo la clave de B.
   */
  private loadGeneration = 0;

  private readonly listeners =
    new Set<() => void>();


  constructor(
    registry: FocusWidgetRegistry,
    noteRepository: NoteRepository
  ) {
    this.registry = registry;
    this.noteRepository = noteRepository;
  }


  private ensureValidLayout(): void {
    const validIds = new Set(
      this.instances.map(instance => instance.instanceId)
    );

    if (!validIds.has(this.layout.top)) {
      this.layout.top =
        this.instances[0]?.instanceId ?? '';
    }

    if (!validIds.has(this.layout.bottom)) {
      this.layout.bottom =
        this.instances[1]?.instanceId ??
        this.instances[0]?.instanceId ??
        '';
    }
  }

  private createInstanceInternal(
  typeId: string,
  name?: string
): WidgetInstance | null {
  const definition = this.getDefinition(typeId);

  if (!definition) {
    console.warn(
      `[WidgetManager] Tipo de widget desconocido: ${typeId}`
    );
    return null;
  }

  if (
    definition.cardinality === 'singleton' &&
    this.instances.some(
      instance => instance.typeId === typeId
    )
  ) {
    console.warn(
      `[WidgetManager] El widget "${typeId}" es singleton`
    );
    return null;
  }

  const instance: WidgetInstance = {
    instanceId: this.createInstanceId(typeId),
    typeId,
    name: name?.trim() || getWidgetDefinitionLabel(definition)
  };

  this.instances.push(instance);

  return instance;
}

async createInstance(
  typeId: string,
  name?: string
): Promise<WidgetInstance | null> {
  const instance = this.createInstanceInternal(typeId, name);

  if (!instance) {
    return null;
  }

  await this.saveForCurrentNote();

  return instance;
}



  getInstances(): WidgetInstance[] {
    return [...this.instances];
  }

  getLayout(): NoteContextLayout {
    return { ...this.layout };
  }

  setLayout(
    top: string,
    bottom: string
  ): void {
    const validIds = new Set(
      this.instances.map(instance => instance.instanceId)
    );

    if (!validIds.has(top) || !validIds.has(bottom)) {
      return;
    }

    this.layout = {
      top,
      bottom
    };
  }

  getInstance(instanceId: string): WidgetInstance | undefined {
    return this.instances.find(
      instance => instance.instanceId === instanceId
    );
  }

  initializeDefaults(): void {
    if (this.instances.length > 0) {
      return;
    }

    this.addInstance('memory', i18n.t('widgets.managerDefaultName.assistant'));
    this.addInstance('notes', i18n.t('widgets.managerDefaultName.notes'));
  }

  addInstance(typeId: string, name?: string): WidgetInstance | null {
    const definition = this.getDefinition(typeId);

    if (!definition) {
      console.warn(
        `[WidgetManager] Tipo de widget desconocido: ${typeId}`
      );
      return null;
    }

    if (
      definition.cardinality === 'singleton' &&
      this.instances.some(instance => instance.typeId === typeId)
    ) {
      return null;
    }

    const instance: WidgetInstance = {
      instanceId: this.createInstanceId(typeId),
      typeId,
      name: name?.trim() || getWidgetDefinitionLabel(definition)
    };

    this.instances.push(instance);

    return instance;
  }

  getInstanceByType(typeId: string): WidgetInstance | undefined {
    return this.instances.find(
      instance => instance.typeId === typeId
    );
  }

  getDefaultInstanceId(typeId: string): string | null {
    const instance = this.getInstanceByType(typeId);

    return instance?.instanceId ?? null;
  }

  removeInstance(instanceId: string): boolean {
    const index = this.instances.findIndex(
      instance => instance.instanceId === instanceId
    );

    if (index === -1) {
      return false;
    }

    this.instances.splice(index, 1);

    if (this.layout.top === instanceId) {
      this.layout.top = '';
    }

    if (this.layout.bottom === instanceId) {
      this.layout.bottom = '';
    }

    this.ensureValidLayout();

    return true;
  }

async renameInstance(
  instanceId: string,
  name: string
): Promise<boolean> {
  const instance = this.getInstance(instanceId);

  if (!instance) {
    return false;
  }

  const normalizedName = name.trim();

  if (!normalizedName) {
    return false;
  }

  instance.name = normalizedName;

  await this.saveForCurrentNote();

  this.notifyInstancesChanged();

  return true;
}

async deleteInstance(
  instanceId: string
): Promise<boolean> {
  const index = this.instances.findIndex(
    instance => instance.instanceId === instanceId
  );

  if (index === -1) {
    return false;
  }

  this.instances.splice(index, 1);

  if (this.layout.top === instanceId) {
    this.layout.top = '';
  }

  if (this.layout.bottom === instanceId) {
    this.layout.bottom = '';
  }

  await this.saveForCurrentNote();

  return true;
}



async applyInstances(
  draftInstances: WidgetInstance[]
): Promise<void> {

  const draftIds = new Set(
    draftInstances
      .filter(instance =>
        !instance.instanceId.startsWith('draft-')
      )
      .map(instance => instance.instanceId)
  );

  // ─────────────────────────────────────────────
  // 1. Eliminar instancias que ya no están
  // ─────────────────────────────────────────────

  this.instances = this.instances.filter(
    instance => draftIds.has(instance.instanceId)
  );

  // ─────────────────────────────────────────────
  // 2. Actualizar existentes y crear nuevas
  // ─────────────────────────────────────────────

  for (const draft of draftInstances) {

    // Instancia nueva
    if (draft.instanceId.startsWith('draft-')) {

      this.createInstanceInternal(
        draft.typeId,
        draft.name
      );

      continue;
    }

    // Instancia existente
    const current =
      this.instances.find(
        instance =>
          instance.instanceId === draft.instanceId
      );

    if (current) {
      current.name = draft.name.trim();
    }
  }

  // ─────────────────────────────────────────────
  // 3. Validar layout
  // ─────────────────────────────────────────────

  this.ensureValidLayout();

  // ─────────────────────────────────────────────
  // 4. Persistir una sola vez
  // ─────────────────────────────────────────────

  await this.saveForCurrentNote();

  this.notifyInstancesChanged();
}


  /**
   * Suscripción a cambios en las INSTANCIAS (p. ej. renombrado
   * desde Biblioteca). Mismo patrón que WidgetController.onChange.
   */
  onChange(
    listener: () => void
  ): () => void {

    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyInstancesChanged(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error(
          '[WidgetManager] Error en listener:',
          error
        );
      }
    }
  }


  getDefinition(typeId: string): WidgetDefinition | undefined {
    return this.registry.getDefinition(typeId);
  }

  private createInstanceId(typeId: string): string {
    return `${typeId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }


    async loadForNote(file: TFile): Promise<void> {
    const diagStart = performance.now();
    const notePath = file.path;
    const generation = ++this.loadGeneration;

    this.currentNotePath = notePath;

    console.warn(`[FolderLab][diag] loadForNote: inicio (${notePath})`);

    const data = await this.noteRepository.loadNote(notePath);

    // P2-B: si mientras cargaba ha llegado una carga más
    // reciente, este resultado queda obsoleto y se descarta:
    // el estado del manager debe corresponder siempre a la
    // nota más reciente solicitada.
    if (generation !== this.loadGeneration) {
      console.warn(
        `[FolderLab][diag] loadForNote: resultado obsoleto descartado (${notePath})`
      );
      return;
    }

  if (data) {
    this.instances = [...data.widgets];

    this.layout = {
      top: data.layout?.top ?? '',
      bottom: data.layout?.bottom ?? ''
    };

    this.ensureValidLayout();

    console.warn(
      `[FolderLab][diag] loadForNote: restaurado desde repositorio ` +
      `(${this.instances.length} instancias, ${(performance.now() - diagStart).toFixed(1)} ms)`
    );

    console.warn(
      `[FolderLab][diagID] FINAL nota=${notePath} ` +
      `instancias=${this.instances.length} ` +
      `layout-top=${this.layout.top ? 'OK' : 'FALTA'} ` +
      `layout-bottom=${this.layout.bottom ? 'OK' : 'FALTA'}`
    );

    return;
  }

    // Primera vez que esta nota utiliza Contexto.
    this.instances = [];

this.createInstanceInternal('memory', i18n.t('widgets.managerDefaultName.assistant'));
this.createInstanceInternal('notes', i18n.t('widgets.managerDefaultName.notes'));

this.layout = {
  top: this.instances[1]?.instanceId ?? '',
  bottom: this.instances[0]?.instanceId ?? ''
};

    await this.saveForCurrentNote();

    console.warn(
      `[FolderLab][diag] loadForNote: bootstrap completado ` +
      `(${this.instances.length} instancias, ${(performance.now() - diagStart).toFixed(1)} ms)`
    );
  }

  async saveForCurrentNote(): Promise<void> {
    if (!this.currentNotePath) {
      return;
    }

    await this.noteRepository.saveNote(
      this.currentNotePath,
      {
        widgets: [...this.instances],
        layout: { ...this.layout }
      }
    );
  }

  getCurrentNotePath(): string | null {
    return this.currentNotePath;
  }
}
