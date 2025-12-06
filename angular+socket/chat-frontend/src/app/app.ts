import { Component, OnInit } from '@angular/core';
import {
  Chart,
  registerables
} from 'chart.js';
import { RouterOutlet, Router } from '@angular/router';
import { AuthService } from './services/auth.service';

Chart.register(...registerables);
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Check authentication and redirect if needed
    if (!this.authService.isLoggedIn()) {
      this.router.navigate(['/login']);
    }
  }
}

