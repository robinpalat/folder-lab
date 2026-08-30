import { Plugin } from 'obsidian';
import { Task, TaskData } from '../types/tasks';

export class TasksController {
  private plugin: Plugin;
  private storageKey = 'tasks';

  private cache: Map<string, TaskData> = new Map();

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  private generateId(): string {
    return `task-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  /**
   * Identidad de almacenamiento de una instancia concreta.
   *
   * Una misma nota puede contener varias instancias del widget
   * Tareas, por lo que notePath por sí solo ya no es suficiente.
   */
  private getStorageId(
    notePath: string,
    instanceId: string
  ): string {
    return `${notePath}::${instanceId}`;
  }

  private async loadAllData(): Promise<Record<string, TaskData>> {
    try {
      const data = await this.plugin.loadData();

      return data?.[this.storageKey] || {};

    } catch {
      return {};
    }
  }

  private async saveAllData(
    data: Record<string, TaskData>
  ): Promise<void> {

    try {
      const fullData =
        await this.plugin.loadData() || {};

      fullData[this.storageKey] = data;

      await this.plugin.saveData(fullData);

    } catch (error) {

      console.error(
        'Error saving tasks:',
        error
      );
    }
  }

  private async ensureNoteData(
    notePath: string,
    instanceId: string
  ): Promise<TaskData> {

    const storageId =
      this.getStorageId(
        notePath,
        instanceId
      );

    let data =
      this.cache.get(storageId);

    if (!data) {

      const all =
        await this.loadAllData();

      const saved =
        all[storageId];

      if (saved) {

        data = saved;

      } else {

        data = {
          notePath,
          tasks: []
        };
      }

      this.cache.set(
        storageId,
        data
      );
    }

    return data;
  }

  private async saveNoteData(
    notePath: string,
    instanceId: string,
    data: TaskData
  ): Promise<void> {

    const storageId =
      this.getStorageId(
        notePath,
        instanceId
      );

    this.cache.set(
      storageId,
      data
    );

    const all =
      await this.loadAllData();

    all[storageId] = data;

    await this.saveAllData(all);
  }

  // ============================================================
  // CONSULTA
  // ============================================================

  async getTasks(
    notePath: string,
    instanceId: string
  ): Promise<Task[]> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    return data.tasks;
  }

  /**
   * Devuelve únicamente las tareas activas/pedientes.
   *
   * getTasks() sigue siendo la fuente completa para el widget.
   */
  async getActiveTasks(
    notePath: string,
    instanceId: string
  ): Promise<Task[]> {

    const tasks =
      await this.getTasks(
        notePath,
        instanceId
      );

    return tasks.filter(
      task => !task.completed
    );
  }

  // ============================================================
  // CREACIÓN
  // ============================================================

  async addTask(
    notePath: string,
    instanceId: string,
    title: string,
    description: string = ''
  ): Promise<Task> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    const task: Task = {
      id: this.generateId(),
      title: title.trim(),
      description: description.trim(),
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    data.tasks.push(task);

    await this.saveNoteData(
      notePath,
      instanceId,
      data
    );

    return task;
  }

  // ============================================================
  // MODIFICACIÓN
  // ============================================================

  async toggleTask(
    notePath: string,
    instanceId: string,
    taskId: string
  ): Promise<void> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    const task =
      data.tasks.find(
        t => t.id === taskId
      );

    if (task) {

      task.completed =
        !task.completed;

      task.updatedAt =
        Date.now();

      await this.saveNoteData(
        notePath,
        instanceId,
        data
      );
    }
  }

  // ============================================================
  // ELIMINACIÓN
  // ============================================================

  async deleteTask(
    notePath: string,
    instanceId: string,
    taskId: string
  ): Promise<void> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    data.tasks =
      data.tasks.filter(
        t => t.id !== taskId
      );

    await this.saveNoteData(
      notePath,
      instanceId,
      data
    );
  }

  async clearCompleted(
    notePath: string,
    instanceId: string
  ): Promise<void> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    data.tasks =
      data.tasks.filter(
        t => !t.completed
      );

    await this.saveNoteData(
      notePath,
      instanceId,
      data
    );
  }

  // ============================================================
  // ESTADÍSTICAS
  // ============================================================

  getStats(
    notePath: string,
    instanceId: string
  ): {
    total: number;
    completed: number;
    pending: number;
  } {

    const storageId =
      this.getStorageId(
        notePath,
        instanceId
      );

    const data =
      this.cache.get(storageId);

    if (!data) {

      return {
        total: 0,
        completed: 0,
        pending: 0
      };
    }

    const total =
      data.tasks.length;

    const completed =
      data.tasks.filter(
        task => task.completed
      ).length;

    return {
      total,
      completed,
      pending: total - completed
    };
  }
}