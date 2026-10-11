// ============================================================
// MODAL: WordCountModal
// ============================================================
// Muestra los resultados del conteo de palabras del libro y la
// meta de escritura (propiedad del libro master, no de la
// carpeta abierta).
// ============================================================

import { Modal, App, setIcon } from 'obsidian';
import { WordCountResult } from '../services/WordCountService';
import {
  clampPercentage,
  parseBookGoalInput
} from '../utils/headerStats';
import { i18n } from '../i18n/I18nService';

export interface WordCountModalOptions {
  /** Meta actual del libro (0 = sin meta). */
  getGoal: () => number;
  /** Guarda (o quita con null) la meta del libro. */
  setGoal: (words: number | null) => void | Promise<void>;
  /**
   * Fuerza un conteo nuevo del libro (botón «Actualizar
   * estadísticas»). Devuelve null si el recorrido falla: el
   * diálogo conserva entonces el último resultado válido.
   */
  refreshStats?: () => Promise<WordCountResult | null>;
}

export class WordCountModal extends Modal {
  private result: WordCountResult;
  private bookName: string;
  private options: WordCountModalOptions | null;
  private goalSection: HTMLElement | null = null;

  constructor(
    app: App,
    result: WordCountResult,
    bookName: string,
    options?: WordCountModalOptions
  ) {
    super(app);
    this.result = result;
    this.bookName = bookName;
    this.options = options ?? null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('word-count-modal');
    this.renderBody();
  }

  /**
   * Dibuja el diálogo completo a partir del resultado vigente.
   * Se reutiliza al pulsar «Actualizar estadísticas» para
   * refrescar TODAS las cifras con el conteo nuevo.
   */
  private renderBody(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Título
    contentEl.createEl('h2', { text: `${this.bookName}` });

    // Actualizar estadísticas (única vía de un conteo nuevo
    // junto a la inicialización del diálogo).
    if (this.options?.refreshStats) {
      this.renderRefreshRow(contentEl);
    }

    // Estadísticas principales
    const stats = contentEl.createEl('div', { cls: 'word-count-stats' });

    this.createStatItem(stats, this.result.totalWords.toLocaleString(), i18n.t('modal.wordCount.stat.totalWords'));
    this.createStatItem(stats, this.result.totalNotes.toLocaleString(), i18n.t('modal.wordCount.stat.notes'));
    this.createStatItem(stats, this.result.avgWords.toLocaleString(), i18n.t('modal.wordCount.stat.avgPerNote'));

    // Meta de escritura del libro
    if (this.options) {
      this.goalSection = contentEl.createEl('div', {
        cls: 'word-count-goal'
      });
      this.renderGoalSection();
    }

    // Detalle por nota
    if (this.result.details.length > 0) {
      contentEl.createEl('h4', { text: i18n.t('modal.wordCount.detailsHeading') });

      const detailList = contentEl.createEl('div', { cls: 'word-count-details' });

      for (const item of this.result.details) {
        const row = detailList.createEl('div', { cls: 'word-count-row' });

        row.createEl('span', { text: item.name });
        row.createEl('span', {
          text: item.words.toLocaleString(),
          cls: 'word-count-count'
        });
      }
    }
  }

  /**
   * Botón «Actualizar estadísticas»: estado de carga mientras
   * dura el recorrido; si falla se conserva el resultado actual
   * y se muestra el error junto al botón.
   */
  private renderRefreshRow(parent: HTMLElement): void {
    const row = parent.createEl('div', {
      cls: 'word-count-refresh'
    });

    const button = row.createEl('button', {
      text: i18n.t('modal.wordCount.refreshButton'),
      attr: { 'aria-label': i18n.t('modal.wordCount.refreshButtonAria') }
    });

    const errorSpan = row.createEl('span', {
      cls: 'word-count-refresh-error'
    });

    button.onclick = async () => {
      button.disabled = true;
      button.textContent = i18n.t('modal.wordCount.refreshing');
      errorSpan.textContent = '';

      const fresh = await this.options!.refreshStats!();

      if (fresh) {
        // Reemplaza el resultado y repinta todas las cifras.
        this.result = fresh;
        this.renderBody();
        return;
      }

      // Fallo: conservar el último resultado válido y avisar.
      button.disabled = false;
      button.textContent = i18n.t('modal.wordCount.refreshButton');
      errorSpan.textContent = i18n.t('modal.wordCount.refreshError');
    };
  }

