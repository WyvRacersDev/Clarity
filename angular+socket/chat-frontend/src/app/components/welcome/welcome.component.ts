import { Component } from '@angular/core';
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
export class WelcomeComponent {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  enterApp(): void {
    // Auto-login as demo user for quick entry
    const demoUser = this.authService.register('Demo User', 'demo123');
    if (demoUser) {
      this.router.navigate(['/dashboard']);
    }
  }
}
