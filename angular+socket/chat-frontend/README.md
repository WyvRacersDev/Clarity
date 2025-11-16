# Clarity - Productivity Application Frontend

A comprehensive all-in-one productivity application built with Angular, featuring task management, collaboration, scheduling, and AI-powered insights.

## Features

### ✅ Implemented Features

1. **User Authentication**
   - Login/Register system
   - User session management
   - Route guards for protected pages

2. **Dashboard**
   - Overview of projects, tasks, and productivity metrics
   - Quick action buttons
   - Recent projects display
   - Progress tracking

3. **Projects Management**
   - Create and manage multiple projects
   - Grid-based organization within projects
   - Add various screen elements (Text documents, To-Do lists)
   - Real-time collaboration via Socket.IO
   - Delete projects and grids

4. **Tasks & Calendar**
   - View tasks by date
   - Create scheduled tasks with priorities
   - Track upcoming and overdue tasks
   - Calendar navigation
   - Task completion tracking

5. **Analytics**
   - Task completion rates
   - Priority distribution charts
   - Project performance metrics
   - Weekly completion trends
   - Visual data representations

6. **AI Insights**
   - Productivity analysis
   - Bottleneck identification
   - Personalized suggestions
   - AI chat assistant for productivity questions

7. **Settings**
   - User preferences (notifications, invites)
   - Google Calendar integration toggle
   - Google Contacts integration (placeholder)
   - Gmail integration (placeholder)
   - Account information

8. **Real-time Collaboration**
   - Socket.IO integration for live updates
   - Element synchronization across users
   - Project room management

## Tech Stack

- **Angular 20** - Frontend framework
- **Ionic** - Mobile compatibility (configured)
- **Capacitor** - Cross-platform support (configured)
- **Socket.IO Client** - Real-time communication
- **Chart.js** - Analytics visualizations (configured)
- **Day.js** - Date manipulation
- **TypeScript** - Type-safe development

## Project Structure

```
src/app/
├── components/
│   ├── login/          # Authentication
│   ├── layout/          # Main layout with sidebar
│   ├── dashboard/       # Dashboard overview
│   ├── projects/       # Project management
│   ├── tasks/          # Tasks & Calendar
│   ├── analytics/      # Analytics & charts
│   ├── ai-insights/    # AI assistant & insights
│   └── settings/       # User settings
├── services/
│   ├── auth.service.ts      # Authentication logic
│   ├── data.service.ts      # Data management
│   └── socket.service.ts    # Socket.IO communication
└── guards/
    └── auth.guard.ts        # Route protection
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Navigate to the frontend directory:
```bash
cd angular+socket/chat-frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

4. Open your browser and navigate to `http://localhost:4200`

### Building for Production

```bash
npm run build
```

## Usage

1. **Register/Login**: Create a new account or login with existing credentials
2. **Create Projects**: Start by creating a project from the Projects page
3. **Add Grids**: Organize your work into grids within projects
4. **Add Elements**: Add text documents, to-do lists, and other elements
5. **Manage Tasks**: Create and schedule tasks with priorities
6. **View Analytics**: Track your productivity with visual analytics
7. **Get AI Insights**: Use the AI assistant for productivity recommendations
8. **Configure Settings**: Customize notifications and integrations

## Data Storage

Currently, data is stored in:
- **localStorage** - User data and projects (JSON format)
- **In-memory** - Active session data

Note: This is a frontend-only implementation. For production, you'll need to integrate with a backend API.

## Real-time Features

The application uses Socket.IO for real-time collaboration:
- Element updates are synchronized across users
- Project rooms for multi-user collaboration
- Task updates broadcast to all connected users

## Google Integrations

The following Google services are prepared for integration:
- **Google Calendar** - Sync tasks and events
- **Google Contacts** - Import contacts
- **Gmail** - Email-based task creation

Note: OAuth implementation is required on the backend for full integration.

## Future Enhancements

- [ ] Full Google OAuth implementation
- [ ] Enhanced AI capabilities with actual API integration
- [ ] Mobile app deployment with Capacitor
- [ ] Offline support (currently live data only)
- [ ] Advanced analytics with Chart.js
- [ ] File upload for images and videos
- [ ] Team collaboration features
- [ ] Export/Import functionality

## Development Notes

- All components are standalone (Angular 20 feature)
- Services use RxJS for reactive data management
- Socket.IO client configured for `http://localhost:3000`
- Responsive design with modern CSS
- Type-safe development with TypeScript

## Contributing

This is a project for Software Design and Analysis course. For questions or issues, please contact the development team.
