# Requirements Document

## Introduction

This document defines the requirements for adding a public-facing homepage to the AuditReady 36 application, integrating the DPDPA Compliance Scanner as an authenticated tab within the main application shell, restructuring routing to separate public and protected pages, and adding the necessary backend proxy and Docker infrastructure.

## Glossary

- **Homepage**: The public landing page rendered at the root path `/` for unauthenticated users, displaying product information and navigation to login/register.
- **AppShell**: The authenticated layout wrapper component that renders the Sidebar, TopBar, and child route content via React Router's `<Outlet />`.
- **DPDPA_Scanner_Service**: The standalone Express-based DPDPA & GDPR compliance scanning microservice running on port 3000.
- **API_Proxy**: The route handler in the main API server that forwards scan requests from the frontend to the DPDPA_Scanner_Service.
- **Route_Guard**: A routing mechanism that redirects unauthenticated users away from protected paths and authenticated users away from public-only paths.
- **Scan_Request**: An HTTP POST body containing `url`, `type`, `headless`, and optionally `policy` fields sent to initiate a compliance scan.
- **Scan_Response**: The JSON payload returned by a successful scan containing `target`, `signals`, `evaluation`, and `html` fields.
- **JWT**: JSON Web Token used for authenticating API requests.
- **Role**: A user attribute (SUPERADMIN, ADMIN, LEAD, AUDITOR, VIEWER) that determines access to specific routes and features.

## Requirements

### Requirement 1: Public Homepage Access

**User Story:** As a visitor, I want to see an informational landing page when I navigate to the root URL, so that I can learn about the product before signing in.

#### Acceptance Criteria

1. WHEN an unauthenticated user navigates to `/` THEN THE Route_Guard SHALL render the Homepage component without requiring authentication.
2. THE Homepage SHALL display a hero section containing the product name, tagline, and call-to-action buttons for sign-in and registration.
3. THE Homepage SHALL display feature highlight cards for ISO 27001 Compliance, DPDP Compliance Scanner, and Dashboard & Reporting.
4. THE Homepage SHALL provide accessible navigation links to the `/login` and `/register` paths.
5. WHEN an authenticated user navigates to `/` THEN THE Route_Guard SHALL redirect the user to the `/app` path.

### Requirement 2: Authenticated Route Protection

**User Story:** As a system administrator, I want all application routes under `/app` to require authentication, so that unauthorized users cannot access compliance data.

#### Acceptance Criteria

1. WHEN an unauthenticated user navigates to any path under `/app` THEN THE Route_Guard SHALL redirect the user to `/login`.
2. WHEN an authenticated user navigates to `/login` THEN THE Route_Guard SHALL redirect the user to their role-based default route.
3. WHEN an authenticated user navigates to `/register` THEN THE Route_Guard SHALL redirect the user to their role-based default route.
4. WHEN a user with the SUPERADMIN role authenticates THEN THE Route_Guard SHALL redirect to `/app/superadmin` as the default route.
5. WHEN a user with the AUDITOR role authenticates THEN THE Route_Guard SHALL redirect to `/app/dashboard` as the default route.
6. WHEN a user with the VIEWER role authenticates THEN THE Route_Guard SHALL redirect to `/app/review` as the default route.
7. WHEN a user with the ADMIN or LEAD role authenticates THEN THE Route_Guard SHALL redirect to `/app` as the default route.
8. WHEN a user navigates to an unrecognized path THEN THE Route_Guard SHALL redirect to `/app` if authenticated or `/` if unauthenticated.

### Requirement 3: Authenticated Application Shell

**User Story:** As an authenticated user, I want a consistent navigation shell with sidebar and top bar, so that I can navigate between compliance features without losing context.

#### Acceptance Criteria

1. WHILE a user is authenticated and viewing any `/app/*` route, THE AppShell SHALL render the Sidebar and TopBar components alongside the active page content.
2. THE AppShell SHALL render navigation links for Tracker, Dashboard, DPDP Compliance, Review, Admin, and Auditors in the Sidebar.
3. WHILE a user is viewing a particular route, THE AppShell SHALL visually highlight the active navigation item in the Sidebar corresponding to the current path.
4. WHILE a user has the ADMIN role, THE AppShell SHALL display the Admin and Auditors navigation items in the Sidebar.
5. WHILE a user has a non-ADMIN role, THE AppShell SHALL hide the Admin and Auditors navigation items from the Sidebar.

### Requirement 4: DPDP Compliance Scanner Integration

**User Story:** As a compliance officer, I want to scan websites for DPDPA and GDPR compliance from within the application, so that I can assess compliance without switching to a separate tool.

#### Acceptance Criteria

