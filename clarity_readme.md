# Clarity - Collaborative Productivity Application

## Project Overview

Clarity is a full-stack collaborative productivity application built with Angular and Node.js. It enables users to manage projects, tasks, and workflows with real-time collaboration capabilities powered by Socket.IO. The application features AI-assisted workflows through Google Gemini integration, optional Google integrations (Gmail, Calendar, Contacts), and a modern Neobrutalist/Glassmorphism UI design inspired by Zedd's "Clarity" album.

The platform supports both **local projects** (private to the owner) and **hosted projects** (publicly shareable), with features including task scheduling, analytics dashboards, and automated email notifications for upcoming tasks.

---

## Authors

- **Mohammad Hamza Iqbal**
- **Bilal Kashif**
- **Mawahid Abbas**

---

## Folder Hierarchy

```
Clarity/
├── angular+socket/
│   ├── chat-frontend/                 # Angular client application
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── components/        # Angular components
│   │   │   │   │   ├── ai-assistant/  # AI chat interface
│   │   │   │   │   ├── ai-insights/   # AI insights display
│   │   │   │   │   ├── analytics/     # Analytics dashboard
│   │   │   │   │   ├── auth-callback/ # OAuth callback handler
│   │   │   │   │   ├── dashboard/     # Main dashboard
│   │   │   │   │   ├── layout/        # Layout wrapper
│   │   │   │   │   ├── projects/      # Project management
│   │   │   │   │   ├── settings/      # User settings
│   │   │   │   │   ├── supabase-test/ # Supabase testing
│   │   │   │   │   ├── tasks/         # Task management
│   │   │   │   │   └── welcome/       # Welcome/landing page
│   │   │   │   ├── config/            # Configuration files
│   │   │   │   ├── guards/            # Route guards
│   │   │   │   └── services/          # Angular services
│   │   │   ├── styles/                # SCSS stylesheets
│   │   │   └── index.html             # Entry HTML
│   │   ├── public/                    # Static assets
│   │   └── package.json               # Frontend dependencies
│   │
│   ├── socket-server/                 # Node.js backend server
│   │   ├── src/
│   │   │   ├── config/                # Server configuration
│   │   │   ├── infrastructure/        # Infrastructure modules
│   │   │   ├── middleware/            # Express middleware
│   │   │   └── services/              # Backend services
│   │   ├── projects/                  # Project storage
│   │   │   ├── local/                 # Local project files
│   │   │   └── hosted/                # Hosted project files
│   │   ├── users/                     # User data storage
│   │   └── lib/                       # Utility libraries
│   │
│   ├── shared_models/                 # Shared TypeScript models
│   │   ├── models/                    # Model definitions
│   │   │   ├── project.model.ts       # Project & Grid classes
│   │   │   ├── screen-elements.model.ts # Screen element classes
│   │   │   ├── user.model.ts          # User & settings classes
│   │   │   └── ai-agent.model.ts      # AI agent base class
│   │   └── dist/                      # Compiled JavaScript
│   │
│   └── package.json                   # Backend dependencies
│
├── package.json                       # Root dependencies
└── README.md                          # Project README
```

---

## Tech Stack

### Frontend
- **Angular 21** - Modern web framework with standalone components
- **Angular Material** - UI component library
- **Angular CDK** - Component Dev Kit for advanced UI patterns
- **Chart.js + ng2-charts** - Data visualization and analytics charts
- **RxJS 7.8** - Reactive programming with Observables
- **Socket.IO Client** - Real-time bidirectional communication
- **Marked** - Markdown parsing for AI responses
- **Day.js** - Date/time manipulation

### Backend
- **Node.js** - JavaScript runtime
- **Express 5** - Web application framework
- **Socket.IO 4** - Real-time event-based communication
- **TypeScript** - Type-safe JavaScript

### Database & Storage
- **Supabase** - PostgreSQL database with real-time subscriptions (optional, for hosted projects)
- **File System** - JSON-based storage for local projects

### AI & Integrations
- **LangChain** - LLM orchestration framework
- **Google Gemini** - AI model for assistant features
- **Google APIs** - Calendar, Contacts, Gmail integration
- **Nodemailer** - Email notifications

### Development Tools
- **TypeScript 5.9** - Static typing
- **Angular CLI** - Build and scaffolding tools
- **Karma + Jasmine** - Unit testing

---

## Installation and Setup Instructions

### Prerequisites

- **Node.js 20+** (recommended)
- **npm** (comes with Node.js)
- **Google Cloud OAuth credentials** (for Google integration)
- **Google Gemini API key** (for AI features)

### Step 1: Clone and Install Dependencies

