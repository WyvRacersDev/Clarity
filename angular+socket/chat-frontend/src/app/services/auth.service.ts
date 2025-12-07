// import { Injectable } from '@angular/core';
// import { Router } from '@angular/router';
// import { DataService } from './data.service';
// import { User } from '../../../../shared_models/models/user.model';

// @Injectable({
//   providedIn: 'root'
// })
// export class AuthService {
//   private isAuthenticated = false;

//   constructor(
//     private dataService: DataService,
//     private router: Router
//   ) {
//     // Check if user is already logged in
//     const currentUser = this.dataService.getCurrentUser();
//     this.isAuthenticated = !!currentUser;
//   }

//   login(userName: string): boolean {
//     const success = this.dataService.loginUser(userName);
//     if (success) {
//       this.isAuthenticated = true;
//       return true;
//     }
//     return false;
//   }

//   register(name: string, password: string): User {
//     const user = this.dataService.createUser(name);
//     this.login(user.name);
//     return user;
//   }

//   logout(): void {
//     this.dataService.logout();
//     this.isAuthenticated = false;
//     this.router.navigate(['/login']);
//   }

//   isLoggedIn(): boolean {
//     return this.isAuthenticated;
//   }

//   getCurrentUser(): User | null {
//     return this.dataService.getCurrentUser();
//   }
// }




import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { DataService } from './data.service';
import { User } from '../../../../shared_models/models/user.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  constructor(
    private dataService: DataService,
    private router: Router
  ) {}

  login(userName: string): boolean {
    const success = this.dataService.loginUser(userName);
    return success;
  }

  register(name: string, password: string): User {
    const user = this.dataService.createUser(name);
    this.login(user.name);
    return user;
  }

  logout(): void {
    this.dataService.logout();
    this.router.navigate(['/login']);
  }

  // isLoggedIn(): boolean {
  //   // Always check the actual data, not cached state
  //   return !!this.dataService.getCurrentUser();
  // }
  isLoggedIn(): boolean {
  const user = this.dataService.getCurrentUser();
  console.log('👤 getCurrentUser result:', user);
  const isLoggedIn = !!user;
  console.log('🔍 isLoggedIn:', isLoggedIn);
  return isLoggedIn;
}

  getCurrentUser(): User | null {
    return this.dataService.getCurrentUser();
  }
}