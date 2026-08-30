interface BoardConnection {
  fromCardId: string;
  toCardId: string;
}

export class Board {
  private container: HTMLElement | null = null;
  private surface: HTMLElement | null = null;
  private cardGrid: HTMLElement | null = null;
  private connectionLayer: SVGSVGElement | null = null;
  private connectionSourceId: string | null = null;
  private connections: BoardConnection[] = [];
  private resizeObserver: ResizeObserver | null = null;

  render(container: HTMLElement): void {
    this.destroy();
    this.container = container;
    this.container.addClass('fl-board');

    this.surface = this.container.createEl('div', { cls: 'fl-board-surface' });
    this.connectionLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.connectionLayer.classList.add('fl-board-connection-layer');
    this.connectionLayer.setAttribute('aria-hidden', 'true');
    this.surface.appendChild(this.connectionLayer);
    this.cardGrid = this.surface.createEl('div', { cls: 'fl-board-card-grid' });

    this.registerTextDrop(this.surface);
    this.surface.addEventListener('scroll', () => this.renderConnections());
    this.resizeObserver = new ResizeObserver(() => this.renderConnections());
    this.resizeObserver.observe(this.surface);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.container?.empty();
    this.container = null;
    this.surface = null;
    this.cardGrid = null;
    this.connectionLayer = null;
    this.connectionSourceId = null;
    this.connections = [];
  }

  private registerTextDrop(surface: HTMLElement): void {
    const acceptsText = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('text/plain');

    surface.addEventListener('dragenter', (event) => {
      if (!acceptsText(event)) return;
      event.preventDefault();
      surface.addClass('is-text-dragging');
    });
    surface.addEventListener('dragover', (event) => {
      if (!acceptsText(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      surface.addClass('is-text-dragging');
    });
    surface.addEventListener('dragleave', (event) => {
      const related = event.relatedTarget as Node | null;
      if (!related || !surface.contains(related)) surface.removeClass('is-text-dragging');
    });
    surface.addEventListener('drop', (event) => {
      if (!acceptsText(event)) return;
      event.preventDefault();
      surface.removeClass('is-text-dragging');
      const text = event.dataTransfer?.getData('text/plain').trim();
      if (text) this.createTextCard(text);
    });
  }

  private createTextCard(text: string): void {
    if (!this.cardGrid) return;
    const cardId = `board-card-${crypto.randomUUID()}`;
    const card = this.cardGrid.createEl('article', { cls: 'fl-board-text-card' });
    card.setAttr('data-board-card-id', cardId);
    const content = card.createEl('div', {
      cls: 'fl-board-text-card-content is-compact', text
    });
    const actions = card.createEl('div', { cls: 'fl-board-text-card-actions' });
    const expandToggle = actions.createEl('button', {
      cls: 'fl-board-text-card-toggle', text: 'Ver más', attr: { type: 'button' }
    });
    expandToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const expanded = !card.hasClass('is-expanded');
      card.toggleClass('is-expanded', expanded);
      content.toggleClass('is-compact', !expanded);
      expandToggle.setText(expanded ? 'Ver menos' : 'Ver más');
      requestAnimationFrame(() => this.renderConnections());
    });
    const connectButton = actions.createEl('button', {
      cls: 'fl-board-text-card-connect', text: 'Conectar', attr: { type: 'button' }
    });
    connectButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.startConnection(cardId);
    });
    card.addEventListener('click', () => {
      if (this.connectionSourceId && this.connectionSourceId !== cardId) {
        this.addConnection(this.connectionSourceId, cardId);
      }
    });
    requestAnimationFrame(() => {
      if (!card.isConnected) return;
      card.toggleClass('is-expandable', content.scrollHeight > content.clientHeight);
      this.renderConnections();
    });
  }

  private startConnection(cardId: string): void {
    this.connectionSourceId = cardId;
    this.cardGrid?.querySelectorAll('.fl-board-text-card').forEach((element) => {
      element.toggleClass('is-connection-source', element.getAttribute('data-board-card-id') === cardId);
    });
    this.surface?.addClass('is-connecting');
  }

  private addConnection(fromCardId: string, toCardId: string): void {
    const exists = this.connections.some((connection) =>
      connection.fromCardId === fromCardId && connection.toCardId === toCardId
    );
    if (!exists) this.connections.push({ fromCardId, toCardId });
    this.connectionSourceId = null;
    this.surface?.removeClass('is-connecting');
    this.cardGrid?.querySelectorAll('.fl-board-text-card').forEach((element) =>
      element.removeClass('is-connection-source')
    );
    this.renderConnections();
  }

  private renderConnections(): void {
    const surface = this.surface;
    const layer = this.connectionLayer;
    const grid = this.cardGrid;
    if (!surface || !layer || !grid) return;
    const width = Math.max(surface.clientWidth, surface.scrollWidth);
    const height = Math.max(surface.clientHeight, surface.scrollHeight);
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    layer.setAttribute('width', String(width));
    layer.setAttribute('height', String(height));
    layer.replaceChildren();
    const surfaceRect = surface.getBoundingClientRect();
    for (const connection of this.connections) {
      const source = grid.querySelector(`[data-board-card-id="${connection.fromCardId}"]`) as HTMLElement | null;
      const target = grid.querySelector(`[data-board-card-id="${connection.toCardId}"]`) as HTMLElement | null;
      if (!source || !target) continue;
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const sourceX = sourceRect.left - surfaceRect.left + surface.scrollLeft + sourceRect.width / 2;
      const sourceY = sourceRect.bottom - surfaceRect.top + surface.scrollTop;
      const targetX = targetRect.left - surfaceRect.left + surface.scrollLeft + targetRect.width / 2;
      const targetY = targetRect.top - surfaceRect.top + surface.scrollTop;
      const routeY = Math.max(sourceY, targetRect.bottom - surfaceRect.top + surface.scrollTop) + 20;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.classList.add('fl-board-connection-line');
      path.setAttribute('d', `M ${sourceX} ${sourceY} V ${routeY} H ${targetX} V ${targetY}`);
      layer.appendChild(path);
    }
  }
}
