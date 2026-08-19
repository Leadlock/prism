# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Prism is a multi-tenant ISO 27001 (and DPDPA/GDPR) compliance audit tracker: React 18 + Vite frontend, Node.js + Express backend, PostgreSQL 16, JWT auth, role-based access (ADMIN, LEAD, CONTRIBUTOR, VIEWER, AUDITOR, plus a separate platform-level SUPERADMIN). AI evidence analysis is powered by a pluggable LLM provider (AWS Bedrock by default, Azure AI Agent as an alternate, or a keyword-only fallback).

## Commands

### Docker (full stack)
```bash
docker compose up --build        # db (5433->5432) + clamav + api (4000) + web (5173)
```

### API (`api/`)
```bash
npm run dev                      # nodemon src/index.js
npm test                         # vitest unit tests (src/__tests__/*.test.js), no DB needed
npx vitest run src/__tests__/sanitise.test.js     # single unit test file
npx vitest run -t "test name"                     # single test by name
npm run test:integration         # vitest against a real local Postgres (see below)
npm run test:all                 # unit + integration
```
Integration tests need Postgres reachable at `postgresql://postgres:postgres@localhost:5432/prism_test`; `globalSetup.js` loads the root `init.sql` schema once, `perTest.js` truncates all tables before each test, and `PRISM_AI_PROVIDER` is forced to `none`. Run a single integration file the same way but pass `--config vitest.integration.config.js`.

### Web (`web/`)
```bash
npm run dev                      # vite dev server on 5173, proxies /api -> http://api:4000
npm run build                    # vite build
npm run test:e2e                 # playwright (chromium only)
npx playwright test tests/guards.spec.js          # single e2e spec
BASE_URL=http://localhost:3000 npx playwright test  # run against the Docker stack instead of a local dev server
```

### Database
`init.sql` (repo root) is the single source of truth for schema + seed data (ISO 27001 modules/questions). Docker's `db` service auto-runs it on first boot; for local Postgres run it once manually with `psql`.

## Architecture

### Backend (`api/src/`)
- **Fat routes, no controller layer**: `routes/*.js` (one file per resource — auth, users, modules, questions, assessments, actions, evidence, lists, dashboard, auditors, superadmin, settings, vault, dpdpa, etc.) contain the handler logic directly, mounted under `/api` via `routes/index.js`.
- **Bootstrap**: `app.js` builds the Express app (`helmet` → `cors` → `express.json` → request timeout → `/health` → static `/api/logos` → `apiRouter` → `errorHandler`). `index.js` is the process entry point — loads dotenv, starts the listener, seeds the super admin, starts the scheduler.
- **Auth/RBAC**: `middleware/auth.js` verifies the JWT, then re-fetches the user (joined with `companies`) from Postgres on *every* request, attaching `req.user = { userId, role, companyId, company, ... }`. It also enforces company status (rejected/suspended/unverified), billing/trial expiry, and auditor time-bound expiry. `middleware/roles.js` provides `requireRole(...)`, `requireReadOnly(...)` (implicit AUDITOR read access), and `requireSuperAdmin`. Route files chain `authenticate` then a role guard per endpoint.
- **Database**: raw SQL via `pg` (`db/index.js`, no ORM) — `query()`, `getClient()` for transactions, `toCamel`/`mapRow(s)` for snake_case→camelCase, `buildUpdate()` for dynamic partial updates.
- **Multi-tenancy is manual, not structural**: there's no ORM-level or Postgres RLS isolation. Every query must filter on `company_id = $N` from `req.user.companyId`, and uploads are stored under `uploads/<companyId>/`. When adding a new query or route, follow this pattern exactly — it's the only thing enforcing tenant isolation.
- **AI provider abstraction** (`utils/aiProvider.js`): switches on `PRISM_AI_PROVIDER` (`bedrock` default → `utils/bedrock.js`, `azure` → `utils/azureOpenAI.js`, `none` → keyword-only fallback). Exposes `analyzeEvidence`, `suggestEvidence`, `chatWithDocuments`, `analyzePolicy`. Always import from `aiProvider.js`, never the concrete provider module directly, so provider-switching keeps working.
- **File uploads**: `multer` (10MB limit, MIME allowlist) → `utils/scanFile.js` validates magic bytes and optionally scans via ClamAV (fails open if ClamAV is unreachable).
- **`scanner/`** is unrelated to file-upload scanning — it's a website privacy/compliance crawler (cheerio + DNS) used by the DPDPA module.
- **Errors**: thrown errors carry `.status`; routes wrap async handlers with `utils/asyncHandler.js`; `middleware/errorHandler.js` is the final handler, always returning `{ error, code? }`.

### Frontend (`web/src/`)
- **Routing**: all routes live in one `<Routes>` block in `App.jsx` (no separate `routes/` folder, no route-guard component) — protection is inline ternaries on `isAuthenticated` / role booleans (`isSuperAdmin`, `isAdmin`, `isLeadOrAdmin`, `isViewer`, `isAuditor`) plus company verification/onboarding state, redirecting via `<Navigate>`.
- **API client**: `src/api/client.js` is the single shared fetch wrapper (`apiFetch`, `apiUpload`, `apiDownload`). No global interceptor — the JWT (stored in `localStorage` under `"token"`) is passed explicitly per call via `{ token }`. Has a 30s/120s request timeout, a 20-in-flight concurrency cap, and a client-side retry/cooldown (3 failures → 30-minute cooldown). 403s with specific codes dispatch `window` events (`auth:company-blocked`, `auth:billing-blocked`) that `App.jsx` listens for.
- **State management**: no Redux/Context/Zustand — auth/session/theme/branding state lives in `App.jsx` via `useState`/`useEffect` and is prop-drilled down as a spread `authProps` object. Only two custom hooks exist (`useAnalytics`, `useCookieConsent`).
- **Styling**: one global stylesheet (`src/styles.css`, ~8000 lines) with CSS custom properties driving a `data-theme` dark/light toggle — no CSS Modules, no Tailwind. `framer-motion` is a dependency but unused (dead). `ogl` (WebGL) powers the animated background in `components/PrismBg.jsx`.
- **Pages** (`src/pages/`) map roughly 1:1 to routes; **components** (`src/components/`) hold shared layout (`AppShell`/`AppSidebar`/`TopBar`) and reusable widgets.

### Testing conventions
- API unit tests mock `req`/`res` and never touch a real DB (a fake `DATABASE_URL` is only set so `pg.Pool` doesn't throw on import).
- API integration tests hit a real Postgres and reset state between tests via truncation — don't add unit tests that assume DB state, and don't add integration tests that mock the DB.
- Playwright e2e tests mock the API per-test via `page.route`/`addInitScript` (see `tests/helpers.js`) rather than hitting a real backend.
