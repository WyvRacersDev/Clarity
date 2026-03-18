import { Component } from '@angular/core';
import {
  Chart,
  registerables
} from 'chart.js';
import { RouterOutlet } from '@angular/router';

Chart.register(...registerables);
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {}