```bash
# Navigate to the main project directory
cd angular+socket

# Install backend dependencies
npm install

# Install frontend dependencies
cd chat-frontend
npm install
cd ..
```

### Step 2: Build Shared Models

```bash
# Compile shared TypeScript models
npx tsc -p shared_models/tsconfig.json
```

### Step 3: Configure Environment Variables

Create a `.env` file in `angular+socket/socket-server/`:

```env
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_APP_USER=your_gmail_address
GOOGLE_APP_PASSWORD=your_google_app_password
SERVER_HOST=0.0.0.0
SERVER_PORT=3000
FRONTEND_URL=http://localhost:4200
SOCKET_CORS_ORIGIN=*
```

### Step 4: Configure Google OAuth

Place your OAuth credentials file at:
```
angular+socket/socket-server/credentials.json
```

The server will automatically create/use:
```
angular+socket/socket-server/tokens.json
```

---

## How to Run the Project

### Terminal 1: Backend Server

```bash
cd angular+socket

# Ensure shared models are compiled
npx tsc -p shared_models/tsconfig.json

# Run the TypeScript server
npx tsx socket-server/src/index.ts
```

Backend runs at: `http://localhost:3000`

### Terminal 2: Frontend Application

```bash
cd angular+socket/chat-frontend

# Start Angular development server
npm start
```

Frontend runs at: `http://localhost:4200`

### Available Scripts

**Frontend (`chat-frontend/`):**
- `npm start` - Run development server
- `npm run build` - Build for production
- `npm test` - Run unit tests
- `npm run watch` - Build with hot reload

**Backend (`angular+socket/`):**
- `npm run dev` - Run with tsx (development)
- `npm run build` - Compile TypeScript
- `npm start` - Run compiled JavaScript

---

## Features

### Core Features
- **Real-time Collaboration** - Socket.IO powered live updates across clients
- **Project Management** - Create, edit, and delete projects with multiple grids
- **Dual Project Modes** - Local (private) and Hosted (public sharing) projects
- **Task Management** - Scheduled tasks with priorities, tags, and collaborators
- **Dashboard Views** - Overview of all projects and tasks

### AI Features
- **AI Assistant** - Chat interface powered by Google Gemini
- **Project Summarization** - AI-generated project summaries
- **Schedule Suggestions** - AI-recommended task schedules
- **Smart Invitations** - Send project invites via AI commands

### Analytics
- **Task Completion Tracking** - Monitor completed tasks over time
- **Tag-based Analytics** - Completion rates by project tags
- **Visual Charts** - Interactive charts using Chart.js

### Google Integrations
- **Google OAuth** - Secure authentication
- **Google Calendar** - Sync tasks as calendar events
- **Google Contacts** - Import contacts for invitations
- **Gmail Integration** - Send email notifications

### Notifications
- **Email Reminders** - Upcoming task notifications via Nodemailer
- **Task Alerts** - Automated checking for due tasks

### UI/UX
- **Neobrutalist Design** - Modern glassmorphism aesthetic
- **Dark Theme** - Optimized for focus and productivity
- **Responsive Layout** - Works on all screen sizes
- **Dynamic Configuration** - Runtime server URL settings

---

## Limitations

### Technical Limitations
1. **File Upload Size** - Maximum 100MB for file uploads (configurable in Socket.IO)
2. **Local Storage Dependency** - Local projects stored as JSON files (not suitable for large-scale production)
3. **Single Server Instance** - No built-in horizontal scaling support
4. **No Offline Support** - Requires active server connection

### Feature Limitations
1. **No User Authentication System** - Uses username-based identification without passwords
2. **Limited Collaboration Controls** - Basic collaborator management without granular permissions
3. **No Version History** - Projects overwritten on save without revision tracking
4. **No Mobile App** - Web-only application (responsive but not native)

### Integration Limitations
1. **Google API Quotas** - Subject to Google API rate limits
2. **Gemini Rate Limits** - AI features subject to Gemini API rate limiting (429 errors)
3. **OAuth Token Expiry** - Requires re-authorization if tokens expire

### Known Issues
1. **SSR Compatibility** - Socket.IO requires browser environment (checks implemented)
2. **Cross-Origin Restrictions** - Requires proper CORS configuration for external access

---

## SOLID Principles Implemented

### 1. Single Responsibility Principle (SRP)

Each class and service has a single, well-defined responsibility:

- **`ProjectHandler`** (`project.service.ts`) - Handles only project CRUD operations
- **`UserHandler`** (`user.service.ts`) - Manages user data exclusively
- **`CalendarService`** (`calendar.service.ts`) - Deals only with Google Calendar operations
- **`NotificationService`** (`notification.service.ts`) - Manages email notifications
- **`AnalyticsService`** (`analytics.service.ts`) - Aggregates analytics data

