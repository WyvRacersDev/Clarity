import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket!: Socket;

  constructor() {
    this.socket = io("http://localhost:3000");
  }

  sendMessage(msg: string) {
    this.socket.emit("chatMessage", msg);
  }

  getMessages(): Observable<string> {
    return new Observable((subscriber) => {
      this.socket.on("chatMessage", (msg: string) => {
        subscriber.next(msg);
      });
    });
  }
}
