# Requirements Document

## Introduction

This feature introduces module ordering, individual module/question management by SuperAdmin, and automatic overdue task marking to the PRISM compliance tracker. Modules are displayed in canonical PRISM order (P → R → I → S → M), SuperAdmin can manage modules and questions individually per company, and actions past their due date are automatically flagged as overdue.

## Glossary

- **System**: The PRISM compliance tracker application (API + frontend)
- **Module**: A top-level compliance category identified by a module_id string (e.g., "P - Policies & Governance")
- **Question**: A compliance assessment item belonging to a module, identified by a quest_id
- **Action**: A corrective task assigned to a user, with optional due_date and status fields
- **PRISM_Order**: The canonical ordering of modules by prefix letter: P=1, R=2, I=3, S=4, M=5
- **Sort_Order**: An integer column on the modules table determining display position
- **SuperAdmin**: A user with the highest privilege role, capable of managing all companies
- **Overdue**: An action whose due_date is in the past and whose status is not terminal (CLOSED, DONE, COMPLETED)
- **Terminal_Status**: A status value in the set {CLOSED, DONE, COMPLETED} indicating the action is finished
- **Scheduler**: A background cron job that runs periodically to perform automated maintenance tasks
- **Company**: An organization entity in the system that owns modules, questions, and actions

## Requirements

### Requirement 1: Module Sort Order Assignment

**User Story:** As a SuperAdmin, I want modules to have an explicit sort order derived from the PRISM canonical order, so that modules are always displayed consistently.

#### Acceptance Criteria

1. THE System SHALL store a `sort_order` integer column on the modules table with a default value of 0
2. WHEN a module is created with a module_id starting with "P", THE System SHALL assign sort_order value 1
3. WHEN a module is created with a module_id starting with "R", THE System SHALL assign sort_order value 2
4. WHEN a module is created with a module_id starting with "I", THE System SHALL assign sort_order value 3
5. WHEN a module is created with a module_id starting with "S", THE System SHALL assign sort_order value 4
6. WHEN a module is created with a module_id starting with "M", THE System SHALL assign sort_order value 5
7. WHEN a module is created with a module_id that does not start with P, R, I, S, or M, THE System SHALL assign sort_order value 99
8. WHERE a SuperAdmin provides an explicit sort_order value, THE System SHALL use the provided value instead of deriving it from the module_id prefix

### Requirement 2: Module Display Ordering

**User Story:** As a user, I want modules displayed in PRISM canonical order in the sidebar, so that I can navigate compliance areas in a consistent sequence.

#### Acceptance Criteria

1. WHEN the API returns a list of modules for a company, THE System SHALL sort the modules by sort_order ascending as primary key and module_id ascending as secondary key
2. THE System SHALL return modules in the same order for repeated requests with unchanged data
3. WHEN multiple modules share the same sort_order value, THE System SHALL order them by module_id ascending

### Requirement 3: SuperAdmin Module Sort Order Override

**User Story:** As a SuperAdmin, I want to override the default module ordering for a company, so that I can customize the display to meet specific organizational needs.

#### Acceptance Criteria

1. WHEN a SuperAdmin sends a PATCH request to update a module sort_order, THE System SHALL update the sort_order value for that module
2. THE System SHALL restrict sort_order modification to SuperAdmin users only
3. WHEN a non-SuperAdmin user attempts to modify sort_order, THE System SHALL reject the request with a 403 Forbidden response

### Requirement 4: SuperAdmin Add Individual Module

**User Story:** As a SuperAdmin, I want to add individual modules to a company without importing an Excel file, so that I can quickly extend a company's compliance structure.

#### Acceptance Criteria

1. WHEN a SuperAdmin submits a valid module creation request with module_id and name, THE System SHALL create the module for the specified company
2. WHEN a SuperAdmin submits a module creation request with a module_id that already exists for that company, THE System SHALL reject the request with a 409 Conflict response
3. WHEN a module is created without an explicit sort_order, THE System SHALL auto-derive the sort_order from the module_id prefix
4. WHEN a module creation request is missing the required module_id field, THE System SHALL reject the request with a 400 Bad Request response
5. WHEN a module creation request is missing the required name field, THE System SHALL reject the request with a 400 Bad Request response
6. WHEN a module is successfully created, THE System SHALL return a 201 status code with the created module data

### Requirement 5: SuperAdmin Delete Individual Module

**User Story:** As a SuperAdmin, I want to delete individual modules from a company, so that I can remove compliance areas that are no longer applicable.

#### Acceptance Criteria

