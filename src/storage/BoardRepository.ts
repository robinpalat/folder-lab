import { App } from 'obsidian';
import { HiddenFolderManager } from './HiddenFolderManager';
import { EntityFileStore } from './EntityFileStore';
import { PolishHistory } from './PolishHistory';
import { INTERNAL_FOLDER } from '../constants/view-types';

const BOARD_FILE = '_board.json';

export type BoardViewMode = 'explore' | 'architecture' | 'document';

/**
 * Nodo estructural de la instancia Arquitectura.
 *
 * La jerarquía se representa como una lista plana ordenada con
 * niveles (modelo outliner): la relación padre-hijo se deduce del
 * orden + nivel. El orden del array ES el orden editorial.
 *
 * `blockIds` son referencias a los bloques de Explorar:
 * la asignación nunca copia el contenido.
 */
export interface BoardArchNode {
  id: string;

  /** 0 = título · 1 = capítulo/sección · 2 = subsección · 3 = apartado */
  level: number;

  title: string;

  blockIds: string[];
}

export interface BoardArchitecture {
  nodes: BoardArchNode[];
}

/**
 * Versión personal de un fragmento del Documento.
 *
 * El original NUNCA se sobrescribe: `originalText` es el texto vivo
 * de la tarjeta de origen (se resuelve en render). Solo se persiste
 * la versión alternativa y qué versión está activa.
 */
export interface BoardFragmentOverride {
  /** Id estable: `block:<blockId>` */
  id: string;
  blockId: string;
  overrideText: string;
  useOverride: boolean;
}

export interface BoardBlock {
  id: string;
  text: string;

  /**
   * Tipo de widget de origen ('snips', 'candidates', ...).
   * 'text' cuando el origen no declaró procedencia
   * (selección de lectura, apuntes, etc.).
   */
  sourceType: string;

  sourceInstanceId?: string;
  sourceItemId?: string;

  /** Sesión de origen ('today' = "Hoy"), según el modelo de los widgets. */
  sessionId?: string;

  /** Activo en Explorar. Los inactivos no participan en el Documento. default true */
  active?: boolean;

  x: number;
  y: number;
}

export interface BoardConnection {
  id: string;

  /**
   * Extremos de la conexión: un extremo puede ser una TARJETA
   * (sourceBlockId/targetBlockId) o un CONTENEDOR DE GRUPO
   * (sourceGroupId/targetGroupId). Datos previos (solo bloques)
   * se leen sin cambios.
   */
  sourceBlockId?: string;
  targetBlockId?: string;
  sourceGroupId?: string;
  targetGroupId?: string;
}

/**
 * Grupo etiquetado del lienzo: conjunto estable de tarjetas con
 * una etiqueta. Referencias por id — sin copias de contenido.
 */
export interface BoardGroup {
  id: string;
  label: string;
  blockIds: string[];

