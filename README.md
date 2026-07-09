# ISO 27001 Compliance Audit Tracker

A full-stack web application for tracking ISO 27001 self-audit compliance, built with React, Node.js, Express, and PostgreSQL.

## Features

- **Module Management**: Track compliance modules with questions, assessments, actions, and evidence
- **Question Tracking**: Detailed view of each compliance question with ISO references
- **Assessment Recording**: Record answers, maturity levels, and review status
- **Action Management**: Track remediation actions with owners and due dates
- **Evidence Upload**: Attach and manage compliance evidence documents
- **AI-Powered Evidence Analysis**: Amazon Bedrock (Claude) integration to provide automated feedback on evidence submissions
- **Role-Based Access**: ADMIN, LEAD, CONTRIBUTOR, VIEWER, and AUDITOR roles
- **Auditor Time-Bound Access**: Temporary auditor access with expiration dates
- **Scoring Gates**: Visual indicators for compliance eligibility
- **Multi-Tenant Companies**: Each company has isolated assessments, actions, evidence, and list values
- **Admin User Management**: Invite, manage roles, and remove users per company
- **Email Notifications**: Automated reminders for action due dates

## Tech Stack

- **Frontend**: React 18 + Vite
- **Backend**: Node.js + Express
- **Database**: PostgreSQL 16
- **Database Access**: SQL via node-postgres
- **Authentication**: JWT
- **Deployment**: Docker Compose

## Quick Start with Docker

1. **Clone and navigate to the project**:
   ```bash
   cd App
   ```

2. **Create environment file**:
   ```bash
   copy .env.example .env
   ```
   Edit `.env` and update passwords and secrets.

3. **Start all services**:
   ```bash
   docker compose up --build
   ```

4. **Access the application**:
   - Web UI: http://localhost:5173
   - API: http://localhost:4000
   - Register a company at http://localhost:5173/register

## Local Development Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- npm or yarn

### API Setup

