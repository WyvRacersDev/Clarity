import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css']
})
export class WelcomeComponent implements OnInit {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}
    ngOnInit(): void {
    // If user is already logged in, redirect to dashboard
    if (this.authService.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
    }
  }


  enterApp(): void {
    // Auto-login as demo user for quick entry
    const demoUser = this.authService.register('Demo User', 'demo123');
    if (demoUser) {
      this.router.navigate(['/dashboard']);
    }
  }
}
