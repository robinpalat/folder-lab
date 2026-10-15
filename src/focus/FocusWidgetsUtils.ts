/**
 * Ordena una colección colocando primero los elementos
 * que cumplen la condición de prioridad.
 *
 * No modifica la colección original.
 */

import {  setIcon } from 'obsidian';
import { i18n } from '../i18n/I18nService';

export function sortPriorityFirst<T>(
  items: T[],
  isPriority: (item: T) => boolean
): T[] {
  return [...items].sort((a, b) => {
    const aPriority = isPriority(a);
    const bPriority = isPriority(b);

    if (aPriority === bPriority) {
      return 0;
    }

    return aPriority ? -1 : 1;
  });
}




// ============================================================
// TEXTO EXPANDIBLE
// ============================================================

/**
 * El colapso se decide por cantidad real de contenido, no por la
 * existencia de saltos de línea.
 *
 * La vista puede mostrar como máximo 3 líneas cuando está contraída,
 * pero eso NO determina si el contenido necesita el control.
 */
export const FOLDER_LAB_COLLAPSE_MAX_CHARS = 240;
export const FOLDER_LAB_COLLAPSE_MAX_WORDS = 40;
export const FOLDER_LAB_COLLAPSE_PREVIEW_LINES = 3;

export type FolderLabTextSize =
  | 'large'
  | 'medium-large'
  | 'medium'
  | 'small';

/**
 * Determina si un texto es suficientemente extenso como para necesitar
 * Expandir / Contraer.
 *
 * Un texto corto no recibe ninguna acción de expansión.
 */
export function shouldCollapseText(text: string): boolean {
  const analysisText = normalizeForAnalysis(text);

  if (!analysisText) return false;

  const wordCount = analysisText
    .split(/\s+/)
    .filter(Boolean)
    .length;

  return (
    analysisText.length > FOLDER_LAB_COLLAPSE_MAX_CHARS ||
    wordCount > FOLDER_LAB_COLLAPSE_MAX_WORDS
  );
}

export interface FolderLabExpandableTextOptions {
  initiallyExpanded?: boolean;
  previewLines?: number;
  expandedLabel?: string;
  collapsedLabel?: string;
  rootClass?: string;
  contentClass?: string;
  actionClass?: string;
  editable?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}


export function getFragmentTextSize(
  text: string
): FolderLabTextSize {

  const wordCount =
    normalizeForAnalysis(text)
      .split(/\s+/)
      .filter(Boolean)
      .length;

  if (wordCount <= 8) {
    return 'large';
  }

  if (wordCount <= 20) {
    return 'medium-large';
  }

  if (wordCount <= 40) {
    return 'medium';
  }

  return 'small';
}

/**
 * Contenido expandible común a los widgets.
 *
 * Reglas:
 * - contenido corto: no hay expansión.
 * - contenido largo contraído: un clic sobre el contenido lo expande.
 * - contenido largo expandido automáticamente: sigue sin mostrar "Contraer".
 * - contenido largo expandido manualmente: aparece "Contraer".
 *
 * `editable` distingue entre contenido documental editable y Snips,
 * que son siempre de solo lectura.
 */