1. **Navigate to API directory**:
   ```bash
   cd api
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Create .env file**:
   ```bash
   copy .env.example .env
   ```
   Update `DATABASE_URL` to point to your local PostgreSQL instance.

4. **Initialize the database**:
   ```bash
   psql "$DATABASE_URL" -f ../init.sql
   ```
   Note: init.sql contains all schema definitions and seed data.

5. **Start development server**:
   ```bash
   npm run dev
   ```

### Web Setup

1. **Navigate to web directory**:
   ```bash
   cd web
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Create .env file**:
   ```bash
   copy .env.example .env
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

## Database Schema

The application uses the following main models:

- **User**: Authentication and role management
- **Company**: Tenant workspace for all assessments and users
- **Module**: Compliance modules (e.g., Information Security Policy)
- **Question**: Individual compliance questions with ISO references
- **Assessment**: Recorded answers and maturity levels
- **Action**: Remediation actions for non-compliant items
- **Evidence**: Uploaded compliance evidence documents
- **ListItem**: Per-company dropdown values for various fields
- **Invitation**: Pending invites for company users

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - Company registration (creates first admin)
- `POST /api/auth/accept-invitation` - Accept invite and set password

### Modules
- `GET /api/modules` - List all modules
- `GET /api/modules/:moduleId` - Get module details

### Questions
- `GET /api/questions` - List questions (filter by moduleId)
- `GET /api/questions/:questId` - Get question details

### Assessments
- `GET /api/assessments` - List assessments
- `POST /api/assessments` - Create assessment
- `PUT /api/assessments/:id` - Update assessment
- `DELETE /api/assessments/:id` - Delete assessment

### Actions
- `GET /api/actions` - List actions
- `POST /api/actions` - Create action
- `PUT /api/actions/:id` - Update action
- `DELETE /api/actions/:id` - Delete action

### Evidence
- `GET /api/evidence` - List evidence
- `POST /api/evidence` - Upload evidence (multipart/form-data)
- `PUT /api/evidence/:id` - Update evidence
- `DELETE /api/evidence/:id` - Delete evidence
- `POST /api/evidence/:id/analyze` - Trigger AI analysis of evidence

### Lists
- `GET /api/lists?listName=answer` - Get dropdown values
- `POST /api/lists` - Create list item
- `DELETE /api/lists/:id` - Delete list item

### Users (Admin)
- `GET /api/users` - List users in company
- `POST /api/users/invite` - Create invitation and invite link
- `PUT /api/users/:id` - Update user role
- `DELETE /api/users/:id` - Remove user
- `GET /api/users/invitations` - List pending invitations
- `DELETE /api/users/invitations/:id` - Cancel invitation

## User Roles

- **ADMIN**: Company owner - manage users, roles, and all records
- **LEAD**: Full access - can create, edit, delete all records
- **CONTRIBUTOR**: Can create and edit assessments, actions, and evidence
- **VIEWER**: Read-only access to all data
- **AUDITOR**: Time-bound read-only access with audit logging

## Database Migrations

For existing databases, run migrations to apply schema updates:

```bash
docker-compose exec db psql -U compliance -d compliance < migrations.sql
```

Or use the setup script:
```bash
setup.bat
```

Migrations include:
- Reviewer/Auditor columns for assessments
- AI analysis columns for evidence

## AI Evidence Analysis

The application can analyze uploaded evidence using Amazon Bedrock (Claude):

1. Configure AWS credentials in `.env`
2. Upload evidence via the UI or API
3. Trigger analysis: `POST /api/evidence/:id/analyze`
4. View AI-generated feedback:
   - Contributor comments (gaps, missing elements)
   - Reviewer comments (approval recommendations)
   - Identified gaps and suggestions

**Supported file types for content analysis:**
- Text files (.txt)
- CSV files (.csv)
- JSON files (.json)
- Log files (.log)
- Markdown (.md)

Other file types are analyzed based on metadata.

## Database Initialization

init.sql contains all schema definitions, tables, indexes, and seed data for ISO 27001 modules and questions. When running Docker for the first time, the Postgres container executes this automatically. For local development, run the SQL file once with psql as shown above.

## Docker Services

- **db**: PostgreSQL 16 database
- **api**: Node.js Express API server
- **web**: React Vite development server

## Environment Variables

### Root .env
- `POSTGRES_DB`: Database name
- `POSTGRES_USER`: Database user
- `POSTGRES_PASSWORD`: Database password
- `DATABASE_URL`: Full PostgreSQL connection string
- `JWT_SECRET`: Secret for JWT token signing
- `CORS_ORIGIN`: Allowed CORS origins
- `API_PORT`: API server port (default: 4000)
- `WEB_PORT`: Web server port (default: 5173)
- `VITE_API_URL`: API URL for frontend
- `WEB_URL`: Base URL for invite links (defaults to http://localhost:5173)
- `SMTP_HOST`: Email server host (optional)
- `SMTP_PORT`: Email server port (optional)
- `SMTP_SECURE`: Use TLS for email (optional)
- `SMTP_USER`: Email username (optional)
- `SMTP_PASSWORD`: Email password (optional)
- `EMAIL_FROM`: From address for emails (optional)
- `AWS_ACCESS_KEY_ID`: AWS access key for Bedrock (optional — falls back to IAM role / ~/.aws/credentials)
- `AWS_SECRET_ACCESS_KEY`: AWS secret key for Bedrock (optional)
- `AWS_REGION`: AWS region for Bedrock (default: us-east-1)
- `BEDROCK_MODEL_ID`: Bedrock model ID to use (optional, defaults to Claude Opus 4.8)

## Production Deployment

1. Update all passwords and secrets in `.env`
2. Set `NODE_ENV=production`
3. Build the web app: `cd web && npm run build`
4. Use a reverse proxy (nginx) for SSL/TLS
5. Set up automated backups for PostgreSQL
6. Configure log aggregation and monitoring

## Security Notes

- Change all default passwords before production use
- Use strong JWT secrets (32+ characters)
- Enable HTTPS in production
- Implement rate limiting on API endpoints
- Regular security updates for dependencies
- Backup database regularly

## License

Proprietary - Internal use only

## Support

For issues or questions, contact the development team.
