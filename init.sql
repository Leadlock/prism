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
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS department TEXT;

-- ===== Self-Assessment Submissions =====
CREATE TABLE IF NOT EXISTS self_assessment_submissions (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT NOT NULL,
  department TEXT NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS self_assess_submissions_unique
  ON self_assessment_submissions (company_id, user_email, department);
ALTER TABLE self_assessment_submissions ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '{}';
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

-- ===== Automated Evidence Collection =====

CREATE TABLE IF NOT EXISTS integrations (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('iam_role', 'access_key', 'oauth2', 'api_key')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'beta', 'coming_soon')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  integration_key TEXT NOT NULL REFERENCES integrations(key),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','error','revoked')),
  external_account_id TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS integration_connections_company_idx ON integration_connections(company_id);

CREATE TABLE IF NOT EXISTS integration_credentials (
  id SERIAL PRIMARY KEY,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  auth_type TEXT NOT NULL,
  ciphertext TEXT,
  iv TEXT,
  auth_tag TEXT,
  key_id TEXT NOT NULL DEFAULT 'local-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS integration_credentials_connection_idx ON integration_credentials(connection_id);

CREATE TABLE IF NOT EXISTS automated_tests (
  id SERIAL PRIMARY KEY,
  integration_key TEXT NOT NULL REFERENCES integrations(key),
  test_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  severity_default TEXT NOT NULL CHECK (severity_default IN ('critical','high','medium','low')),
  remediation_guidance TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS test_control_mappings (
  id SERIAL PRIMARY KEY,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  framework TEXT NOT NULL DEFAULT 'ISO27001',
  iso_reference TEXT NOT NULL,
  UNIQUE(test_key, framework, iso_reference)
);

CREATE TABLE IF NOT EXISTS evidence_collection_runs (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual','scheduled','retry')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial_failure','failed')),
  tests_run INT NOT NULL DEFAULT 0,
  tests_passed INT NOT NULL DEFAULT 0,
  tests_failed INT NOT NULL DEFAULT 0,
  error_message TEXT,
  triggered_by INT REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS evidence_collection_runs_company_idx ON evidence_collection_runs(company_id);
CREATE INDEX IF NOT EXISTS evidence_collection_runs_connection_idx ON evidence_collection_runs(connection_id);

CREATE TABLE IF NOT EXISTS evidence_test_results (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES evidence_collection_runs(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  resource_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass','fail','warn','error','not_applicable')),
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  message TEXT,
  evidence_payload JSONB,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS evidence_test_results_run_idx ON evidence_test_results(run_id);
CREATE INDEX IF NOT EXISTS evidence_test_results_company_idx ON evidence_test_results(company_id);

CREATE TABLE IF NOT EXISTS automated_evidence_items (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  evidence_vault_id INT REFERENCES evidence_vault(id) ON DELETE SET NULL,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  resource_id TEXT NOT NULL,
  latest_result_id INT REFERENCES evidence_test_results(id) ON DELETE SET NULL,
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'fresh' CHECK (status IN ('fresh','stale','expired')),
  first_collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_collection_due_at TIMESTAMPTZ,
  UNIQUE(company_id, connection_id, test_key, resource_id)
);
CREATE INDEX IF NOT EXISTS automated_evidence_items_company_idx ON automated_evidence_items(company_id);

CREATE TABLE IF NOT EXISTS findings (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  resource_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','suppressed','false_positive')),
  title TEXT NOT NULL,
  description TEXT,
  source_result_id INT REFERENCES evidence_test_results(id) ON DELETE SET NULL,
  linked_action_id INT REFERENCES actions(id) ON DELETE SET NULL,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by INT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(company_id, connection_id, test_key, resource_id)
);
CREATE INDEX IF NOT EXISTS findings_company_idx ON findings(company_id);
CREATE INDEX IF NOT EXISTS findings_status_idx ON findings(company_id, status);

ALTER TABLE actions ADD COLUMN IF NOT EXISTS finding_id INT REFERENCES findings(id) ON DELETE SET NULL;

-- ===== Automated Evidence Collection: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('aws', 'Amazon Web Services', 'cloud', 'iam_role', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('aws', 'aws.iam.mfa_enforced', 'IAM users have MFA enabled', 'Checks every IAM user has at least one registered MFA device.', 'critical', 'Require MFA for all IAM users, ideally via an IAM policy condition or SSO enforcement.'),
  ('aws', 'aws.iam.password_policy', 'Account password policy meets minimum strength', 'Checks the account password policy enforces a 14+ character minimum with mixed case, numbers, and symbols.', 'high', 'Update the account password policy under IAM > Account settings.'),
  ('aws', 'aws.iam.access_key_age', 'IAM access keys are rotated within 90 days', 'Flags active access keys older than 90 days.', 'high', 'Rotate the access key and update any services using it, then deactivate the old key.'),
  ('aws', 'aws.logging.cloudtrail_enabled', 'CloudTrail is enabled and multi-region', 'Checks at least one multi-region CloudTrail trail is actively logging.', 'critical', 'Enable a multi-region CloudTrail trail with log file validation.'),
  ('aws', 'aws.logging.config_enabled', 'AWS Config is recording', 'Checks an AWS Config recorder exists and is actively recording.', 'medium', 'Enable AWS Config in this region and confirm the recorder is turned on.'),
  ('aws', 'aws.network.s3_public_access_blocked', 'S3 buckets block public access', 'Checks every S3 bucket has all four public access block settings enabled.', 'critical', 'Enable "Block all public access" on the bucket, or at the account level.'),
  ('aws', 'aws.network.security_groups_no_open_ingress', 'Security groups do not expose management ports publicly', 'Flags security groups allowing inbound SSH (22) or RDP (3389) from 0.0.0.0/0.', 'critical', 'Restrict the security group rule to specific IP ranges or a bastion/VPN.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, framework, iso_reference) VALUES
  ('aws.iam.mfa_enforced', 'ISO27001', 'A.9.4.2'),
  ('aws.iam.password_policy', 'ISO27001', 'A.9.4.3'),
  ('aws.iam.access_key_age', 'ISO27001', 'A.9.2.4'),
  ('aws.logging.cloudtrail_enabled', 'ISO27001', 'A.12.4.1'),
  ('aws.logging.config_enabled', 'ISO27001', 'A.12.1.1'),
  ('aws.network.s3_public_access_blocked', 'ISO27001', 'A.8.2.3'),
  ('aws.network.security_groups_no_open_ingress', 'ISO27001', 'A.13.1.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('azure', 'Microsoft Azure', 'cloud', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, severity_default) VALUES
  ('azure', 'azure.logging.activity_log_diagnostics_enabled', 'Activity Log diagnostic settings are configured', 'critical'),
  ('azure', 'azure.security.defender_enabled', 'Microsoft Defender for Cloud is enabled', 'medium'),
  ('azure', 'azure.storage.public_access_blocked', 'Storage accounts block public blob access', 'critical'),
  ('azure', 'azure.network.nsg_no_open_ingress', 'Network security groups do not expose management ports publicly', 'critical')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('azure.logging.activity_log_diagnostics_enabled', 'A.12.4.1'),
  ('azure.security.defender_enabled', 'A.12.1.1'),
  ('azure.storage.public_access_blocked', 'A.8.2.3'),
  ('azure.network.nsg_no_open_ingress', 'A.13.1.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('github', 'GitHub', 'devops', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('github', 'github.org.two_factor_required', 'Organization requires two-factor authentication', 'Checks the GitHub organization enforces 2FA for all members, billing managers, and outside collaborators.', 'critical', 'Enable Require two-factor authentication under Organization settings > Authentication security.'),
  ('github', 'github.repo.branch_protection_required_reviews', 'Default branch requires pull request review before merging', 'Checks each repository default branch has a protection rule requiring at least one approving review.', 'high', 'Add a branch protection rule on the default branch requiring at least 1 approving review before merge.'),
  ('github', 'github.repo.vulnerability_alerts_enabled', 'Dependabot vulnerability alerts are enabled', 'Checks Dependabot alerts are enabled for each repository.', 'high', 'Enable Dependabot alerts under Repository settings > Code security and analysis.'),
  ('github', 'github.repo.secret_scanning_enabled', 'Secret scanning is enabled', 'Checks secret scanning is enabled for each repository where GitHub Advanced Security is available.', 'medium', 'Enable secret scanning under Repository settings > Code security and analysis.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('github.org.two_factor_required', 'A.9.4.2'),
  ('github.repo.branch_protection_required_reviews', 'A.14.2.2'),
  ('github.repo.vulnerability_alerts_enabled', 'A.12.6.1'),
  ('github.repo.secret_scanning_enabled', 'A.9.4.3')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Purview connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('purview', 'Microsoft Purview', 'data_governance', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('purview', 'purview.datamap.sources_scanned', 'Registered data sources have a recent successful scan', 'Checks every registered Data Map source has completed a successful scan within the last 30 days.', 'high', 'Run or re-schedule a scan for the source in Microsoft Purview > Data Map > Sources.'),
  ('purview', 'purview.datamap.scan_schedule_configured', 'Registered data sources have a recurring scan schedule', 'Checks each registered source has a recurring (not one-off) scan trigger configured.', 'medium', 'Edit the source''s scan and set a recurring trigger instead of "Once".'),
  ('purview', 'purview.datamap.classification_applied', 'Scanned assets have classifications applied', 'Checks scanned assets have at least one data classification applied where the source type supports classification.', 'medium', 'Review scan rule sets to ensure classification rules are enabled for this source type, then re-run the scan.'),
  ('purview', 'purview.datamap.sensitivity_labels_applied', 'Scanned assets have sensitivity labels applied', 'Checks scanned assets carry a sensitivity label where the source type supports labeling.', 'medium', 'Apply sensitivity labels via auto-labeling policies or manually label the asset in the Purview Unified Catalog.'),
  ('purview', 'purview.audit.unified_logging_enabled', 'Unified audit logging is enabled', 'Checks unified audit logging is turned on for the tenant.', 'critical', 'Enable audit logging in Microsoft Purview > Audit > Start recording user and admin activity.'),
  ('purview', 'purview.audit.subscriptions_active', 'Required audit log content-type subscriptions are active', 'Checks Azure AD, Exchange, SharePoint, and General audit content-type subscriptions are enabled.', 'high', 'Start the missing content-type subscription via the Office 365 Management Activity API (POST /activity/feed/subscriptions/start?contentType={type}).'),
  ('purview', 'purview.audit.dlp_alerts_available', 'DLP audit content is available', 'Checks the DLP.All content-type subscription is active and retrievable, evidencing DLP policy enforcement logging.', 'high', 'Confirm at least one DLP policy is enabled in Purview and that the DLP.All subscription is active.'),
  ('purview', 'purview.audit.content_recently_available', 'Audit content is actively flowing', 'Checks at least one audit content blob was produced within the last 24 hours for each active subscription, proving logs are actually flowing rather than merely subscribed.', 'medium', 'Investigate why no recent audit content is available - this can indicate audit logging was disabled after setup or the subscription lapsed.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('purview.datamap.sources_scanned', 'A.8.1.1'),
  ('purview.datamap.scan_schedule_configured', 'A.8.1.1'),
  ('purview.datamap.classification_applied', 'A.8.2.1'),
  ('purview.datamap.sensitivity_labels_applied', 'A.8.2.3'),
  ('purview.audit.unified_logging_enabled', 'A.12.4.1'),
  ('purview.audit.subscriptions_active', 'A.12.4.1'),
  ('purview.audit.dlp_alerts_available', 'A.13.2.1'),
  ('purview.audit.content_recently_available', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Purview Compliance Manager: catalog-only placeholder (no connector) =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('purview_compliance', 'Microsoft Purview Compliance Manager', 'data_governance', 'oauth2', 'coming_soon')
ON CONFLICT (key) DO NOTHING;

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
ALTER TABLE companies      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE companies SET is_verified = TRUE WHERE status IN ('active', 'approved') AND is_verified = FALSE;

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
