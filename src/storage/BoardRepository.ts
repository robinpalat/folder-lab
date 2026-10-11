import { App } from 'obsidian';
import { HiddenFolderManager } from './HiddenFolderManager';
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

export class BoardRepository {

  private readonly hiddenManager: HiddenFolderManager;

  constructor(private readonly app: App) {
    this.hiddenManager = new HiddenFolderManager(
      app,
      INTERNAL_FOLDER
    );
  }

  async loadFolder(folderPath: string): Promise<BoardStore> {
    const data = await this.hiddenManager.readJSON<BoardStore>(
      folderPath,
      BOARD_FILE
    );

    return data ?? {};
  }

  async saveFolder(
    folderPath: string,
    data: BoardStore
  ): Promise<void> {
    await this.hiddenManager.writeJSON(
      folderPath,
      BOARD_FILE,
      data
    );
  }

  async loadNote(notePath: string): Promise<BoardData | null> {
    const folderPath = this.getParentFolderPath(notePath);

    if (folderPath === null) {
      return null;
    }

    const store = await this.loadFolder(folderPath);

    return store[notePath] ?? null;
  }

  async saveNote(
    notePath: string,
    data: BoardData
  ): Promise<void> {
    const folderPath = this.getParentFolderPath(notePath);

    if (folderPath === null) {
      throw new Error(
        `[BoardRepository] No se pudo determinar la carpeta padre de "${notePath}"`
      );
    }

    const store = await this.loadFolder(folderPath);

    store[notePath] = data;

    await this.saveFolder(folderPath, store);
  }

  private getParentFolderPath(notePath: string): string | null {
    const separatorIndex = notePath.lastIndexOf('/');

    if (separatorIndex === -1) {
      return '';
    }

    return notePath.substring(0, separatorIndex);
  }
}
