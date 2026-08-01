import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { Subscription } from 'rxjs';
import dayjs, { Dayjs } from 'dayjs';
import { DataService } from '../../services/data.service';
import { User } from '../../../../../shared_models/models/user.model';
import {
  TaskListLens,
  collectTaskLists,
  isElementComplete,
} from '../../shared/task-lens.util';

/** One horizontal bar: a ToDoLst positioned by its tasks' time span. */
interface GanttRow {
  lens: TaskListLens;
  elementId: string;
  name: string;
  projectName: string;
  start: Dayjs;
  end: Dayjs;
  total: number;
  done: number;
  complete: boolean;
  left: number; // px from track origin
  width: number; // px
}

/** A dependency arrow between two rows (A2 `dependsOn`, drawn on the timeline). */
interface GanttLink {
  key: string;
  path: string;
  blocked: boolean;
}

interface RulerTick {
  left: number;
  label: string;
  major: boolean;
}

/**
 * Dependency-aware timeline / Gantt (N4).
 *
 * Reads the data that already exists — `scheduled_task.time` for the horizontal
 * span of each ToDoLst, and the element-level `dependsOn` links (A2) for the
 * arrows between them — via the shared task-lens util. Read-only: it visualises
 * schedule + dependencies without mutating anything, so there is no new contract.
 *
 * A dependency arrow is "blocked" (dashed / danger) when its predecessor list is
 * not yet complete, reusing the same completion rule as the canvas.
 *
 * Zoneless: geometry is computed into plain fields on each user/filter change and
 * change detection is driven manually.
 */
@Component({
  selector: 'app-timeline',
  standalone: true,
  imports: [],
  templateUrl: './timeline.component.html',
  styleUrls: ['./timeline.component.css'],
})
export class TimelineComponent implements OnInit, OnDestroy {
  private readonly dataService = inject(DataService);
  private readonly cdr = inject(ChangeDetectorRef);

  private currentUser: User | null = null;
  private sub?: Subscription;

  // Layout constants (px). Bound into the template so the SVG overlay and the
  // bar tracks share a single source of truth for alignment.
  readonly labelWidth = 220;
  readonly rowHeight = 48;
  readonly rulerHeight = 36;

  isLoading = true;
  rows: GanttRow[] = [];
  ticks: RulerTick[] = [];
  links: GanttLink[] = [];
  chartWidth = 0;
  rowsHeight = 0;
  todayLeft: number | null = null;
  unscheduledCount = 0;

  activeProject = 'all';
  projectNames: string[] = [];

  private minDate: Dayjs = dayjs();
  private pxPerDay = 48;

