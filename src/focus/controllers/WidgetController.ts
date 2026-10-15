import { Plugin } from 'obsidian';
import { PluginDataStore } from '../../storage/PluginDataStore';

/**
 * Registro de ítem/contenido de un widget (3C1: exportado para
 * reutilizarse en los contratos de contexto; forma intencionalmente
 * abierta, la widget dueña de sus campos).
 */
export type WidgetRecord = Record<string, any>;

export class WidgetController {

  private readonly cache =
    new Map<string, WidgetRecord>();

  private readonly listeners =
    new Set<() => void>();

  private readonly dataStore: PluginDataStore;

  constructor(
    private readonly plugin: Plugin,
    dataStore?: PluginDataStore
  ) {

    this.dataStore =
      dataStore ??
      new PluginDataStore(plugin);
  }

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

      if (!all[key]) {

        /*
         * Diagnóstico NO destructivo de claves huérfanas: si esta
         * nota tiene registros del widget bajo OTRO instanceId
         * (p. ej., una instancia recreada en el pasado), la lectura
         * actual los ignora y el widget aparece vacío. Se registra
         * en consola para poder identificar el caso sin migrar nada.
         */
        const prefix =
          `${storageKey}::${notePath}::`;

        const orphans = Object.keys(all).filter(
          candidate =>
            candidate.startsWith(prefix) &&
            candidate !== key &&
            Array.isArray(all[candidate]?.items) &&
            all[candidate].items.length > 0
        );

        if (orphans.length > 0) {
          console.warn(
            `[FolderLab] ${storageKey}: sin datos para la instancia actual, ` +
            `pero existen ${orphans.length} registro(s) bajo otra(s) instancia(s) ` +
            `de esta nota:`,
            orphans
          );
        }
      }

      const data =
        all[key] || {
          notePath,
          items: []
        };

      /*
       * Solo se instala en caché si no hay una entrada más fresca
       * (una escritura concurrente pudo cachear el registro ya
       * mutado mientras este get leía el estado anterior).
       */
      if (!this.cache.has(key)) {
        this.cache.set(
          key,
          data
        );
      }