  /**
   * Geometría del contenedor rectangular en el lienzo (coords de
   * contenido, como las tarjetas). Se recalcula al mover miembros
   * y se persiste como objeto independiente.
   */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface BoardData {
  blocks: BoardBlock[];
  connections: BoardConnection[];

  viewMode?: BoardViewMode;
  architecture?: BoardArchitecture;
  fragmentOverrides?: BoardFragmentOverride[];
  groups?: BoardGroup[];
}

export interface BoardStore {
  [notePath: string]: BoardData;
}

/**
 * Comprueba que un valor es un objeto simple (no array, no null).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

const VIEW_MODE_VALUES: readonly BoardViewMode[] = [
  'explore',
  'architecture',
  'document'
];

/**
 * Valida una entrada de Board al CARGAR (P0-1).
 *
 * Tolerancia deliberada a datos antiguos: los campos opcionales
 * pueden ausentarse (se rellenan con valores por defecto en
 * `Board.load`). Lo que NO se tolera es un campo presente con
 * forma incorrecta: eso es dato malformado y no debe descartarse
 * silenciosamente ni utilizarse.
 */
function assertStoredBoardData(
  value: unknown,
  context: string
): asserts value is BoardData {
  if (!isPlainObject(value)) {
    throw new Error(
      `[BoardRepository] Entrada malformada en ${context}: se esperaba un objeto`
    );
  }

  if (value.blocks !== undefined && !isObjectArray(value.blocks)) {
    throw new Error(
      `[BoardRepository] Entrada malformada en ${context}: "blocks" debe ser un array de objetos`
    );
  }

  if (value.connections !== undefined && !isObjectArray(value.connections)) {
    throw new Error(
      `[BoardRepository] Entrada malformada en ${context}: "connections" debe ser un array de objetos`
    );
  }

  if (
    value.viewMode !== undefined &&
    !VIEW_MODE_VALUES.includes(value.viewMode as BoardViewMode)
  ) {
    throw new Error(
      `[BoardRepository] Entrada malformada en ${context}: "viewMode" no es un modo válido`
    );
  }

  if (
    value.architecture !== undefined &&
    (!isPlainObject(value.architecture) ||
      (value.architecture.nodes !== undefined &&
        !isObjectArray(value.architecture.nodes)))
  ) {
    throw new Error(
      `[BoardRepository] Entrada malformada en ${context}: "architecture" debe ser un objeto con "nodes"`
    );
  }

  if (
    value.fragmentOverrides !== undefined &&
    !isObjectArray(value.fragmentOverrides)
  ) {
    throw new Error(
      `[BoardRepository] Entrada malformada en ${context}: "fragmentOverrides" debe ser un array de objetos`
    );
  }

  if (value.groups !== undefined && !isObjectArray(value.groups)) {
    throw new Error(
      `[BoardRepository] Entrada malformada en ${context}: "groups" debe ser un array de objetos`
    );
  }
}

/**
 * Valida un BoardData antes de ESCRIBIRLO (P0-1).
 *
 * `blocks` y `connections` son requeridos por el contrato de
 * escritura de `Board.save`; los campos opcionales, si viajan,
 * deben tener forma correcta.
 */
function assertBoardDataForSave(
  value: unknown,
  context: string
): asserts value is BoardData {
  if (!isPlainObject(value)) {
    throw new Error(
      `[BoardRepository] Datos a guardar inválidos en ${context}: se esperaba un objeto`
    );
  }

  if (!isObjectArray(value.blocks)) {
    throw new Error(
      `[BoardRepository] Datos a guardar inválidos en ${context}: "blocks" debe ser un array de objetos`
    );
  }

  if (!isObjectArray(value.connections)) {
    throw new Error(
      `[BoardRepository] Datos a guardar inválidos en ${context}: "connections" debe ser un array de objetos`
    );
  }

  assertStoredBoardData(value, context);
}

export class BoardRepository {

  private readonly hiddenManager: HiddenFolderManager;
  private readonly identity?: (notePath: string) => Promise<string | null>;
  private readonly getRootPath?: () => string | null;
  private readonly legacyOwnershipSafe?: (
    notePath: string
  ) => Promise<boolean>;
  private readonly entities: EntityFileStore<BoardData> | null;
  private readonly polishHistory: PolishHistory | null;

  /*
   * P2-1: cola FIFO de operaciones sobre el almacén de la
   * carpeta. Mismo mecanismo que PluginDataStore (tail +
   * catch para que un fallo no bloquee la cola): cada
   * lectura-modificación-escritura se ejecuta completa antes
   * de que empiece la siguiente, de modo que dos escrituras no
   * pueden terminarse aplicándose en orden inverso y un RMW
   * concurrente no pierde actualizaciones de otras notas.
   * Instancia única por plugin (compartida por todos los Board).
   */
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly app: App,
    options?: {
      identity?: (notePath: string) => Promise<string | null>;
      getRootPath?: () => string | null;
      /**
       * Corrección A: propiedad segura de datos legados por ruta.
       * false cuando la ruta tiene pendientes de otra identidad (no
       * se adopta el store legado). Ausente = sin criterio (legacy).
       */
      legacyOwnershipSafe?: (notePath: string) => Promise<boolean>;
    }
  ) {
    this.hiddenManager = new HiddenFolderManager(
      app,
      INTERNAL_FOLDER
    );
    this.identity = options?.identity;
    this.getRootPath = options?.getRootPath;
    this.legacyOwnershipSafe = options?.legacyOwnershipSafe;
    this.entities =
      this.identity && this.getRootPath
        ? new EntityFileStore<BoardData>(app, {
            subfolder: 'boards',
            getRootPath: this.getRootPath,
            validate: (data, context) => {
              assertStoredBoardData(data, context);
            }
          })
        : null;
    this.polishHistory =
      this.getRootPath !== undefined
        ? new PolishHistory(app, this.getRootPath)
        : null;
  }

