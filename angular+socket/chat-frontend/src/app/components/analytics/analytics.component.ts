import { Component, OnInit, ViewChild, ChangeDetectorRef, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ChartData, Chart, registerables } from 'chart.js';
import { AnalyticsService, SeriesEntry } from '../../services/analytics.service';
import { FormsModule } from '@angular/forms';
import { BaseChartDirective } from 'ng2-charts';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DataService } from '../../services/data.service';

Chart.register(...registerables);

export interface KpiStat {
  label: string;
  value: string;
  sub: string;
  trend: 'up' | 'down' | 'neutral';
  variant: 'blue' | 'cyan' | 'teal' | 'green' | 'lime' | 'accent' | 'success' | 'warning' | 'danger';
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [
    BaseChartDirective,
    FormsModule,
    CommonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.css']
})
export class AnalyticsComponent implements OnInit {

  @ViewChild('lineChart') lineChart?: BaseChartDirective;
  @ViewChild('barChart') barChart?: BaseChartDirective;

  lineChartMap: SeriesEntry[] = [];
  lineChartData: ChartData<'line'> = {
    labels: [],
    datasets: []
  };

  availableTags: string[] = [];
  selectedTags: string[] = [];

  completionChartData: ChartData<'bar'> = {
    labels: [],
    datasets: [
      {
        label: 'Completion Rate (%)',
        data: [],
        // Resolved at runtime via resolveAccentColors(); placeholders kept for SSR
        backgroundColor: 'rgba(23, 196, 206, 0.50)',
        borderColor: 'rgba(23, 196, 206, 1)',
        borderWidth: 2,
      }
    ]
  };

  // Individual flags for each chart
  completionChartReady = false;
  lineChartReady = false;

  // A13: error flags per data source. When set, the corresponding surface shows
  // an explicit error state with a retry action instead of silently rendering an
  // empty/"no data" chart (which is indistinguishable from a genuine empty result).
  completionError = false;
  lineError = false;

  // KPI stats derived from API responses
  kpiStats: KpiStat[] = [];
  kpiReady = false;

  // Zedd Clarity album accent spectrum — resolved at runtime from CSS custom properties.
  // Fallback literals mirror the dark-mode token values so SSR and canvas both work.
  private seriesColors: string[] = [
    '#2E6FB0', // --accent-blue   (resolved in ngOnInit when in browser)
    '#17C4CE', // --accent cyan   (--accent)
    '#1FB6AE', // --accent-teal
    '#34C471', // --accent-green
    '#86C540', // --accent-lime
    '#2E6FB0', // --accent-blue   (wrap for 6th series)
  ];

  /** Read CSS custom property values from the document root (browser only). */
  private resolveAccentColors(): void {
    if (!isPlatformBrowser(this.platformId)) { return; }
    const style = getComputedStyle(document.documentElement);
    const get = (v: string) => style.getPropertyValue(v).trim();
    this.seriesColors = [
      get('--accent-blue'),
      get('--accent'),
      get('--accent-teal'),
      get('--accent-green'),
      get('--accent-lime'),
      get('--accent-blue'), // wrap for 6th series
    ];
    // Recolor chart chrome (legend/ticks/grid/tooltip) from theme tokens so
    // both dark and light themes render legible axes. Falls back to the dark
    // literals baked into the options objects when a token is empty.
    this.applyChartChrome({
      text: get('--text-secondary'),
      muted: get('--text-muted'),
      grid: get('--border'),
      border: get('--border-strong'),
      surface: get('--surface-2'),
      primary: get('--text-primary'),
      mono: get('--font-mono') || 'ui-monospace, monospace',
    });
  }

