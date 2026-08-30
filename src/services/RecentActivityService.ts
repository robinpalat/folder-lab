import { App, TFile } from "obsidian";

/**
 * Tipos de actividad registrados por Folder Lab.
 *
 * El log es deliberadamente append-only:
 * timestamp|path|event|weight
 */
export type RecentActivityEvent =
  | "open"
  | "context"
  | `widget:${string}`
  | "edit";

export interface RecentActivityEntry {
  timestamp: number;
  path: string;
  event: string;
  weight: number;
}

export interface RecentNoteScore {
  path: string;
  score: number;
  lastActivity: number;
  lastMeaningfulActivity: number;
  activityScore: number;
  recencyScore: number;
}
/**
 * Registro y análisis de actividad reciente.
 *
 * Primera versión:
 * - persiste eventos en Master/Folder Lab/_activity.log
 * - no guarda contenido de las notas
 * - permite reconstruir el ranking posteriormente
 * - mantiene el algoritmo de ranking separado del registro
 */
export class RecentActivityService {
  private static readonly FOLDER_NAME = ".folder-lab";
  private static readonly WINDOW_DAYS = 7;
  private static readonly DEFAULT_LIMIT = 5;
  private static readonly ACTIVITY_WEIGHT = 0.45;
  private static readonly RECENCY_WEIGHT = 0.55;
  private static readonly RECENCY_HALF_LIFE_HOURS = 24;
  private lastOpenedPath: string | null = null;
  private lastOpenedAt = 0;
  private editTimeout: number | null = null;
  private pendingEditPath: string | null = null;


  constructor(
	  private readonly app: App,
	  private readonly getMasterPath: () => string
	) { }

  /**
   * Registra una señal de actividad.
   *
   * No decide si la nota merece aparecer en Recientes.
   * Solo registra evidencia para que el ranking pueda decidirlo después.
   */
async record(
  file: TFile,
  event: RecentActivityEvent,
  weight: number
): Promise<void> {
  if (!file || file.extension !== "md") {
    return;
  }

  if (!Number.isFinite(weight) || weight <= 0) {
    return;
  }

  // Filtrar duplicados de "open" ANTES de cualquier await.
  if (event === "open") {
    const now = Date.now();

    console.log(
      '[Folder Lab][RecentActivity] open:',
      file.path,
      now
    );

    if (
      this.lastOpenedPath === file.path &&
      now - this.lastOpenedAt < 2000
    ) {
      return;
    }

    // Actualizar inmediatamente, antes de cualquier operación async.
    this.lastOpenedPath = file.path;
    this.lastOpenedAt = now;
  }

  await this.ensureLogDirectory();

  const line = [
    Date.now(),
    this.escapeField(file.path),
    this.escapeField(event),
    Math.round(weight)
  ].join("|") + "\n";

  try {
    await this.app.vault.adapter.append(
      this.getLogPath(),
      line
    );
  } catch (error) {
    console.warn(
      "[Folder Lab] No se pudo registrar actividad reciente:",
      error
    );
  }
}

  /**
   * Lee todos los eventos del período configurado.
   */
  async readEvents(
    days: number = RecentActivityService.WINDOW_DAYS
  ): Promise<RecentActivityEntry[]> {
    if (!(await this.logExists())) {
      return [];
    }

    let content: string;

    try {
      content = await this.app.vault.adapter.read(
		  this.getLogPath()
		);
    } catch (error) {
      console.warn(
        "[Folder Lab] No se pudo leer el registro de actividad:",
        error
      );
      return [];
    }

    const cutoff = Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000;
    const entries: RecentActivityEntry[] = [];

    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();

      if (!line) {
        continue;
      }

      const parts = line.split("|");

      if (parts.length !== 4) {
        continue;
      }

      const timestamp = Number(parts[0]);
      const weight = Number(parts[3]);

      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(weight) ||
        timestamp < cutoff
      ) {
        continue;
      }

      entries.push({
        timestamp,
        path: this.unescapeField(parts[1]),
        event: this.unescapeField(parts[2]),
        weight
      });
    }

    return entries;
  }

  /**
   * Agrupa la actividad por nota.
   *
   * Por ahora usamos suma simple de pesos. El algoritmo temporal
   * puede evolucionar después sin modificar el formato del log.
   */
