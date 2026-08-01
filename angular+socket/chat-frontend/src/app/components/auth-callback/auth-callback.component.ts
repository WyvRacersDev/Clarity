import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="cb-screen">
      <!-- Album iris: radial --accent-soft glow, background-layer only -->
      <div class="cb-iris" aria-hidden="true"></div>

      <!-- Centered signing-in state -->
      <div class="cb-stack">
        <div class="spinner spinner-lg" role="status" aria-label="Signing you in"></div>
        <span class="mono-label cb-status">Completing authentication</span>
      </div>
    </div>
  `,
  styles: [`
    /* ── Full-screen stage ─────────────────────────────────────────────── */
    .cb-screen {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      min-width: 100vw;
      background-color: var(--bg-app);
      overflow: hidden;
    }

    /* ── Album iris — radial --accent-soft bloom (background-layer glow) ── */
    .cb-iris {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(
          60% 60% at 50% 42%,
          var(--accent-soft) 0%,
          transparent 70%
        );
      animation: cb-breathe 6s var(--ease) infinite alternate;
    }

    /* ── Centered stack ────────────────────────────────────────────────── */
    .cb-stack {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-5);
      animation: cb-fade var(--dur-slow) var(--ease) both;
    }

    .cb-status {
      color: var(--text-secondary);
    }

    /* ── Keyframes ─────────────────────────────────────────────────────── */
    @keyframes cb-fade {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    @keyframes cb-breathe {
      from { opacity: 0.7; }
      to   { opacity: 1; }
    }

    /* ── Reduced-motion: collapse animations ───────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      .cb-iris,
      .cb-stack {
        animation: none;
      }
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
