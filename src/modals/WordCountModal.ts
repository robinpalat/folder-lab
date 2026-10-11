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
    stats.style.display = 'grid';
    stats.style.gridTemplateColumns = 'repeat(3, 1fr)';
    stats.style.gap = '12px';
    stats.style.marginBottom = '20px';

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
      detailList.style.maxHeight = '250px';
      detailList.style.overflow = 'auto';
      detailList.style.marginTop = '8px';
      detailList.style.border = '1px solid var(--background-modifier-border)';
      detailList.style.borderRadius = '6px';
      detailList.style.padding = '4px 0';

      for (const item of this.result.details) {
        const row = detailList.createEl('div', { cls: 'word-count-row' });
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.padding = '6px 10px';
        row.style.borderBottom = '1px solid var(--background-modifier-border)';
        row.style.fontSize = '0.9em';
        row.style.color = 'var(--text-normal)';

        row.createEl('span', { text: item.name });
        const countSpan = row.createEl('span', { text: item.words.toLocaleString() });
        countSpan.style.fontWeight = '600';
        countSpan.style.color = 'var(--text-accent)';
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
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.marginBottom = '16px';

    const button = row.createEl('button', {
      text: i18n.t('modal.wordCount.refreshButton'),
      attr: { 'aria-label': i18n.t('modal.wordCount.refreshButtonAria') }
    });

    const errorSpan = row.createEl('span', {
      cls: 'word-count-refresh-error'
    });
    errorSpan.style.color = 'var(--text-error)';
    errorSpan.style.fontSize = '0.85em';

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
      setButton.style.marginTop = '8px';
      setButton.onclick = () => this.renderGoalEditor(null);
      return;
    }

    const goalBox = section.createEl('div', {
      cls: 'word-count-goal-box'
    });
    goalBox.style.marginTop = '12px';
    goalBox.style.padding = '8px 10px';
    goalBox.style.border = '1px solid var(--background-modifier-border)';
    goalBox.style.borderRadius = '8px';
    goalBox.style.background = 'var(--background-primary-alt)';

    const headerRow = goalBox.createEl('div');
    headerRow.style.display = 'flex';
    headerRow.style.alignItems = 'center';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.marginBottom = '4px';

    const titleEl = headerRow.createEl('span', { text: i18n.t('modal.wordCount.goalTitle') });
    titleEl.style.fontWeight = '600';
    titleEl.style.fontSize = '0.9em';

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
    editor.style.marginTop = '8px';

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

    const actions = editor.createEl('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '8px';
    actions.style.marginTop = '8px';

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
    div.style.padding = '14px 10px';
    div.style.textAlign = 'center';
    div.style.border = '1px solid var(--background-modifier-border)';
    div.style.borderRadius = '8px';
    div.style.background = 'var(--background-primary-alt)';
    div.style.transition = 'transform 0.2s ease';

    const numEl = div.createEl('div', { text: number });
    numEl.style.fontSize = '2em';
    numEl.style.fontWeight = '700';
    numEl.style.color = 'var(--text-accent)';
    numEl.style.marginBottom = '4px';

    const labelEl = div.createEl('div', { text: label });
    labelEl.style.fontSize = '0.75em';
    labelEl.style.textTransform = 'uppercase';
    labelEl.style.color = 'var(--text-muted)';
    labelEl.style.letterSpacing = '0.2px';
  }

  private createStatRow(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createEl('div', { cls: 'word-count-row' });
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.padding = '6px 10px';
    row.style.borderBottom = '1px solid var(--background-modifier-border)';
    row.style.fontSize = '0.9em';
    row.style.color = 'var(--text-normal)';

    row.createEl('span', { text: label });
    const valueSpan = row.createEl('span', { text: value });
    valueSpan.style.fontWeight = '500';
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    this.goalSection = null;
  }
}
