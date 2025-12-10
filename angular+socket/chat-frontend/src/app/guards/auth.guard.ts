import { inject, PLATFORM_ID } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { isPlatformBrowser } from '@angular/common';
export const authGuard: CanActivateFn = (route, state) => {
  console.log('🔒 Auth Guard triggered');
  console.log('📍 Current URL:', state.url);
  console.log('🛤️  Route path:', route.routeConfig?.path);

  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    return true; // Always allow during SSR
  }
  const authService = inject(AuthService);
  const router = inject(Router);

  const isOAuthCallback = route.queryParams['oauth'] !== undefined;
  const oauthInProgress = localStorage.getItem("oauth_in_progress");

  console.log('🔐 isLoggedIn:', authService.isLoggedIn());
  console.log('🎫 OAuth callback:', isOAuthCallback);
  console.log('⏳ OAuth in progress:', oauthInProgress);

  if (isOAuthCallback || oauthInProgress === '1') {
    localStorage.removeItem("oauth_in_progress");

    const savedUsers = localStorage.getItem("clarity_users");
    const currentUserName = localStorage.getItem("current_user_name");

    console.log('✅ OAuth path - allowing access');
    if (savedUsers && currentUserName) {
      return true;
    }
  }

  if (authService.isLoggedIn()) {
    console.log('✅ User authenticated - allowing access');
    return true;
  } else {
    console.log('❌ Not authenticated - redirecting to login');
    router.navigate(['/']);
    return false;
  }
};



