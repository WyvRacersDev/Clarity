import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
   const isOAuthCallback = route.queryParams['oauth'] !== undefined;
  const oauthInProgress = localStorage.getItem("oauth_in_progress");
    // If this is an OAuth callback, clear the flag and allow access if user data exists
  if (isOAuthCallback || oauthInProgress === '1') {
    // Clear the oauth flag since we're handling it now
    localStorage.removeItem("oauth_in_progress");
    
    // Check if we have user data in localStorage
    const savedUsers = localStorage.getItem("clarity_users");
    const currentUserName = localStorage.getItem("current_user_name");
    
    if (savedUsers && currentUserName) {
      // User data exists, allow access - the AuthService will load the user
      return true;
    }
  }
  
  if (authService.isLoggedIn()) {
    return true;
  } else {
    router.navigate(['/login']);
    return false;
  }
};




