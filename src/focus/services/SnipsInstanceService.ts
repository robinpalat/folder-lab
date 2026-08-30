import { WidgetInstance } from '../WidgetDefinition';
import { WidgetManager } from '../WidgetManager';
import { NoteRepository } from '../../storage/NoteRepository';

export class SnipsInstanceService {

  private instances: WidgetInstance[] = [];

  constructor(
    private readonly widgetManager: WidgetManager,
    private readonly noteRepository: NoteRepository
  ) {}

  /**
   * Carga las instancias de widgets de una nota
   * sin depender de que Focus haya sido abierto.
   */
  async loadForNote(
    notePath: string
  ): Promise<void> {

    const data =
      await this.noteRepository.loadNote(
        notePath
      );

    if (!data) {
      this.instances = [];
      return;
    }

    this.instances = [
      ...data.widgets
    ];
  }

  /**
   * Devuelve únicamente las instancias Snips.
   */
  getInstances(): WidgetInstance[] {
    return this.instances.filter(
      instance =>
        instance.typeId === 'snips'
    );
  }

  hasInstances(): boolean {
    return this.getInstances().length > 0;
  }

  getInstance(
    instanceId: string
  ): WidgetInstance | undefined {

    return this.getInstances().find(
      instance =>
        instance.instanceId === instanceId
    );
  }

  getNames(): string[] {
    return this.getInstances().map(
      instance =>
        instance.name
    );
  }
}