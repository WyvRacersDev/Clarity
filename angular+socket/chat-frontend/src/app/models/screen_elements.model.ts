export abstract class Screen_Element
{
    
    name:String;
    x_pos:number;  //BRUH WDYM "number", int/float better
    y_pos:number;

    constructor(name: string,x_pos:number,y_pos:number) 
  { 
    console.log("Screen_Element object created")
    this.name = name;
    this.x_pos=x_pos;
    this.y_pos=y_pos;
  }

}

export class Text_document extends Screen_Element
{
  Text_field:string;

  constructor(name: string,x_pos:number,y_pos:number,text_field:string)
  {
    super(name,x_pos,y_pos);
    this.Text_field=text_field;
    console.log("Text object created")
  }
}

//TODO need to put all other screen element classes here as well