async calculateRanking(
  days: number = RecentActivityService.WINDOW_DAYS
): Promise<RecentNoteScore[]> {
  const entries = await this.readEvents(days);

  interface NoteActivity {
    path: string;
    rawScore: number;
    lastActivity: number;
    lastMeaningfulActivity: number;
  }

  const byPath = new Map<string, NoteActivity>();

  for (const entry of entries) {
    let current = byPath.get(entry.path);

    if (!current) {
      current = {
        path: entry.path,
        rawScore: 0,
        lastActivity: 0,
        lastMeaningfulActivity: 0
      };

      byPath.set(entry.path, current);
    }

    current.rawScore += entry.weight;

    current.lastActivity = Math.max(
      current.lastActivity,
      entry.timestamp
    );

    const isMeaningful =
      entry.event === "context" ||
      entry.event === "edit" ||
      entry.event.startsWith("widget:");

    if (isMeaningful) {
      current.lastMeaningfulActivity = Math.max(
        current.lastMeaningfulActivity,
        entry.timestamp
      );
    }
  }

  const now = Date.now();

	const activityScores = [
	  ...byPath.values()
	].map(activity =>
	  Math.log1p(activity.rawScore)
	);

	const maxActivityScore =
	  Math.max(...activityScores, 1);


  const ranking: RecentNoteScore[] = [];

  for (const activity of byPath.values()) {
    /*
     * Comprimimos la actividad acumulada.
     *
     * Esto evita que una nota con muchísimos eventos históricos
     * domine indefinidamente el ranking.
     */
    const rawActivityScore = Math.log1p(
	  activity.rawScore
	);

	const activityScore =
	  rawActivityScore / maxActivityScore;

    /*
     * La recencia utiliza un decaimiento exponencial.
     *
     * A las 24 horas la señal conserva aproximadamente la mitad
     * de su intensidad.
     */
    const referenceTimestamp =
	  activity.lastMeaningfulActivity > 0
		? activity.lastMeaningfulActivity
		: activity.lastActivity;

	const ageHours =
	  Math.max(
		0,
		now - referenceTimestamp
	  ) / 3_600_000;

    const recencyScore = Math.pow(
	  0.5,
	  ageHours /
		RecentActivityService.RECENCY_HALF_LIFE_HOURS
	);

    /*
     * Las dos componentes se combinan.
     *
     * La recencia pesa ligeramente más que la actividad acumulada.
     */
    const score =
      activityScore *
        RecentActivityService.ACTIVITY_WEIGHT +
      recencyScore *
        RecentActivityService.RECENCY_WEIGHT;

    ranking.push({
      path: activity.path,
      score,
      lastActivity: activity.lastActivity,
      lastMeaningfulActivity:
        activity.lastMeaningfulActivity,
      activityScore,
      recencyScore
    });
  }

  ranking.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return b.lastActivity - a.lastActivity;
  });

  return ranking;
}

  /**
   * Devuelve las cinco notas con mayor actividad por defecto.
   */
async getRecentNotes(
  limit: number = RecentActivityService.DEFAULT_LIMIT,
  days: number = RecentActivityService.WINDOW_DAYS
): Promise<RecentNoteScore[]> {
  const safeLimit = Math.max(0, limit);

  if (safeLimit === 0) {
    return [];
  }

  const ranking = await this.calculateRanking(days);

  if (ranking.length <= safeLimit) {
    return ranking;
  }

  /*
   * Encontrar la última nota en la que hubo actividad significativa.
   *
   * "open" no cuenta como trabajo significativo.
   */
  let latestMeaningful: RecentNoteScore | null = null;

  for (const note of ranking) {
    if (note.lastMeaningfulActivity <= 0) {
      continue;
    }

    if (
      !latestMeaningful ||
      note.lastMeaningfulActivity >
        latestMeaningful.lastMeaningfulActivity
    ) {
      latestMeaningful = note;
    }
  }

  const result = ranking.slice(0, safeLimit);

  if (!latestMeaningful) {
    return result;
  }

  /*
   * Si la última nota realmente trabajada ya está dentro
   * del Top 5, no hacemos nada.
   */
  const alreadyIncluded = result.some(
    note => note.path === latestMeaningful!.path
  );

  if (alreadyIncluded) {
    return result;
  }

  /*
   * La última nota trabajada tiene prioridad de presencia.
   *
   * Sacamos la última del Top y colocamos la nota significativa.
   */
  result[result.length - 1] = latestMeaningful;

  /*
   * Volvemos a ordenar las cinco para que la nota introducida
   * ocupe su posición natural dentro del conjunto final.
   */
  result.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return b.lastActivity - a.lastActivity;
  });

  return result;
}

  /**
   * Permite inspeccionar el log sin exponer la ruta interna.
   */
	getLogPath(): string {
	  const masterPath = this.normalizePath(this.getMasterPath());

	  return masterPath
		? `${masterPath}/${RecentActivityService.FOLDER_NAME}/_activity.log`
		: `${RecentActivityService.FOLDER_NAME}/_activity.log`;
	}

	private async ensureLogDirectory(): Promise<void> {
	  const masterPath = this.normalizePath(this.getMasterPath());

	  const directory = masterPath
		? `${masterPath}/${RecentActivityService.FOLDER_NAME}`
		: RecentActivityService.FOLDER_NAME;

	  try {
		if (!(await this.app.vault.adapter.exists(directory))) {
		  await this.app.vault.adapter.mkdir(directory);
		}
	  } catch (error) {
		if (!(await this.app.vault.adapter.exists(directory))) {
		  throw error;
		}
	  }
	}

	private async logExists(): Promise<boolean> {
	  try {
		return await this.app.vault.adapter.exists(
		  this.getLogPath()
		);
	  } catch {
		return false;
	  }
	}

	private normalizePath(path: string): string {
	  return path.replace(/^\/|\/$/g, "");
	}
	
	/**
	 * Programa el registro de una sesión de edición.
	 *
	 * Los eventos modify de Obsidian pueden producirse muchas veces
	 * durante una misma sesión de escritura. Por eso no se registra
	 * inmediatamente cada modificación.
	 *
	 * Si pasan 2 segundos sin nuevas modificaciones, se considera
	 * terminada la sesión y registram un único evento "edit".
	 */
	scheduleEdit(file: TFile): void {
	  if (!file || file.extension !== "md") {
		return;
	  }

	  this.pendingEditPath = file.path;

	  if (this.editTimeout !== null) {
		window.clearTimeout(this.editTimeout);
	  }

	  this.editTimeout = window.setTimeout(() => {
		const path = this.pendingEditPath;

		this.editTimeout = null;
		this.pendingEditPath = null;

		if (!path) {
		  return;
		}

		const currentFile =
		  this.app.vault.getAbstractFileByPath(path);

		if (!(currentFile instanceof TFile)) {
		  return;
		}

		void this.record(
		  currentFile,
		  "edit",
		  5
		);
	  }, 2000);
	}
	
  private escapeField(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  }

  private unescapeField(value: string): string {
    return value
      .replace(/\\\|/g, "|")
      .replace(/\\\\/g, "\\");
  }
}
