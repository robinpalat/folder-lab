// ============================================================
// COMPONENTE: StatsComponent
// ============================================================
// Renderiza las estadísticas de progreso
// ============================================================


import { FolderLabController } from '../core/FolderLabController';  //  CORREGIDO

export class StatsComponent {
  private container: HTMLElement;
  private controller: FolderLabController;
  private element: HTMLElement;

  constructor(container: HTMLElement, controller: FolderLabController) {
    this.container = container;
    this.controller = controller;
  }

  render(): void {
    if (this.element) {
      this.element.remove();
    }

    this.element = this.container.createEl('div', { cls: 'folder-order-stats' });
    this.element.style.width = '100%';
    this.element.style.fontSize = '0.8em';
    this.element.style.color = 'var(--text-muted)';
    this.element.style.opacity = '0.8';
    this.element.style.padding = '0 4px 12px 4px';
    this.element.style.boxSizing = 'border-box';
    this.element.style.textAlign = 'left';
    
    // Actualizar stats asincrónicamente
    this.updateStats();
  }

  async updateStats(): Promise<void> {
    if (!this.element) return;
    
    const stats = await this.controller.getStats();
    if (stats && stats.totalNotes > 0) {
      this.element.textContent = `${stats.totalNotes} notas  ·  ${stats.percentage}% completado`;
    } else {
      this.element.textContent = '0 notas  ·  0% completado';
    }
  }
}
