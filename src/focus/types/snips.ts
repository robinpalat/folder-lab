export interface SnipFragment {
  id: string;
  text: string;
  timestamp: number;
  date: string;
  time: string;
  notePath: string;
  noteName: string;
  position?: {
    start: number;
    end: number;
  };

  /**
   * Si es false, el Snip no participa como fuente de IA.
   * Si no existe, se considera activo por compatibilidad.
   */
  active?: boolean;
}

export interface SnipSession {
  id: string;
  name: string;
  createdAt: number;
  fragments: SnipFragment[];
}

export interface SnipData {
  notePath: string;
  sessions: SnipSession[];
  activeSessionId: string;
}
