import { Injectable,PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { User } from '../../../../shared_models/models/user.model';
import { AnalyticsService } from './analytics.service';
import { DataService } from './data.service';
import { Observable, tap } from 'rxjs';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

@Injectable({
  providedIn: 'root'
})
export class AIService {
    chatHistory: AIMessage[] = [];

  constructor(private analyticsService: AnalyticsService,
    private http: HttpClient,
    private dataService: DataService,
    
  ) {this.loadInitialData();}
  loadInitialData():void{
    if(!isPlatformBrowser(PLATFORM_ID)) return;
    if(this.dataService.getCurrentUser()==null) return;
    //this.http.get<string>(`http://localhost:3000/ai-assistant/set-user-name?username=${this.dataService.getCurrentUser()?.name!}`).subscribe();
  }

 chat(input: string): Observable<string> {
        // Add user message to history
    console.log("Sending to AIService chat:", input);
        this.chatHistory.push({
      role: 'user',
      content: input,
      timestamp: new Date()
    });
    console.log("Current user in AIService chat:", this.dataService.getCurrentUser());
    return this.http.get<string>(`http://localhost:3000/ai-assistant/chat-agent?username=${this.dataService.getCurrentUser()?.name}&input=${input}`).pipe(
      tap((response: string) => {
        this.chatHistory.push({
          role: 'assistant',
          content: response,
          timestamp: new Date()
        });
      })
    );
  }


  getChatHistory(): AIMessage[] {
    return this.chatHistory;
  }

  clearChatHistory(): void {
    this.chatHistory = [];
  }
}

