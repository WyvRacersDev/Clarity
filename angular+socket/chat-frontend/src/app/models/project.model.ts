import { Screen_Element } from "../models/screen_elements.model";

export class Grid{
    name:string;
    Screen_elements: Screen_Element[] =[]; //list of screen elements in the grid

    constructor(name:string)
    {
        this.name=name;
        console.log("Grid object created")
    }

    add_element(element:Screen_Element):void  //the screen element must be passed to the function (because they all will have separate constructors) 
    {
        this.Screen_elements.push(element);
    }
}

export class Project{
    name:string;

    grid:Grid[]=[];  //list of grids (each project can have multiple grids)
    //each of which can be edited independently 

    constructor(name:string)
    { 
        this.name=name;
        console.log("Project object created")
    }

    create_grid(name:string)  //takes grid name and adds to the list of the grids in the project
    {
       this.grid.push(new Grid(name)); 
    }
}

