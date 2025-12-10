import { Component, OnInit } from '@angular/core';

import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { GoogleIntegrationService } from '../../services/google-integration.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css']
})
export class LayoutComponent implements OnInit {
  currentUser: any = null;
  isSidebarOpen = true;

  constructor(
    private authService: AuthService,
    private router: Router,
    private google_service:GoogleIntegrationService
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
  }

  toggleSidebar(): void {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  logout(): void {
    this.authService.logout();
    this.google_service.disconnectGmail();
  }

  isActiveRoute(route: string): boolean {
    return this.router.url.includes(route);
  }
}