  ngOnInit(): void {
    this.sub = this.dataService.currentUser$.subscribe((user) => {
      this.currentUser = user;
      this.rebuild();
      this.isLoading = false;
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  setProject(name: string): void {
    this.activeProject = name;
    this.rebuild();
    this.cdr.detectChanges();
  }

  private rebuild(): void {
    const lists = collectTaskLists(this.currentUser);
    const names = new Set<string>();
    const rows: GanttRow[] = [];
    let unscheduled = 0;

    for (const lens of lists) {
      names.add(lens.projectName);
      if (this.activeProject !== 'all' && lens.projectName !== this.activeProject) {
        continue;
      }

      const timed = lens.tasks.filter((t) => t.time && dayjs(t.time).isValid());
      if (timed.length === 0) {
        if (lens.tasks.length > 0) unscheduled++;
        continue;
      }

      const times = timed.map((t) => dayjs(t.time));
      const start = times.reduce((a, b) => (b.isBefore(a) ? b : a));
      const end = times.reduce((a, b) => (b.isAfter(a) ? b : a));

      rows.push({
        lens,
        elementId: lens.elementId,
        name: `${lens.element.name || 'Untitled list'}`,
        projectName: lens.projectName,
        start,
        end,
        total: lens.tasks.length,
        done: lens.tasks.filter((t) => t.is_done).length,
        complete: isElementComplete(lens.element),
        left: 0,
        width: 0,
      });
    }

    this.projectNames = Array.from(names).sort((a, b) => a.localeCompare(b));
    if (this.activeProject !== 'all' && !names.has(this.activeProject)) {
      this.activeProject = 'all';
    }
    this.unscheduledCount = unscheduled;

    if (rows.length === 0) {
      this.rows = [];
      this.ticks = [];
      this.links = [];
      this.chartWidth = 0;
      this.rowsHeight = 0;
      this.todayLeft = null;
      return;
    }

    // Domain: floor to the earliest day, ceil past the latest, with a day of
    // padding on each side so bars never hug the edges.
    const minStart = rows.reduce((a, r) => (r.start.isBefore(a) ? r.start : a), rows[0].start);
    const maxEnd = rows.reduce((a, r) => (r.end.isAfter(a) ? r.end : a), rows[0].end);
    const minDate = minStart.startOf('day').subtract(1, 'day');
    const maxDate = maxEnd.startOf('day').add(2, 'day');
    const totalDays = Math.max(maxDate.diff(minDate, 'day'), 1);

    // Scale so the whole chart stays readable regardless of span.
    this.pxPerDay = totalDays <= 14 ? 64 : totalDays <= 45 ? 40 : totalDays <= 120 ? 20 : 10;
    this.minDate = minDate;
    this.chartWidth = totalDays * this.pxPerDay;

    const dayFrac = (d: Dayjs) => d.diff(minDate, 'hour') / 24;
    for (const r of rows) {
      r.left = dayFrac(r.start) * this.pxPerDay;
      r.width = Math.max((dayFrac(r.end) - dayFrac(r.start)) * this.pxPerDay, 28);
    }

    this.rows = rows;
    this.rowsHeight = rows.length * this.rowHeight;

    // Ruler ticks — daily for short spans, weekly / monthly for longer ones.
    const step = totalDays <= 21 ? 1 : totalDays <= 120 ? 7 : 30;
    const ticks: RulerTick[] = [];
    for (let d = 0; d <= totalDays; d += step) {
      const date = minDate.add(d, 'day');
      ticks.push({
        left: d * this.pxPerDay,
        label: date.format(step === 1 ? 'M/D' : 'MMM D'),
        major: date.date() === 1,
      });
    }
    this.ticks = ticks;

    // Today marker (only when it falls within the domain).
    const todayFrac = dayFrac(dayjs());
    const todayLeft = todayFrac * this.pxPerDay;
    this.todayLeft = todayLeft >= 0 && todayLeft <= this.chartWidth ? todayLeft : null;

    // Dependency arrows (A2). dependsOn holds predecessor element ids; only draw
    // links where BOTH ends are visible timed rows on the current view.
    const rowByElement = new Map<string, number>();
    rows.forEach((r, i) => {
      if (r.elementId) rowByElement.set(r.elementId, i);
    });
    const links: GanttLink[] = [];
    rows.forEach((dep, dIdx) => {
      const predIds = dep.lens.element.dependsOn ?? [];
      for (const predId of predIds) {
        const pIdx = rowByElement.get(predId);
        if (pIdx === undefined) continue;
        const pred = rows[pIdx];
        const x1 = pred.left + pred.width;
        const y1 = pIdx * this.rowHeight + this.rowHeight / 2;
        const x2 = dep.left;
        const y2 = dIdx * this.rowHeight + this.rowHeight / 2;
        const dx = Math.max(24, Math.abs(x2 - x1) / 2);
        links.push({
          key: `${predId}->${dep.elementId}`,
          path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
          blocked: !pred.complete,
        });
      }
    });
    this.links = links;
  }

  progressPct(row: GanttRow): number {
    return row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;
  }

  rangeLabel(row: GanttRow): string {
    const fmt = 'MMM D';
    return row.start.isSame(row.end, 'day')
      ? row.start.format(fmt)
      : `${row.start.format(fmt)} – ${row.end.format(fmt)}`;
  }

  rowTop(index: number): number {
    return index * this.rowHeight;
  }

  trackRow(_: number, row: GanttRow): string {
    return row.elementId || row.name;
  }

  trackLink(_: number, link: GanttLink): string {
    return link.key;
  }

  trackTick(_: number, tick: RulerTick): number {
    return tick.left;
  }
}
