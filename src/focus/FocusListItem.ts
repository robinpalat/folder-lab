// src/focus/FocusListItem.ts

export type FocusListItemState =
  | 'default'
  | 'active'
  | 'inactive'
  | 'completed';

export interface FocusListItemAction {
  id: string;
  label: string;
  onClick: (event: MouseEvent) => void;
  disabled?: boolean;
}

export interface FocusListItemConfig {
  state?: FocusListItemState;
  primaryAction?: FocusListItemAction;
  deleteAction?: FocusListItemAction;
}

export class FocusListItem {
  private item: HTMLElement;
  private content: HTMLElement;
  private actions: HTMLElement;
  private primaryIndicator: HTMLElement | null = null;

  constructor(
    container: HTMLElement,
    config: FocusListItemConfig = {}
  ) {
    this.item = container.createEl('div', {
      cls: 'fl-focus-list-item'
    });

    this.content = this.item.createEl('div', {
      cls: 'fl-focus-list-item-content'
    });

    this.actions = this.item.createEl('div', {
      cls: 'fl-focus-list-item-actions'
    });

    if (config.state) {
      this.setState(config.state);
    }

    if (config.primaryAction) {
      this.renderPrimaryAction(config.primaryAction);
    }

    if (config.deleteAction) {
      this.renderDeleteAction(config.deleteAction);
    }
  }

  getContentElement(): HTMLElement {
    return this.content;
  }

  setState(state: FocusListItemState): void {
    this.item.classList.remove(
      'is-default',
      'is-active',
      'is-inactive',
      'is-completed'
    );

    this.item.classList.add(`is-${state}`);

    this.updatePrimaryIndicator();
  }

  destroy(): void {
    this.item.remove();
  }

  private renderPrimaryAction(
    action: FocusListItemAction
  ): void {
    const button = this.actions.createEl('button', {
      cls: 'fl-focus-list-item-action',
      attr: {
        type: 'button',
        'aria-label': action.label,
        'aria-pressed': String(
          this.item.classList.contains('is-active')
        )
      }
    });

    this.primaryIndicator = button.createEl('span', {
      cls: 'fl-focus-list-item-action-indicator'
    });

    this.updatePrimaryIndicator();

    button.addEventListener('click', (event) => {
      event.stopPropagation();

      if (action.disabled) {
        return;
      }

      action.onClick(event);
    });
  }

  private renderDeleteAction(
    action: FocusListItemAction
  ): void {
    const button = this.actions.createEl('button', {
      cls: 'fl-focus-list-item-delete',
      attr: {
        type: 'button',
        'aria-label': action.label
      }
    });

    button.textContent = '×';

    button.addEventListener('click', (event) => {
      event.stopPropagation();

      if (action.disabled) {
        return;
      }

      action.onClick(event);
    });
  }

  private updatePrimaryIndicator(): void {
    if (!this.primaryIndicator) {
      return;
    }

    this.primaryIndicator.classList.toggle(
      'is-active',
      this.item.classList.contains('is-active')
    );
  }

setExpanded(expanded: boolean): void {
  console.log('[FocusListItem] setExpanded llamado con', expanded, this.item);
  this.item.classList.toggle('is-expanded', expanded);
  this.actions.classList.toggle('is-hidden', expanded);
}
}



