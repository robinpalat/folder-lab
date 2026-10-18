import type { Plugin } from 'obsidian';

/**
 * Frontera con data.json: el contenido es JSON externo. Se estrecha
 * a `unknown` y solo se acepta si es un objeto plano.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pipeline ÚNICO y serializado de lectura-modificación-escritura
 * sobre el data.json del plugin (plugin.loadData/saveData).
 *
 * Motivo: saveData reescribe el archivo completo. Sin serialización,
 * dos escritores concurrentes (widgets y ajustes) se pisaban y se
 * perdían datos entre sesiones. Aquí TODAS las escrituras pasan por
 * una cola: cada mutación lee el estado MÁS RECIENTE del disco
 * dentro de su transacción y solo entonces escribe.
 *
 * Los errores se registran en consola (registros visibles) y se
 * propagan al llamante; la cola no queda bloqueada.
 */
export class PluginDataStore {

  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly plugin: Plugin
  ) {}

  /** Lectura directa del estado actual (objeto plano validado). */
  async read(): Promise<Record<string, unknown>> {
    const diagStart = performance.now();

    try {
      const raw: unknown = await this.plugin.loadData();
      return isPlainObject(raw) ? raw : {};
    } catch (error) {
      // [diag] Solo se registra el MENSAJE del error (nunca el
      // contenido de la configuración ni secretos). Un fallo de
      // parse con mensaje "Unexpected end of JSON input" indica
      // lectura de un data.json truncado/vacío (escritura
      // concurrente no atómica).
      console.error(
        `[FolderLab][diag] Error leyendo data.json del plugin ` +
        `(${(performance.now() - diagStart).toFixed(1)} ms):`,
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  /**
   * Ejecuta `mutator` sobre una copia fresca del data.json y
   * guarda el resultado, en cola (una escritura a la vez).
   */
  transact(
    mutator: (data: Record<string, unknown>) => void | Promise<void>
  ): Promise<void> {
    const run = async (): Promise<void> => {
      // [diag] Escritura de data.json: registrar inicio/fin para
      // correlacionar con lecturas rasgadas concurrentes. Nunca
      // se registra el contenido (puede contener la API key).
      const diagStart = performance.now();

      console.warn(
        '[FolderLab][diag] transact: escritura de data.json iniciada'
      );

      const raw: unknown = await this.plugin.loadData();
      const data: Record<string, unknown> = isPlainObject(raw) ? raw : {};
      await mutator(data);
      await this.plugin.saveData(data);

      console.warn(
        `[FolderLab][diag] transact: data.json escrito ` +
        `(${(performance.now() - diagStart).toFixed(1)} ms)`
      );
    };

    const result = this.tail.then(run);

    // La cadena continúa aunque una escritura falle.
    this.tail = result.catch(() => {});

    return result.catch((error) => {
      console.error(
        '[FolderLab] Fallo guardando data.json del plugin:',
        error
      );
      throw error;
    });
  }

  /**
   * Guarda SOLO las claves propias de los ajustes sobre el estado
   * actual del disco. Nunca toca las claves de almacenamiento de
   * widgets: escribir el objeto settings completo era lo que borraba
   * los datos de los widgets guardados durante la sesión.
   */
  saveOwnedSettings(
    settings: object,
    ownedKeys: string[]
  ): Promise<void> {
    return this.transact((data) => {
      const source = settings as Record<string, unknown>;
      for (const key of ownedKeys) {
        if (key in settings) {
          data[key] = source[key];
        }
      }
    });
  }
}
