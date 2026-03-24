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
import Konva from 'konva';
import { Screen_Element, ToDoLst, Text_document, Image, Video } from '../../../../../../../shared_models/models/screen-elements.model';

type KonvaNode = Konva.Node;
type KonvaStage = Konva.Stage;
type KonvaLayer = Konva.Layer;

export interface CanvasElement {
  id: string;
  element: Screen_Element;
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
}

@Component({
  selector: 'app-canvas-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './canvas-workspace.component.html',
  styleUrl: './canvas-workspace.component.css'
})
export class CanvasWorkspaceComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  @Input() elements: Screen_Element[] = [];
  @Input() selectedElementIndex: number = -1;
  @Output() elementSelected = new EventEmitter<number>();
  @Output() elementMoved = new EventEmitter<{ index: number; x: number; y: number }>();
  @Output() elementResized = new EventEmitter<{ index: number; width: number; height: number }>();
  @Output() elementDeleted = new EventEmitter<number>();
  @Output() addElementRequest = new EventEmitter<string>();

  @ViewChild('container') containerRef!: ElementRef;

  private stage: KonvaStage | null = null;
  private layer: KonvaLayer | null = null;
  private transformer: Konva.Transformer | null = null;

  // Canvas state
  zoom = 1;
  showGrid = true;
  gridSize = 20;

  // UI state
  showToolbar = true;

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    this.initCanvas();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['elements'] && this.stage) {
      this.renderElements();
    }
    if (changes['selectedElementIndex'] && this.transformer) {
      this.updateSelection();
    }
  }

  ngOnDestroy(): void {
    if (this.stage) {
      this.stage.destroy();
    }
  }

  private initCanvas(): void {
    const container = this.containerRef.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    this.stage = new Konva.Stage({
      container: container,
      width: width,
      height: height,
      draggable: true
    });

    this.layer = new Konva.Layer();
    this.stage.add(this.layer);

    // Add grid layer (bottom)
    this.drawGrid();

    // Add transformer for selection
    this.transformer = new Konva.Transformer({
      rotateEnabled: true,
      enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center'],
      boundBoxFunc: (oldBox, newBox) => {
        if (newBox.width < 50 || newBox.height < 30) {
          return oldBox;
        }
        return newBox;
      }
    });
    this.layer.add(this.transformer);

    // Render initial elements
    this.renderElements();

    // Handle stage events
    this.stage.on('wheel', this.handleWheel.bind(this));
    this.stage.on('click tap', this.handleStageClick.bind(this));

    // Handle window resize
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  private drawGrid(): void {
    if (!this.layer || !this.stage) return;

    const gridLayer = new Konva.Layer({ name: 'grid' });

    const gridSize = this.gridSize;
    const width = this.stage.width();
    const height = this.stage.height();

    // Draw vertical lines
    for (let i = 0; i < width / gridSize; i++) {
      gridLayer.add(new Konva.Rect({
        x: i * gridSize,
        y: 0,
        width: 1,
        height: height,
        fill: 'rgba(0, 212, 255, 0.1)',
        stroke: 'rgba(0, 212, 255, 0.05)',
        strokeWidth: 1
      }));
    }

    // Draw horizontal lines
    for (let i = 0; i < height / gridSize; i++) {
      gridLayer.add(new Konva.Rect({
        x: 0,
        y: i * gridSize,
        width: width,
        height: 1,
        fill: 'rgba(0, 212, 255, 0.1)',
        stroke: 'rgba(0, 212, 255, 0.05)',
        strokeWidth: 1
      }));
    }

    this.stage.add(gridLayer);
    gridLayer.moveToBottom();
  }

  private renderElements(): void {
    if (!this.layer) return;

    // Remove existing element shapes (keep transformer)
    const shapes = this.layer.find('.element-shape');
    shapes.forEach((shape: KonvaNode) => shape.destroy());

    this.elements.forEach((element, index) => {
      const shape = this.createElementShape(element, index);
      if (shape) {
        this.layer!.add(shape);
      }
    });

    this.updateSelection();
    this.layer.draw();
  }

  private createElementShape(element: Screen_Element, index: number): Konva.Group | null {
    if (!this.layer) return null;

    const x = (element as any).x_pos * 250 || index * 280;
    const y = (element as any).y_pos * 200 || index * 180;
    const width = this.getElementWidth(element);
    const height = 150;

    const group = new Konva.Group({
      x: x,
      y: y,
      width: width,
      height: height,
      draggable: true,
      name: 'element-shape',
      id: `element-${index}`
    });

    // Background rect
    const bgRect = new Konva.Rect({
      width: width,
      height: height,
      fill: '#1a1a2e',
      stroke: '#00d4ff',
      strokeWidth: 1,
      cornerRadius: 12,
      shadowColor: '#00d4ff',
      shadowBlur: 10,
      shadowOpacity: 0.2
    });

    // Element type badge
    const typeText = new Konva.Text({
      text: this.getElementType(element).toUpperCase(),
      fontSize: 10,
      fill: '#888',
      padding: 8
    });

    // Element name
    const nameText = new Konva.Text({
      text: String(element.name || 'Untitled'),
      fontSize: 14,
      fill: '#fff',
      padding: 8,
      y: 25
    });

    group.add(bgRect);
    group.add(typeText);
    group.add(nameText);

    // Handle drag
    group.on('dragend', (e: any) => {
      const newPos = { x: e.target.x(), y: e.target.y() };
      this.elementMoved.emit({
        index,
        x: Math.round(newPos.x / 250),
        y: Math.round(newPos.y / 200)
      });
    });

    // Handle click for selection
    group.on('click tap', (e: any) => {
      e.cancelBubble = true;
      this.elementSelected.emit(index);
      this.selectElement(index);
    });

    // Handle transform
    group.on('transformend', (e: any) => {
      const node = e.target;
      this.elementResized.emit({
        index,
        width: node.width() * node.scaleX(),
        height: node.height() * node.scaleY()
      });
      node.scaleX(1);
      node.scaleY(1);
    });

    return group;
  }

  private selectElement(index: number): void {
    if (!this.transformer || !this.layer) return;

    const node = this.stage?.findOne(`#element-${index}`);
    if (node) {
      this.transformer.nodes([node as Konva.Shape]);
    } else {
      this.transformer.nodes([]);
    }
    this.layer.draw();
  }

  private updateSelection(): void {
    if (this.selectedElementIndex >= 0) {
      this.selectElement(this.selectedElementIndex);
    } else if (this.transformer) {
      this.transformer.nodes([]);
      this.layer?.draw();
    }
  }

  private handleWheel(e: any): void {
    e.evt.preventDefault();

    const oldScale = this.zoom;
    const pointer = this.stage!.getPointerPosition();

    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - this.stage!.x()) / oldScale,
      y: (pointer.y - this.stage!.y()) / oldScale
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = direction > 0 ? oldScale * 1.1 : oldScale / 1.1;
    this.zoom = Math.max(0.25, Math.min(3, newScale));

    this.stage!.scale({ x: this.zoom, y: this.zoom });

    const newPos = {
      x: pointer.x - mousePointTo.x * this.zoom,
      y: pointer.y - mousePointTo.y * this.zoom
    };
    this.stage!.position(newPos);
    this.stage!.batchDraw();
  }

  private handleStageClick(e: any): void {
    if (e.target === this.stage) {
      this.elementSelected.emit(-1);
      this.transformer?.nodes([]);
      this.layer?.draw();
    }
  }

  private handleResize(): void {
    if (!this.stage) return;

    const container = this.containerRef.nativeElement;
    this.stage.width(container.clientWidth);
    this.stage.height(container.clientHeight || 600);
    this.stage.draw();
  }

  // Public methods for toolbar
  zoomIn(): void {
    this.zoom = Math.min(3, this.zoom * 1.2);
    this.stage?.scale({ x: this.zoom, y: this.zoom });
    this.stage?.batchDraw();
  }

  zoomOut(): void {
    this.zoom = Math.max(0.25, this.zoom / 1.2);
    this.stage?.scale({ x: this.zoom, y: this.zoom });
    this.stage?.batchDraw();
  }

  resetView(): void {
    this.zoom = 1;
    this.stage?.scale({ x: 1, y: 1 });
    this.stage?.position({ x: 0, y: 0 });
    this.stage?.batchDraw();
  }

  fitToScreen(): void {
    if (!this.stage || this.elements.length === 0) {
      this.resetView();
      return;
    }

    // Calculate bounding box of all elements
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    this.elements.forEach((el, i) => {
      const x = (el as any).x_pos * 250 || i * 280;
      const y = (el as any).y_pos * 200 || i * 180;
      const w = this.getElementWidth(el);
      const h = 150;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    });

    const padding = 50;
    const containerWidth = this.stage.width();
    const containerHeight = this.stage.height();

    const scaleX = containerWidth / (maxX - minX + padding * 2);
    const scaleY = containerHeight / (maxY - minY + padding * 2);
    this.zoom = Math.min(scaleX, scaleY, 1);

    this.stage.scale({ x: this.zoom, y: this.zoom });
    this.stage.position({
      x: (containerWidth - (maxX - minX) * this.zoom) / 2 - minX * this.zoom,
      y: (containerHeight - (maxY - minY) * this.zoom) / 2 - minY * this.zoom
    });
    this.stage.batchDraw();
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;
    const gridLayer = this.stage?.find('.grid')[0] as KonvaLayer;
    if (gridLayer) {
      gridLayer.visible(this.showGrid);
      this.stage?.batchDraw();
    }
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
    if (element instanceof Image) return 'Image';
    if (element instanceof Video) return 'Video';
    return 'Element';
  }

  private getElementWidth(element: Screen_Element): number {
    const xscale = (element as any).x_scale || 1;
    if (xscale > 10) return xscale;

    const type = this.getElementType(element);
    switch (type) {
      case 'Todo': return 280;
      case 'Text': return 300;
      case 'Image': return 320;
      case 'Video': return 320;
      default: return 250;
    }
  }

  getZoomPercent(): number {
    return Math.round(this.zoom * 100);
  }
}
