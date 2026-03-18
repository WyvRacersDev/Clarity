import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';
import { SupabaseAuthService } from '../../services/supabase-auth.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="callback-container">
      <div class="spinner"></div>
      <p>Completing sign in...</p>
    </div>
  `,
  styles: [`
    .callback-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg-primary);
      gap: var(--space-4);
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(0, 194, 224, 0.15);
      border-top-color: var(--accent-primary);
      border-radius: 50%;
      animation: spin 0.65s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    p {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
  `]
})
export class AuthCallbackComponent implements OnInit {
  constructor(
    private supabaseService: SupabaseService,
    private supabaseAuth: SupabaseAuthService,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      // Wait for Supabase to process the OAuth callback
      const { data: { session }, error } = await this.supabaseService.client.auth.getSession();

      if (error) {
        console.error('OAuth callback error:', error);
        this.authService.setAuthMode(true);
        this.router.navigate(['/']);
        return;
      }

      if (session?.user) {
        // Ensure auth mode is set to Supabase
        this.authService.setAuthMode(true);

        // Wait a moment for the auth state to propagate
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check if user is now authenticated
        if (this.authService.isLoggedIn()) {
          this.router.navigate(['/dashboard']);
        } else {
          // Force reload of user profile
          const user = await this.supabaseAuth.getSession();
          if (user) {
            this.router.navigate(['/dashboard']);
          } else {
            this.router.navigate(['/']);
          }
        }
      } else {
        this.router.navigate(['/']);
      }
    } catch (err) {
      console.error('Error handling OAuth callback:', err);
      this.router.navigate(['/']);
    }
  }
}
