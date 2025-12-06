import { Component } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ChatService } from './chat.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './chat.component.html'
})
export class ChatComponent {
  message = '';
  messages: string[] = [];
  connected = false;

  constructor(private chatService: ChatService) {
    this.chatService.messages$.subscribe(msgs => {
      this.messages = msgs;
      this.connected=true;
    });
  }

  send() {
    if (this.message.trim()) {
      console.log('➡️ Sending:', this.message);
      this.chatService.sendMessage(this.message);
      this.message = '';
    }
  }

  disconnect() {
    this.chatService.disconnect();
    this.connected = false;
  }

  reconnect() {
    this.chatService.reconnect();
    this.connected = true;
  }
}
