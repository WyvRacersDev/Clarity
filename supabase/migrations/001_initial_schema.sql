-- Using gen_random_uuid() which is built into PostgreSQL 13+
-- No extension needed

-- ============================================
-- PROFILES TABLE (extends auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  settings JSONB DEFAULT '{
    "receive_notifications": true,
    "allow_invite": true,
    "allow_google_calendar": true
  }'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policies for profiles
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Trigger to create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email, settings)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email,
    '{"receive_notifications": true, "allow_invite": true, "allow_google_calendar": true}'::jsonb
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- CONTACTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  contact_detail TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own contacts" ON contacts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own contacts" ON contacts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own contacts" ON contacts
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own contacts" ON contacts
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- PROJECTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  project_type TEXT CHECK (project_type IN ('local', 'hosted')) DEFAULT 'local',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(owner_id, name, project_type)
);

-- Enable RLS on projects
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own projects" ON projects
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Users can view hosted projects" ON projects
  FOR SELECT USING (project_type = 'hosted');

CREATE POLICY "Users can insert their own projects" ON projects
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own projects" ON projects
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own projects" ON projects
  FOR DELETE USING (auth.uid() = owner_id);

-- ============================================
-- GRIDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS grids (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on grids
ALTER TABLE grids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view grids of accessible projects" ON grids
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = grids.project_id
      AND (projects.owner_id = auth.uid() OR projects.project_type = 'hosted')
    )
  );

CREATE POLICY "Users can insert grids in their projects" ON grids
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = grids.project_id
      AND projects.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update grids in their projects" ON grids
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = grids.project_id
      AND projects.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete grids in their projects" ON grids
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = grids.project_id
      AND projects.owner_id = auth.uid()
    )
  );

-- ============================================
-- SCREEN_ELEMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS screen_elements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  grid_id UUID REFERENCES grids(id) ON DELETE CASCADE NOT NULL,
  element_type TEXT NOT NULL CHECK (element_type IN ('Text_document', 'Image', 'Video', 'ToDoLst')),
  name TEXT NOT NULL,
  x_pos DOUBLE PRECISION DEFAULT 0,
  y_pos DOUBLE PRECISION DEFAULT 0,
  x_scale DOUBLE PRECISION DEFAULT 1,
  y_scale DOUBLE PRECISION DEFAULT 1,
  content JSONB DEFAULT '{}'::jsonb,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on screen_elements
ALTER TABLE screen_elements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view elements of accessible projects" ON screen_elements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM grids
      JOIN projects ON projects.id = grids.project_id
      WHERE grids.id = screen_elements.grid_id
      AND (projects.owner_id = auth.uid() OR projects.project_type = 'hosted')
    )
  );

CREATE POLICY "Users can insert elements in their projects" ON screen_elements
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM grids
      JOIN projects ON projects.id = grids.project_id
      WHERE grids.id = screen_elements.grid_id
      AND projects.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update elements in their projects" ON screen_elements
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM grids
      JOIN projects ON projects.id = grids.project_id
      WHERE grids.id = screen_elements.grid_id
      AND projects.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete elements in their projects" ON screen_elements
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM grids
      JOIN projects ON projects.id = grids.project_id
      WHERE grids.id = screen_elements.grid_id
      AND projects.owner_id = auth.uid()
    )
  );

-- ============================================
-- TASKS TABLE (extracted from ToDoLst for easier querying)
-- ============================================
CREATE TABLE IF NOT EXISTS tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  element_id UUID REFERENCES screen_elements(id) ON DELETE CASCADE NOT NULL,
  taskname TEXT NOT NULL,
  priority INTEGER DEFAULT 2,
  is_done BOOLEAN DEFAULT FALSE,
  time TIMESTAMP WITH TIME ZONE,
  completion_time TIMESTAMP WITH TIME ZONE,
  completed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notified BOOLEAN DEFAULT FALSE,
  calendar_event_id TEXT,
  creation_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sort_order INTEGER DEFAULT 0
);

-- Enable RLS on tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tasks of accessible projects" ON tasks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM screen_elements
      JOIN grids ON grids.id = screen_elements.grid_id
      JOIN projects ON projects.id = grids.project_id
      WHERE screen_elements.id = tasks.element_id
      AND (projects.owner_id = auth.uid() OR projects.project_type = 'hosted')
    )
  );

CREATE POLICY "Users can insert tasks in their projects" ON tasks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM screen_elements
      JOIN grids ON grids.id = screen_elements.grid_id
      JOIN projects ON projects.id = grids.project_id
      WHERE screen_elements.id = tasks.element_id
      AND projects.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update tasks in their projects" ON tasks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM screen_elements
      JOIN grids ON grids.id = screen_elements.grid_id
      JOIN projects ON projects.id = grids.project_id
      WHERE screen_elements.id = tasks.element_id
      AND projects.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tasks in their projects" ON tasks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM screen_elements
      JOIN grids ON grids.id = screen_elements.grid_id
      JOIN projects ON projects.id = grids.project_id
      WHERE screen_elements.id = tasks.element_id
      AND projects.owner_id = auth.uid()
    )
  );

-- ============================================
-- OAUTH_TOKENS TABLE (Google API tokens)
-- ============================================
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google',
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMP WITH TIME ZONE,
  scope TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Enable RLS on oauth_tokens
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tokens" ON oauth_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tokens" ON oauth_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tokens" ON oauth_tokens
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tokens" ON oauth_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- PROJECT COLLABORATORS (for shared projects)
-- ============================================
CREATE TABLE IF NOT EXISTS project_collaborators (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  role TEXT CHECK (role IN ('viewer', 'editor', 'admin')) DEFAULT 'editor',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- Enable RLS on project_collaborators
ALTER TABLE project_collaborators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view collaborators of accessible projects" ON project_collaborators
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_collaborators.project_id
      AND (projects.owner_id = auth.uid() OR projects.project_type = 'hosted')
    )
  );

-- ============================================
-- FUNCTIONS AND TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_screen_elements_updated_at ON screen_elements;
CREATE TRIGGER update_screen_elements_updated_at
  BEFORE UPDATE ON screen_elements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(project_type);
CREATE INDEX IF NOT EXISTS idx_grids_project ON grids(project_id);
CREATE INDEX IF NOT EXISTS idx_elements_grid ON screen_elements(grid_id);
CREATE INDEX IF NOT EXISTS idx_elements_type ON screen_elements(element_type);
CREATE INDEX IF NOT EXISTS idx_tasks_element ON tasks(element_id);
CREATE INDEX IF NOT EXISTS idx_tasks_time ON tasks(time);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_tokens(user_id);

-- ============================================
-- REALTIME REPLICATION
-- ============================================
-- Enable realtime for specific tables
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
ALTER PUBLICATION supabase_realtime ADD TABLE grids;
ALTER PUBLICATION supabase_realtime ADD TABLE screen_elements;
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
