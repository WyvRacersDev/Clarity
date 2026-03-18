import { Component, OnInit, ViewChild, ElementRef, AfterViewInit, Inject, PLATFORM_ID } from '@angular/core';
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
  isMuted = false;
  private audioStarted = false;

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

    if (this.audioPlayer && this.audioPlayer.nativeElement) {
      this.audioPlayer.nativeElement.volume = 0.3;

      const playPromise = this.audioPlayer.nativeElement.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.log('Audio autoplay prevented:', error);
        });
      }
    }
  }

  toggleMute(): void {
    this.isMuted = !this.isMuted;
    if (this.audioPlayer) {
      this.audioPlayer.nativeElement.muted = this.isMuted;

      if (!this.isMuted && this.audioPlayer.nativeElement.paused) {
        this.audioPlayer.nativeElement.play().catch(err => console.log('Play failed:', err));
      }
    }
  }

  playAudioOnInteraction(): void {
    if (!this.audioStarted && this.audioPlayer && this.audioPlayer.nativeElement.paused) {
      this.audioPlayer.nativeElement.play().catch(err => console.log('Play failed:', err));
      this.audioStarted = true;
    }
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
