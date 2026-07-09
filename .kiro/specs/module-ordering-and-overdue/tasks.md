# Implementation Plan: Module Ordering & Overdue Marking

## Overview

This plan implements three improvements to the PRISM compliance tracker: module ordering by PRISM canonical order, SuperAdmin individual module/question CRUD, and automatic overdue action marking. The implementation is broken into incremental steps that build on the existing Express/PostgreSQL/React codebase.

## Tasks

- [ ] 1. Database migration and sort_order backfill
  - [ ] 1.1 Add sort_order column to modules table and backfill PRISM order
    - Add `ALTER TABLE modules ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0` to `init.sql` or create a migration script
    - Backfill existing rows: P→1, R→2, I→3, S→4, M→5 based on first character of module_id
    - Add the `PRISM_ORDER` map constant and `deriveSortOrder()` helper function in a new file `api/src/utils/prismOrder.js`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ]* 1.2 Write property test for deriveSortOrder
    - **Property 1: PRISM Sort Order Derivation**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7**

- [ ] 2. Backend — Module ordering queries
  - [ ] 2.1 Update GET /api/modules to ORDER BY sort_order ASC, module_id ASC
    - Modify `api/src/routes/modules.js` — change the ORDER BY clause in both the list and detail queries
    - Ensure modules are returned in sort_order ascending, then module_id ascending as tiebreaker
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 2.2 Update GET /api/superadmin/companies/:id/modules to ORDER BY sort_order ASC, module_id ASC
    - Modify `api/src/routes/superadmin.js` — update the company modules listing query
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 2.3 Add PATCH /api/superadmin/companies/:companyId/modules/:moduleId/order endpoint
    - Add a new route in `api/src/routes/superadmin.js` that accepts `{ sortOrder: <integer> }` in the body
    - Validate that sortOrder is a non-negative integer
    - Update the module's sort_order for the given company and module
    - Protect with `requireSuperAdmin` middleware
    - Return 404 if module not found, 403 for non-SuperAdmin
    - _Requirements: 3.1, 3.2, 3.3, 1.8_

  - [ ]* 2.4 Write property test for module list ordering
    - **Property 3: Module List Ordering**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [ ] 3. Checkpoint — Verify module ordering
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Backend — SuperAdmin individual module CRUD
  - [ ] 4.1 Add POST /api/superadmin/companies/:id/modules endpoint
    - Add a new route in `api/src/routes/superadmin.js` for creating a single module
    - Validate required fields: `moduleId`, `name`
    - Auto-derive sort_order from module_id prefix using `deriveSortOrder()` if not explicitly provided
    - Check for duplicate module_id per company — return 409 on conflict
    - Return 201 with created module data on success
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 1.8, 12.1_

  - [ ] 4.2 Add DELETE /api/superadmin/companies/:id/modules/:moduleId endpoint
    - Add a new route in `api/src/routes/superadmin.js` for deleting a single module
    - Use a transaction: delete questions first, then delete the module
    - Return 404 if module not found for the company
    - Return 200 with `{ deleted: true }` on success
    - Protect with `requireSuperAdmin` middleware
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 12.2_

  - [ ]* 4.3 Write property test for cascade delete atomicity
    - **Property 7: Cascade Delete Atomicity**
    - **Validates: Requirements 5.1, 5.3**

  - [ ]* 4.4 Write unit tests for module creation and deletion
    - Test duplicate module_id returns 409
    - Test missing required fields returns 400
    - Test successful creation returns 201
    - Test delete non-existent returns 404
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 5.2_

- [ ] 5. Backend — SuperAdmin individual question CRUD
  - [ ] 5.1 Add POST /api/superadmin/companies/:id/questions endpoint
    - Add a new route in `api/src/routes/superadmin.js` for creating a single question
    - Validate required fields: `questId`, `moduleId`
    - Verify referenced module_id exists for the company — return 400 if not found
    - Return 201 with created question data on success
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 12.3_

  - [ ] 5.2 Add DELETE /api/superadmin/companies/:id/questions/:questId endpoint
    - Add a new route in `api/src/routes/superadmin.js` for deleting a single question
    - Return 404 if question not found for the company
    - Return 200 with `{ deleted: true }` on success
    - Protect with `requireSuperAdmin` middleware
    - _Requirements: 7.1, 7.2, 7.3, 12.4_

  - [ ]* 5.3 Write unit tests for question CRUD
    - Test referencing non-existent module returns 400
    - Test missing quest_id returns 400
    - Test successful creation returns 201
    - Test delete non-existent returns 404
    - _Requirements: 6.1, 6.2, 6.3, 7.1, 7.2_

