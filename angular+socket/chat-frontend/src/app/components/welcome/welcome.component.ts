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
    // Set initial volume
    if (this.audioPlayer) {
      this.audioPlayer.nativeElement.volume = 0.3;
    }
  }
  
  toggleMute(): void {
    this.isMuted = !this.isMuted;
    if (this.audioPlayer) {
      this.audioPlayer.nativeElement.muted = this.isMuted;
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