export function createExpandableText(
  container: HTMLElement,
  text: string,
  options: FolderLabExpandableTextOptions = {}
): {
  root: HTMLElement;
  content: HTMLElement;
  action: HTMLElement | null;
  expanded: () => boolean;
  manuallyExpanded: () => boolean;
  editing: () => boolean;
  setExpanded: (expanded: boolean, manual?: boolean) => void;
} {
  const originalText = String(text ?? '');

  const editable = options.editable ?? false;
  const textSize =
    getFragmentTextSize(originalText);

  const root = container.createEl('div', {
    cls: options.rootClass || 'fl-expandable-text'
  });

  root.addClass(
    `fl-fragment-text-${textSize}`
  );

  const content = root.createEl('div', {
    cls: options.contentClass || 'fl-expandable-text-content'
  });

  content.addClass('fl-fragment-text-content');
  content.textContent = originalText;

  // Editable widgets do NOT start editable.
  // The first click puts them into edit mode.
  if (editable) {
    content.setAttr('contenteditable', 'false');
    content.addClass('fl-expandable-text-editable-ready');
  } else {
    content.addClass('fl-expandable-text-readonly');
  }

  const previewLines =
    options.previewLines ?? FOLDER_LAB_COLLAPSE_PREVIEW_LINES;

  const collapseLabel = options.expandedLabel ?? i18n.t('widgets.common.collapse');

  const collapseAction = root.createEl('div', {
    cls: `${options.actionClass || 'fl-expandable-text-action'} fl-expandable-text-collapse-action`,
    text: collapseLabel
  });

  collapseAction.setAttr('role', 'button');
  collapseAction.setAttr('tabindex', '0');
  collapseAction.setAttr('aria-label', collapseLabel);

  let isExpanded = options.initiallyExpanded ?? false;
  let manuallyExpandedState = false;
  let isEditing = false;

  const enterEditMode = (event?: MouseEvent): void => {
    if (!editable || isEditing) return;

    event?.preventDefault();
    event?.stopPropagation();

    isEditing = true;
    content.setAttr('contenteditable', 'true');
    content.addClass('is-editing');
    content.removeClass('fl-expandable-text-editable-ready');
    content.focus();
  };

  const setExpanded = (
    expanded: boolean,
    manual: boolean = false
  ): void => {
    isExpanded = expanded;

    options.onExpandedChange?.(expanded);

    root.toggleClass(
      'fl-fragment-text-expanded',
      expanded
    );

    if (manual && expanded) {
      manuallyExpandedState = true;
    }

    if (!expanded) {
      manuallyExpandedState = false;
    }

    root.toggleClass('is-expanded', expanded);
    root.toggleClass('is-collapsed', !expanded);

    if (expanded) {
      // Limpieza de los overrides en línea del estado colapsado
      // (equivalente a asignar '', sin valores estáticos en línea).
      content.style.removeProperty('max-height');
      content.style.removeProperty('overflow');

      collapseAction.setCssProps({ display: 'block' });

      content.removeClass(
        'fl-expandable-text-preview'
      );
    } else {
      const computedStyle = window.getComputedStyle(content);
      const lineHeight = parseFloat(computedStyle.lineHeight);

      if (Number.isFinite(lineHeight) && lineHeight > 0) {
        content.style.maxHeight = `${previewLines * lineHeight}px`;
      } else {
        content.style.maxHeight =
          `calc(${previewLines} * var(--fl-expandable-line-height, 1.45em))`;
      }


      content.setCssProps({ overflow: 'hidden' });

      content.addClass('fl-expandable-text-preview');
      collapseAction.setCssProps({ display: 'none' });
    }
  };

  const handleContentClick = (event: MouseEvent): void => {
    if (isEditing) return;

    if (!isExpanded) {
      // Long collapsed content:
      // first click = expand + enter edit mode for editable widgets.
      setExpanded(true, true);

      if (editable) {
        enterEditMode(event);
      }

      return;
    }

    // Already expanded:
    // first click = enter edit mode for editable widgets.
    if (editable) {
      enterEditMode(event);
    }
  };

  content.addEventListener('click', handleContentClick);

  const collapseFromAction = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();

    // Do not leave the content editable while collapsed.
    if (editable && isEditing) {
      isEditing = false;
      content.setAttr('contenteditable', 'false');
      content.removeClass('is-editing');
      content.addClass('fl-expandable-text-editable-ready');
    }

    setExpanded(false, false);
  };

  collapseAction.addEventListener('click', collapseFromAction);

  collapseAction.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      collapseFromAction(event as unknown as MouseEvent);
    }
  });

  // Automatic expansion does not count as manual expansion.
  setExpanded(isExpanded, false);

  return {
    root,
    content,
    action: null,
    expanded: () => isExpanded,
    manuallyExpanded: () => manuallyExpandedState,
    editing: () => isEditing,
    setExpanded
  };
}


/**
 * Aplica una capitular editorial al primer carácter visible.
 *
 * No modifica el texto fuente. Solo cambia su representación DOM.
 * El `float` permite que las primeras líneas rodeen la capitular
 * y que, al terminar su altura, el texto vuelva a ocupar todo el ancho.
 */
