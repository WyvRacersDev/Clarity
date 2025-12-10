import { Component, OnInit, ViewChild, ChangeDetectorRef } from '@angular/core';
import { ChartData, Chart, registerables } from 'chart.js';
import { AnalyticsService, SeriesEntry } from '../../services/analytics.service';
import { FormsModule } from '@angular/forms';
import { BaseChartDirective } from 'ng2-charts';
import { CommonModule } from '@angular/common';
import { MatChipOption, MatChipSet } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DataService } from '../../services/data.service';

// Register Chart.js components
Chart.register(...registerables);

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [
    BaseChartDirective,
    FormsModule,
    CommonModule,
    MatChipOption,
    MatChipSet,
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
        backgroundColor: 'rgba(0, 212, 255, 0.6)',
        borderColor: '#00D4FF',
        borderWidth: 2
      }
    ]
  };

  // Individual flags for each chart
  completionChartReady = false;
  lineChartReady = false;

  // Chart options
  lineChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          color: '#FFFFFF',
          font: {
            size: 14
          }
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#FFFFFF'
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.1)'
        }
      },
      y: {
        beginAtZero: true,
        ticks: {
          color: '#FFFFFF'
        },
        title: {
          display: true,
          text: 'Tasks Completed',
          color: '#FFFFFF'
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.1)'
        }
      }
    }
  };

  barChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        left: 10,
        right: 10,
        top: 10,
        bottom: 20
      }
    },
    plugins: {
      legend: {
        display: true,
        labels: {
          color: '#FFFFFF',
          font: {
            size: 14
          },
          padding: 15
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#FFFFFF',
          autoSkip: false,
          maxRotation: 45,
          minRotation: 45,
          font: {
            size: 11
          }
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.1)'
        }
      },
      y: {
        beginAtZero: true,
        max: 100,
        ticks: {
          color: '#FFFFFF',
          callback: function(value: any) {
            return value + '%';
          }
        },
        title: {
          display: true,
          text: 'Completion Rate (%)',
          color: '#FFFFFF'
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.1)'
        }
      }
    }
  };

  constructor(
    private analytics: AnalyticsService,
    private cdr: ChangeDetectorRef,
    private dataService: DataService
  ) {}

  ngOnInit(): void {
    console.log('Analytics Component Initialized');

    // COMPLETION RATE
    this.analytics.getCompletionRateByTag(30,this.dataService.getCurrentUser()?.name || "Demo User").subscribe({
      next: (res) => {
        console.log("Completion API response:", res);
        
        this.availableTags = res.labels;
        this.selectedTags = [];
        
        this.completionChartData = {
          labels: res.labels,
          datasets: [
            {
              label: 'Completion Rate (%)',
              data: res.values.map(v => Math.round(v * 100)),
              backgroundColor: 'rgba(0, 212, 255, 0.6)',
              borderColor: '#00D4FF',
              borderWidth: 2
            }
          ]
        };

        console.log("Completion chart ready");
        
        this.completionChartReady = true;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error("❌ Completion API error:", err);
      }
    });

    // COMPLETED PER DAY
    this.analytics.getCompletedPerDay(30,this.dataService.getCurrentUser()?.name || "Demo User").subscribe({
      next: (res) => {
        console.log("📈 Completed per day API response:", res);
        
        this.lineChartMap = res.series;
        
        this.lineChartData = {
          labels: res.labels,
          datasets: []  // Start empty until tags are selected
        };

        console.log("Line chart ready");
        
        this.lineChartReady = true;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error("Completed per day API error:", err);
      }
    });
  }

  toggleTag(tag: string) {
    console.log("Toggling tag:", tag);
    
    // Prevent rapid clicks
    const index = this.selectedTags.indexOf(tag);
    if (index > -1) {
      this.selectedTags.splice(index, 1);
    } else {
      this.selectedTags.push(tag);
    }

    console.log("Selected tags:", this.selectedTags);

    // Update chart data
    this.lineChartData = {
      labels: this.lineChartData.labels,
      datasets: this.selectedTags.map((selectedTag, index) => {
        const colors = [
          '#667eea',
          '#764ba2', 
          '#f093fb',
          '#4facfe',
          '#43e97b',
          '#fa709a'
        ];
        
        return {
          label: selectedTag,
          data: this.lineChartMap.find(s => s.tag === selectedTag)?.data || [],
          borderColor: colors[index % colors.length],
          backgroundColor: colors[index % colors.length] + '20',
          tension: 0.4,
          fill: true
        };
      })
    };

    console.log("Updated line chart data");

    // Force chart update
    this.cdr.detectChanges();
    setTimeout(() => {
      this.lineChart?.chart?.update();
    }, 0);
  }
}