  /** Apply resolved token colors to both chart option objects. */
  private applyChartChrome(c: {
    text: string; muted: string; grid: string; border: string;
    surface: string; primary: string; mono: string;
  }): void {
    const legend = { color: c.text, font: { size: 12, family: c.mono }, boxWidth: 12, boxHeight: 12, padding: 16 };
    const tooltip = {
      backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
      titleColor: c.primary, bodyColor: c.text, padding: 12, cornerRadius: 10,
      titleFont: { family: c.mono }, bodyFont: { family: c.mono },
    };
    const tick = { color: c.muted, font: { size: 11, family: c.mono } };

    (this.lineChartOptions.plugins.legend.labels as any) = { ...this.lineChartOptions.plugins.legend.labels, ...legend };
    Object.assign(this.lineChartOptions.plugins.tooltip, tooltip);
    Object.assign(this.lineChartOptions.scales.x.ticks, tick);
    Object.assign(this.lineChartOptions.scales.y.ticks, tick);
    this.lineChartOptions.scales.x.grid.color = c.grid;
    this.lineChartOptions.scales.y.grid.color = c.grid;
    this.lineChartOptions.scales.x.border.color = c.border;
    this.lineChartOptions.scales.y.border.color = c.border;
    (this.lineChartOptions.scales.y.title as any).color = c.muted;

    (this.barChartOptions.plugins.legend.labels as any) = { ...this.barChartOptions.plugins.legend.labels, ...legend };
    Object.assign(this.barChartOptions.plugins.tooltip, tooltip);
    Object.assign(this.barChartOptions.scales.x.ticks, tick);
    Object.assign(this.barChartOptions.scales.y.ticks, tick);
    this.barChartOptions.scales.x.grid.color = c.grid;
    this.barChartOptions.scales.y.grid.color = c.grid;
    this.barChartOptions.scales.x.border.color = c.border;
    this.barChartOptions.scales.y.border.color = c.border;
    (this.barChartOptions.scales.y.title as any).color = c.muted;
  }

