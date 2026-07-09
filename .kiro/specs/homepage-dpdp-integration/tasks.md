# Implementation Plan: Homepage & DPDP Compliance Integration

## Overview

This plan implements a public homepage, restructures routing to separate public and authenticated paths under `/app`, integrates the DPDPA Compliance Scanner as an authenticated page, adds a backend API proxy route, and updates Docker Compose to include the scanner service.

## Tasks

- [x] 1. Create the Homepage component and public route infrastructure
  - [x] 1.1 Create the Homepage component at `web/src/pages/Homepage.jsx`
    - Implement hero section with product name "AuditReady 36", tagline, and CTA buttons (Sign In, Get Started)
    - Add feature highlight cards for ISO 27001 Compliance, DPDP Compliance Scanner, and Dashboard & Reporting
    - Include navigation links to `/login` and `/register`
    - Use semantic HTML elements and accessible labels for all interactive elements
    - Ensure responsive layout from 320px to 1920px viewports
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 9.1, 9.2, 9.3_

  - [ ]* 1.2 Write unit tests for the Homepage component
    - Test that hero section, feature cards, and CTA buttons render correctly
    - Test that navigation links point to `/login` and `/register`
    - Test responsive layout class application
    - _Requirements: 1.2, 1.3, 1.4, 9.2_

- [x] 2. Create the AppShell layout component
  - [x] 2.1 Create the AppShell component at `web/src/components/AppShell.jsx`
    - Accept props: `token`, `user`, `company`, `branding`, `onLogout`, `theme`, `onThemeToggle`
    - Render a layout with the navigation sidebar, TopBar, and React Router `<Outlet />` for child route content
    - Pass auth props down to TopBar for user info, theme toggle, and logout
    - _Requirements: 3.1_

  - [x] 2.2 Create the AppSidebar navigation component at `web/src/components/AppSidebar.jsx`
    - Render navigation links: Tracker (`/app`), Dashboard (`/app/dashboard`), DPDP Compliance (`/app/dpdp-compliance`), Review (`/app/review`), Admin (`/app/admin`), Auditors (`/app/auditors`)
    - Highlight the active navigation item based on the current route path using `useLocation()`
    - Conditionally show Admin and Auditors links only for users with the ADMIN role
    - Display company branding/logo if available
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

  - [ ]* 2.3 Write unit tests for AppShell and AppSidebar
    - Test that AppShell renders sidebar, topbar, and outlet
    - Test that AppSidebar shows/hides Admin and Auditors links based on user role
    - Test active link highlighting
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Implement the DPDPA API proxy route in the backend
  - [x] 3.1 Create the DPDPA proxy route at `api/src/routes/dpdpa.js`
    - Create a POST `/scan` endpoint protected by the auth middleware
    - Validate that `req.body.url` exists and is a non-empty string; return HTTP 400 if missing
    - Forward the request (url, type, headless, policy) to the DPDPA Scanner Service at `process.env.DPDPA_SERVICE_URL || "http://localhost:3000"` endpoint `/api/scan`
    - Set a 60-second timeout on the forwarded request using AbortController
    - Return the scanner response to the client on success (HTTP 200)
    - Forward error status and message from the scanner on failure
    - Return HTTP 502 with "DPDPA scanner service unavailable" if the service is unreachable or times out
    - Never expose the internal DPDPA_SERVICE_URL in any client response
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 3.2 Register the DPDPA route in `api/src/routes/index.js`
    - Import the new `dpdpa.js` route module
    - Mount it at `/dpdpa` path so the full endpoint becomes `/api/dpdpa/scan`
    - _Requirements: 5.3_

  - [ ]* 3.3 Write unit tests for the DPDPA proxy route
    - Test 400 response when URL is missing
    - Test 200 response when scanner returns success
    - Test 502 response when scanner is unreachable
    - Test that internal service URL is not leaked in responses
    - Test 60-second timeout behavior
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

- [x] 4. Checkpoint - Ensure backend proxy and components compile correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Create the DPDPCompliance page component
  - [x] 5.1 Create the DPDPCompliance component at `web/src/pages/DPDPCompliance.jsx`
    - Accept props: `token`, `user`, `company`
    - Render an input form with: target URL text field, scan type select (website/mobile), headless mode toggle checkbox
    - On submit, validate that URL is not empty (show validation error if empty, prevent API call)
    - Send POST request to `/api/dpdpa/scan` with `{url, type, headless}` using the existing `apiFetch` helper with the auth token
    - Display a loading indicator while scan is in progress
    - On success, render: overall compliance score, GDPR and DPDPA framework scores, category breakdown, and remediation priorities
    - On error, display a descriptive error message
    - Provide download options for HTML report and JSON report
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [ ]* 5.2 Write unit tests for DPDPCompliance component
    - Test empty URL validation prevents API call
    - Test loading state displays during scan
    - Test successful result rendering (scores, categories, remediation)
    - Test error state rendering
    - Test download report buttons
    - _Requirements: 4.2, 4.3, 4.5, 4.6, 4.7, 4.8_