      return this.cache.get(key) ?? data;
    },

    /**
     * Mutación ATÓMICA a nivel de ítem: lee el estado del disco
     * DENTRO de la transacción serializada, aplica el mutador y
     * escribe. La creación y la activación comparten así la misma
     * garantía: ninguna ráfaga ni lectura concurrente puede
     * reemplazar la clave con un registro divergente.
     */
    mutateItems: async (
      storageKey: string,
      notePath: string,
      instanceId: string,
      mutator: (
        items: WidgetRecord[],
        record: WidgetRecord
      ) => void
    ): Promise<WidgetRecord> => {

      const key =
        this.getStorageId(
          storageKey,
          notePath,
          instanceId
        );

      let written: WidgetRecord = {
        notePath,
        items: []
      };

      await this.dataStore.transact((full) => {

        // Frontera data.json (3E-6): unknown + guard de objeto;
        // el casting queda respaldado por el propio guard.
        const existing: unknown = full[storageKey];

        const all: Record<string, WidgetRecord> =
          existing && typeof existing === 'object'
            ? (existing as Record<string, WidgetRecord>)
            : {};

        const stored: unknown = all[key];

        const record: WidgetRecord =
          stored && typeof stored === 'object'
            ? stored
            : { notePath, items: [] };

        const items: WidgetRecord[] = Array.isArray(record.items)
          ? record.items
          : [];
        record.items = items;

        mutator(items, record);

        all[key] = record;
        full[storageKey] = all;

        written = record;
      });

      this.cache.set(
        key,
        written
      );

      this.notifyChange();

      return written;
    },

    add: async (
      storageKey: string,
      notePath: string,
      instanceId: string,
      item: WidgetRecord

    ): Promise<void> => {

      const normalizedItem = {
        ...item,
        id: item.id ?? this.generateId(storageKey),
        createdAt: item.createdAt ?? Date.now()
      };

      await this.storage.mutateItems(
        storageKey,
        notePath,
        instanceId,
        (items) => {
          items.push(normalizedItem);
        }
      );
    },

    update: async (
      storageKey: string,
      notePath: string,
      instanceId: string,
      itemId: string,
      changes: WidgetRecord
    ): Promise<WidgetRecord | null> => {

      let updated: WidgetRecord | null = null;

      await this.storage.mutateItems(
        storageKey,
        notePath,
        instanceId,
        (items) => {

          const item = items.find(
            (entry: WidgetRecord) =>
              entry.id === itemId
          );

          if (item) {
            Object.assign(item, changes);
            updated = item;
          }
        }
      );

      return updated;
    },

    delete: async (
      storageKey: string,
      notePath: string,
      instanceId: string,
      itemId: string
    ): Promise<void> => {

      await this.storage.mutateItems(
        storageKey,
        notePath,
        instanceId,
        (items) => {

          const index = items.findIndex(
            (entry: WidgetRecord) =>
              entry.id === itemId
          );

          if (index >= 0) {
            items.splice(index, 1);
          }
        }
      );
    },

    clear: async (
      storageKey: string,
      notePath: string,
      instanceId: string
    ): Promise<void> => {

      await this.storage.mutateItems(
        storageKey,
        notePath,
        instanceId,
        (items) => {
          items.length = 0;
        }
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

      /*
       * Lectura-modificación-escritura SERIALIZADA sobre el estado
       * más reciente del disco (PluginDataStore). El fusionado
       * ocurre DENTRO de la transacción: dos guardados concurrentes
       * de widgets o instancias distintas ya no se pisan.
       */
      await this.dataStore.transact((full) => {

        // Frontera data.json (3E-6): unknown + guard; casting
        // respaldado por el guard (mismo patrón que mutateItems).
        const existing: unknown = full[storageKey];

        const all: Record<string, WidgetRecord> =
          existing && typeof existing === 'object'
            ? (existing as Record<string, WidgetRecord>)
            : {};

        all[key] = data;

        full[storageKey] = all;
      });

      this.cache.set(
        key,
        data
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

      let result: boolean | null = null;

      await this.storage.mutateItems(
        storageKey,
        notePath,
        instanceId,
        (items) => {

          const item = items.find(
            (entry: WidgetRecord) =>
              entry.id === itemId
          );

          if (!item) {
            return;
          }

          const toggled = !item[field];
          item[field] = toggled;

          result = toggled;
        }
      );

      return result;
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

      let result: boolean | null = null;

      await this.storage.mutateItems(
        storageKey,
        notePath,
        instanceId,
        (items) => {

          const target = items.find(
            (entry: WidgetRecord) =>
              entry.id === itemId
          );

          if (!target) {
            return;
          }

          for (const item of items) {
            item[field] =
              item.id === itemId;
          }

          result = true;
        }
      );

      return result;
    }
  };


  // ============================================================
  // ORDERING
  // ============================================================

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

      return [...items].sort((a, b) => {

        // ------------------------------------------------------
        // 1. PRIORIDAD
        // ------------------------------------------------------

        const priority =
          definition.priority;

        if (priority) {

          const aPriority =
            a[priority.field] === priority.value;

          const bPriority =
            b[priority.field] === priority.value;

          if (aPriority !== bPriority) {
            return aPriority ? -1 : 1;
          }
        }

        // ------------------------------------------------------
        // 2. ORDEN PRINCIPAL
        // ------------------------------------------------------

        const primary =
          definition.primary;

        if (primary) {

          const av =
            a[primary.field];

          const bv =
            b[primary.field];

          if (av !== bv) {

            const comparison =
              av < bv ? -1 : 1;

            return primary.direction === 'ascending'
              ? comparison
              : -comparison;
          }
        }

        return 0;
      });
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

    await this.storage.mutateItems(
      storageKey,
      notePath,
      instanceId,
      (items) => {

        const next = items.filter(
          (item: WidgetRecord) =>
            item[field] !== value
        );

        items.length = 0;
        items.push(...next);
      }
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
        await this.dataStore.read();

      /*
       * 3E-6: frontera con data.json (datos externos). El valor
       * por clave se estrecha tras validar que es un objeto; cada
       * valor es un registro de widget de forma abierta ( WidgetRecord,
       * justificado en 3C1) cuyos campos valida cada widget en sus
       * bordes de lectura.
       */
      const raw: unknown = data?.[storageKey];

      if (!isPlainObject(raw)) {
        return {};
      }

      return raw as Record<string, WidgetRecord>;
    } catch {

      return {};
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}