```typescript
// Example: ProjectHandler focuses only on project operations
export class ProjectHandler {
    saveProject(project: any, projectType: 'local' | 'hosted'): Promise<...>
    loadProject(projectName: string, projectType: 'local' | 'hosted'): {...}
    deleteProject(projectName: string, projectType: 'local' | 'hosted'): {...}
    listProjects(projectType: 'local' | 'hosted'): {...}
}
```

### 2. Open/Closed Principle (OCP)

The system is open for extension but closed for modification:

- **`Screen_Element`** - Abstract base class that can be extended with new element types without modifying existing code

```typescript
// Abstract base class - closed for modification
export abstract class Screen_Element {
    name: String;
    x_pos: number;
    y_pos: number;
    // ... common properties
    toJSON() { ... }
}

// Open for extension - add new element types
export class Text_document extends Screen_Element { ... }
export class Image extends Screen_Element { ... }
export class Video extends Screen_Element { ... }
export class ToDoLst extends Screen_Element { ... }
```

### 3. Liskov Substitution Principle (LSP)

Subtypes are substitutable for their base types:

- All `Screen_Element` subclasses can be used interchangeably
- They implement the same interface and behavior contract

```typescript
// Any Screen_Element subclass can be used here
add_element(element: Screen_Element): void {
    this.Screen_elements.push(element);
}

// Works with Image, Video, Text_document, or ToDoLst
grid.add_element(new Image(...));
grid.add_element(new ToDoLst(...));
```

### 4. Interface Segregation Principle (ISP)

Services have focused, specific interfaces:

- **Angular Services** - Each service exposes only relevant methods
- **Backend Services** - Clear separation of concerns

```typescript
// SocketService - only socket-related operations
export class SocketService {
    saveProject(...): Observable<any>
    loadProject(...): Observable<any>
    emitElementUpdate(...): void
    onElementUpdate(): Observable<any>
}

// DataService - only data management operations
export class DataService {
    createProject(...): Project | null
    saveProject(...): Promise<boolean>
    getCurrentUser(): User | null
}
```

### 5. Dependency Inversion Principle (DIP)

High-level modules depend on abstractions, not concrete implementations:

- **Angular Dependency Injection** - Services injected via DI system
- **Abstract Base Classes** - `AI_agent` abstract class with `Chat_Agent` concrete implementation

```typescript
// Abstract base class
export abstract class AI_agent {
    protected api_key: string;
    abstract chat(input: string, username: string): Promise<string>;
}

// Concrete implementation depends on abstraction
export class Chat_Agent extends AI_agent {
    private model: ChatGoogleGenerativeAI;

    constructor(api_key: string) {
        super(api_key);
        // ...
    }

    async chat(user_input: string, username: string): Promise<string> {
        // Implementation
    }
}

// Angular DI - depends on abstraction
@Injectable({ providedIn: 'root' })
export class DataService {
    constructor(
        private socketService: SocketService,
        private databaseService: DatabaseService,
        private supabaseAuth: SupabaseAuthService
    ) { }
}
```

---

## Design Patterns Implemented

### 1. Builder Pattern

The `objects_builder` and `user_builder` classes reconstruct complex objects from serialized data:

```typescript
export class objects_builder {
    static rebuild(obj: any): Screen_Element | scheduled_task | any {
        // Detects type and builds appropriate object
        if (obj.scheduled_tasks !== undefined) {
            const list = new ToDoLst(obj.name, obj.x_pos, obj.y_pos);
            // ... build and configure
            return list;
        }
        if (obj.imagepath !== undefined) {
            return new Image(...);
        }
        // ... other types
    }
}
```

### 2. Observer Pattern

Implemented using RxJS Observables and Socket.IO events:

```typescript
// RxJS BehaviorSubject for state management
private currentUserSubject = new BehaviorSubject<User | null>(null);
public currentUser$ = this.currentUserSubject.asObservable();

// Socket.IO event observation
onHostedProjectUpdated(): Observable<any> {
    return new Observable(observer => {
        this.socket!.on('hostedProjectUpdated', (data) => {
            observer.next(data);
        });
    });
}
```

### 3. Singleton Pattern

Angular services are singletons via `providedIn: 'root'`:

```typescript
@Injectable({
    providedIn: 'root'  // Singleton instance for entire application
})
export class SocketService { ... }

@Injectable({
    providedIn: 'root'
})
export class DataService { ... }
```

### 4. Factory Pattern

