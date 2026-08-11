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
  reset_otp TEXT,
  reset_otp_expires TIMESTAMPTZ,
  reset_otp_attempts INT NOT NULL DEFAULT 0,
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
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  tags TEXT,
  due_date DATE,
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
  ai_date_warning TEXT,
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

-- ===== Consent Logs =====

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

-- ===== Evidence Vault =====

CREATE TABLE IF NOT EXISTS evidence_vault (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  assessment_id INT REFERENCES assessments(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT,
  file_type TEXT,
  file_size BIGINT,
  storage_path TEXT,
  evidence_link TEXT,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  legacy_evidence_id INT,
  locked BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS evidence_vault_company_idx ON evidence_vault(company_id);
CREATE INDEX IF NOT EXISTS evidence_vault_title_idx ON evidence_vault(company_id, title);
CREATE INDEX IF NOT EXISTS idx_evidence_vault_locked ON evidence_vault(locked) WHERE locked = true;

CREATE TABLE IF NOT EXISTS question_evidence (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  vault_id INT NOT NULL REFERENCES evidence_vault(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  linked_by TEXT,
  CONSTRAINT question_evidence_unique UNIQUE (company_id, quest_id, vault_id)
);
CREATE INDEX IF NOT EXISTS question_evidence_quest_idx ON question_evidence(company_id, quest_id);
CREATE INDEX IF NOT EXISTS question_evidence_vault_idx ON question_evidence(vault_id);

CREATE TABLE IF NOT EXISTS evidence_versions (
  id             SERIAL PRIMARY KEY,
  evidence_id    INTEGER NOT NULL REFERENCES evidence_vault(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  file_name      TEXT,
  file_type      TEXT,
  file_size      BIGINT,
  storage_path   TEXT,
  uploaded_by    TEXT,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version_notes  TEXT,
  UNIQUE (evidence_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_evidence_versions_evidence_id ON evidence_versions(evidence_id);
CREATE INDEX IF NOT EXISTS idx_evidence_versions_uploaded_at ON evidence_versions(uploaded_at DESC);

-- ===== Evidence Requests =====

CREATE TABLE IF NOT EXISTS evidence_requests (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  assessment_id INT REFERENCES assessments(id) ON DELETE SET NULL,
  question_id TEXT,
  artifact_group_id INT,
  requester_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignee_id INT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Submitted', 'Completed', 'Cancelled')),
  fulfilled_evidence_id INT REFERENCES evidence_vault(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS evidence_requests_company_idx ON evidence_requests(company_id);
CREATE INDEX IF NOT EXISTS evidence_requests_assignee_idx ON evidence_requests(company_id, assignee_id);
CREATE INDEX IF NOT EXISTS evidence_requests_requester_idx ON evidence_requests(company_id, requester_id);
CREATE INDEX IF NOT EXISTS evidence_requests_status_idx ON evidence_requests(company_id, status);

CREATE TABLE IF NOT EXISTS evidence_request_comments (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES evidence_requests(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  author_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS erc_request_idx ON evidence_request_comments(request_id);

-- ===== Question Dependencies =====

CREATE TABLE IF NOT EXISTS question_dependencies (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  depends_on_quest_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT question_dependencies_unique UNIQUE (company_id, quest_id, depends_on_quest_id)
);
CREATE INDEX IF NOT EXISTS question_dependencies_quest_idx ON question_dependencies(company_id, quest_id);
CREATE INDEX IF NOT EXISTS question_dependencies_depends_on_idx ON question_dependencies(company_id, depends_on_quest_id);

-- ===== Module Dependencies =====

CREATE TABLE IF NOT EXISTS module_dependencies (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  depends_on_module_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT module_dependencies_unique UNIQUE (company_id, module_id, depends_on_module_id)
);
CREATE INDEX IF NOT EXISTS module_dependencies_module_idx ON module_dependencies(company_id, module_id);
CREATE INDEX IF NOT EXISTS module_dependencies_depends_on_idx ON module_dependencies(company_id, depends_on_module_id);

-- ===== Notifications =====

CREATE TABLE IF NOT EXISTS notifications (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT,
  entity_type  TEXT,
  entity_id    INTEGER,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id, created_at DESC);

-- ===== Marketplace Subscriptions =====

CREATE TABLE IF NOT EXISTS marketplace_subscriptions (
  id                    SERIAL PRIMARY KEY,
  subscription_id       TEXT NOT NULL UNIQUE,
  company_id            INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  plan_id               TEXT,
  quantity              INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'PendingFulfillmentStart',
  purchaser_email       TEXT,
  purchaser_tenant_id   TEXT,
  beneficiary_email     TEXT,
  beneficiary_tenant_id TEXT,
  offer_id              TEXT,
  publisher_id          TEXT,
  term_start_date       TIMESTAMPTZ,
  term_end_date         TIMESTAMPTZ,
  auto_renew            BOOLEAN NOT NULL DEFAULT true,
  is_free_trial         BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_subs_company ON marketplace_subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_subs_status  ON marketplace_subscriptions(status);

-- ===== Idempotent upgrade guards (existing databases) =====
-- These are no-ops on a fresh install; safe to run repeatedly on upgrades.

ALTER TABLE modules     ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE users       ADD COLUMN IF NOT EXISTS reset_otp TEXT;
ALTER TABLE users       ADD COLUMN IF NOT EXISTS reset_otp_expires TIMESTAMPTZ;
ALTER TABLE users       ADD COLUMN IF NOT EXISTS reset_otp_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE questions   ADD COLUMN IF NOT EXISTS priority TEXT;
ALTER TABLE questions   ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE questions   ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS audited_at TIMESTAMPTZ;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS reviewer_notes TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS auditor_notes TEXT;
ALTER TABLE evidence    ADD COLUMN IF NOT EXISTS ai_date_warning TEXT;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users          ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS technology_stack JSONB;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS vault_pin_hash TEXT;

-- Normalise priority values and enforce constraint
UPDATE questions SET priority = 'Medium'
  WHERE priority IS NULL OR priority NOT IN ('Critical', 'High', 'Medium', 'Low');
ALTER TABLE questions ALTER COLUMN priority SET DEFAULT 'Medium';
ALTER TABLE questions ALTER COLUMN priority SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_priority_check') THEN
    ALTER TABLE questions ADD CONSTRAINT questions_priority_check
      CHECK (priority IN ('Critical', 'High', 'Medium', 'Low'));
  END IF;
END $$;

COMMIT;
