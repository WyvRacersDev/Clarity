import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
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
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      // The backend Google-login flow redirects here with ?token=<jwt>.
      const token = this.route.snapshot.queryParamMap.get('token');

      if (!token) {
        console.error('[AuthCallback] No token in callback URL');
        this.router.navigate(['/']);
        return;
      }

      const ok = await this.authService.completeTokenLogin(token);
      if (ok) {
        this.router.navigate(['/dashboard']);
      } else {
        console.error('[AuthCallback] Failed to complete token login');
        this.router.navigate(['/']);
      }
    } catch (err) {
      console.error('[AuthCallback] Error handling OAuth callback:', err);
      this.router.navigate(['/']);
    }
  }
}
