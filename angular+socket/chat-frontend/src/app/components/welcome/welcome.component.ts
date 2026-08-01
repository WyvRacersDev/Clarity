import { Component, OnInit, ViewChild, ElementRef, AfterViewInit, Inject, PLATFORM_ID, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css']
})
export class WelcomeComponent implements OnInit, AfterViewInit {
  @ViewChild('backgroundMusic') audioPlayer!: ElementRef<HTMLAudioElement>;
  // B15: the welcome song no longer autoplays on load. Sound is OFF by default
  // and only ever starts from an explicit click on the sound toggle (`playing`).
  // Signal (not a plain field) so the icon flips correctly under zoneless CD —
  // playback state is set inside audio.play()'s promise, outside the click's
  // change-detection pass, and a signal notifies the scheduler when it does.
  readonly isPlaying = signal(false);

  // Form fields
  isLoginMode = true;
  email = '';
  username = '';
  password = '';
  isLoading = false;
  errorMessage: string | null = null;

  constructor(
    private authService: AuthService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    if (this.authService.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
    }

    // Subscribe to auth errors
    this.authService.error$.subscribe(error => {
      this.errorMessage = error;
      this.isLoading = false;
    });
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // B15: no autoplay. Just prime the volume; playback only ever starts from
    // an explicit toggleSound() click, so sound never begins without consent.
    if (this.audioPlayer && this.audioPlayer.nativeElement) {
      this.audioPlayer.nativeElement.volume = 0.3;
    }
  }

  /** B15: explicit user opt-in — start/stop the welcome song from the sound button. */
  toggleSound(): void {
    if (!isPlatformBrowser(this.platformId) || !this.audioPlayer) {
      return;
    }
    const audio = this.audioPlayer.nativeElement;

    if (this.isPlaying()) {
      audio.pause();
      this.isPlaying.set(false);
      return;
    }

    audio.muted = false;
    audio.play()
      .then(() => {
        this.isPlaying.set(true);
      })
      .catch(err => {
        this.isPlaying.set(false);
        console.log('Play failed:', err);
      });
  }

  clearError(): void {
    this.errorMessage = null;
    this.authService.clearError();
  }

  async onSubmit(): Promise<void> {
    this.clearError();

    if (!this.email || !this.password) {
      this.errorMessage = 'Please fill in all required fields';
      return;
    }

    if (!this.isLoginMode && this.password.length < 6) {
      this.errorMessage = 'Password must be at least 6 characters';
      return;
    }

    this.isLoading = true;

    try {
      let success = false;

      if (this.isLoginMode) {
        success = await this.authService.loginWithEmail(this.email, this.password);
      } else {
        const user = await this.authService.registerWithEmail(this.email, this.password, this.username);
        success = !!user;
      }

      if (success) {
        this.router.navigate(['/dashboard']);
      }
    } catch (error) {
      this.errorMessage = 'An unexpected error occurred';
      console.error('Auth error:', error);
    } finally {
      this.isLoading = false;
    }
  }

  async loginWithGoogle(): Promise<void> {
    this.clearError();
    this.isLoading = true;

    try {
      await this.authService.loginWithGoogle();
      // OAuth will redirect, so we don't need to navigate
    } catch (error) {
      this.errorMessage = 'Google login failed';
      console.error('Google login error:', error);
      this.isLoading = false;
    }
  }

  enterAsDemo(): void {
    // Demo mode using legacy auth
    this.authService.setAuthMode(false);
    try {
      const demoUser = this.authService.register('Demo User', 'demo123');
      if (demoUser) {
        this.router.navigate(['/dashboard']).catch(err => {
          console.error('Navigation error:', err);
        });
      }
    } catch (error) {
      console.error('Error during demo registration:', error);
    }
  }
}
