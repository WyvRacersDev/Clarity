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

    this.analytics.getCompletionRateByTag(30, this.dataService.getCurrentUser()?.name || 'Demo User').subscribe({
      next: (res) => {
        console.log('Completion API response:', res);

        this.availableTags = res.labels;
        this.selectedTags = [];

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
        const totalTasks = res.counts ? res.counts.reduce((a, c) => a + c.total, 0) : 0;
        const onTimeTasks = res.counts ? res.counts.reduce((a, c) => a + c.onTime, 0) : 0;
        const lateTasks = res.counts ? res.counts.reduce((a, c) => a + c.late, 0) : 0;

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
        this.completionChartReady = true;
        this.kpiReady = true;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Completion API error:', err);
        this.completionChartReady = true;
        this.kpiReady = true;
        this.cdr.detectChanges();
      }
    });

    this.analytics.getCompletedPerDay(30, this.dataService.getCurrentUser()?.name || 'Demo User').subscribe({
      next: (res) => {
        console.log('Completed per day API response:', res);

        this.lineChartMap = res.series;

        this.lineChartData = {
          labels: res.labels,
          datasets: []
        };

        console.log('Line chart ready');
        this.lineChartReady = true;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Completed per day API error:', err);
        this.lineChartReady = true;
        this.cdr.detectChanges();
      }
    });
  }

  toggleTag(tag: string) {
    console.log('Toggling tag:', tag);

    const index = this.selectedTags.indexOf(tag);
    if (index > -1) {
      this.selectedTags.splice(index, 1);
    } else {
      this.selectedTags.push(tag);
    }

    console.log('Selected tags:', this.selectedTags);

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

    console.log('Updated line chart data');

    this.cdr.detectChanges();
    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => {
        this.lineChart?.chart?.update();
      }, 0);
    }
  }

  get hasLineChartData(): boolean {
    return this.lineChartData.datasets.length > 0;
  }

  get hasCompletionData(): boolean {
    return (this.completionChartData.labels?.length ?? 0) > 0;
  }

  get hasAvailableTags(): boolean {
    return this.availableTags.length > 0;
  }
}
