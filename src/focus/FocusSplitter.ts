export class FocusSplitter {
  private element: HTMLElement | null = null;
  private handle: HTMLElement | null = null;
  private container: HTMLElement;
  
  private onDrag: (ratio: number) => void;
  private onDragStart?: () => void;
  private onDragEnd?: () => void;
  
  private isDragging: boolean = false;
  private startY: number = 0;
  private startRatio: number = 0;
  private currentRatio: number = 50;
  private minRatio: number = 15;
  private maxRatio: number = 85;
  
  private boundOnMouseDown: (e: MouseEvent) => void;
  private boundOnMouseMove: (e: MouseEvent) => void;
  private boundOnMouseUp: (e: MouseEvent) => void;

  constructor(
    container: HTMLElement,
    initialRatio: number = 50,
    onDrag: (ratio: number) => void,
    onDragStart?: () => void,
    onDragEnd?: () => void
  ) {
    this.container = container;
    this.currentRatio = Math.max(this.minRatio, Math.min(this.maxRatio, initialRatio));
    this.onDrag = onDrag;
    this.onDragStart = onDragStart;
    this.onDragEnd = onDragEnd;
    
    this.boundOnMouseDown = this.handleMouseDown.bind(this);
    this.boundOnMouseMove = this.handleMouseMove.bind(this);
    this.boundOnMouseUp = this.handleMouseUp.bind(this);
  }

  render(): HTMLElement {
    if (this.element) {
      this.element.remove();
    }

    // El contenedor conserva la geometría estructural definida por
    // FocusWorkspace. Todo el aspecto visual lo controla el CSS.
    this.container.classList.add('focus-splitter-container');

    this.element = this.container.createEl('div', {
      cls: 'focus-splitter'
    });

    this.handle = this.element.createEl('div', {
      cls: 'focus-splitter-handle'
    });

    // El evento mousedown se captura en el contenedor.
    this.container.addEventListener(
      'mousedown',
      this.boundOnMouseDown
    );

    return this.element;
  }

  private handleMouseDown(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();

    this.isDragging = true;
    this.startY = e.clientY;
    this.startRatio = this.currentRatio;

    // El estado visual del drag lo controla CSS.
    this.container.classList.add('is-dragging');
    document.body.classList.add('focus-splitter-dragging');

    if (this.onDragStart) {
      this.onDragStart();
    }

    document.addEventListener(
      'mousemove',
      this.boundOnMouseMove
    );

    document.addEventListener(
      'mouseup',
      this.boundOnMouseUp
    );
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;
    
    // Usar el elemento padre para calcular
    const parent = this.container.parentElement;
    if (!parent) return;
    
    const rect = parent.getBoundingClientRect();
    const deltaY = e.clientY - this.startY;
    const deltaRatio = (deltaY / rect.height) * 100;
    
    let newRatio = this.startRatio + deltaRatio;
    newRatio = Math.max(this.minRatio, Math.min(this.maxRatio, newRatio));
    
    this.currentRatio = newRatio;
    this.onDrag(newRatio);
  }

  private handleMouseUp(_e: MouseEvent): void {
    if (!this.isDragging) return;

    this.isDragging = false;

    this.container.classList.remove('is-dragging');
    document.body.classList.remove('focus-splitter-dragging');

    document.removeEventListener(
      'mousemove',
      this.boundOnMouseMove
    );

    document.removeEventListener(
      'mouseup',
      this.boundOnMouseUp
    );

    if (this.onDragEnd) {
      this.onDragEnd();
    }
  }

  getRatio(): number {
    return this.currentRatio;
  }

  setRatio(ratio: number): void {
    this.currentRatio = Math.max(this.minRatio, Math.min(this.maxRatio, ratio));
  }

  destroy(): void {
    document.removeEventListener('mousemove', this.boundOnMouseMove);
    document.removeEventListener('mouseup', this.boundOnMouseUp);
    
    if (this.container) {
      this.container.removeEventListener('mousedown', this.handleMouseDown.bind(this));
    }
    
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
    this.handle = null;
  }
}