import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SVG } from '@svgdotjs/svg.js';
import { Screen_Element, ToDoLst, Text_document } from '../../../../../../../shared_models/models/screen-elements.model';

@Component({
  selector: 'app-svg-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './svg-canvas.component.html',
  styleUrl: './svg-canvas.component.css'
})
export class SvgCanvasComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  @Input() elements: Screen_Element[] = [];
  @Input() selectedElementIndex: number = -1;
  @Output() elementSelected = new EventEmitter<number>();
  @Output() elementMoved = new EventEmitter<{ index: number; x: number; y: number }>();
  @Output() elementDeleted = new EventEmitter<number>();
  @Output() addElementRequest = new EventEmitter<string>();

  @ViewChild('canvasContainer') canvasContainer!: ElementRef;

  private svg: any = null;
  private elementsGroup: any = null;

  // Canvas state
  zoom = 1;
  panX = 0;
  panY = 0;
  showGrid = true;
  gridSize = 20;

  // Interaction state
  isPanning = false;
  dragStartX = 0;
  dragStartY = 0;

  // UI state
  showToolbar = true;

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    this.initCanvas();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['elements'] && this.svg) {
      this.renderElements();
    }
    if (changes['selectedElementIndex'] && this.svg) {
      this.updateSelection();
    }
  }

  ngOnDestroy(): void {
    if (this.svg) {
      this.svg.remove();
    }
  }

  private initCanvas(): void {
    const container = this.canvasContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    // Create SVG canvas
    this.svg = SVG().addTo(container).size('100%', '100%').viewbox(0, 0, width, height);

    // Create groups
    this.elementsGroup = this.svg.group().attr({ id: 'elements' });

    // Draw grid
    this.drawGrid();

    // Render elements
    this.renderElements();

    // Setup events
    this.setupEvents();

    // Handle resize
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  private drawGrid(): void {
    const gridGroup = this.svg.group().attr({ id: 'grid' });

    if (!this.showGrid) return;

    const width = 3000;
    const height = 2000;

    for (let x = 0; x <= width; x += this.gridSize) {
      gridGroup.line(x, 0, x, height).stroke({ color: 'rgba(0, 212, 255, 0.05)', width: 1 });
    }

    for (let y = 0; y <= height; y += this.gridSize) {
      gridGroup.line(0, y, width, y).stroke({ color: 'rgba(0, 212, 255, 0.05)', width: 1 });
    }
  }

  private renderElements(): void {
    if (!this.elementsGroup) return;

    this.elementsGroup.clear();

    this.elements.forEach((element, index) => {
      const x = (element as any).x_pos * 250 || index * 280;
      const y = (element as any).y_pos * 200 || index * 180;
      const width = this.getElementWidth(element);
      const height = 150;

      const group = this.elementsGroup.group().attr({
        id: `element-${index}`,
        class: 'canvas-element'
      });

      // Background
      group.rect(width, height)
        .fill('#1a1a2e')
        .stroke({ color: '#00d4ff', width: 1 })
        .radius(12)
        .move(0, 0);

      // Type badge
      const type = this.getElementType(element);
      group.text(type.toUpperCase()).font({ size: 10, fill: '#888' }).move(12, 10);

      // Name
      group.text(String(element.name || 'Untitled')).font({ size: 14, fill: '#fff' }).move(12, 30);

      // Preview content
      if (type === 'Todo' && (element as ToDoLst).scheduled_tasks?.length > 0) {
        const tasks = (element as ToDoLst).scheduled_tasks.slice(0, 3);
        tasks.forEach((task, i) => {
          group.text(`${task.is_done ? '✓' : '○'} ${task.taskname}`)
            .font({ size: 12, fill: '#aaa' })
            .move(12, 60 + i * 20);
        });
      } else if (type === 'Text') {
        const text = (element as Text_document).Text_field || '';
        const preview = text.substring(0, 60) + (text.length > 60 ? '...' : '');
        group.text(preview).font({ size: 12, fill: '#aaa' }).move(12, 60);
      }

      // Position group
      group.move(x, y);

      // Store index
      group.elementIndex = index;

      // Click handler
      group.on('click', () => {
        this.elementSelected.emit(index);
        this.updateSelection();
      });
    });

    this.updateSelection();
  }

  private setupEvents(): void {
    this.svg.on('mousedown', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest('.canvas-element')) return;

      const mouseEvent = e as MouseEvent;
      this.isPanning = true;
      this.dragStartX = mouseEvent.clientX - this.panX;
      this.dragStartY = mouseEvent.clientY - this.panY;
    });

    this.svg.on('mousemove', (e: Event) => {
      if (!this.isPanning) return;
      const mouseEvent = e as MouseEvent;
      this.panX = mouseEvent.clientX - this.dragStartX;
      this.panY = mouseEvent.clientY - this.dragStartY;
      this.updateViewbox();
    });

    this.svg.on('mouseup', () => {
      this.isPanning = false;
    });

    this.svg.on('wheel', (e: Event) => {
      e.preventDefault();
      const wheelEvent = e as WheelEvent;
      const delta = wheelEvent.deltaY > 0 ? 0.9 : 1.1;
      this.zoom = Math.max(0.25, Math.min(3, this.zoom * delta));
      this.updateViewbox();
    });
  }

  private updateSelection(): void {
    if (!this.elementsGroup) return;

    this.elementsGroup.each((i: number, children: any[]) => {
      const rect = children[i].find('rect')[0];
      if (rect) {
        rect.stroke({ color: '#00d4ff', width: 1 });
      }
    });

    if (this.selectedElementIndex >= 0) {
      const selected = this.svg.find(`#element-${this.selectedElementIndex}`)[0];
      if (selected) {
        const rect = selected.find('rect')[0];
        if (rect) {
          rect.stroke({ color: '#00d4ff', width: 3 });
        }
      }
    }
  }

  private updateViewbox(): void {
    const container = this.canvasContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    const vbWidth = width / this.zoom;
    const vbHeight = height / this.zoom;
    const vbX = -this.panX / this.zoom;
    const vbY = -this.panY / this.zoom;

    this.svg.viewbox(vbX, vbY, vbWidth, vbHeight);
  }

  private handleResize(): void {
    this.updateViewbox();
  }

  // Public methods
  zoomIn(): void {
    this.zoom = Math.min(3, this.zoom * 1.2);
    this.updateViewbox();
  }

  zoomOut(): void {
    this.zoom = Math.max(0.25, this.zoom / 1.2);
    this.updateViewbox();
  }

  resetView(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.updateViewbox();
  }

  fitToScreen(): void {
    if (this.elements.length === 0) {
      this.resetView();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    this.elements.forEach((el, i) => {
      const x = (el as any).x_pos * 250 || i * 280;
      const y = (el as any).y_pos * 200 || i * 180;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + this.getElementWidth(el));
      maxY = Math.max(maxY, y + 150);
    });

    const container = this.canvasContainer.nativeElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight || 600;

    const scaleX = containerWidth / (maxX - minX + 100);
    const scaleY = containerHeight / (maxY - minY + 100);
    this.zoom = Math.min(scaleX, scaleY, 1);

    this.panX = -(containerWidth - (maxX - minX) * this.zoom) / 2 + minX * this.zoom - 50 * this.zoom;
    this.panY = -(containerHeight - (maxY - minY) * this.zoom) / 2 + minY * this.zoom - 50 * this.zoom;

    this.updateViewbox();
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.svg.find('#grid')[0]?.remove();
    this.drawGrid();
  }

  deleteSelected(): void {
    if (this.selectedElementIndex >= 0) {
      this.elementDeleted.emit(this.selectedElementIndex);
    }
  }

  addElement(type: string): void {
    this.addElementRequest.emit(type);
  }

  private getElementType(element: Screen_Element): string {
    if (element instanceof ToDoLst) return 'Todo';
    if (element instanceof Text_document) return 'Text';
    return 'Element';
  }

  private getElementWidth(element: Screen_Element): number {
    const xscale = (element as any).x_scale || 1;
    if (xscale > 10) return xscale;
    return 280;
  }

  getZoomPercent(): number {
    return Math.round(this.zoom * 100);
  }
}