  /** Id estable de la nota si la identidad está disponible. */
  private async entityId(notePath: string): Promise<string | null> {
    if (!this.identity || !this.getRootPath?.()) return null;
    return this.identity(notePath);
  }

  /** Historial de versiones de Pulir (Etapa 4); null sin Master. */
  getPolishHistory(): PolishHistory | null {
    return this.polishHistory;
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.tail.then(op, op);

    // La cadena continúa aunque la operación falle.
    this.tail = result.then(() => {}, () => {});

    return result;
  }

  /**
   * Lee y valida el almacén SIN pasar por la cola (solo para uso
   * INTERNO dentro de una operación ya encolada; usar los
   * métodos públicos fuera de ese contexto).
   */
  private async readStoreRaw(folderPath: string): Promise<BoardStore> {
    const data = await this.hiddenManager.readJSON<BoardStore>(
      folderPath,
      BOARD_FILE
    );

    if (data === null) {
      return {};
    }

    if (!isPlainObject(data)) {
      throw new Error(
        `[BoardRepository] El almacén "${folderPath}/${BOARD_FILE}" no tiene la forma esperada`
      );
    }

    return data;
  }

  private async writeStoreRaw(
    folderPath: string,
    data: BoardStore
  ): Promise<void> {
    await this.hiddenManager.writeJSON(
      folderPath,
      BOARD_FILE,
      data
    );
  }

  /**
   * Carga el almacén de una carpeta.
   *
   * P0-1: un archivo ausente produce un almacén vacío (caso
   * legítimo de primera escritura). Un error de lectura o JSON
   * inválido PROPAGA: jamás se devuelve `{}` en su lugar, porque
   * el siguiente `saveNote` reescribiría el archivo con una única
   * entrada y borraría los boards de las demás notas.
   */
  loadFolder(folderPath: string): Promise<BoardStore> {
    return this.enqueue(async () => {
      const legacy = await this.readStoreRaw(folderPath);
      if (!this.entities) return legacy;

      // Fusión: el store legado + los archivos por entidad (la
      // entidad gana). Los archivos corruptos se omiten con log.
      const merged: BoardStore = { ...legacy };
      const items = await this.entities.list();
      const prefix =
        folderPath === '' ? '' : folderPath.replace(/\/+$/, '') + '/';
      for (const { envelope } of items) {
        const notePath = envelope.notePath;
        const inFolder =
          folderPath === ''
            ? !notePath.includes('/')
            : notePath.startsWith(prefix);
        if (inFolder) {
          merged[notePath] = envelope.data;
        }
      }
      return merged;
    });
  }

  saveFolder(
    folderPath: string,
    data: BoardStore
  ): Promise<void> {
    return this.enqueue(() => this.writeStoreRaw(folderPath, data));
  }

  /**
   * Migra la entrada de una nota al renombrarla/moverla (Etapa 1).
   * Invariante anti-pérdida: el destino se escribe ANTES de retirar
   * el origen; si la escritura de destino falla, el origen queda
   * intacto y la operación PROPAGA.
   */
  migrateEntry(oldPath: string, newPath: string): Promise<void> {
    return this.enqueue(async () => {
      const oldFolder = this.getParentFolderPath(oldPath);
      const newFolder = this.getParentFolderPath(newPath);

      if (oldFolder === null || newFolder === null) return;

      if (oldFolder === newFolder) {
        const store = await this.readStoreRaw(oldFolder);
        if (oldPath in store) {
          store[newPath] = store[oldPath];
          delete store[oldPath];
          await this.writeStoreRaw(oldFolder, store);
        }
      } else {
        const source = await this.readStoreRaw(oldFolder);
        if (oldPath in source) {
          const entry = source[oldPath];
          const target = await this.readStoreRaw(newFolder);
          target[newPath] = entry;
          await this.writeStoreRaw(newFolder, target);
          delete source[oldPath];
          await this.writeStoreRaw(oldFolder, source);
        }
      }

      // El re-clavado de la entidad se aplica aunque la entrada
      // viva SOLO en el archivo por entidad (Etapa 3).
      if (this.entities) {
        await this.entities.rekeyNotePath(
          (p) => p === oldPath,
          () => newPath
        );
      }
    });
  }

