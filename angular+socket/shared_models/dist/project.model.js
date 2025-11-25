export class Grid {
    constructor(name) {
        this.Screen_elements = []; //list of screen elements in the grid
        this.name = name;
        console.log("Grid object created");
    }
    get_name() {
        return this.name;
    }
    set_name(name) {
        this.name = name;
    }
    add_element(element) {
        this.Screen_elements.push(element);
    }
    remove_element(element_index) {
        if (element_index >= 0 && element_index < this.Screen_elements.length) {
            this.Screen_elements.splice(element_index, 1);
            return true;
        }
        else {
            return false;
        }
    }
}
export class Project {
    //each of which can be edited independently 
    constructor(name, owner_name, project_type) {
        this.grid = []; //list of grids (each project can have multiple grids)
        this.name = name;
        this.owner_name = owner_name;
        this.project_type = project_type;
        console.log("Project object created");
    }
    get_name() {
        return this.name;
    }
    set_name(name) {
        this.name = name;
    }
    create_grid(name) {
        this.grid.push(new Grid(name));
    }
    remove_grid(grid_index) {
        if (grid_index >= 0 && grid_index < this.grid.length) {
            this.grid.splice(grid_index, 1);
            return true;
        }
        else {
            return false;
        }
    }
    get_owner_name() {
        return this.owner_name;
    }
    set_owner_name(owner_name) {
        this.owner_name = owner_name;
    }
    get_project_type() {
        return this.project_type;
    } //setter not included as project type should not be changed after creation
}
