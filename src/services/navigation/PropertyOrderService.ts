import { App, TFile } from 'obsidian';

/**
 * Gestiona el orden de navegación basado en propiedades
 * (por ejemplo, nav_order de Jekyll / Just the Docs).
 *
 * No conoce la UI ni el sistema de drag & drop.
 * Su única responsabilidad es persistir el orden
 * en el Frontmatter de las notas.
 */
export class PropertyOrderService {

  constructor(private app: App) {}

  /**
   * Persiste un nuevo orden para un conjunto de notas hermanas.
   *
   * El índice de la posición se convierte directamente
   * en el valor de la propiedad de orden.
   *
   * Ejemplo:
   *   [A, C, B]
   *
   * produce:
   *   A → order: 1
   *   C → order: 2
   *   B → order: 3
   */
async reorder(
  files: TFile[],
  orderProperty: string
): Promise<void> {

  if (!orderProperty) {
    throw new Error(
      '[PROPERTY ORDER] No se especificó la propiedad de orden'
    );
  }

  // 1. Persistir el nuevo orden en el frontmatter
  const valoresAnteriores: Array<{ archivo: string; anterior: unknown }> =
    [];

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const order = index + 1;

    const cachePrevio =
      this.app.metadataCache.getFileCache(file);

    valoresAnteriores.push({
      archivo: file.name,
      anterior:
        cachePrevio?.frontmatter?.[orderProperty] ?? '(sin valor)'
    });

    await this.app.fileManager.processFrontMatter(
      file,
      (frontmatter) => {
        frontmatter[orderProperty] = order;
      }
    );
  }

  console.log('[FOLDERLAB-DROP-TRACE]', {
    punto: 'persistencia solicitada (solo nombres de archivo y órdenes)',
    propiedad: orderProperty,
    valores: files.map((file, index) => ({
      archivo: file.name,
      anterior:
        valoresAnteriores[index]?.anterior ?? '(desconocido)',
      solicitado: index + 1
    }))
  });

  // 2. Esperar a que metadataCache refleje los nuevos valores.
  //
  // processFrontMatter() actualiza el archivo inmediatamente,
  // pero metadataCache puede quedar momentáneamente atrasado.
  const maxAttempts = 20;
  const delayMs = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let cacheIsUpdated = true;

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const expectedOrder = index + 1;

      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;

      const cachedOrder = frontmatter?.[orderProperty];

      if (Number(cachedOrder) !== expectedOrder) {
        cacheIsUpdated = false;

        console.log('[PROPERTY ORDER] Esperando metadataCache...', {
          file: file.name,
          expected: expectedOrder,
          cached: cachedOrder,
          attempt: attempt + 1
        });

        break;
      }
    }

    if (cacheIsUpdated) {
      console.log(
        '[PROPERTY ORDER] metadataCache sincronizado correctamente'
      );
      break;
    }

    await new Promise(resolve =>
      window.setTimeout(resolve, delayMs)
    );
  }

  const valoresConfirmados = files.map((file) => {
    const cacheFinal =
      this.app.metadataCache.getFileCache(file);

    return {
      archivo: file.name,
      confirmado:
        cacheFinal?.frontmatter?.[orderProperty] ?? '(sin valor)'
    };
  });

  console.log('[FOLDERLAB-DROP-TRACE]', {
    punto: 'persistencia confirmada en caché (solo nombres y órdenes)',
    propiedad: orderProperty,
    valores: valoresConfirmados
  });

  // 3. Notificar SOLO después de que el cache esté sincronizado.
  (this.app.workspace as any).trigger(
    'folder-lab:order-changed'
  );

  console.log(
    '[PROPERTY ORDER] Evento order-changed emitido'
  );
}
}
