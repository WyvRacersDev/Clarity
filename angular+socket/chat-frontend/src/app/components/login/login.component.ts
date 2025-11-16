import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  isLoginMode = true;
  name = '';
  password = '';
  errorMessage = '';

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  toggleMode(): void {
    this.isLoginMode = !this.isLoginMode;
    this.errorMessage = '';
    this.name = '';
    this.password = '';
  }

  onSubmit(): void {
    if (this.isLoginMode) {
      this.login();
    } else {
      this.register();
    }
  }

  login(): void {
    if (!this.name || !this.password) {
      this.errorMessage = 'Please fill in all fields';
      return;
    }

    // For demo: auto-register/login (in production, you'd have proper authentication)
    // This creates a new user or logs in if already registered
    const user = this.authService.register(this.name, this.password);
    if (user) {
      this.router.navigate(['/dashboard']);
    } else {
      this.errorMessage = 'Failed to login. Please try again.';
    }
  }

  register(): void {
    if (!this.name || !this.password) {
      this.errorMessage = 'Please fill in all fields';
      return;
    }

    const user = this.authService.register(this.name, this.password);
    this.router.navigate(['/dashboard']);
  }
}

