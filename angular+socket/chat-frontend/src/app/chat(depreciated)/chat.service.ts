import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private socket: Socket;
  private messagesSubject = new BehaviorSubject<string[]>([]);
  messages$ = this.messagesSubject.asObservable();

  constructor() {
    this.socket = io("http://localhost:3000");

    // Receive chat history on connect
    this.socket.on("chatHistory", (msgs: string[]) => {
      console.log("📜 Received chat history:", msgs);
      this.messagesSubject.next(msgs);
    });

    // Receive new messages
    this.socket.on("chatMessage", (msg: string) => {
      const current = this.messagesSubject.value;
      this.messagesSubject.next([...current, msg]);
    });

    // Debug connection events
    this.socket.on("connect", () => console.log("⚡ Connected:", this.socket.id));
    this.socket.on("disconnect", () => console.log("🔌 Disconnected"));
  }

  sendMessage(msg: string) {
    this.socket.emit("chatMessage", msg);
  }

  disconnect() {
    this.socket.disconnect();
    console.log("🔌 Manually disconnected");
  }

  reconnect() {
    if (!this.socket.connected) {
      this.socket.connect();
      console.log("⚡ Reconnected");
    }
  }
}