  /**
   * Re-clava todas las entradas bajo un prefijo al renombrar una
   * carpeta. El archivo del store se localiza por el padre del
   * prefijo (el renombrar no cambia el padre).
   */
  migrateFolderPrefix(
    oldPrefix: string,
    newPrefix: string
  ): Promise<void> {
    return this.enqueue(async () => {
      const oldBase = oldPrefix.replace(/\/+$/, '');
      const newBase = newPrefix.replace(/\/+$/, '');
      // El archivo del store se MOVIÓ con la carpeta renombrada:
      // tras el evento, la ubicación válida es la nueva.
      const folderPath = newBase;

      const store = await this.readStoreRaw(folderPath);
      let changed = false;
      for (const key of Object.keys(store)) {
        if (key === oldBase || key.startsWith(oldBase + '/')) {
          const next =
            key === oldBase
              ? newBase
              : newBase + '/' + key.slice(oldBase.length + 1);
          store[next] = store[key];
          delete store[key];
          changed = true;
        }
      }
      if (changed) await this.writeStoreRaw(folderPath, store);
      if (this.entities) {
        await this.entities.rekeyNotePath(
          (p) => p === oldBase || p.startsWith(oldBase + '/'),
          (p) =>
            p === oldBase
              ? newBase
              : newBase + '/' + p.slice(oldBase.length + 1)
        );
      }
    });
  }

  loadNote(notePath: string): Promise<BoardData | null> {
    return this.enqueue(async () => {
      const folderPath = this.getParentFolderPath(notePath);

      if (folderPath === null) {
        return null;
      }

      // 1) Archivo por entidad (verdad única, Etapa 3). JSON
      //    ilegible PROPAGA (protección anti-pisado).
      const id = await this.entityId(notePath);
      if (id && this.entities) {
        const envelope = await this.entities.read(id);
        if (envelope !== null) {
          return envelope.data;
        }

        // Corrección A: identidad ACTIVA sin entidad propia: el
        // store legado por ruta solo se adopta si la propiedad es
        // segura (la ruta no tiene pendientes de otra identidad).
        if (this.legacyOwnershipSafe) {
          const safe = await this.legacyOwnershipSafe(notePath);
          if (!safe) {
            return null;
          }
        }
      }

      // 2) Fallback al store multipath legado (+ migración perezosa).
      const store = await this.readStoreRaw(folderPath);

      const entry = store[notePath];

      if (entry === undefined) {
        return null;
      }

      // Entrada propia malformada: se rechaza en lugar de
      // descartarla silenciosamente (la siguiente escritura la
      // sobrescribiría con un estado inventado).
      assertStoredBoardData(entry, `"${notePath}"`);

      if (id && this.entities) {
        await this.entities.write(id, notePath, entry).catch((error) => {
          console.error(
            '[BoardRepository] Migración perezosa fallida:',
            error
          );
        });
      }

      return entry;
    });
  }

  saveNote(
    notePath: string,
    data: BoardData
  ): Promise<void> {
    return this.enqueue(async () => {
      assertBoardDataForSave(data, `"${notePath}"`);

      // Ruta por entidad (Etapa 3): verdad única por nota. Si el
      // archivo existente es ilegible, la lectura protege PROPAGA
      // y la escritura queda abortada (nunca se pisa un corrupto).
      const id = await this.entityId(notePath);
      if (id && this.entities) {
        await this.entities.read(id);
        await this.entities.write(id, notePath, data);
        // Etapa 4: snapshot del historial de Pulir (best-effort;
        // el estado vigente ya está en la entidad recién escrita).
        if (this.polishHistory) {
          try {
            await this.polishHistory.append(
              id,
              notePath,
              data.fragmentOverrides ?? []
            );
          } catch (error) {
            console.error(
              '[BoardRepository] Snapshot de Pulir fallido:',
              error
            );
          }
        }
        return;
      }

      const folderPath = this.getParentFolderPath(notePath);

      if (folderPath === null) {
        throw new Error(
          `[BoardRepository] No se pudo determinar la carpeta padre de "${notePath}"`
        );
      }

      // Si la lectura del almacén falla o el JSON está corrupto,
      // readStoreRaw lanza y la escritura queda ABORTADA: los
      // datos existentes en disco se conservan intactos.
      const store = await this.readStoreRaw(folderPath);

      store[notePath] = data;

      await this.writeStoreRaw(folderPath, store);
    });
  }

  private getParentFolderPath(notePath: string): string | null {
    const separatorIndex = notePath.lastIndexOf('/');

    if (separatorIndex === -1) {
      return '';
    }

    return notePath.substring(0, separatorIndex);
  }
}
