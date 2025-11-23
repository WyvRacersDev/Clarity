import { Screen_Element } from "../models/screen_elements.model";

export class Grid{
    name:string;
    Screen_elements: Screen_Element[] =[]; //list of screen elements in the grid

    constructor(name:string)
    {
        this.name=name;
        console.log("Grid object created")
    }

    get_name():string
    {
        return this.name
    }

    set_name(name:string)
    {
        this.name=name;
    }
    
    add_element(element:Screen_Element):void  //the screen element must be passed to the function (because they all will have separate constructors) 
    {
        this.Screen_elements.push(element);
    }

    remove_element(element_index:number):boolean
    {
        if(element_index>=0 && element_index<this.Screen_elements.length)
        {
            this.Screen_elements.splice(element_index,1)
            return true
        }
        else
        {
            return false
        }
    }
}

export class Project{
    name:string;
    owner_id?:number;

    grid:Grid[]=[];  //list of grids (each project can have multiple grids)
    //each of which can be edited independently 

    constructor(name:string, owner_id?:number)
    { 
        this.name=name;
        this.owner_id = owner_id;
        console.log("Project object created")
    }

    get_name():string
    {
        return this.name
    }

    set_name(name:string)
    {
        this.name=name;
    }
    
    create_grid(name:string)  //takes grid name and adds to the list of the grids in the project
    {
       this.grid.push(new Grid(name)); 
    }

    remove_grid(grid_index:number):boolean
    {
        if(grid_index>=0 && grid_index<this.grid.length)
        {
            this.grid.splice(grid_index,1)
            return true
        }
        else
        {
            return false
        }
    }

    get_owner_id():number | undefined
    {
        return this.owner_id;
    }

    set_owner_id(owner_id:number)
    {
        this.owner_id=owner_id;
    }   
}

