import { Component } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  isLoginMode = true;
  name = '';
  password = '';
  userId: number | null = null;
  errorMessage = '';

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  toggleMode(): void {
    this.isLoginMode = !this.isLoginMode;
    this.errorMessage = '';
  }

  onSubmit(): void {
    if (!this.name || !this.password) {
      this.errorMessage = 'Please fill in all fields';
      return;
    }

    if (this.isLoginMode) {
      // For login, we'll use a simple approach - in production, you'd have proper user lookup
      // For now, we'll create a user if they don't exist (demo mode)
      const userId = this.hashUserId(this.name);
      if (this.authService.login(this.name)) {
        this.router.navigate(['/dashboard']);
      } else {
        // Auto-register for demo purposes
        const user = this.authService.register(this.name, this.password);
        if (user) {
          this.router.navigate(['/dashboard']);
        }
      }
    } else {
      // Register
      const user = this.authService.register(this.name, this.password);
      if (user) {
        this.router.navigate(['/dashboard']);
      }
    }
  }

  private hashUserId(name: string): number {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      const char = name.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