The `objects_builder.rebuild()` method acts as a factory for creating different element types:

```typescript
static rebuild(obj: any): Screen_Element | scheduled_task | any {
    switch (obj.type) {
        case 'Text_document':
            return new Text_document(...);
        case 'Image':
            return new Image(...);
        case 'Video':
            return new Video(...);
        case 'ToDoLst':
            return new ToDoLst(...);
        default:
            return obj;
    }
}
```

### 5. Strategy Pattern

The `Chat_Agent` class uses different prompt strategies:

```typescript
export class Chat_Agent extends AI_agent {
    private summarise_prompt: ChatPromptTemplate;
    private suggest_schedule_prompt: ChatPromptTemplate;
    private default_prompt: ChatPromptTemplate;

    async chat(user_input: string, username: string): Promise<string> {
        if (summarise_match) {
            // Use summarise strategy
            const chain = RunnableSequence.from([this.summarise_prompt, this.model]);
        } else if (suggest_schedule_match) {
            // Use schedule suggestion strategy
            const chain = RunnableSequence.from([this.suggest_schedule_prompt, this.model]);
        } else {
            // Use default strategy
            const chain = RunnableSequence.from([this.default_prompt, this.model]);
        }
    }
}
```

### 6. Repository Pattern

Data access is abstracted through handler classes:

```typescript
export class ProjectHandler {
    // Abstracts file system operations
    saveProject(project: any, projectType: 'local' | 'hosted'): Promise<...>
    loadProject(projectName: string, projectType: 'local' | 'hosted'): {...}
    listProjects(projectType: 'local' | 'hosted'): {...}
}

export class UserHandler {
    // Abstracts user data storage
    saveUser(user: any): {...}
    loadUser(username: string): {...}
    listUsers(): {...}
}
```

### 7. Template Method Pattern

The `toJSON()` method is defined in base classes and overridden in subclasses:

```typescript
// Base class template
export abstract class Screen_Element {
    toJSON() {
        return {
            type: this.constructor.name,
            name: this.name,
            x_pos: this.x_pos,
            y_pos: this.y_pos
        };
    }
}

// Subclass overrides with additional properties
export class ToDoLst extends Screen_Element {
    override toJSON() {
        return {
            ...super.toJSON(),  // Call base template
            scheduled_tasks: this.scheduled_tasks.map(t => t.toJSON()),
            collaborators: this.collaborators,
            tags: this.tags
        };
    }
}
```

### 8. Dependency Injection Pattern

Angular's built-in DI system for loose coupling:

```typescript
@Injectable({ providedIn: 'root' })
export class DataService {
    constructor(
        @Inject(PLATFORM_ID) private platformId: Object,
        private socketService: SocketService,
        private databaseService: DatabaseService,
        private supabaseAuth: SupabaseAuthService
    ) {
        // Dependencies injected, not created
    }
}
```

---

## Additional Information

### Configuration

The application supports runtime configuration through:
- **Server Config** (`server.config.ts`) - Configurable backend URL
- **Settings Component** - In-app server URL configuration
- **Environment Variables** - Backend configuration via `.env`

### Security Considerations

- **CORS Configuration** - Dynamic origin validation
- **File Path Validation** - Security checks for file operations
- **Input Sanitization** - Filename sanitization for uploads

### Data Persistence

- **Local Projects** - Stored as JSON files in `socket-server/projects/local/`
- **Hosted Projects** - Stored in `socket-server/projects/hosted/` or Supabase
- **User Data** - Stored in `socket-server/users/` or Supabase
- **Asset Files** - Images and videos stored in project-specific `_assets/` directories

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth` | GET | Initiates Google OAuth flow |
| `/oauth2callback` | GET | Handles OAuth callback |
| `/analytics/completed-per-day` | GET | Task completion analytics |
| `/analytics/completion-rate-by-tag` | GET | Tag-based analytics |
| `/ai-assistant/chat-agent` | GET | AI chat endpoint |
| `/contacts` | GET | Fetch Google Contacts |
| `/gmail/user-info` | GET | Get Gmail user info |

### Socket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `saveProject` | Client → Server | Save a project |
| `loadProject` | Client → Server | Load a project |
| `listProjects` | Client → Server | List all projects |
| `deleteProject` | Client → Server | Delete a project |
| `saveUser` | Client → Server | Save user data |
| `loadUser` | Client → Server | Load user data |
| `uploadFile` | Client → Server | Upload media file |
| `hostedProjectUpdated` | Server → Client | Broadcast project update |
| `importGoogleContacts` | Client → Server | Import contacts from Google |

---

*Last Updated: March 2026*
