import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatComponent } from './chat/chat.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ChatComponent], // ✅ import ChatComponent here
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent {}

