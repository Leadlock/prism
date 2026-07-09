# Tasks: SuperAdmin Dashboard

## Task 1: Database Schema Update
> Requirement(s): 9

- [x] 1.1 Add module_templates table to init.sql with columns: id, name, description, file_name, module_data (JSONB), question_data (JSONB), created_by (FK to super_admins), created_at, updated_at
- [x] 1.2 Ensure companies.status supports 'suspended' value (already TEXT, no change needed - just document)
- [x] 1.3 Add index on module_templates(created_by) for efficient lookups

## Task 2: Company Listing with AI Status
> Requirement(s): 1

- [x] 2.1 Update GET /api/superadmin/companies to LEFT JOIN company_settings and include ai_enabled (default true if no row)
- [x] 2.2 Add admin_email, industry, company_size to the response if not already included
- [x] 2.3 Verify endpoint returns 403 for non-SUPERADMIN users

## Task 3: Company Status Management Endpoint
> Requirement(s): 2

- [x] 3.1 Replace separate /approve and /reject routes with unified PATCH /api/superadmin/companies/:id/status
- [x] 3.2 Validate status is one of: 'approved', 'rejected', 'suspended' - return 400 for invalid values
- [x] 3.3 Return 404 if company not found
- [x] 3.4 Return updated company record with id, name, domain, status

## Task 4: AI Toggle Endpoint
> Requirement(s): 3

- [x] 4.1 Create PATCH /api/superadmin/companies/:id/ai-toggle endpoint
- [x] 4.2 Implement upsert logic: INSERT INTO company_settings ON CONFLICT (company_id) DO UPDATE SET ai_enabled
- [x] 4.3 Validate company exists (return 404 if not)
- [x] 4.4 Return { companyId, aiEnabled } on success

## Task 5: Excel Parser Utility
> Requirement(s): 4

- [x] 5.1 Create api/src/utils/excelParser.js with parseExcelImport(filePath) function
- [x] 5.2 Implement sheet detection logic (look for 'Modules'/'Questions' sheets, fallback to first sheet)
- [x] 5.3 Implement column mapping with flexible header names (snake_case and PascalCase variants)
- [x] 5.4 Validate required fields (module_id for modules, quest_id + module_id for questions)
- [x] 5.5 Return { modules[], questions[], errors[] } with trimmed string values
- [x] 5.6 Skip empty rows silently

## Task 6: Excel Import Endpoint
> Requirement(s): 4, 7

- [x] 6.1 Create POST /api/superadmin/import-modules endpoint with Multer file upload middleware
- [x] 6.2 Configure Multer: 10MB limit, accept only .xlsx/.xls extensions, store in uploads/
- [x] 6.3 Implement transaction-based bulk insert for modules and questions with ON CONFLICT DO NOTHING
- [x] 6.4 Support optional companyId in form data for direct assignment
- [x] 6.5 Clean up uploaded file after processing (success or failure)
- [x] 6.6 Return { modulesImported, questionsImported, errors[], templateId }

## Task 7: Template Management Endpoints
> Requirement(s): 5, 6

- [x] 7.1 Add saveAsTemplate + templateName handling in the import endpoint
- [x] 7.2 Create GET /api/superadmin/templates endpoint (list all templates)
- [x] 7.3 Create DELETE /api/superadmin/templates/:templateId endpoint
- [x] 7.4 Create POST /api/superadmin/templates/:templateId/assign endpoint
- [x] 7.5 Implement atomic assignment: insert template's modules + questions for target company in transaction
- [x] 7.6 Create GET /api/superadmin/companies/:id/modules endpoint

## Task 8: Frontend - Tabbed Dashboard Layout
> Requirement(s): 8

- [x] 8.1 Refactor SuperAdminDashboard.jsx to use tabbed layout (Companies, Modules, Import)
- [x] 8.2 Implement tab state management with session persistence
- [x] 8.3 Add loading and error state handling for each tab

## Task 9: Frontend - Company Management Tab
> Requirement(s): 1, 2, 3, 8

- [x] 9.1 Create CompanyManagementTable component with status badges and action buttons
- [x] 9.2 Add Approve/Suspend/Reject action buttons per company row
- [x] 9.3 Add AI toggle switch per company row
- [x] 9.4 Implement optimistic UI update on status change and AI toggle
- [x] 9.5 Add success/error toast feedback for actions

## Task 10: Frontend - Excel Import Tab
> Requirement(s): 4, 7, 8

- [x] 10.1 Create ExcelUploadPanel component with file input and drag-drop area
- [x] 10.2 Add company selector dropdown for direct assignment
- [x] 10.3 Add "Save as Template" checkbox with template name input
- [x] 10.4 Display import results (counts + errors) after upload completes
- [x] 10.5 Add file type and size validation on the client side

## Task 11: Frontend - Module Templates Tab
> Requirement(s): 5, 6, 8

- [x] 11.1 Create ModuleAssignmentPanel component listing all templates
- [x] 11.2 Add company selector for assigning a template
- [x] 11.3 Add delete button with confirmation dialog for templates
- [x] 11.4 Show module/question counts per template
- [x] 11.5 Display success feedback after assignment
