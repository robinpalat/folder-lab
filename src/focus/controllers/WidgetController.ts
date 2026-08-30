import { Plugin } from 'obsidian';

type WidgetRecord = Record<string, any>;

export class WidgetController {

  private readonly cache =
    new Map<string, WidgetRecord>();

  private readonly listeners =
    new Set<() => void>();

  constructor(
    private readonly plugin: Plugin
  ) { }

  // ============================================================
  // EVENTS
  // ============================================================

  onChange(
    listener: () => void
  ): () => void {

    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error(
          '[WidgetController] Error en listener:',
          error
        );
      }
    }
  }

  // ============================================================
  // STORAGE
  // ============================================================

  readonly storage = {

    get: async (
      storageKey: string,
      notePath: string,
      instanceId: string
    ): Promise<WidgetRecord> => {

      const key =
        this.getStorageId(
          storageKey,
          notePath,
          instanceId
        );

      const cached =
        this.cache.get(key);

      if (cached) {
        return cached;
      }

      const all =
        await this.loadStorage(
          storageKey
        );

      const data =
        all[key] || {
          notePath,
          items: []
        };

      this.cache.set(
        key,
        data
      );

      return data;
    },

    add: async (
      storageKey: string,
      notePath: string,
      instanceId: string,
      item: WidgetRecord

    ): Promise<void> => {

      const data =
        await this.storage.get(
          storageKey,
          notePath,
          instanceId
        );

      if (!Array.isArray(data.items)) {
        data.items = [];
      }

      const normalizedItem = {
        ...item,
        id: item.id ?? this.generateId(storageKey),
        createdAt: item.createdAt ?? Date.now()
      };

      data.items.push(normalizedItem);

      await this.storage.save(
        storageKey,
        notePath,
        instanceId,
        data
      );
    },

    update: async (
      storageKey: string,
      notePath: string,
      instanceId: string,
      itemId: string,
      changes: WidgetRecord
    ): Promise<WidgetRecord | null> => {

      const data =
        await this.storage.get(
          storageKey,
          notePath,
          instanceId
        );

      if (!Array.isArray(data.items)) {
        return null;
      }

      const item =
        data.items.find(
          (entry: WidgetRecord) =>
            entry.id === itemId
        );

      if (!item) {
        return null;
      }

      Object.assign(
        item,
        changes
      );

      await this.storage.save(
        storageKey,
        notePath,
        instanceId,
        data
      );

      return item;
    },

    delete: async (
      storageKey: string,
      notePath: string,
      instanceId: string,
      itemId: string
    ): Promise<void> => {

      const data =
        await this.storage.get(
          storageKey,
          notePath,
          instanceId
        );

      if (!Array.isArray(data.items)) {
        return;
      }

      data.items =
        data.items.filter(
          (entry: WidgetRecord) =>
            entry.id !== itemId
        );

      await this.storage.save(
        storageKey,
        notePath,
        instanceId,
        data
      );
    },

    clear: async (
      storageKey: string,
      notePath: string,
      instanceId: string
    ): Promise<void> => {

      const data =
        await this.storage.get(
          storageKey,
          notePath,
          instanceId
        );

      data.items = [];

      await this.storage.save(
        storageKey,
        notePath,
        instanceId,
        data
      );
    },

    save: async (
      storageKey: string,
      notePath: string,
      instanceId: string,
      data: WidgetRecord
    ): Promise<void> => {

      const key =
        this.getStorageId(
          storageKey,
          notePath,
          instanceId
        );

      this.cache.set(
        key,
        data
      );

      const all =
        await this.loadStorage(
          storageKey
        );

      all[key] = data;

      await this.saveStorage(
        storageKey,
        all
      );

      this.notifyChange();
    }
  };

  // ============================================================
  // STATE
  // ============================================================

  readonly state = {

    toggle: async (
      storageKey: string,
      notePath: string,
      instanceId: string,
      itemId: string,
      field: string
    ): Promise<boolean | null> => {

      const data =
        await this.storage.get(
          storageKey,
          notePath,
          instanceId
        );

      if (!Array.isArray(data.items)) {
        return null;
      }

      const item =
        data.items.find(
          (entry: WidgetRecord) =>
            entry.id === itemId
        );

      if (!item) {
        return null;
      }

      item[field] =
        !Boolean(item[field]);

      await this.storage.save(
        storageKey,
        notePath,
        instanceId,
        data
      );

      return Boolean(item[field]);
    }
  };

  // ============================================================
  // SELECTION
  // ============================================================

  readonly selection = {

    select: async (
      storageKey: string,
      notePath: string,
      instanceId: string,
      itemId: string,
      field: string
    ): Promise<boolean | null> => {

      const data =
        await this.storage.get(
          storageKey,
          notePath,
          instanceId
        );

      if (!Array.isArray(data.items)) {
        return null;
      }

      const target =
        data.items.find(
          (entry: WidgetRecord) =>
            entry.id === itemId
        );

      if (!target) {
        return null;
      }

      for (const item of data.items) {
        item[field] =
          item.id === itemId;
      }

      await this.storage.save(
        storageKey,
        notePath,
        instanceId,
        data
      );

      return true;
    }
  };


  // ============================================================
  // ORDERING
  // ============================================================

  readonly ordering = {

    sort: (
      items: WidgetRecord[],
      definition: {
        primary?: {
          field: string;
          direction:
          'ascending' |
          'descending';
        };

        priority?: {
          field: string;
          value: unknown;
        };
      }
    ): WidgetRecord[] => {

      const result =
        [...items];

      const priority =
        definition.priority;

      if (priority) {
        result.sort((a, b) => {

          const aPriority =
            a[priority.field] ===
            priority.value;

          const bPriority =
            b[priority.field] ===
            priority.value;

          if (aPriority === bPriority) {
            return 0;
          }

          return aPriority
            ? -1
            : 1;
        });
      }

      const primary =
        definition.primary;

      if (primary) {
        result.sort((a, b) => {

          const av =
            a[primary.field];

          const bv =
            b[primary.field];

          if (av === bv) {
            return 0;
          }

          const comparison =
            av < bv ? -1 : 1;

          return primary.direction ===
            'ascending'
            ? comparison
            : -comparison;
        });
      }

      return result;
    }
  };

  // ============================================================
  // METRICS
  // ============================================================


  async clearByState(
    storageKey: string,
    notePath: string,
    instanceId: string,
    field: string,
    value: unknown
  ): Promise<void> {

    const data =
      await this.storage.get(
        storageKey,
        notePath,
        instanceId
      );

    if (!Array.isArray(data.items)) {
      return;
    }

    data.items =
      data.items.filter(
        (item: WidgetRecord) =>
          item[field] !== value
      );

    await this.storage.save(
      storageKey,
      notePath,
      instanceId,
      data
    );
  }



  readonly metrics = {

    count: (
      items: WidgetRecord[],
      field?: string,
      value?: unknown
    ): number => {

      if (!field) {
        return items.length;
      }

      return items.filter(
        item =>
          item[field] === value
      ).length;
    }
  };

  // ============================================================
  // ID
  // ============================================================

  generateId(
    prefix: string
  ): string {

    return `${prefix}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  // ============================================================
  // CACHE
  // ============================================================

  clearCache(): void {
    this.cache.clear();
  }

  // ============================================================
  // INTERNAL STORAGE
  // ============================================================

  private getStorageId(
    storageKey: string,
    notePath: string,
    instanceId: string
  ): string {

    return `${storageKey}::${notePath}::${instanceId}`;
  }

  private async loadStorage(
    storageKey: string
  ): Promise<Record<string, WidgetRecord>> {

    try {

      const data =
        await this.plugin.loadData();

      return data?.[storageKey] || {};

    } catch {

      return {};
    }
  }

  private async saveStorage(
    storageKey: string,
    data: Record<string, WidgetRecord>
  ): Promise<void> {

    const fullData =
      await this.plugin.loadData() || {};

    fullData[storageKey] =
      data;

    await this.plugin.saveData(
      fullData
    );
  }
}