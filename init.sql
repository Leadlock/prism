BEGIN;

-- ===== Enums =====
DO $$ BEGIN
  CREATE TYPE role AS ENUM ('ADMIN', 'LEAD', 'CONTRIBUTOR', 'VIEWER', 'AUDITOR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ===== Core Tables =====

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  admin_email TEXT NOT NULL,
  industry TEXT,
  company_size TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  plan TEXT NOT NULL DEFAULT 'lite',
  billing_status TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  template_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS companies_status_idx ON companies(status);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  department TEXT,
  job_title TEXT,
  role role NOT NULL,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_company_id_idx ON users(company_id);

CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  module_id TEXT NOT NULL,
  company_id INT REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  primary_owner TEXT,
  frequency TEXT,
  total_quests INT,
  purpose TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS modules_company_id_idx ON modules(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS modules_company_module_id_idx ON modules(company_id, module_id);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  quest_id TEXT NOT NULL,
  company_id INT REFERENCES companies(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  module_name TEXT,
  control_area TEXT,
  iso_reference TEXT,
  baseline_question TEXT,
  level3_yes_criteria TEXT,
  required_evidence TEXT,
  default_owner TEXT,
  frequency TEXT,
  recurrence_interval TEXT DEFAULT 'monthly',
  next_due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS questions_module_id_idx ON questions(module_id);
CREATE INDEX IF NOT EXISTS questions_company_id_idx ON questions(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS questions_company_quest_id_idx ON questions(company_id, quest_id);

CREATE TABLE IF NOT EXISTS assessments (
  id SERIAL PRIMARY KEY,
  assessment_id TEXT,
  month TEXT,
  module_id TEXT,
  quest_id TEXT,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  control_area TEXT,
  answer TEXT,
  current_level INT,
  level3_plus BOOLEAN,
  evidence_link TEXT,
  owner TEXT,
  submitted_by TEXT,
  reviewer TEXT,
  review_status TEXT,
  score_eligible BOOLEAN,
  comments TEXT,
  reviewed_by TEXT,
  audited_by TEXT,
  reviewed_at TIMESTAMPTZ,
  audited_at TIMESTAMPTZ,
  reviewer_notes TEXT,
  auditor_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS assessments_company_id_idx ON assessments(company_id);
CREATE INDEX IF NOT EXISTS assessments_module_id_idx ON assessments(module_id);
CREATE INDEX IF NOT EXISTS assessments_quest_id_idx ON assessments(quest_id);

CREATE TABLE IF NOT EXISTS actions (
  id SERIAL PRIMARY KEY,
  action_id TEXT,
  month TEXT,
  module_id TEXT,
  quest_id TEXT,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  defeated_quest TEXT,
  current_level INT,
  target_level INT,
  immediate_action_required BOOLEAN,
  owner TEXT,
  due_date TIMESTAMPTZ,
  status TEXT,
  closure_evidence_link TEXT,
  reviewer TEXT,
  closure_date TIMESTAMPTZ,
  notes TEXT,
  reminder_sent_offsets INT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS actions_company_id_idx ON actions(company_id);
CREATE INDEX IF NOT EXISTS actions_module_id_idx ON actions(module_id);
CREATE INDEX IF NOT EXISTS actions_quest_id_idx ON actions(quest_id);

CREATE TABLE IF NOT EXISTS evidence (
  id SERIAL PRIMARY KEY,
  evidence_id TEXT,
  month TEXT,
  module_id TEXT,
  quest_id TEXT,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  evidence_type TEXT,
  evidence_name TEXT,
  evidence_link TEXT,
  file_path TEXT,
  uploaded_by TEXT,
  upload_date TIMESTAMPTZ,
  reviewer TEXT,
  approval_status TEXT,
  notes TEXT,
  ai_contributor_comments TEXT,
  ai_reviewer_comments TEXT,
  ai_gaps JSONB,
  ai_suggestions JSONB,
  ai_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS evidence_company_id_idx ON evidence(company_id);
CREATE INDEX IF NOT EXISTS evidence_module_id_idx ON evidence(module_id);
CREATE INDEX IF NOT EXISTS evidence_quest_id_idx ON evidence(quest_id);

CREATE TABLE IF NOT EXISTS list_items (
  id SERIAL PRIMARY KEY,
  list_name TEXT NOT NULL,
  value TEXT NOT NULL,
  color TEXT,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, list_name, value)
);
CREATE INDEX IF NOT EXISTS list_items_company_id_idx ON list_items(company_id);
CREATE INDEX IF NOT EXISTS list_items_company_list_name_idx ON list_items(company_id, list_name);

CREATE TABLE IF NOT EXISTS import_logs (
  id SERIAL PRIMARY KEY,
  source_file TEXT,
  status TEXT,
  notes TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auditor_profiles (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '14 days'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auditor_profiles_company_id_idx ON auditor_profiles(company_id);
CREATE INDEX IF NOT EXISTS auditor_profiles_expiry_idx ON auditor_profiles(expiry_date) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  detail JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_company_id_idx ON audit_logs(company_id);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role role NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS invitations_company_id_idx ON invitations(company_id);
CREATE INDEX IF NOT EXISTS invitations_token_idx ON invitations(token);

-- ===== Super Admin =====

CREATE TABLE IF NOT EXISTS super_admins (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_settings (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  logo_url TEXT,
  primary_color TEXT,
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  default_reminder_offsets INT[] NOT NULL DEFAULT '{7,14,30}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS company_settings_company_id_idx ON company_settings(company_id);

CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  action_id INT REFERENCES actions(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  quest_id TEXT,
  module_id TEXT,
  reminder_type TEXT NOT NULL DEFAULT 'action_due',
  remind_at TIMESTAMPTZ NOT NULL,
  recipient_email TEXT,
  message TEXT,
  sent BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reminders_company_id_idx ON reminders(company_id);
CREATE INDEX IF NOT EXISTS reminders_remind_at_idx ON reminders(remind_at) WHERE sent = FALSE;
CREATE INDEX IF NOT EXISTS reminders_action_id_idx ON reminders(action_id);

CREATE TABLE IF NOT EXISTS module_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  file_name TEXT,
  module_data JSONB NOT NULL,
  question_data JSONB NOT NULL,
  created_by INT REFERENCES super_admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_module_templates_created_by ON module_templates(created_by);

-- ===== Module Ordering: sort_order backfill (for upgrades from older schema) =====
ALTER TABLE modules ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
UPDATE modules SET sort_order = 1 WHERE sort_order = 0 AND module_id LIKE 'P%';
UPDATE modules SET sort_order = 2 WHERE sort_order = 0 AND module_id LIKE 'R%';
UPDATE modules SET sort_order = 3 WHERE sort_order = 0 AND module_id LIKE 'I%';
UPDATE modules SET sort_order = 4 WHERE sort_order = 0 AND module_id LIKE 'S%';
UPDATE modules SET sort_order = 5 WHERE sort_order = 0 AND module_id LIKE 'M%';

-- ===== Assessment review/audit timestamps and notes (for upgrades) =====
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS audited_at TIMESTAMPTZ;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS reviewer_notes TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS auditor_notes TEXT;

-- ===== Consent Logs (GDPR cookie consent audit trail) =====
CREATE TABLE IF NOT EXISTS consent_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ip_address VARCHAR(45) NOT NULL,
  language VARCHAR(10) DEFAULT 'en',
  consent_version VARCHAR(20) NOT NULL,
  choices JSONB NOT NULL DEFAULT '{}',
  action VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_logs_ip_anon
  ON consent_logs (ip_address, created_at DESC)
  WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_consent_logs_user
  ON consent_logs (user_id, created_at DESC);

COMMIT;
