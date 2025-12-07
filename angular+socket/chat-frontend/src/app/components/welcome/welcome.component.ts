import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
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
export class WelcomeComponent implements OnInit, AfterViewInit {
  @ViewChild('backgroundMusic') audioPlayer!: ElementRef<HTMLAudioElement>;
  isMuted = false;
  private audioStarted = false;
  
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
  
  ngAfterViewInit(): void {
    // Set initial volume and try to play
    if (this.audioPlayer) {
      this.audioPlayer.nativeElement.volume = 0.3;
      // Try to play audio
      const playPromise = this.audioPlayer.nativeElement.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.log('Audio autoplay prevented:', error);
          // Audio will play after user interaction
        });
      }
    }
  }
  
  toggleMute(): void {
    this.isMuted = !this.isMuted;
    if (this.audioPlayer) {
      this.audioPlayer.nativeElement.muted = this.isMuted;
      // Try to play if not already playing
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

  enterApp(): void {
    try {
      // Auto-login as demo user for quick entry
      const demoUser = this.authService.register('Demo User', 'demo123');
      if (demoUser) {
        // Navigate to dashboard after successful registration
        this.router.navigate(['/dashboard']).catch(err => {
          console.error('Navigation error:', err);
        });
      }
    } catch (error) {
      console.error('Error during registration:', error);
    }
  }
}
