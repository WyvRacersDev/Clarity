# Clarity

Clarity is a collaborative productivity app built with Angular and Socket.IO. It features a Canva-like canvas workspace where users can create projects and organize tasks, notes, images, and videos on an infinite canvas with drag-and-drop, pan, and zoom functionality.

## Authors

Mohammad Hamza Iqbal, Bilal Kashif, Mawahid Abbas

## Features

- **Canvas Workspace**: Canva-like infinite canvas with pan, zoom, and drag-and-drop elements
- **Real-time Collaboration**: Multi-user editing via Socket.IO
- **Project Management**: Local and hosted project modes with real-time sync
- **Multiple Element Types**: Todo lists, text documents, images, and videos
- **Task Scheduling**: Priority-based task management with due dates
- **AI Assistant**: Powered by Gemini via LangChain
- **Google Integration**: OAuth for Gmail, Calendar, and Contacts
- **Email Notifications**: Reminders for upcoming tasks

## Tech Stack

- **Frontend**: Angular 21, TypeScript, SCSS
- **Backend**: Node.js, Express, Socket.IO
- **Database**: Supabase (for hosted projects)
- **AI**: LangChain + Google Gemini
- **Canvas Libraries**: Konva.js, Fabric.js, SVG.js (modular canvas implementations)

## UI Design

Clarity features a modern **Neobrutalist/Glassmorphism** design inspired by Zedd's "Clarity" album:
- Glassmorphic cards with blur effects and subtle borders
- Cyan accent color palette (#00d4ff)
- Dark theme optimized for focus and productivity
- Infinite canvas with grid overlay
- Mini-map navigation

## Canvas Workspace

The core feature of Clarity is its canvas-based project workspace:

- **Pan**: Click and drag on empty canvas space
- **Zoom**: Mouse wheel or toolbar buttons (25% - 300%)
- **Elements**: Drag to reposition, double-click to expand
- **Toolbar**: Zoom controls, grid toggle, delete selected
- **Mini-map**: Navigate large canvases quickly

## Repository Structure

```text
.
├── angular+socket/
│   ├── chat-frontend/          # Angular client app
│   │   └── src/app/
│   │       └── components/
│   │           └── projects/
│   │               └── project-detail/  # Canvas workspace
│   ├── socket-server/          # Express + Socket.IO server
│   │   └── projects/           # Project data storage
│   ├── shared_models/          # Shared TypeScript models
│   └── package.json
├── package.json
└── README.md
```

## Prerequisites

- Node.js 20+ (recommended)
- npm
- Google Cloud OAuth credentials (for Google integration)

## Setup

```bash
# from repo root
cd angular+socket
npm install

# install frontend dependencies
cd chat-frontend
npm install
cd ..

# build shared models used by the server
npx tsc -p shared_models/tsconfig.json
```

## Environment and Config

### 1) Backend environment file
Create `angular+socket/socket-server/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_APP_USER=your_gmail_address
GOOGLE_APP_PASSWORD=your_google_app_password
SERVER_HOST=0.0.0.0
SERVER_PORT=3000
FRONTEND_URL=http://localhost:4200
SOCKET_CORS_ORIGIN=*
```

### 2) Google OAuth credentials
Place your OAuth credentials file at:

- `angular+socket/socket-server/credentials.json`

The server will create/use:

- `angular+socket/socket-server/tokens.json`

## Running the App

Open two terminals.

### Terminal 1: Backend

```bash
cd angular+socket

# ensure shared models are compiled
npx tsc -p shared_models/tsconfig.json

# run TypeScript server (using tsx)
npx tsx socket-server/server.ts
```

Backend default URL: `http://localhost:3000`

### Terminal 2: Frontend

```bash
cd angular+socket/chat-frontend
npm start
```

Frontend default URL: `http://localhost:4200`

## Usage

1. Open the app in your browser
2. Create a new project from the Projects page
3. Click on the project to open the canvas workspace
4. Add elements (Todo, Text, Image, Video) using the Add button
5. Drag elements to position them on the canvas
6. Double-click todo lists to open full-screen view
7. Use the toolbar to zoom, pan, and manage elements

## Notes

- In the app Settings screen, you can configure the backend URL at runtime
- Local projects are stored in `angular+socket/socket-server/projects/local/`
- Hosted projects sync with Supabase for multi-device access
- User preferences are stored in `angular+socket/socket-server/users/`

## Scripts (Frontend)

From `angular+socket/chat-frontend`:

- `npm start` - run Angular dev server
- `npm run build` - build frontend for production
- `npm test` - run unit tests