  /** Build rgba(r,g,b, alpha) fill from a hex CSS-var value. */
  private hexToRgba(hex: string, alpha: number): string {
    const h = hex.replace('#', '');
    if (h.length !== 6) { return `rgba(0,0,0,${alpha})`; }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  lineChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          color: 'rgba(169,177,194,1)',
          font: { size: 13, family: 'Inter, system-ui, sans-serif' },
          boxWidth: 12,
          boxHeight: 12,
          padding: 16,
        }
      },
      tooltip: {
        backgroundColor: 'rgba(23,27,36,0.95)',
        borderColor: 'rgba(255,255,255,0.10)',
        borderWidth: 1,
        titleColor: '#F4F6FB',
        bodyColor: '#A9B1C2',
        padding: 12,
        cornerRadius: 10,
      }
    },
    scales: {
      x: {
        ticks: { color: '#6B7385', font: { size: 11 } },
        grid: { color: 'rgba(255,255,255,0.05)' },
        border: { color: 'rgba(255,255,255,0.06)' }
      },
      y: {
        beginAtZero: true,
        ticks: { color: '#6B7385', font: { size: 11 } },
        title: { display: true, text: 'Tasks Completed', color: '#6B7385', font: { size: 12 } },
        grid: { color: 'rgba(255,255,255,0.05)' },
        border: { color: 'rgba(255,255,255,0.06)' }
      }
    }
  };

  barChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: { left: 10, right: 10, top: 10, bottom: 20 }
    },
    plugins: {
      legend: {
        display: true,
        labels: {
          color: '#A9B1C2',
          font: { size: 13, family: 'Inter, system-ui, sans-serif' },
          boxWidth: 12,
          boxHeight: 12,
          padding: 16,
        }
      },
      tooltip: {
        backgroundColor: 'rgba(23,27,36,0.95)',
        borderColor: 'rgba(255,255,255,0.10)',
        borderWidth: 1,
        titleColor: '#F4F6FB',
        bodyColor: '#A9B1C2',
        padding: 12,
        cornerRadius: 10,
        callbacks: {
          label: (ctx: any) => ` ${ctx.raw}%`
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#6B7385',
          autoSkip: false,
          maxRotation: 45,
          minRotation: 45,
          font: { size: 11 }
        },
        grid: { color: 'rgba(255,255,255,0.05)' },
        border: { color: 'rgba(255,255,255,0.06)' }
      },
      y: {
        beginAtZero: true,
        max: 100,
        ticks: {
          color: '#6B7385',
          font: { size: 11 },
          callback: function(value: any) {
            return value + '%';
          }
        },
        title: { display: true, text: 'Completion Rate (%)', color: '#6B7385', font: { size: 12 } },
        grid: { color: 'rgba(255,255,255,0.05)' },
        border: { color: 'rgba(255,255,255,0.06)' }
      }
    }
  };

  constructor(
    private analytics: AnalyticsService,
    private cdr: ChangeDetectorRef,
    private dataService: DataService,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  ngOnInit(): void {
    console.log('Analytics Component Initialized');

    // Resolve CSS custom property values once, before chart data is built
    this.resolveAccentColors();

    this.loadAvailableTags();
    this.loadCompletionData();
    this.loadLineData();
  }

  /**
   * Populate the "Filter by tag" chips from ALL of the user's tags (not only
   * those with completed tasks), so every tag is selectable. The charts still
   * source their data from the completion endpoints; a tag with no completions
   * simply charts as zero.
   */
  loadAvailableTags(): void {
    const username = this.dataService.getCurrentUser()?.name || 'Demo User';
    this.analytics.getUserTags(username).subscribe({
      next: (res) => {
        this.availableTags = res.tags ?? [];
        // Default: keep every project selected so the line chart shows all
        // series on load (the user can deselect chips to narrow it down).
        this.selectAllTags();
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('User tags API error:', err);
        // Non-fatal: fall back to whatever completion data provided.
      },
    });
  }

  /**
   * A13: (re)load the completion-rate-by-tag data that feeds both the KPI strip
   * and the completion bar chart. Resets the ready/error flags up front so a
   * retry shows the loading state again, and flips `completionError` on failure
   * so the template renders an error state with a retry button instead of a
   * blank "no data" chart.
   */
  loadCompletionData(): void {
    this.completionChartReady = false;
    this.kpiReady = false;
    this.completionError = false;
    this.cdr.markForCheck();

    this.analytics.getCompletionRateByTag(30, this.dataService.getCurrentUser()?.name || 'Demo User').subscribe({
      next: (res) => {
        console.log('Completion API response:', res);

        // Merge (union) rather than overwrite: `loadAvailableTags()` is the
        // primary source (all of the user's tags), and completion labels are a
        // subset — merging keeps the full chip set regardless of call order or a
        // failed tags request. Drops the synthetic "__untagged__" bucket.
        const merged = new Set([...this.availableTags, ...res.labels]);
        merged.delete('__untagged__');
        this.availableTags = Array.from(merged);
        // Keep all projects selected by default (union may have grown the list).
        this.selectAllTags();

        // Bar chart: cyan (--accent) fill, blue (--accent-blue) border
        const barFill = this.hexToRgba(this.seriesColors[1], 0.50); // --accent cyan
        const barBorder = this.seriesColors[0];                      // --accent-blue

        this.completionChartData = {
          labels: res.labels,
          datasets: [
            {
              label: 'Completion Rate (%)',
              data: res.values.map(v => Math.round(v * 100)),
              backgroundColor: barFill,
              borderColor: barBorder,
              borderWidth: 2,
              borderRadius: 6,
            } as any
          ]
        };

        // Build KPI stats from completion data
        const rates = res.values.map(v => Math.round(v * 100));
        const avgRate = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;
        // The backend returns `counts` as an object keyed by tag
        // ({ tag: { total, onTime, late } }), not an array. Normalize to an
        // array of summaries before reducing — calling .reduce on the object
        // threw "reduce is not a function", which aborted this handler and left
        // the charts stuck on their skeleton loaders forever.
        const countSummaries: Array<{ total: number; onTime: number; late: number }> =
          res.counts ? Object.values(res.counts as any) : [];
        const totalTasks = countSummaries.reduce((a, c) => a + (c?.total ?? 0), 0);
        const onTimeTasks = countSummaries.reduce((a, c) => a + (c?.onTime ?? 0), 0);
        const lateTasks = countSummaries.reduce((a, c) => a + (c?.late ?? 0), 0);

        // KPI cards each get a distinct album hue: blue → cyan → teal → green
        this.kpiStats = [
          {
            label: 'Avg Completion Rate',
            value: `${avgRate}%`,
            sub: `across ${res.labels.length} tag${res.labels.length !== 1 ? 's' : ''}`,
            trend: avgRate >= 70 ? 'up' : avgRate >= 40 ? 'neutral' : 'down',
            variant: 'blue',
          },
          {
            label: 'Total Tasks',
            value: `${totalTasks}`,
            sub: 'last 30 days',
            trend: 'neutral',
            variant: 'cyan',
          },
          {
            label: 'Completed On Time',
            value: `${onTimeTasks}`,
            sub: totalTasks > 0 ? `${Math.round((onTimeTasks / totalTasks) * 100)}% of total` : 'no data',
            trend: 'up',
            variant: 'green',
          },
          {
            label: 'Completed Late',
            value: `${lateTasks}`,
            sub: totalTasks > 0 ? `${Math.round((lateTasks / totalTasks) * 100)}% of total` : 'no data',
            trend: lateTasks > 0 ? 'down' : 'neutral',
            variant: 'lime',
          },
        ];

        console.log('Completion chart ready');
        this.completionError = false;
        this.completionChartReady = true;
        this.kpiReady = true;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Completion API error:', err);
        // A13: surface the failure instead of swallowing it as an empty chart.
        this.completionError = true;
        this.completionChartReady = true;
        this.kpiReady = true;
        this.cdr.markForCheck();
      }
    });
  }

  /**
   * A13: (re)load the completed-tasks-per-day series that feeds the line chart.
   * Mirrors {@link loadCompletionData}: resets flags up front and flips
   * `lineError` on failure so the chart shows a retryable error state.
   */
  loadLineData(): void {
    this.lineChartReady = false;
    this.lineError = false;
    this.cdr.markForCheck();

    this.analytics.getCompletedPerDay(30, this.dataService.getCurrentUser()?.name || 'Demo User').subscribe({
      next: (res) => {
        console.log('Completed per day API response:', res);

        this.lineChartMap = res.series;

        // Set the day labels, then (re)draw the series for the currently
        // selected projects — which default to all, so the chart is populated
        // on load rather than blank until the user clicks a chip.
        this.lineChartData = { labels: res.labels, datasets: [] };
        this.rebuildLineChart();

        console.log('Line chart ready');
        this.lineError = false;
        this.lineChartReady = true;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Completed per day API error:', err);
        // A13: surface the failure instead of swallowing it as an empty chart.
        this.lineError = true;
        this.lineChartReady = true;
        this.cdr.markForCheck();
      }
    });
  }

  toggleTag(tag: string) {
    const index = this.selectedTags.indexOf(tag);
    if (index > -1) {
      this.selectedTags.splice(index, 1);
    } else {
      this.selectedTags.push(tag);
    }
    this.rebuildLineChart();
  }

  /** Select every available tag (default state) and redraw the line chart. */
  selectAllTags(): void {
    this.selectedTags = [...this.availableTags];
    this.rebuildLineChart();
  }

  /**
   * Rebuild the line chart datasets from the current `selectedTags` against the
   * loaded `lineChartMap`, then push the update. Shared by the initial
   * "all selected" default and each chip toggle.
   */
  private rebuildLineChart(): void {
    this.lineChartData = {
      labels: this.lineChartData.labels,
      datasets: this.selectedTags.map((selectedTag, i) => {
        const color = this.seriesColors[i % this.seriesColors.length];
        return {
          label: selectedTag,
          data: this.lineChartMap.find(s => s.tag === selectedTag)?.data || [],
          borderColor: color,
          backgroundColor: this.hexToRgba(color, 0.14),
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointHoverRadius: 5,
        };
      })
    };

    this.cdr.markForCheck();
    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => {
        this.lineChart?.chart?.update();
      }, 0);
    }
  }

  get hasLineChartData(): boolean {
    return this.lineChartData.datasets.length > 0;
  }

  // ── B4: accessibility — role="img" aria-labels + text-table fallbacks ──────
  // Canvas charts are opaque to screen readers, so each chart carries a spoken
  // summary (aria-label) and a visually-hidden data table with the same numbers.

  get lineChartAriaLabel(): string {
    const days = this.lineChartData.labels?.length ?? 0;
    const tags = this.selectedTags.length ? this.selectedTags.join(', ') : 'none selected';
    return `Line chart: completed tasks per day over the last ${days} days, by tag (${tags}). ` +
           `A data table with the same values follows.`;
  }

  get barChartAriaLabel(): string {
    const n = this.completionChartData.labels?.length ?? 0;
    return `Bar chart: task completion rate as a percentage for ${n} tag${n !== 1 ? 's' : ''}. ` +
           `A data table with the same values follows.`;
  }

  /** Rows for the bar chart's screen-reader table: tag + completion rate (%). */
  get completionTableRows(): { tag: string; rate: number }[] {
    const labels = (this.completionChartData.labels ?? []) as string[];
    const data = (this.completionChartData.datasets[0]?.data ?? []) as number[];
    return labels.map((tag, i) => ({ tag, rate: data[i] ?? 0 }));
  }

  /** Series (tag) names — column headers for the line chart's table. */
  get lineTableColumns(): string[] {
    return (this.lineChartData.datasets ?? []).map(d => (d.label ?? '') as string);
  }

  /** Rows for the line chart's screen-reader table: day + per-tag counts. */
  get lineTableRows(): { day: string; values: number[] }[] {
    const labels = (this.lineChartData.labels ?? []) as string[];
    const datasets = this.lineChartData.datasets ?? [];
    return labels.map((day, i) => ({
      day: day as string,
      values: datasets.map(d => ((d.data as number[])[i] ?? 0)),
    }));
  }

  get hasCompletionData(): boolean {
    return (this.completionChartData.labels?.length ?? 0) > 0;
  }

  get hasAvailableTags(): boolean {
    return this.availableTags.length > 0;
  }
}
