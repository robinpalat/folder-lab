// ============================================================
// UTIL: SINGLE-FLIGHT CACHE
// ============================================================
// Contenedor mínimo para el último resultado válido de un cálculo
// caro (p. ej. el conteo de palabras del libro). Módulo puro (sin
// Obsidian): el proceso lo inyecta como factory.
//
// Reglas:
// - Sin `force` reutiliza el resultado en memoria si existe.
// - Con `force` fuerza un cálculo nuevo (p. ej. botón
//   «Actualizar estadísticas»).
// - Las peticiones simultáneas comparten el mismo vuelo en curso:
//   nunca hay dos ejecuciones duplicadas.
// - Un cálculo fallido (null) NO sustituye al último resultado
//   válido: se conserva el anterior.
// ============================================================

export class SingleFlightCache<T> {
  private value: T | null = null;
  private inFlight: Promise<T | null> | null = null;

  /** Último resultado válido en memoria. Nunca calcula. */
  get(): T | null {
    return this.value;
  }

  /**
   * Obtiene el resultado, calculando solo cuando corresponde.
   *
   * @param factory Proceso que produce el resultado (null = fallo).
   * @param force  Fuerza un cálculo nuevo ignorando la memoria.
   */
  async request(
    factory: () => Promise<T | null>,
    force: boolean = false
  ): Promise<T | null> {
    if (!force && this.value !== null) {
      return this.value;
    }

    // Petición simultánea: compartir el vuelo en curso.
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = factory()
      .then((result) => {
        if (result !== null) {
          this.value = result;
        }
        return result;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }
}
