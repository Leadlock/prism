# Requirements: SuperAdmin Dashboard

## Requirement 1: Company Listing and Status Display

### User Story
As a SuperAdmin, I want to view all registered companies with their current status so that I can monitor the platform at a glance.

### Acceptance Criteria
- 1.1 The GET /api/superadmin/companies endpoint returns all companies ordered by created_at DESC
- 1.2 Each company record includes: id, name, domain, admin_email, industry, company_size, status, ai_enabled, created_at
- 1.3 The ai_enabled field is joined from company_settings table (defaults to true if no settings row exists)
- 1.4 The endpoint requires SUPERADMIN authentication and returns 403 for non-SUPERADMIN users
- 1.5 The frontend displays companies in a table with columns: Name, Domain, Admin Email, Status, AI Enabled, Created Date

## Requirement 2: Company Status Management

### User Story
As a SuperAdmin, I want to activate, suspend, or reject companies so that I can control which organizations have access to the platform.

### Acceptance Criteria
- 2.1 PATCH /api/superadmin/companies/:id/status accepts a body with { status } where status is one of: 'approved', 'rejected', 'suspended'
- 2.2 The endpoint updates the company's status and updated_at timestamp
- 2.3 Returns the updated company record (id, name, domain, status) on success
- 2.4 Returns 404 if the company ID does not exist
- 2.5 Returns 400 if the provided status is not a valid value
- 2.6 The frontend provides action buttons (Approve, Suspend, Reject) per company row
- 2.7 Status changes are reflected immediately in the UI without full page reload


## Requirement 3: AI Feature Toggle

### User Story
As a SuperAdmin, I want to enable or disable AI features for individual companies so that I can control which organizations have access to AI-powered functionality.

### Acceptance Criteria
- 3.1 PATCH /api/superadmin/companies/:id/ai-toggle accepts a body with { aiEnabled: boolean }
- 3.2 The endpoint upserts the company_settings row (creates if not exists, updates if exists)
- 3.3 Returns { companyId, aiEnabled } on success
- 3.4 Returns 404 if the company ID does not exist
- 3.5 The frontend displays a toggle switch per company that reflects the current ai_enabled state
- 3.6 Toggling AI to the same value is idempotent and produces no error

## Requirement 4: Excel File Upload and Parsing

### User Story
As a SuperAdmin, I want to upload Excel files containing modules and questions so that I can bulk-import compliance content for companies.

### Acceptance Criteria
- 4.1 POST /api/superadmin/import-modules accepts multipart/form-data with a file field
- 4.2 Only .xlsx and .xls file extensions are accepted; other formats return 400
- 4.3 File size is limited to 10MB; larger files are rejected with 413 status
- 4.4 The parser looks for 'Modules' and 'Questions' sheets; if not found, treats the first sheet as questions
- 4.5 Each module row requires a module_id field; rows without it are skipped with an error
- 4.6 Each question row requires quest_id and module_id fields; rows without them are skipped with an error
- 4.7 The response includes { modulesImported, questionsImported, errors[], templateId }
- 4.8 All string values from Excel cells are trimmed before storage
- 4.9 Empty rows in the spreadsheet are skipped silently
- 4.10 The uploaded file is deleted from disk after processing regardless of success or failure

## Requirement 5: Template Storage

### User Story
As a SuperAdmin, I want to save imported Excel data as reusable templates so that I can assign the same module set to multiple companies without re-uploading.

### Acceptance Criteria
- 5.1 The import endpoint accepts optional fields: saveAsTemplate (boolean) and templateName (string)
- 5.2 When saveAsTemplate is true, a module_templates record is created with the parsed module_data and question_data as JSONB
- 5.3 GET /api/superadmin/templates returns all stored templates ordered by created_at DESC
- 5.4 Each template includes: id, name, description, file_name, module count, question count, created_at
- 5.5 DELETE /api/superadmin/templates/:templateId removes the template record
- 5.6 Deleting a template does not affect modules/questions already assigned to companies from that template


## Requirement 6: Module Assignment to Companies

### User Story
As a SuperAdmin, I want to assign module templates to specific companies so that each company gets the appropriate compliance modules.

### Acceptance Criteria
- 6.1 POST /api/superadmin/templates/:templateId/assign accepts { companyId } in the body
- 6.2 The endpoint inserts modules and questions from the template into the respective tables with the target company_id
- 6.3 Duplicate module_id + company_id combinations are handled with ON CONFLICT DO NOTHING (no duplicates created)
- 6.4 Returns { assigned: true, moduleCount, questionCount } on success
- 6.5 Returns 404 if the template or company does not exist
- 6.6 The assignment operation is atomic (transaction): all or nothing
- 6.7 GET /api/superadmin/companies/:id/modules returns all modules currently assigned to a specific company

## Requirement 7: Direct Import to Company

### User Story
As a SuperAdmin, I want to upload an Excel file and assign it directly to a specific company so that I can quickly set up a company with modules.

### Acceptance Criteria
- 7.1 The import endpoint accepts an optional companyId field in the form data
- 7.2 When companyId is provided, modules and questions are inserted with that company_id
- 7.3 The insert uses ON CONFLICT DO NOTHING to prevent duplicates if the same file is uploaded twice
- 7.4 Both saveAsTemplate and companyId can be used together (save template AND assign to company in one operation)
- 7.5 The operation is wrapped in a database transaction; on failure, nothing is persisted
- 7.6 Returns 404 if the provided companyId does not reference an existing company

## Requirement 8: Frontend Dashboard UI

### User Story
As a SuperAdmin, I want a tabbed interface that organizes company management, module templates, and import functionality into clear sections.

### Acceptance Criteria
- 8.1 The SuperAdmin Dashboard has three tabs: 'Companies', 'Modules', 'Import'
- 8.2 The 'Companies' tab displays the company table with status badges and action controls
- 8.3 The 'Modules' tab shows available templates with option to assign to companies or delete
- 8.4 The 'Import' tab provides a file upload form with options for target company and template saving
- 8.5 Tab selection persists during the session (not reset on data refresh)
- 8.6 Loading and error states are displayed appropriately for each tab
- 8.7 Success/error feedback is shown after status changes, AI toggles, imports, and assignments

## Requirement 9: Database Schema

### User Story
As a developer, I need the module_templates table to store reusable template data.

### Acceptance Criteria
- 9.1 A module_templates table exists with columns: id (SERIAL PK), name (TEXT NOT NULL), description (TEXT), file_name (TEXT), module_data (JSONB NOT NULL), question_data (JSONB NOT NULL), created_by (INT FK to super_admins), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ)
- 9.2 The migration is idempotent (uses CREATE TABLE IF NOT EXISTS)
- 9.3 The companies.status column supports values: 'pending', 'approved', 'rejected', 'suspended'