  // ============================================================
  // SECCIÓN DE META DEL LIBRO
  // ============================================================

  /**
   * Estado sin meta: botón «Establecer meta».
   * Estado con meta: valores + engranaje «Cambiar meta».
   */
  private renderGoalSection(): void {
    const section = this.goalSection;
    if (!section || !this.options) return;

    section.empty();

    const goal = this.options.getGoal();

    if (!(goal > 0)) {
      const setButton = section.createEl('button', {
        text: i18n.t('modal.wordCount.setGoal'),
        cls: 'word-count-goal-set'
      });
      setButton.onclick = () => this.renderGoalEditor(null);
      return;
    }

    const goalBox = section.createEl('div', {
      cls: 'word-count-goal-box'
    });

    const headerRow = goalBox.createEl('div', {
      cls: 'word-count-goal-header'
    });

    const titleEl = headerRow.createEl('span', {
      text: i18n.t('modal.wordCount.goalTitle'),
      cls: 'word-count-goal-title'
    });

    const gear = headerRow.createEl('button', {
      cls: 'clickable-icon',
      attr: {
        'aria-label': i18n.t('modal.wordCount.changeGoal'),
        title: i18n.t('modal.wordCount.changeGoal')
      }
    });
    setIcon(gear, 'settings');
    gear.onclick = () => this.renderGoalEditor(goal);

    const rows = goalBox.createEl('div');
    this.createStatRow(rows, i18n.t('modal.wordCount.goalWords'), goal.toLocaleString());
    this.createStatRow(rows, i18n.t('modal.wordCount.currentWords'), this.result.totalWords.toLocaleString());

    const percentage = clampPercentage(
      (this.result.totalWords / goal) * 100
    );
    this.createStatRow(rows, i18n.t('modal.wordCount.compliance'), `${percentage}%`);
  }

  /**
   * Editor de la meta: input numérico + Guardar/Cancelar.
   * Valor vacío = quitar la meta. Entero positivo requerido.
   */
  private renderGoalEditor(currentGoal: number | null): void {
    const section = this.goalSection;
    if (!section || !this.options) return;

    section.empty();

    const editor = section.createEl('div', {
      cls: 'word-count-goal-editor'
    });

    const input = editor.createEl('input', {
      cls: 'fl-folder-goal-input',
      attr: {
        type: 'number',
        min: '1',
        step: '1',
        placeholder: currentGoal !== null
          ? String(currentGoal)
          : i18n.t('modal.wordCount.goalPlaceholder'),
        'aria-label': i18n.t('modal.wordCount.goalAria')
      }
    }) as unknown as HTMLInputElement;

    if (currentGoal !== null) {
      input.value = String(currentGoal);
    }

    const actions = editor.createEl('div', {
      cls: 'fl-modal-actions word-count-goal-editor-actions'
    });

    const cancelButton = actions.createEl('button', { text: i18n.t('common.cancel') });
    cancelButton.onclick = () => this.renderGoalSection();

    const saveButton = actions.createEl('button', {
      text: i18n.t('modal.wordCount.saveGoal'),
      cls: 'mod-cta'
    });

    const evaluate = (): void => {
      const parsed = parseBookGoalInput(input.value);
      // Vacío solo es válido para quitar una meta existente.
      saveButton.disabled =
        parsed.kind === 'invalid' ||
        (parsed.kind === 'empty' && currentGoal === null);
    };

    input.addEventListener('input', evaluate);
    evaluate();

    saveButton.onclick = async () => {
      const parsed = parseBookGoalInput(input.value);

      if (parsed.kind === 'invalid') return;

      const nextGoal = parsed.kind === 'valid' ? parsed.value : null;
      await this.options!.setGoal(nextGoal);
      this.renderGoalSection();
    };

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  // ============================================================
  // UTILIDADES DE PRESENTACIÓN
  // ============================================================

  private createStatItem(parent: HTMLElement, number: string, label: string): void {
    const div = parent.createEl('div', { cls: 'word-count-stat-item' });

    div.createEl('div', { text: number, cls: 'word-count-number' });
    div.createEl('div', { text: label, cls: 'word-count-label' });
  }

  private createStatRow(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createEl('div', { cls: 'word-count-row' });

    row.createEl('span', { text: label });
    row.createEl('span', { text: value, cls: 'word-count-goal-value' });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    this.goalSection = null;
  }
}
