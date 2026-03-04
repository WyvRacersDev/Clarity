# Clarity

Clarity is a collaborative productivity app built with Angular and Socket.IO. It lets users manage projects, tasks, analytics, and AI-assisted workflows, with optional Google integrations (Gmail, Calendar, Contacts).

**Authors:** Mohammad Hamza Iqbal, Bilal Kashif, Mawahid Abbas

## Features

- Real-time collaboration using Socket.IO
- Project management with local and hosted project modes
- Task scheduling and dashboard views
- Analytics and AI insights pages
- AI assistant powered by Gemini (via LangChain)
- Google OAuth integration for Gmail/Calendar/Contacts
- Email notifications for upcoming tasks

## Tech Stack

- Frontend: Angular 21, Angular Material, Chart.js
- Backend: Node.js, Express, Socket.IO, TypeScript
- AI: LangChain + Google Gemini
- Integrations: Google APIs, Nodemailer

## Repository Structure

```text
.
├── angular+socket/
│   ├── chat-frontend/      # Angular client app
│   ├── socket-server/      # Express + Socket.IO server
│   ├── shared_models/      # Shared TypeScript models
│   └── package.json        # Backend/runtime dependencies
├── package.json            # Root-level misc dependencies
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

## Notes

- In the app Settings screen, you can configure the backend URL at runtime.
- Project files are stored under `angular+socket/socket-server/projects/`.
- User files are stored under `angular+socket/socket-server/users/`.

## Scripts (Frontend)

From `angular+socket/chat-frontend`:

- `npm start` - run Angular dev server
- `npm run build` - build frontend
- `npm test` - run unit tests