- [x] 6. Restructure App.jsx routing
  - [x] 6.1 Update `web/src/App.jsx` to implement new routing structure
    - Import the Homepage, AppShell, and DPDPCompliance components
    - Define public routes: `/` renders Homepage for unauthenticated users, redirects to `/app` for authenticated users
    - `/login` renders Login for unauthenticated users, redirects to role-based default route for authenticated users
    - `/register` renders Register for unauthenticated users, redirects to role-based default route for authenticated users
    - `/accept-invite/:token` remains as-is for unauthenticated users
    - Define authenticated routes under `/app` wrapped by AppShell using nested `<Route>` with `<Outlet />`
    - Nested routes: index → Tracker (ADMIN/LEAD), `dashboard` → Dashboard (all), `dpdp-compliance` → DPDPCompliance (all), `review` → Review (ADMIN/LEAD/VIEWER), `admin` → AdminPanel (ADMIN only), `auditors` → AuditorPanel (ADMIN only), `superadmin` → SuperAdminDashboard (SUPERADMIN only)
    - Update `defaultRoute()` to return `/app/superadmin` for SUPERADMIN, `/app/dashboard` for AUDITOR, `/app/review` for VIEWER, `/app` for ADMIN/LEAD
    - Add role-based route guards: redirect non-ADMIN users away from `/app/admin` and `/app/auditors` to their default route
    - Catch-all `*` route redirects to `/app` if authenticated, `/` if unauthenticated
    - _Requirements: 1.1, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 7.1, 7.2, 7.3, 7.4_

  - [ ]* 6.2 Write property tests for route resolution logic
    - **Property 1: Route Guard Invariant** — For any path under `/app/*` and any unauthenticated user, the route resolver produces a redirect to `/login`
    - **Validates: Requirements 2.1**
    - **Property 2: Public Access Invariant** — For any unauthenticated user at `/`, Homepage renders; for any authenticated user at `/`, redirect to `/app`
    - **Validates: Requirements 1.1, 1.5**
    - **Property 3: Role-Based Default Route Completeness** — For any role in {SUPERADMIN, ADMIN, LEAD, AUDITOR, VIEWER}, `getDefaultAuthRoute` returns a valid route path
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.7**

  - [ ]* 6.3 Write property tests for role-based access control
    - **Property 8: Role-Based Route Access Control** — For any user without ADMIN role navigating to `/app/admin` or `/app/auditors`, redirect to default route
    - **Validates: Requirements 7.1, 7.2**
    - **Property 9: Fallback Route Resolution** — For any unrecognized path, redirect to `/app` if authenticated, `/` if unauthenticated
    - **Validates: Requirements 2.8**

- [x] 7. Checkpoint - Ensure frontend routing and components work together
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update Docker Compose and environment configuration
  - [x] 8.1 Add `dpdpa-scanner` service to `docker-compose.yml`
    - Add service that builds from `./DPDPA Complaince/DPDPA Complaince` directory
    - Set `PORT: 3000` environment variable
    - Expose port `3000:3000`
    - Set restart policy to `unless-stopped`
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 8.2 Add `DPDPA_SERVICE_URL` environment variable to the API service
    - Add `DPDPA_SERVICE_URL: http://dpdpa-scanner:3000` to the api service environment in `docker-compose.yml`
    - Add `DPDPA_SERVICE_URL` to the `.env.example` file with default value `http://dpdpa-scanner:3000`
    - _Requirements: 8.4, 8.5_

- [x] 9. Wire sidebar navigation into the AppShell
  - [x] 9.1 Integrate AppSidebar into AppShell and verify navigation
    - Ensure AppShell passes `user`, `currentPath` (from `useLocation()`), and `branding` to AppSidebar
    - Verify clicking navigation items in the sidebar routes to the correct `/app/*` paths
    - Ensure the DPDP Compliance link navigates to `/app/dpdp-compliance`
    - _Requirements: 3.1, 3.2, 3.3, 4.1_

  - [ ]* 9.2 Write property tests for navigation visibility
    - **Property 4: Role-Based Navigation Visibility** — For any user role, Admin and Auditors items are visible only to ADMIN users; DPDP Compliance is visible to all authenticated roles
    - **Validates: Requirements 3.4, 3.5, 7.4**

- [x] 10. Final checkpoint - Ensure all components are wired and tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The existing `Sidebar.jsx` is specific to the Tracker page (ISO 27001 module navigation) and remains unchanged — the new `AppSidebar.jsx` handles app-wide navigation
- The project uses JavaScript (React + Vite for frontend, Node.js/Express for backend)
- No new npm dependencies are required

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.2"] },
    { "id": 2, "tasks": ["2.3", "3.3", "5.1"] },
    { "id": 3, "tasks": ["5.2", "6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "8.1", "8.2"] },
    { "id": 5, "tasks": ["9.1"] },
    { "id": 6, "tasks": ["9.2"] }
  ]
}
```
