import { bootstrapApplication } from '@angular/platform-browser';
import { ChatComponent } from './app/chat(depreciated)/chat.component';
import { AppComponent } from './app/app';
import 'zone.js'; 

bootstrapApplication(ChatComponent)
  .catch(err => console.error(err));
