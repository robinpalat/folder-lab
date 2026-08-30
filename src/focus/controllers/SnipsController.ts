import { Plugin } from 'obsidian';
import {
  SnipFragment,
  SnipSession,
  SnipData
} from '../types/snips';

export class SnipsController {

  private plugin: Plugin;
  private storageKey = 'snips';

  private cache: Map<string, SnipData> =
    new Map();

  private listeners: Array<() => void> = [];

  constructor(plugin: Plugin) {
    this.plugin = plugin;

  }

  // ============================================================
  // EVENTOS
  // ============================================================

  onChange(listener: () => void): void {

    this.listeners.push(listener);
  }

  private notifyChange(): void {

    for (const listener of this.listeners) {

      try {

        listener();

      } catch (error) {

        console.error(
          'SnipsController: error en listener:',
          error
        );
      }
    }
  }

  // ============================================================
  // IDENTIDAD DE ALMACENAMIENTO
  // ============================================================

  private getStorageId(
    notePath: string,
    instanceId: string
  ): string {

    return `${notePath}::${instanceId}`;
  }

  private generateId(): string {

    return `snip-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
  }

  private getTimestamp(): {
    timestamp: number;
    date: string;
    time: string;
  } {

    const now = new Date();

    return {
      timestamp: now.getTime(),
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString()
    };
  }

  // ============================================================
  // PERSISTENCIA
  // ============================================================

  private async loadAllData():
    Promise<Record<string, SnipData>> {

    try {

      const data =
        await this.plugin.loadData();

      return data?.[this.storageKey] || {};

    } catch {

      return {};
    }
  }

  private async saveAllData(
    data: Record<string, SnipData>
  ): Promise<void> {

    try {

      const fullData =
        await this.plugin.loadData() || {};

      fullData[this.storageKey] = data;

      await this.plugin.saveData(
        fullData
      );

    } catch (error) {

      console.error(
        'Error saving snips:',
        error
      );
    }
  }

  private async ensureNoteData(
    notePath: string,
    instanceId: string
  ): Promise<SnipData> {

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

        const sessionId =
          `session-${Date.now()}`;

        data = {

          notePath,

          sessions: [
            {
              id: sessionId,
              name:
                `Sesión ${new Date().toLocaleDateString()}`,
              createdAt: Date.now(),
              fragments: []
            }
          ],

          activeSessionId:
            sessionId
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
    data: SnipData
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

    await this.saveAllData(
      all
    );
  }

  // ============================================================
  // FRAGMENTOS
  // ============================================================

  async addFragment(
    notePath: string,
    instanceId: string,
    noteName: string,
    text: string,
    position?: {
      start: number;
      end: number;
    }
  ): Promise<SnipFragment> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    const timestamp =
      this.getTimestamp();

    const fragment: SnipFragment = {

      id: this.generateId(),

      text: text.trim(),

      timestamp:
        timestamp.timestamp,

      date:
        timestamp.date,

      time:
        timestamp.time,

      notePath,

      noteName,

      position,

      active: true
    };

    let activeSession =
      data.sessions.find(
        s =>
          s.id ===
          data.activeSessionId
      );

    if (!activeSession) {

      const sessionId =
        `session-${Date.now()}`;

      activeSession = {

        id: sessionId,

        name:
          `Sesión ${new Date().toLocaleDateString()}`,

        createdAt:
          Date.now(),

        fragments: []
      };

      data.sessions.push(
        activeSession
      );

      data.activeSessionId =
        sessionId;
    }

    activeSession.fragments.push(
      fragment
    );

    await this.saveNoteData(
      notePath,
      instanceId,
      data
    );


    this.notifyChange();

    return fragment;
  }

  async getFragments(
    notePath: string,
    instanceId: string
  ): Promise<SnipFragment[]> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    const activeSession =
      data.sessions.find(
        s =>
          s.id ===
          data.activeSessionId
      );

    return (
      activeSession?.fragments ||
      []
    );
  }

  async getActiveFragments(
    notePath: string,
    instanceId: string
  ): Promise<SnipFragment[]> {

    const fragments =
      await this.getFragments(
        notePath,
        instanceId
      );

    return fragments.filter(
      fragment =>
        fragment.active !== false
    );
  }

  // ============================================================
  // SESIONES
  // ============================================================

  async getAllSessions(
    notePath: string,
    instanceId: string
  ): Promise<SnipSession[]> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    return data.sessions;
  }

  async getActiveSession(
    notePath: string,
    instanceId: string
  ): Promise<SnipSession | null> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    return (
      data.sessions.find(
        s =>
          s.id ===
          data.activeSessionId
      ) || null
    );
  }

  async newSession(
    notePath: string,
    instanceId: string,
    name?: string
  ): Promise<SnipSession> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    const session: SnipSession = {

      id:
        `session-${Date.now()}`,

      name:
        name ||
        `Sesión ${new Date().toLocaleDateString()}`,

      createdAt:
        Date.now(),

      fragments: []
    };

    data.sessions.push(
      session
    );

    data.activeSessionId =
      session.id;

    await this.saveNoteData(
      notePath,
      instanceId,
      data
    );

    this.notifyChange();

    return session;
  }

  async switchSession(
    notePath: string,
    instanceId: string,
    sessionId: string
  ): Promise<void> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    const exists =
      data.sessions.some(
        s =>
          s.id === sessionId
      );

    if (exists) {

      data.activeSessionId =
        sessionId;

      await this.saveNoteData(
        notePath,
        instanceId,
        data
      );

      this.notifyChange();
    }
  }

  async deleteSession(
    notePath: string,
    instanceId: string,
    sessionId: string
  ): Promise<void> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    data.sessions =
      data.sessions.filter(
        s =>
          s.id !== sessionId
      );

    if (
      data.activeSessionId ===
      sessionId
    ) {

      data.activeSessionId =
        data.sessions[0]?.id || '';
    }

    await this.saveNoteData(
      notePath,
      instanceId,
      data
    );

    this.notifyChange();
  }

  async clearActiveSession(
    notePath: string,
    instanceId: string
  ): Promise<void> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    const session =
      data.sessions.find(
        s =>
          s.id ===
          data.activeSessionId
      );

    if (session) {

      session.fragments = [];

      await this.saveNoteData(
        notePath,
        instanceId,
        data
      );

      this.notifyChange();
    }
  }

  // ============================================================
  // FRAGMENTOS INDIVIDUALES
  // ============================================================

  async deleteFragment(
    notePath: string,
    instanceId: string,
    fragmentId: string
  ): Promise<void> {

    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    const session =
      data.sessions.find(
        s =>
          s.id ===
          data.activeSessionId
      );

    if (session) {

      session.fragments =
        session.fragments.filter(
          f =>
            f.id !== fragmentId
        );

      await this.saveNoteData(
        notePath,
        instanceId,
        data
      );

      this.notifyChange();
    }
  }

  async toggleFragmentActive(
    notePath: string,
    instanceId: string,
    fragmentId: string
  ): Promise<boolean | null> {


    const data =
      await this.ensureNoteData(
        notePath,
        instanceId
      );

    const session =
      data.sessions.find(
        s =>
          s.id ===
          data.activeSessionId
      );

    if (!session) {

      console.warn(
        '[SNIP CONTROLLER] sesión no encontrada'
      );

      return null;
    }

    const fragment =
      session.fragments.find(
        f =>
          f.id === fragmentId
      );

    if (!fragment) {

      console.warn(
        '[SNIP CONTROLLER] fragmento no encontrado',
        fragmentId
      );

      return null;
    }

    const currentlyActive =
      fragment.active !== false;

    fragment.active =
      !currentlyActive;

    console.log(
      '[SNIP CONTROLLER] nuevo estado:',
      fragment.active
    );

    await this.saveNoteData(
      notePath,
      instanceId,
      data
    );

    this.notifyChange();

    return fragment.active;
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

  clearCache(): void {
    this.cache.clear();
  }

  getStats(
    notePath: string,
    instanceId: string
  ): {
    totalFragments: number;
    totalSessions: number;
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
        totalFragments: 0,
        totalSessions: 0
      };
    }

    const totalFragments =
      data.sessions.reduce(
        (sum, s) =>
          sum + s.fragments.length,
        0
      );

    return {

      totalFragments,

      totalSessions:
        data.sessions.length
    };
  }
}