1. WHEN a SuperAdmin sends a delete request for an existing module, THE System SHALL remove the module and all its associated questions in a single transaction
2. WHEN a SuperAdmin sends a delete request for a module that does not exist, THE System SHALL return a 404 Not Found response
3. IF the database transaction fails during module deletion, THEN THE System SHALL rollback all changes and return a 500 error response
4. THE System SHALL restrict module deletion to SuperAdmin users only

### Requirement 6: SuperAdmin Add Individual Question

**User Story:** As a SuperAdmin, I want to add individual questions to a module for a company, so that I can expand compliance assessments incrementally.

#### Acceptance Criteria

1. WHEN a SuperAdmin submits a valid question creation request with quest_id and module_id, THE System SHALL create the question for the specified company
2. WHEN a SuperAdmin submits a question creation request referencing a module_id that does not exist for that company, THE System SHALL reject the request with a 400 Bad Request response
3. WHEN a question creation request is missing the required quest_id field, THE System SHALL reject the request with a 400 Bad Request response
4. WHEN a question is successfully created, THE System SHALL return a 201 status code with the created question data

### Requirement 7: SuperAdmin Delete Individual Question

**User Story:** As a SuperAdmin, I want to delete individual questions from a company, so that I can remove outdated or irrelevant assessment items.

#### Acceptance Criteria

1. WHEN a SuperAdmin sends a delete request for an existing question, THE System SHALL remove the question
2. WHEN a SuperAdmin sends a delete request for a question that does not exist, THE System SHALL return a 404 Not Found response
3. THE System SHALL restrict question deletion to SuperAdmin users only

### Requirement 8: Overdue Action Detection

**User Story:** As a user, I want actions past their due date to be flagged as overdue, so that I can prioritize work that needs immediate attention.

#### Acceptance Criteria

1. WHEN the API returns actions, THE System SHALL compute an is_overdue flag for each action
2. WHEN an action has a due_date in the past and a status that is not a Terminal_Status, THE System SHALL set is_overdue to true
3. WHEN an action has a due_date in the future or equal to the current date, THE System SHALL set is_overdue to false
4. WHEN an action has no due_date, THE System SHALL set is_overdue to false
5. WHEN an action has a Terminal_Status, THE System SHALL set is_overdue to false regardless of due_date

### Requirement 9: Scheduled Overdue Status Update

**User Story:** As a system operator, I want a scheduled job to mark overdue actions, so that overdue status is persisted and can be used for notifications and reporting.

#### Acceptance Criteria

1. THE Scheduler SHALL run daily to identify actions past their due_date
2. WHEN the Scheduler identifies an action with due_date in the past and status not in Terminal_Status or OVERDUE, THE Scheduler SHALL update the action status to "OVERDUE"
3. THE Scheduler SHALL not modify actions that have a Terminal_Status
4. THE Scheduler SHALL not modify actions that already have status "OVERDUE"
5. THE Scheduler SHALL update the updated_at timestamp for all modified actions
6. IF the Scheduler encounters a database error, THEN THE System SHALL log the error and retry on the next scheduled cycle

### Requirement 10: Overdue Action Display Priority

**User Story:** As a user, I want overdue actions displayed at the top of action lists, so that urgent items are immediately visible.

#### Acceptance Criteria

1. WHEN displaying a list of actions, THE System SHALL sort overdue actions before non-overdue actions
2. WHEN multiple actions are overdue, THE System SHALL sort them by due_date ascending within the overdue group
3. WHEN actions have no due_date, THE System SHALL sort them after actions with due dates

### Requirement 11: Overdue Visual Indicator

**User Story:** As a user, I want a clear visual indicator for overdue actions, so that I can immediately identify tasks that need attention.

#### Acceptance Criteria

1. WHEN an action is overdue, THE System SHALL display a red "OVERDUE" badge on the action row
2. WHEN an action is overdue, THE System SHALL apply distinct visual styling to the action row
3. THE System SHALL include "OVERDUE" as a filter option in the action status filter

### Requirement 12: Access Control for Module Management

**User Story:** As a system operator, I want module and question management restricted to SuperAdmin, so that regular users cannot modify the compliance structure.

#### Acceptance Criteria

1. THE System SHALL require SuperAdmin role for all module creation endpoints
2. THE System SHALL require SuperAdmin role for all module deletion endpoints
3. THE System SHALL require SuperAdmin role for all question creation endpoints
4. THE System SHALL require SuperAdmin role for all question deletion endpoints
5. WHEN an unauthorized user attempts any module or question management operation, THE System SHALL return a 403 Forbidden response
