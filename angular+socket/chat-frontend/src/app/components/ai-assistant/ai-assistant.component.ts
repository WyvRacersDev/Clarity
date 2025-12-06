// import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { FormsModule } from '@angular/forms';
// import { DataService } from '../../services/data.service';
// import { AIService, AIMessage } from '../../services/ai.service';
// import { User } from '../../../../../shared_models/models/user.model';

// @Component({
//   selector: 'app-ai-assistant',
//   standalone: true,
//   imports: [CommonModule, FormsModule],
//   templateUrl: './ai-assistant.component.html',
//   styleUrls: ['./ai-assistant.component.css']
// })
// export class AIAssistantComponent implements OnInit {
//   @ViewChild('chatContainer') chatContainer!: ElementRef;
//   currentUser: User | null = null;
//   messages: AIMessage[] = [];
//   userInput = '';
//   isProcessing = false;

//   constructor(
//     private dataService: DataService,
//     private aiService: AIService
//   ) {}

//   ngOnInit(): void {
//     this.dataService.currentUser$.subscribe(user => {
//       this.currentUser = user;
//       if (user && this.messages.length === 0) {
//         // Add welcome message
//         this.messages.push({
//           role: 'assistant',
//           content: 'Hello! I\'m your AI productivity assistant. I can help you analyze your productivity, schedule tasks, and provide insights on your projects. How can I assist you today?',
//           timestamp: new Date()
//         });
//       }
//     });

//     // Load chat history
//     this.messages = this.aiService.getChatHistory();
//     if (this.messages.length === 0) {
//       this.messages.push({
//         role: 'assistant',
//         content: 'Hello! I\'m your AI productivity assistant. I can help you analyze your productivity, schedule tasks, and provide insights on your projects. How can I assist you today?',
//         timestamp: new Date()
//       });
//     }
//   }

//   ngAfterViewChecked(): void {
//     this.scrollToBottom();
//   }

//   async sendMessage(): Promise<void> {
//     if (!this.userInput.trim() || this.isProcessing) return;

//     const userMessage = this.userInput.trim();
//     this.userInput = '';
//     this.isProcessing = true;

//     // Add user message immediately
//     const userMsg: AIMessage = {
//       role: 'user',
//       content: userMessage,
//       timestamp: new Date()
//     };
//     this.messages.push(userMsg);

//     try {
//       // Get AI response
//       const response = await this.aiService.sendMessage(userMessage, this.currentUser);
      
//       // Response is already added by the service, but we need to update our local messages
//       const history = this.aiService.getChatHistory();
//       this.messages = [...history];
//     } catch (error) {
//       console.error('Error getting AI response:', error);
//       this.messages.push({
//         role: 'assistant',
//         content: 'Sorry, I encountered an error. Please try again.',
//         timestamp: new Date()
//       });
//     } finally {
//       this.isProcessing = false;
//       this.scrollToBottom();
//     }
//   }

//   clearChat(): void {
//     if (confirm('Are you sure you want to clear the chat history?')) {
//       this.aiService.clearChatHistory();
//       this.messages = [{
//         role: 'assistant',
//         content: 'Chat history cleared. How can I help you?',
//         timestamp: new Date()
//       }];
//     }
//   }

//   private scrollToBottom(): void {
//     try {
//       if (this.chatContainer) {
//         this.chatContainer.nativeElement.scrollTop = this.chatContainer.nativeElement.scrollHeight;
//       }
//     } catch (err) {
//       // Ignore scroll errors
//     }
//   }

//   formatMessage(content: string): string {
//     // Convert newlines to <br> for display
//     return content.replace(/\n/g, '<br>');
//   }
// }

