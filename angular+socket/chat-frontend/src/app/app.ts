import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
//import { ChatComponent } from './chat(depreciated)/chat.component';

//humari apni classes ki importing
import { User,settings,calender } from "./models/user.model"
import { Project,Grid } from './models/project.model';
import { Screen_Element,Text_document } from './models/screen_elements.model';

@Component({
  selector: 'app-root',
  standalone: true,
  //imports: [CommonModule, ChatComponent], // ✅ import ChatComponent here
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})

//basically this is humari main app ki class
export class AppComponent  //this is the class that is sent to bootstrap by main.ts 
{
  
  constructor()
  {
    //testing classes ke objects banana
    new User(5,"test_user_name","unencrypted_test_password",new settings());  //user creation
    new Project ("test_project_name") //project creation test
    new Grid("test_Grid") //grid creation test
    new Text_document("document_name",0,0,"test_the_text") //screen element <- text document
    console.log(new calender().get_current_date()) //testing using calender class
  }

}