- [ ] 6. Checkpoint — Verify module and question CRUD
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Backend — Overdue action marking
  - [ ] 7.1 Add markOverdueActions() function to scheduler
    - Add a new function in `api/src/utils/scheduler.js` that bulk-updates open actions past due_date to status "OVERDUE"
    - Only update actions where status is NOT in (CLOSED, DONE, COMPLETED, OVERDUE)
    - Update `updated_at` timestamp for all modified rows
    - Register the function in `startScheduler()` to run daily
    - Log the number of actions marked overdue
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ] 7.2 Update GET /api/actions to compute is_overdue flag and sort overdue first
    - Modify `api/src/routes/actions.js` — add a computed `is_overdue` column using SQL CASE expression
    - Add ORDER BY clause: overdue actions first, then by due_date ASC NULLS LAST, then created_at DESC
    - Map `is_overdue` to camelCase `isOverdue` in the response
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 10.1, 10.2, 10.3_

  - [ ]* 7.3 Write property test for overdue detection correctness
    - **Property 4: Overdue Detection Correctness**
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5**

  - [ ]* 7.4 Write property test for scheduler idempotency
    - **Property 5: Scheduler Overdue Marking Idempotency**
    - **Validates: Requirements 9.2, 9.4**

  - [ ]* 7.5 Write property test for scheduler preserving terminal actions
    - **Property 6: Scheduler Preserves Terminal Actions**
    - **Validates: Requirements 9.3, 8.5**

- [ ] 8. Checkpoint — Verify overdue backend logic
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Frontend — SuperAdmin module/question management UI
  - [ ] 9.1 Add "Add Module" form to SuperAdmin company detail view
    - In `web/src/pages/SuperAdminDashboard.jsx`, add a form section for adding a module (fields: moduleId, name, primaryOwner, frequency)
    - Call POST `/api/superadmin/companies/:id/modules` on submit
    - Show success toast and refresh module list on success
    - Show error messages for 400/409 responses
    - _Requirements: 4.1, 4.6, 12.1_

  - [ ] 9.2 Add delete button per module with confirmation dialog
    - In the modules list within SuperAdmin company detail, add a delete icon/button per module row
    - Show a confirmation dialog before deletion ("This will also delete all questions under this module")
    - Call DELETE `/api/superadmin/companies/:id/modules/:moduleId` on confirm
    - Refresh module list on success
    - _Requirements: 5.1, 5.4, 12.2_

  - [ ] 9.3 Add "Add Question" form within module expansion in SuperAdmin
    - Add an expandable section or inline form for adding a question under a module (fields: questId, controlArea, isoReference, baselineQuestion)
    - Call POST `/api/superadmin/companies/:id/questions` on submit
    - Show error for invalid module reference
    - _Requirements: 6.1, 6.4, 12.3_

  - [ ] 9.4 Add delete button per question with confirmation
    - In the questions list within module expansion, add a delete icon/button per question
    - Show confirmation before deletion
    - Call DELETE `/api/superadmin/companies/:id/questions/:questId` on confirm
    - _Requirements: 7.1, 7.3, 12.4_

- [ ] 10. Frontend — Overdue action indicator and sorting
  - [ ] 10.1 Add overdue badge and row styling to action list components
    - In the component that renders the actions table/list, check `action.isOverdue` or `action.status === 'OVERDUE'`
    - Display a red "OVERDUE" badge when true
    - Apply distinct CSS class (e.g., `row-overdue`) for visual distinction (red/orange left border or background tint)
    - _Requirements: 11.1, 11.2_

  - [ ] 10.2 Add "OVERDUE" option to action status filter
    - In the status filter dropdown for actions, add an "OVERDUE" option
    - Wire filter to pass `status=OVERDUE` query param to GET /api/actions
    - _Requirements: 11.3_

  - [ ]* 10.3 Write unit tests for overdue display logic
    - Test that isOverdue=true renders badge
    - Test that isOverdue=false does not render badge
    - Test that OVERDUE filter option is present
    - _Requirements: 11.1, 11.2, 11.3_

- [ ] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The database migration (task 1.1) should be run before any other backend tasks
- All SuperAdmin endpoints reuse the existing `requireSuperAdmin` middleware already defined in `api/src/routes/superadmin.js`
- The frontend tasks assume the SuperAdmin dashboard already has a company detail view (from existing superadmin-dashboard spec)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4"] },
    { "id": 3, "tasks": ["4.1", "4.2", "5.1", "5.2"] },
    { "id": 4, "tasks": ["4.3", "4.4", "5.3"] },
    { "id": 5, "tasks": ["7.1", "7.2"] },
    { "id": 6, "tasks": ["7.3", "7.4", "7.5"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3", "9.4", "10.1", "10.2"] },
    { "id": 8, "tasks": ["10.3"] }
  ]
}
```
