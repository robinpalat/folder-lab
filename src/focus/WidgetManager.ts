import { WidgetDefinition, WidgetInstance } from './WidgetDefinition';
import { FocusWidgetRegistry } from './FocusWidgetRegistry';
import { TFile } from 'obsidian';
import {
  NoteRepository,
  NoteContextLayout
} from '../storage/NoteRepository';

export class WidgetManager {

  private readonly registry: FocusWidgetRegistry;
  private instances: WidgetInstance[] = [];
  private layout: NoteContextLayout = {
    top: '',
    bottom: ''
  };
  private readonly noteRepository: NoteRepository;
  private currentNotePath: string | null = null;


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
    name: name?.trim() || definition.identity.label
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

    this.addInstance('memory', 'Asistente');
    this.addInstance('notes', 'Apuntes');
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
      name: name?.trim() || definition.identity.label
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
    const notePath = file.path;

    this.currentNotePath = notePath;

    const data = await this.noteRepository.loadNote(notePath);

  if (data) {
    this.instances = [...data.widgets];

    this.layout = {
      top: data.layout?.top ?? '',
      bottom: data.layout?.bottom ?? ''
    };

    this.ensureValidLayout();

    return;
  }

    // Primera vez que esta nota utiliza Contexto.
        // Primera vez que esta nota utiliza Contexto.
    this.instances = [];

this.createInstanceInternal('memory', 'Asistente');
this.createInstanceInternal('notes', 'Apuntes');

this.layout = {
  top: this.instances[1]?.instanceId ?? '',
  bottom: this.instances[0]?.instanceId ?? ''
};

    await this.saveForCurrentNote();
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