export function applyDropCap(
  content: HTMLElement,
  sourceText: string
): void {
  if (!content || !sourceText) return;

  const match = sourceText.match(/^(\s*)(.*?)([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/u);

  if (!match) return;

  const prefix = match[1] + match[2];
  const firstLetter = match[3];

  const textAfterLetter =
    sourceText.slice(
      sourceText.indexOf(firstLetter) + firstLetter.length
    );

  content.empty();

  if (prefix) {
    content.appendChild(
      document.createTextNode(prefix)
    );
  }

  const dropCap = content.createEl('span', {
    cls: 'fl-dropcap',
    text: firstLetter.toLocaleUpperCase('es-ES')
  });

  dropCap.setAttr('aria-hidden', 'true');

  content.appendChild(
    document.createTextNode(textAfterLetter)
  );
}


/**
 * Normalización exclusiva para medir el contenido.
 *
 * NO se utiliza para renderizarlo.
 */
function normalizeForAnalysis(text: string): string {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

import { App, TFile, Notice } from 'obsidian';

export type FolderLabDropKind = 'text' | 'file';

export interface FolderLabTextPayload {
  kind: 'text';
  text: string;
  sourcePath?: string;
  sourceName?: string;

  source?: {
    widgetId: string;
    instanceId: string;
    itemId: string;
    sessionId?: string;
  };
}

export interface FolderLabFilePayload {
  kind: 'file';
  file: File;
}

export type FolderLabDropPayload = FolderLabTextPayload | FolderLabFilePayload;

interface DropTargetOptions {
  kinds: FolderLabDropKind[];
  onDrop: (payload: FolderLabDropPayload) => void | Promise<void>;
  onDragState?: (active: boolean, kind?: FolderLabDropKind) => void;
}

/**
 * Infraestructura común de Drag & Drop para Focus widgets.
 *
 * - Convierte texto seleccionado en Reading View en una operación drag.
 * - Permite que varios widgets registren zonas de drop.
 * - Permite recibir archivos externos del sistema operativo.
 * - Se instala una sola vez aunque existan varios widgets.
 */
export class FolderLabDragDrop {
  private static instance: FolderLabDragDrop | null = null;

  private readonly app: App;
  private readonly targets = new Map<HTMLElement, DropTargetOptions>();
  private sourceInstalled = false;
  private activeDragSource:
    FolderLabTextPayload['source'] | null = null;

  static getInstance(app: App): FolderLabDragDrop {
    if (!this.instance) {
      this.instance = new FolderLabDragDrop(app);
    }
    return this.instance;
  }

  private constructor(app: App) {
    this.app = app;
  }

  private installSelectionSource(): void {
    if (this.sourceInstalled) return;
    this.sourceInstalled = true;

    document.addEventListener('dragstart', (event) => {
      const e = event;
      const dt = e.dataTransfer;
      if (!dt) return;

      // Comprobación entre ventanas (popouts): Node.instanceOf
      // es el sustituto oficial de `instanceof HTMLElement`.
      const target = (e.target as Node | null)?.instanceOf(HTMLElement)
        ? e.target as HTMLElement
        : null;
      if (!target) return;

      // Solo intervenir en el Reading View de Obsidian.
      const readingView = target.closest('.markdown-preview-view, .markdown-reading-view');
      if (!readingView) return;

      const selection = window.getSelection();
      const text = selection?.toString().trim() || '';
      if (!text) return;

      const activeFile = this.app.workspace.getActiveFile();

      const payload: FolderLabTextPayload = {
        kind: 'text',
        text,
        sourcePath: activeFile?.path,
        sourceName: activeFile?.basename
      };

      try {
        dt.setData('text/plain', text);
        dt.setData('application/x-folder-lab', JSON.stringify(payload));
        /*
         * 'copyMove' y no 'copy': los destinos fijan dropEffect='move'
         * durante dragover. Con effectAllowed='copy' la operación queda
         * en 'none' y el navegador no llega a disparar el drop.
         */
        dt.effectAllowed = 'copyMove';
      } catch (error) {
        console.warn('[FolderLabDragDrop] No se pudo preparar la selección:', error);
      }
    }, true);
  }

  setActiveDragSource(
    source: FolderLabTextPayload['source']
  ): void {
    this.activeDragSource = source;
  }

  clearActiveDragSource(): void {
    this.activeDragSource = null;
  }

  getActiveDragSource():
    FolderLabTextPayload['source'] | null {
    return this.activeDragSource;
  }

  registerTextDropTarget(
    element: HTMLElement,
    onDrop: (payload: FolderLabTextPayload) => void | Promise<void>,
    onDragState?: (active: boolean) => void
  ): () => void {
    return this.registerDropTarget(element, {
      kinds: ['text'],
      onDrop: (payload) => {
        if (payload.kind === 'text') return onDrop(payload);
      },
      onDragState
    });
  }

  registerTextDragSource(
    element: HTMLElement,
    getText: () => string,
    onDragState?: (active: boolean) => void
  ): () => void {
    element.setAttr('draggable', 'true');

    const dragStart = (event: DragEvent) => {
      const dt = event.dataTransfer;
      if (!dt) return;

      const text = getText().trim();

      // No permitir arrastrar un bloque vacío.
      if (!text) {
        event.preventDefault();
        return;
      }

      const payload: FolderLabTextPayload = {
        kind: 'text',
        text
      };

      try {
        dt.setData(
          'text/plain',
          text
        );

        dt.setData(
          'application/x-folder-lab',
          JSON.stringify(payload)
        );

        /*
         * 'copyMove' y no 'copy': los destinos (Board y widgets)
         * fijan dropEffect='move' durante dragover. Con
         * effectAllowed='copy' la operación queda en 'none' y el
         * navegador no llega a disparar el drop.
         */
        dt.effectAllowed = 'copyMove';

        onDragState?.(true);

      } catch (error) {
        console.warn(
          '[FolderLabDragDrop] No se pudo preparar el texto para drag:',
          error
        );

        event.preventDefault();
      }
    };

    const dragEnd = () => {
      onDragState?.(false);
    };

    element.addEventListener(
      'dragstart',
      dragStart
    );

    element.addEventListener(
      'dragend',
      dragEnd
    );

    return () => {
      element.removeAttribute('draggable');

      element.removeEventListener(
        'dragstart',
        dragStart
      );

      element.removeEventListener(
        'dragend',
        dragEnd
      );

      onDragState?.(false);
    };
  }

  registerFileDropTarget(
    element: HTMLElement,
    onDrop: (payload: FolderLabFilePayload) => void | Promise<void>,
    onDragState?: (active: boolean) => void
  ): () => void {
    return this.registerDropTarget(element, {
      kinds: ['file'],
      onDrop: (payload) => {
        if (payload.kind === 'file') return onDrop(payload);
      },
      onDragState
    });
  }

  registerDropTarget(element: HTMLElement, options: DropTargetOptions): () => void {
    this.installSelectionSource();
    this.unregisterDropTarget(element);
    this.targets.set(element, options);

    const dragOver = (event: DragEvent) => {
      if (!this.accepts(event, options.kinds)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      options.onDragState?.(true, this.detectKind(event));
    };

    const dragEnter = (event: DragEvent) => {
      if (!this.accepts(event, options.kinds)) return;
      event.preventDefault();
      event.stopPropagation();
      options.onDragState?.(true, this.detectKind(event));
    };

    const dragLeave = (event: DragEvent) => {
      if (!this.accepts(event, options.kinds)) return;
      const related = event.relatedTarget as Node | null;
      if (related && element.contains(related)) return;
      options.onDragState?.(false);
    };

    const drop = async (event: DragEvent) => {
      const kind = this.detectKind(event);

      /*
       * En DROP tenemos acceso real a DataTransfer.files.
       * Si hay archivos, el tipo es inequívocamente 'file'.
       */
      const hasFiles =
        !!event.dataTransfer &&
        event.dataTransfer.files &&
        event.dataTransfer.files.length > 0;

      const actualKind: FolderLabDropKind | undefined =
        hasFiles ? 'file' : kind;

      if (
        actualKind === undefined ||
        !options.kinds.includes(actualKind)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      options.onDragState?.(false);

      const payload = this.readPayload(event);
      if (!payload) return;

      try {
        await options.onDrop(payload);
      } catch (error) {
        console.error(
          '[FolderLabDragDrop] Error procesando drop:',
          error
        );

        new Notice(i18n.t('focus.dragdrop.dropFailed'));
      }
    };

    /*
     * L3b: `drop` ya gestiona sus errores internamente; el
     * envoltorio síncrono evita entregar una promesa al DOM y
     * se registra una única referencia para add/remove.
     */
    const dropSync = (event: DragEvent) => {
      void drop(event);
    };

    element.addEventListener('dragover', dragOver);
    element.addEventListener('dragenter', dragEnter);
    element.addEventListener('dragleave', dragLeave);
    element.addEventListener('drop', dropSync);

    return () => {
      element.removeEventListener('dragover', dragOver);
      element.removeEventListener('dragenter', dragEnter);
      element.removeEventListener('dragleave', dragLeave);
      element.removeEventListener('drop', dropSync);
      this.targets.delete(element);
      options.onDragState?.(false);
    };
  }

  unregisterDropTarget(element: HTMLElement): void {
    // Los listeners son eliminados por la función de cleanup devuelta al registrar.
    // Si el elemento se reemplaza por render(), el DOM antiguo ya no recibe eventos.
    this.targets.delete(element);
  }

  private accepts(
    event: DragEvent,
    kinds: FolderLabDropKind[]
  ): boolean {
    const kind = this.detectKind(event);
    return kind !== undefined && kinds.includes(kind);
  }

  private detectKind(event: DragEvent): FolderLabDropKind | undefined {
    const dt = event.dataTransfer;
    if (!dt) return undefined;

    /*
     * IMPORTANTE:
     *
     * Durante dragenter / dragover, dataTransfer.files puede estar
     * protegido y aparecer vacío aunque el arrastre sea un archivo.
     *
     * Para esos eventos usamos DataTransfer.types.
     * La File real se obtiene posteriormente en drop().
     */

    if (Array.from(dt.types || []).some(type =>
      type === 'Files' ||
      type === 'application/x-moz-file'
    )) {
      return 'file';
    }

    /*
     * Texto producido por Folder Lab.
     */
    if (Array.from(dt.types || []).includes('application/x-folder-lab')) {
      return 'text';
    }

    /*
     * Texto normal.
     */
    if (Array.from(dt.types || []).includes('text/plain')) {
      return 'text';
    }

    return undefined;
  }
  private readPayload(event: DragEvent): FolderLabDropPayload | null {
    const dt = event.dataTransfer;

    if (!dt) {
      return null;
    }

    if (dt.files && dt.files.length > 0) {
      return {
        kind: 'file',
        file: dt.files[0]
      };
    }

    // ----------------------------------------------------------
    // PAYLOAD INTERNO DE FOLDER LAB
    // ----------------------------------------------------------

    const custom =
      dt.getData('application/x-folder-lab');

    if (custom) {
      try {
        const payload =
          JSON.parse(custom) as FolderLabTextPayload;

        if (
          payload.kind === 'text' &&
          payload.text?.trim()
        ) {
          return payload;
        }

      } catch {
        // Continúa con el fallback.
      }
    }

    // ----------------------------------------------------------
    // TEXT/PLAIN
    // ----------------------------------------------------------

    const text =
      dt.getData('text/plain')?.trim();

    if (!text) {
      return null;
    }

    const source =
      this.activeDragSource;

    const activeFile =
      this.app.workspace.getActiveFile();

    return {
      kind: 'text',
      text,
      source: source ?? undefined,
      sourcePath: activeFile?.path,
      sourceName: activeFile?.basename
    };
  }
}

/**
 * Copia un archivo externo recibido por DataTransfer al vault.
 * No depende de una ruta del sistema operativo: usa File.arrayBuffer().
 */
export async function importDroppedFile(
  app: App,
  file: File,
  folderPath: string
): Promise<TFile> {
  const safeName = file.name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'recurso';
  const basePath = `${folderPath.replace(/\/$/, '')}/${safeName}`;

  let targetPath = basePath;
  let counter = 2;

  while (app.vault.getAbstractFileByPath(targetPath)) {
    const dot = safeName.lastIndexOf('.');
    const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot > 0 ? safeName.slice(dot) : '';
    targetPath = `${folderPath.replace(/\/$/, '')}/${stem} (${counter})${ext}`;
    counter++;
  }

  const buffer = await file.arrayBuffer();
  return app.vault.createBinary(targetPath, buffer);
};



export interface WidgetIdentityVisual {
  icon?: string;
  color?: string;
}

export function applyWidgetIdentity(
  element: HTMLElement,
  identity: WidgetIdentityVisual
): HTMLElement {
  if (identity.icon) {
    setIcon(element, identity.icon);
  }

if (identity.color) {

  element.addClass(
    'fl-widget-identity-colored'
  );

  element.setAttribute(
    'data-widget-color',
    identity.color
  );

  element.style.setProperty(
    '--fl-widget-identity-color',
    identity.color
  );

} else {

  element.removeClass(
    'fl-widget-identity-colored'
  );

  element.removeAttribute(
    'data-widget-color'
  );

  element.style.removeProperty(
    '--fl-widget-identity-color'
  );
}

  return element;
}



export function applyMenuItemIdentity(
  item: any,
  identity: WidgetIdentityVisual
): void {

  if (!identity.color) {
    return;
  }

  const itemEl =
    item?.dom as HTMLElement | undefined;

  if (!itemEl) {
    return;
  }

  const iconEl =
    itemEl.querySelector(
      '.menu-item-icon'
    ) as HTMLElement | null;

  if (!iconEl) {
    return;
  }

  applyWidgetIdentity(
    iconEl,
    identity
  );
}