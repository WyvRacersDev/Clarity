import { User, settings, contact, user_builder } from "../../shared_models/dist/user.model.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export class UserHandler {

    private __dirname: string;
    private USERS_PATH: string;

    constructor() {
        const __filename = fileURLToPath(import.meta.url);
        this.__dirname = path.dirname(__filename);
        this.USERS_PATH = path.join(this.__dirname, "../users");

        // Ensure users directory exists
        if (!fs.existsSync(this.USERS_PATH)) {
            fs.mkdirSync(this.USERS_PATH, { recursive: true });
        }
    }
    /**
    * Sanitize username for use as filename (email-safe)
    */
    sanitizeFilename(name: string): string {
        return name
            .replace(/[^a-z0-9_\-@. ]/gi, '_')
            .replace(/\s+/g, '_')
            .substring(0, 100); // Limit length
    }

    /**
     * Get the file path for a user's JSON file
     */
    getUserFilePath(username: string): string {
        const safeName = this.sanitizeFilename(username);
        return path.join(this.USERS_PATH, `${safeName}.json`);
    }
    /**
    * Serialize a User object to JSON for storage
    */
    serializeUser(user: any): any {
        console.log(`[UserHandler] serializeUser called for user: ${user.name}`);

        // Use toJSON if available
        if (user.toJSON && typeof user.toJSON === 'function') {
            console.log(`[UserHandler] User serialized using toJSON`);
            const serialized = user.toJSON();
            //  serialized.lastModified = new Date().toISOString()
            return serialized;
        }

        // Manual serialization fallback
        const projectRefs = user.projectReferences || user.projects || [];
        return {
            type: 'User',
            name: user.name,
            contacts: user.contacts.map((c: any) => this.serializeContact(c)),
            settings: this.serializeSettings(user.settings),
            projectReferences: projectRefs.map((p: any) => ({
                name: p.name,
                projectType: p.projectType || p.project_type || 'local'
            })),
            lastModified: new Date().toISOString()
        };
    }
    /**
    * Serialize settings object
    */
    serializeSettings(s: any): any {
        if (!s) {
            // Return default settings if none provided
            return {
                type: 'settings',
                recieve_notifications: s.recieve_notifications !== undefined ? s.recieve_notifications : true,
                allow_invite: s.allow_invite !== undefined ? s.allow_invite : true,
                allow_google_calender: s.allow_google_calender !== undefined ? s.allow_google_calender : true

            };
        }

        if (s.toJSON && typeof s.toJSON === 'function') {
            return s.toJSON();
        }
        console.log("[UserHandler] serializeSettings using manual serialization");
        return {
            type: 'settings',
            recieve_notifications: s.recieve_notifications,
            allow_invite: s.allow_invite,
            allow_google_calender: s.allow_google_calender
        };
    }

    /**
     * Serialize contact object
     */
  serializeContact(c: any): any {
        if (!c) return null;
        if (c.toJSON && typeof c.toJSON === 'function') {
            console.log("[UserHandler] serializeContact using manual serialization");
            return c.toJSON();
        }
        return {
            type: 'contact',
            name: c.name,
            contact_detail: c.contact_detail || c
        };
    }
    /**
    * Deserialize JSON to a User object
    */
    deserializeUser(data: any): User {
        return user_builder.rebuild(data);
    }

    /**
     * Save a user to the users folder
     */
    saveUser(user: any): { success: boolean; message: string; path?: string } {
        try {
            const username = user.name;
            if (!username) {
                return { success: false, message: 'User name is required' };
            }
            const filePath = this.getUserFilePath(username);
            console.log(`[UserHandler] saveUser called for: "${username}"`, user);
            const serialized = this.serializeUser(user);
            console.log(`[UserHandler] Serialized user is ${serialized}`);

            fs.writeFileSync(filePath, JSON.stringify(serialized, null, 2), 'utf-8');
            console.log(`[UserHandler] ✓ User "${username}" saved successfully to ${filePath}`);
            return { success: true, message: `User "${username}" saved successfully`, path: filePath };
        } catch (error: any) {
            console.error('[UserHandler] Error saving user:', error);
            return { success: false, message: `Failed to save user: ${error.message}` };
        }
    }
    /**
    * Load a user from the users folder
    */
    loadUser(username: string): { success: boolean; user?: User; message: string } {
        try {
            console.log(`[UserHandler] loadUser called for: "${username}"`);

            // First try direct file lookup
            const filePath = this.getUserFilePath(username);

            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(fileContent);
                const user = this.deserializeUser(data);
                console.log(`[UserHandler] ✓ User "${username}" loaded successfully`);
                return { success: true, user, message: `User "${username}" loaded successfully` };
            }

            // If not found, search through all files to find matching name
            const files = fs.readdirSync(this.USERS_PATH).filter(file => file.endsWith('.json'));
            for (const file of files) {
                try {
                    const userFilePath = path.join(this.USERS_PATH, file);
                    const fileContent = fs.readFileSync(userFilePath, 'utf-8');
                    const data = JSON.parse(fileContent);

                    if (data.name === username) {
                        console.log(`[UserHandler] ✓ Found user "${username}" in file ${file}`);
                        const user = this.deserializeUser(data);
                        return { success: true, user, message: `User "${username}" loaded from ${file}` };
                    }
                } catch (error) {
                    console.error(`[UserHandler] Error reading file ${file}:`, error);
                    continue;
                }
            }

            console.log(`[UserHandler] User "${username}" not found`);
            return { success: false, message: `User "${username}" not found` };
        } catch (error: any) {
            console.error(`[UserHandler] Error loading user "${username}":`, error);
            return { success: false, message: `Failed to load user: ${error.message}` };
        }
    }
    /**
    * List all users
    */
    listUsers(): { success: boolean; users: any[]; message: string } {
        try {
            if (!fs.existsSync(this.USERS_PATH)) {
                return { success: false, users: [], message: 'Users directory does not exist' };
            }

            const files = fs.readdirSync(this.USERS_PATH).filter(file => file.endsWith('.json'));
            const users = files.map(file => {
                try {
                    const filePath = path.join(this.USERS_PATH, file);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const data = JSON.parse(content);

                    return {
                        name: data.name,
                        filename: file,
                        projectCount: data.projectReferences?.length || 0,
                        lastModified: data.lastModified || fs.statSync(filePath).mtime.toISOString()
                    };
                } catch (error) {
                    console.error(`[UserHandler] Error reading user file ${file}:`, error);
                    return null;
                }
            }).filter((u): u is any => u !== null);

            console.log(`[UserHandler] Found ${users.length} users`);
            return { success: true, users, message: `Found ${users.length} users` };
        } catch (error: any) {
            console.error('[UserHandler] Error listing users:', error);
            return { success: false, users: [], message: `Failed to list users: ${error.message}` };
        }
    }

    /**
     * Delete a user
     */
    deleteUser(username: string): { success: boolean; message: string } {
        try {
            const filePath = this.getUserFilePath(username);

            if (!fs.existsSync(filePath)) {
                return { success: false, message: `User "${username}" not found` };
            }

            fs.unlinkSync(filePath);
            console.log(`[UserHandler] ✓ User "${username}" deleted successfully`);
            return { success: true, message: `User "${username}" deleted successfully` };
        } catch (error: any) {
            console.error('[UserHandler] Error deleting user:', error);
            return { success: false, message: `Failed to delete user: ${error.message}` };
        }
    }

    /**
     * Check if a user exists
     */
    userExists(username: string): boolean {
        const filePath = this.getUserFilePath(username);
        return fs.existsSync(filePath);
    }

    /**
     * Get the users directory path
     */
    getUsersPath(): string {
        return this.USERS_PATH;
    }
}
