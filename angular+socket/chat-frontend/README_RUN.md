# How to Run the Clarity Frontend

## Step 1: Navigate to the Frontend Directory

Open your terminal/command prompt and navigate to:

```
angular+socket\chat-frontend
```

**Full path:**
```
D:\FAST NU\Semester 5\Software Design and Analysis\Clarity\Clarity\angular+socket\chat-frontend
```

## Step 2: Install Dependencies (First Time Only)

If you haven't installed dependencies yet, run:

```bash
npm install
```

## Step 3: Start the Development Server

Run the following command:

```bash
npm start
```

OR

```bash
ng serve
```

## Step 4: Access the Application

Once the server starts, you'll see output like:

```
✔ Browser application bundle generation complete.
Initial Chunk Files | Names         |  Size
main.js             | main          |  XXX kB

** Angular Live Development Server is listening on localhost:4200 **

✔ Compiled successfully.
```

Open your browser and go to:

**http://localhost:4200**

## Available Routes

- **Login Page:** http://localhost:4200/login
- **Dashboard:** http://localhost:4200/dashboard (requires login)
- **Projects:** http://localhost:4200/projects
- **Tasks:** http://localhost:4200/tasks
- **Analytics:** http://localhost:4200/analytics
- **AI Insights:** http://localhost:4200/ai-insights
- **Settings:** http://localhost:4200/settings

## Quick Start Commands

```bash
# Navigate to frontend directory
cd "angular+socket\chat-frontend"

# Install dependencies (first time only)
npm install

# Start development server
npm start
```

## Troubleshooting

- **Port 4200 already in use?** The server will automatically try port 4201, 4202, etc.
- **Module not found errors?** Run `npm install` again
- **Build errors?** Check that all dependencies are installed correctly

