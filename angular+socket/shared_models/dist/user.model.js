// import { Project } from "../models/project.model";
// import dayjs from 'dayjs'; //for calender ki class (does require doing npm install dayjs)
// import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
// dayjs.extend(isSameOrBefore);
export class User {
    constructor(name, settings) {
        //password:string; //ye to encrypt kerna parhay ga lol
        this.projects = []; //projects jo user banaye ga to 
        this.contacts = []; //gmail se is ka kuch ho ga later on currently idk
        console.log("user created");
        this.name = name;
        //this.password=password;
        //NEED TO FINISH
        this.settings = settings;
    }
    create_project(name, project_type) {
        this.projects.push(new Project(name, this.name, project_type));
    }
    delete_project(prj_index) {
        if (prj_index >= 0 && prj_index < this.projects.length) {
            this.projects.splice(prj_index, 1);
            return true;
        }
        else {
            return false;
        }
    }
    create_contact(contact) {
        this.contacts.push(contact);
    }
    remove_contact(contact_index) {
        if (contact_index >= 0 && contact_index < this.contacts.length) {
            this.contacts.splice(contact_index, 1);
            return true;
        }
        else {
            return false;
        }
    }
    /**
     * Serialize user to JSON
     */
    toJSON() {
        return {
            type: 'User',
            name: this.name,
            settings: this.settings ? this.settings.toJSON() : null,
            contacts: this.contacts.map(c => c.toJSON()),
            projects: this.projects.map(p => p.name) // Just store project names as references
        };
    }
}
//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS
export class settings {
    constructor() {
        this.recieve_notifications = true;
        this.allow_invite = true;
        this.allow_google_calender = true;
    }
    toggle_notif() {
        this.recieve_notifications = !this.recieve_notifications;
    }
    toggle_invite() {
        this.allow_invite = !this.allow_invite;
    }
    toggle_calender() {
        this.allow_google_calender = !this.allow_google_calender;
    }
    get_notif_status() {
        return this.recieve_notifications;
    }
    get_invite_status() {
        return this.allow_invite;
    }
    get_calender_status() {
        return this.allow_google_calender;
    }
    /**
     * Serialize settings to JSON
     */
    toJSON() {
        return {
            recieve_notifications: this.recieve_notifications,
            allow_invite: this.allow_invite,
            allow_google_calender: this.allow_google_calender
        };
    }
}
export class contact {
    constructor(detail, name, phone) {
        this.contact_detail = detail;
        this.name = name;
        this.phone = phone;
    }
    /**
     * Serialize contact to JSON
     */
    toJSON() {
        return {
            contact_detail: this.contact_detail,
            name: this.name,
            phone: this.phone
        };
    }
}
export class calender {
    constructor(ToDoLst) {
        //scheduled tasks ki list chahiye is mei woh jub woh element banay ga tub deikhein gei 
        this.scheduled_tasks = [];
        ToDoLst.scheduled_tasks.forEach(element => {
            this.scheduled_tasks.push(element);
        });
    }
    get_current_date() {
        return dayjs().toString();
    }
    calculate_due_tasks() {
        const now = dayjs();
        return this.scheduled_tasks.filter(task => {
            const taskTime = dayjs(task.get_time());
            return taskTime.isSameOrBefore(now) && !task.get_status();
        });
    }
    calculate_late_tasks() {
        const now = dayjs();
        return this.scheduled_tasks.filter(task => {
            const t = dayjs(task.get_time());
            return t.isBefore(now) && !task.get_status();
        });
    }
}
/**
 * Builder class for reconstructing User objects from JSON data
 */
export class user_builder {
    /**
     * Rebuild a User object from JSON data
     */
    static rebuild(data) {
        if (!data) {
            throw new Error('Cannot rebuild User from null/undefined data');
        }
        // Rebuild settings
        const userSettings = user_builder.rebuildSettings(data.settings || {});
        // Create user
        const user = new User(data.name || '', userSettings);
        // Rebuild contacts
        if (data.contacts && Array.isArray(data.contacts)) {
            user.contacts = data.contacts.map((c) => user_builder.rebuildContact(c));
        }
        else {
            user.contacts = [];
        }
        // Projects are stored as references (names), not full objects
        // They will be loaded separately from the server
        user.projects = [];
        return user;
    }
    /**
     * Rebuild a settings object from JSON data
     */
    static rebuildSettings(obj) {
        const s = new settings();
        s.recieve_notifications = obj.recieve_notifications !== undefined ? obj.recieve_notifications : true;
        s.allow_invite = obj.allow_invite !== undefined ? obj.allow_invite : true;
        s.allow_google_calender = obj.allow_google_calender !== undefined ? obj.allow_google_calender : true;
        return s;
    }
    /**
     * Rebuild a contact object from JSON data
     */
    static rebuildContact(obj) {
        return new contact(obj.contact_detail || obj.email || '', obj.name, obj.phone);
    }
}
//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS//NEED TO FINISH AFTER DISCUSSIONS
