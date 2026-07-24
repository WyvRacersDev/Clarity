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
      <!-- Ambient aurora glow orbs -->
      <div class="cb-orb cb-orb--violet" aria-hidden="true"></div>
      <div class="cb-orb cb-orb--teal" aria-hidden="true"></div>

      <!-- Central card -->
      <div class="cb-card">
        <!-- Clarity mark -->
        <div class="cb-mark" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="40" height="40" rx="12" fill="url(#cb-grad)"/>
            <path d="M20 10 L28 15 L28 25 L20 30 L12 25 L12 15 Z" stroke="white" stroke-width="1.75" stroke-linejoin="round" fill="none"/>
            <circle cx="20" cy="20" r="3.5" fill="white" fill-opacity="0.92"/>
            <defs>
              <linearGradient id="cb-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#2E6FB0"/>
                <stop offset="46%" stop-color="#1BD2DC"/>
                <stop offset="100%" stop-color="#34C471"/>
              </linearGradient>
            </defs>
          </svg>
        </div>

        <!-- Aurora spinner -->
        <div class="cb-spinner" role="status" aria-label="Signing you in"></div>

        <!-- Message -->
        <div class="cb-text">
          <span class="cb-title">Signing you in</span>
          <span class="cb-subtitle">Completing authentication&hellip;</span>
        </div>
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

    /* ── Ambient glow orbs ─────────────────────────────────────────────── */
    .cb-orb {
      position: absolute;
      border-radius: var(--radius-full);
      filter: blur(80px);
      pointer-events: none;
      will-change: transform;
    }

    .cb-orb--violet {
      width: 480px;
      height: 480px;
      top: -120px;
      left: -100px;
      background: none;
      animation: cb-drift-a 12s ease-in-out infinite alternate;
    }

    .cb-orb--teal {
      width: 400px;
      height: 400px;
      bottom: -80px;
      right: -80px;
      background: none;
      animation: cb-drift-b 10s ease-in-out infinite alternate;
    }

    /* ── Central card ──────────────────────────────────────────────────── */
    .cb-card {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-6);
      padding: var(--space-12) var(--space-10);
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-2xl);
      box-shadow: var(--shadow-lg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      animation: cb-scale-in var(--dur-slow) var(--ease-spring) both;
    }

    /* ── Clarity mark ──────────────────────────────────────────────────── */
    .cb-mark {
      display: flex;
      align-items: center;
      justify-content: center;
      filter: drop-shadow(0 4px 16px rgba(23, 196, 206, 0.35));
    }

    /* ── Aurora spinner ────────────────────────────────────────────────── */
    .cb-spinner {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-full);
      border: 3.5px solid var(--accent-soft);
      border-top-color: var(--accent);
      animation: cb-spin 0.9s linear infinite;
    }

    /* ── Text block ────────────────────────────────────────────────────── */
    .cb-text {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-1);
      text-align: center;
    }

    .cb-title {
      font-family: var(--font-sans);
      font-size: var(--text-lg);
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.02em;
      line-height: 1.3;
    }

    .cb-subtitle {
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--text-muted);
      letter-spacing: -0.011em;
      line-height: 1.55;
    }

    /* ── Keyframes ─────────────────────────────────────────────────────── */
    @keyframes cb-spin {
      to { transform: rotate(360deg); }
    }

    @keyframes cb-scale-in {
      from { opacity: 0; transform: scale(0.94); }
      to   { opacity: 1; transform: scale(1); }
    }

    @keyframes cb-drift-a {
      from { transform: translate(0, 0) scale(1); }
      to   { transform: translate(40px, 30px) scale(1.08); }
    }

    @keyframes cb-drift-b {
      from { transform: translate(0, 0) scale(1); }
      to   { transform: translate(-30px, -25px) scale(1.06); }
    }

    /* ── Reduced-motion: collapse animations ───────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      .cb-spinner,
      .cb-orb,
      .cb-card {
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
