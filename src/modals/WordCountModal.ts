// ============================================================
// MODAL: WordCountModal
// ============================================================
// Muestra los resultados del conteo de palabras
// ============================================================

import { Modal, App } from 'obsidian';
import { WordCountResult } from '../services/WordCountService';

export class WordCountModal extends Modal {
  private result: WordCountResult;
  private bookName: string;

  constructor(app: App, result: WordCountResult, bookName: string) {
    super(app);
    this.result = result;
    this.bookName = bookName;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('word-count-modal');

    // Título
    contentEl.createEl('h2', { text: `📊 ${this.bookName}` });

    // Estadísticas principales
    const stats = contentEl.createEl('div', { cls: 'word-count-stats' });
    stats.style.display = 'grid';
    stats.style.gridTemplateColumns = 'repeat(3, 1fr)';
    stats.style.gap = '12px';
    stats.style.marginBottom = '20px';

    this.createStatItem(stats, this.result.totalWords.toLocaleString(), 'Total palabras');
    this.createStatItem(stats, this.result.totalNotes.toLocaleString(), 'Notas');
    this.createStatItem(stats, this.result.avgWords.toLocaleString(), 'Promedio por nota');

    // Máximo y mínimo
    this.createStatRow(contentEl, '🏆 Más palabras', `${this.result.maxWords.name} (${this.result.maxWords.words.toLocaleString()})`);
    this.createStatRow(contentEl, '📉 Menos palabras', `${this.result.minWords.name} (${this.result.minWords.words.toLocaleString()})`);

    // Detalle por nota
    if (this.result.details.length > 0) {
      contentEl.createEl('h4', { text: 'Detalle por nota' });

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
  }
}