1. WHEN an authenticated user navigates to `/app/dpdp-compliance` THEN THE AppShell SHALL render the DPDPCompliance component.
2. THE DPDPCompliance component SHALL provide an input form with fields for target URL, scan type (website or mobile), and headless mode toggle.
3. WHEN a user submits a scan with an empty URL THEN THE DPDPCompliance component SHALL display a validation error and prevent the API call.
4. WHEN a user submits a valid scan request THEN THE DPDPCompliance component SHALL send a POST request to `/api/dpdpa/scan` with the URL, type, and headless parameters.
5. WHILE a scan is in progress, THE DPDPCompliance component SHALL display a loading indicator.
6. WHEN the scan API returns a successful response THEN THE DPDPCompliance component SHALL display the overall compliance score, framework scores for GDPR and DPDPA, category breakdown, and remediation priorities.
7. WHEN the scan API returns an error response THEN THE DPDPCompliance component SHALL display a descriptive error message to the user.
8. THE DPDPCompliance component SHALL provide options to download the scan report in HTML and JSON formats.

### Requirement 5: DPDPA API Proxy Route

**User Story:** As a backend developer, I want scan requests proxied through the main API, so that the DPDPA scanner service remains isolated from direct client access.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/dpdpa/scan` without a valid JWT THEN THE API_Proxy SHALL return HTTP 401 with an error message.
2. WHEN a POST request is received at `/api/dpdpa/scan` with a valid JWT but no URL in the body THEN THE API_Proxy SHALL return HTTP 400 with an error message indicating a URL is required.
3. WHEN a POST request is received at `/api/dpdpa/scan` with a valid JWT and a valid URL THEN THE API_Proxy SHALL forward the request to the DPDPA_Scanner_Service at the configured service URL.
4. WHEN the DPDPA_Scanner_Service returns a successful response THEN THE API_Proxy SHALL return the scan results to the client with HTTP 200.
5. WHEN the DPDPA_Scanner_Service returns an error response THEN THE API_Proxy SHALL forward the error status and message to the client.
6. IF the DPDPA_Scanner_Service is unreachable or times out THEN THE API_Proxy SHALL return HTTP 502 with the message "DPDPA scanner service unavailable".
7. THE API_Proxy SHALL set a request timeout of 60 seconds for forwarded scan requests.
8. THE API_Proxy SHALL NOT expose the internal DPDPA_Scanner_Service URL in any response sent to the client.

### Requirement 6: Scan Result Validity

**User Story:** As a compliance officer, I want scan results to contain valid and complete data, so that I can make accurate compliance assessments.

#### Acceptance Criteria

1. WHEN a scan completes successfully THEN THE Scan_Response SHALL contain an `evaluation.overall.score` value between 0 and 100 inclusive.
2. WHEN a scan completes successfully THEN THE Scan_Response SHALL contain `evaluation.frameworks.GDPR.score` and `evaluation.frameworks.DPDPA.score` values between 0 and 100 inclusive.
3. WHEN a scan completes successfully THEN THE Scan_Response SHALL contain a non-empty `target` field matching the requested URL.
4. WHEN a scan completes successfully THEN THE Scan_Response SHALL contain an `html` field with the pre-rendered report content.

### Requirement 7: Role-Based Route Access Control

**User Story:** As a system administrator, I want routes restricted by user role, so that users only access features appropriate to their responsibilities.

#### Acceptance Criteria

1. WHEN a user without the ADMIN role navigates to `/app/admin` THEN THE Route_Guard SHALL redirect the user to their default route.
2. WHEN a user without the ADMIN role navigates to `/app/auditors` THEN THE Route_Guard SHALL redirect the user to their default route.
3. WHEN a user with the ADMIN or LEAD role navigates to `/app` THEN THE Route_Guard SHALL render the Tracker component.
4. THE Route_Guard SHALL allow all authenticated user roles to access `/app/dpdp-compliance`.

### Requirement 8: Docker Infrastructure for DPDPA Service

**User Story:** As a DevOps engineer, I want the DPDPA scanner service included in the Docker Compose configuration, so that all services start together and can communicate over the Docker network.

#### Acceptance Criteria

1. THE Docker Compose configuration SHALL define a `dpdpa-scanner` service that builds from the DPDPA Compliance scanner directory.
2. THE `dpdpa-scanner` service SHALL expose port 3000 and configure the `PORT` environment variable.
3. THE `dpdpa-scanner` service SHALL use a restart policy of `unless-stopped`.
4. THE API service SHALL have access to the DPDPA_Scanner_Service via the `DPDPA_SERVICE_URL` environment variable.
5. WHILE Docker Compose is running, THE API service SHALL be able to reach the `dpdpa-scanner` service over the Docker network.

### Requirement 9: Homepage Responsiveness and Accessibility

**User Story:** As a visitor on any device, I want the homepage to display correctly and be navigable with assistive technology, so that all potential users can access product information.

#### Acceptance Criteria

1. THE Homepage SHALL render correctly on viewport widths from 320px to 1920px.
2. THE Homepage SHALL use semantic HTML elements and provide accessible labels for all interactive elements.
3. THE Homepage SHALL maintain readable contrast ratios and logical focus order for keyboard navigation.
