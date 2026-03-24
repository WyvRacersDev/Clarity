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
import * as fabric from 'fabric';
import { Screen_Element, ToDoLst, Text_document, Image, Video } from '../../../../../../../shared_models/models/screen-elements.model';

@Component({
  selector: 'app-fabric-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fabric-canvas.component.html',
  styleUrl: './fabric-canvas.component.css'
})
export class FabricCanvasComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  @Input() elements: Screen_Element[] = [];
  @Input() selectedElementIndex: number = -1;
  @Output() elementSelected = new EventEmitter<number>();
  @Output() elementMoved = new EventEmitter<{ index: number; x: number; y: number }>();
  @Output() elementResized = new EventEmitter<{ index: number; width: number; height: number }>();
  @Output() elementDeleted = new EventEmitter<number>();
  @Output() addElementRequest = new EventEmitter<string>();

  @ViewChild('canvasContainer') canvasContainer!: ElementRef;
  @ViewChild('canvasEl') canvasEl!: ElementRef<HTMLCanvasElement>;

  private canvas: fabric.Canvas | null = null;

  // Canvas state
  zoom = 1;
  showGrid = true;
  gridSize = 20;

  // UI state
  showToolbar = true;
  isPanning = false;
  private lastPosX = 0;
  private lastPosY = 0;

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    this.initCanvas();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['elements'] && this.canvas) {
      this.renderElements();
    }
    if (changes['selectedElementIndex'] && this.canvas) {
      this.updateSelection();
    }
  }

  ngOnDestroy(): void {
    if (this.canvas) {
      this.canvas.dispose();
    }
  }

  private initCanvas(): void {
    const container = this.canvasContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    this.canvas = new fabric.Canvas(this.canvasEl.nativeElement, {
      width: width,
      height: height,
      backgroundColor: '#0a0a0f',
      selection: true,
      preserveObjectStacking: true
    });

    // Draw grid
    this.drawGrid();

    // Render initial elements
    this.renderElements();

    // Handle selection events
    this.canvas.on('selection:created', this.handleSelection.bind(this));
    this.canvas.on('selection:updated', this.handleSelection.bind(this));
    this.canvas.on('selection:cleared', () => this.elementSelected.emit(-1));

    // Handle object modification
    this.canvas.on('object:modified', this.handleObjectModified.bind(this));

    // Handle mouse wheel for zoom
    this.canvas.on('mouse:wheel', this.handleWheel.bind(this));

    // Handle window resize
    window.addEventListener('resize', this.handleResize.bind(this));

    // Set custom controls styling
    fabric.FabricObject.prototype.set({
      borderColor: '#00d4ff',
      cornerColor: '#00d4ff',
      cornerStyle: 'circle',
      cornerSize: 10,
      transparentCorners: false,
      borderScaleFactor: 2
    });
  }

  private drawGrid(): void {
    if (!this.canvas || !this.showGrid) return;

    const gridSize = this.gridSize;
    const width = this.canvas.getWidth() * 3;
    const height = this.canvas.getHeight() * 3;

    const gridLines: fabric.Line[] = [];

    // Vertical lines
    for (let i = 0; i < width / gridSize; i++) {
      const line = new fabric.Line([i * gridSize, 0, i * gridSize, height], {
        stroke: 'rgba(0, 212, 255, 0.1)',
        strokeWidth: 1,
        selectable: false,
        evented: false,
        excludeFromExport: true,
        objectCaching: false
      });
      gridLines.push(line);
    }

    // Horizontal lines
    for (let i = 0; i < height / gridSize; i++) {
      const line = new fabric.Line([0, i * gridSize, width, i * gridSize], {
        stroke: 'rgba(0, 212, 255, 0.1)',
        strokeWidth: 1,
        selectable: false,
        evented: false,
        excludeFromExport: true,
        objectCaching: false
      });
      gridLines.push(line);
    }

    const gridGroup = new fabric.Group(gridLines, {
      selectable: false,
      evented: false,
      excludeFromExport: true
    });
    (gridGroup as any).name = 'grid';

    this.canvas.add(gridGroup);
    this.canvas.sendObjectToBack(gridGroup);
  }

  private renderElements(): void {
    if (!this.canvas) return;

    // Remove existing element objects (keep grid)
    const objects = this.canvas.getObjects();
    objects.forEach((obj: any) => {
      if (obj.name?.startsWith('element-')) {
        this.canvas!.remove(obj);
      }
    });

    this.elements.forEach((element, index) => {
      const fabricObj = this.createElementObject(element, index);
      if (fabricObj) {
        this.canvas!.add(fabricObj);
      }
    });

    this.updateSelection();
    this.canvas.renderAll();
  }

  private createElementObject(element: Screen_Element, index: number): fabric.Group | null {
    const x = (element as any).x_pos * 250 || index * 280;
    const y = (element as any).y_pos * 200 || index * 180;
    const width = this.getElementWidth(element);
    const height = 150;

    const elementType = this.getElementType(element);
    const colors: Record<string, string> = {
      'Todo': '#1a3a2e',
      'Text': '#2e1a3a',
      'Image': '#3a2e1a',
      'Video': '#1a2e3a',
      'Element': '#1a1a2e'
    };
    const bgColor = colors[elementType] || '#1a1a2e';

    // Create group elements
    const rect = new fabric.Rect({
      width: width,
      height: height,
      fill: bgColor,
      stroke: '#00d4ff',
      strokeWidth: 1,
      rx: 12,
      ry: 12,
      shadow: new fabric.Shadow({
        color: 'rgba(0, 212, 255, 0.3)',
        blur: 15,
        offsetX: 0,
        offsetY: 0
      })
    });

    const typeText = new fabric.Text(elementType.toUpperCase(), {
      fontSize: 10,
      fill: '#888',
      left: 12,
      top: 10,
      fontFamily: 'Inter, system-ui, sans-serif'
    });

    const nameText = new fabric.Text(String(element.name || 'Untitled'), {
      fontSize: 14,
      fill: '#ffffff',
      left: 12,
      top: 30,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: '500'
    });

    // Content preview
    let contentText: fabric.Text | null = null;
    if (elementType === 'Todo' && (element as ToDoLst).scheduled_tasks?.length > 0) {
      const tasks = (element as ToDoLst).scheduled_tasks;
      const preview = tasks.slice(0, 3).map(t => `${t.is_done ? '✓' : '○'} ${t.taskname}`).join('\n');
      contentText = new fabric.Text(preview, {
        fontSize: 12,
        fill: '#aaa',
        left: 12,
        top: 60,
        fontFamily: 'Inter, system-ui, sans-serif'
      });
    } else if (elementType === 'Text') {
      const text = (element as Text_document).Text_field || '';
      const preview = text.substring(0, 100) + (text.length > 100 ? '...' : '');
      contentText = new fabric.Text(preview, {
        fontSize: 12,
        fill: '#aaa',
        left: 12,
        top: 60,
        fontFamily: 'Inter, system-ui, sans-serif',
        width: width - 24
      });
    }

    const groupObjects = [rect, typeText, nameText];
    if (contentText) groupObjects.push(contentText);

    const group = new fabric.Group(groupObjects, {
      left: x,
      top: y,
      hasControls: true,
      hasBorders: true,
      selectable: true
    });

    // Custom properties (not in typed interface)
    (group as any).name = `element-${index}`;
    (group as any).elementIndex = index;

    return group;
  }

  private handleSelection(e: any): void {
    const selected = e.selected?.[0];
    if (selected && (selected as any).elementIndex !== undefined) {
      this.elementSelected.emit((selected as any).elementIndex);
    }
  }

  private handleObjectModified(e: any): void {
    const obj = e.target;
    if (!obj || (obj as any).elementIndex === undefined) return;

    const index = (obj as any).elementIndex;
    const left = obj.left || 0;
    const top = obj.top || 0;

    if (e.action === 'drag') {
      this.elementMoved.emit({
        index,
        x: Math.round(left / 250),
        y: Math.round(top / 200)
      });
    } else if (e.action === 'scale' || e.action === 'resize') {
      this.elementResized.emit({
        index,
        width: obj.getScaledWidth(),
        height: obj.getScaledHeight()
      });
    }
  }

  private handleWheel(opt: any): void {
    const e = opt.e;
    e.preventDefault();
    e.stopPropagation();

    const delta = e.deltaY;
    let zoom = this.canvas!.getZoom();
    zoom *= 0.999 ** delta;
    zoom = Math.min(Math.max(0.25, zoom), 3);

    this.canvas!.zoomToPoint({ x: e.offsetX, y: e.offsetY } as fabric.Point, zoom);
    this.zoom = zoom;
    opt.e.preventDefault();
    opt.e.stopPropagation();
  }

  private updateSelection(): void {
    if (!this.canvas) return;

    this.canvas.discardActiveObject();

    if (this.selectedElementIndex >= 0) {
      const objects = this.canvas.getObjects();
      const targetObj = objects.find((obj: any) => obj.name === `element-${this.selectedElementIndex}`);
      if (targetObj) {
        this.canvas.setActiveObject(targetObj);
      }
    }

    this.canvas.renderAll();
  }

  private handleResize(): void {
    if (!this.canvas) return;

    const container = this.canvasContainer.nativeElement;
    (this.canvas as any).setWidth(container.clientWidth);
    (this.canvas as any).setHeight(container.clientHeight || 600);
    this.canvas.renderAll();
  }

  // Public methods for toolbar
  zoomIn(): void {
    if (!this.canvas) return;
    let zoom = this.canvas.getZoom();
    zoom = Math.min(3, zoom * 1.2);
    this.canvas.setZoom(zoom);
    this.zoom = zoom;
    this.canvas.renderAll();
  }

  zoomOut(): void {
    if (!this.canvas) return;
    let zoom = this.canvas.getZoom();
    zoom = Math.max(0.25, zoom / 1.2);
    this.canvas.setZoom(zoom);
    this.zoom = zoom;
    this.canvas.renderAll();
  }

  resetView(): void {
    if (!this.canvas) return;
    this.canvas.setZoom(1);
    this.canvas.absolutePan({ x: 0, y: 0 } as fabric.Point);
    this.zoom = 1;
    this.canvas.renderAll();
  }

  fitToScreen(): void {
    if (!this.canvas || this.elements.length === 0) {
      this.resetView();
      return;
    }

    // Calculate bounding box
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
    const canvasWidth = this.canvas.getWidth();
    const canvasHeight = this.canvas.getHeight();

    const scaleX = canvasWidth / (maxX - minX + padding * 2);
    const scaleY = canvasHeight / (maxY - minY + padding * 2);
    this.zoom = Math.min(scaleX, scaleY, 1);

    this.canvas.setZoom(this.zoom);
    this.zoom = this.zoom;
    this.canvas.renderAll();
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;

    // Remove existing grid
    const gridObj = this.canvas?.getObjects().find((obj: any) => obj.name === 'grid');
    if (gridObj) {
      this.canvas!.remove(gridObj);
    }

    if (this.showGrid) {
      this.drawGrid();
    }

    this.canvas?.renderAll();
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

  // Export canvas as image
  exportAsImage(): string | null {
    if (!this.canvas) return null;
    return this.canvas.toDataURL({
      format: 'png',
      quality: 1,
      multiplier: 2
    });
  }
}
