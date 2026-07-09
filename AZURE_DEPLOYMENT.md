================================================================================
         ISO 27001 AUDIT TRACKER - AZURE VPS DEPLOYMENT GUIDE
                   Domain: prism.askthechamp.com
================================================================================

NOTE: Database keeps all data during rebuild (Docker volumes are preserved).

================================================================================
ONE-TIME: SET UP GITHUB REPOSITORY (Local Machine)
================================================================================

--- 1. Create repo on GitHub ---

  - Go to https://github.com/new
  - Repository name: App-VPS (or any name)
  - Set to Private
  - Do NOT initialize with README (you already have code)
  - Click "Create repository"

--- 2. Initialize and push from local machine (PowerShell) ---

    cd C:\Users\aum\Music\App-VPS

    git init
    git add .
    git commit -m "initial commit"
    git branch -M main
    git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git
    git push -u origin main

--- 3. Add .gitignore if not already present ---

  Make sure these are in your .gitignore:

    node_modules/
    .env
    api/uploads/
    *.tar.gz


================================================================================
ONE-TIME SERVER SETUP  (Skip this after first deployment)
================================================================================

--- 1. Provision Azure VM ---

  - Ubuntu 22.04 LTS, size: Standard_B2s or larger
  - Inbound port rules: SSH (22), HTTP (80), HTTPS (443)
  - Note the Public IP after provisioning

--- 2. Connect & Install Docker + Git ---

    ssh -i .\prism_key.pem azureuser@20.193.251.171

    sudo apt update && sudo apt upgrade -y

    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker $USER
    newgrp docker

    sudo apt install -y docker-compose-plugin git

--- 3. Clone the Repository ---

    git clone https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git ~/app
    cd ~/app

--- 4. Configure Environment ---

    cp .env.example .env
    nano .env

  Set these values:

    POSTGRES_PASSWORD=<strong_password>
    DATABASE_URL=postgresql://compliance:<strong_password>@db:5432/compliance
    JWT_SECRET=<32+_char_random_string>

    CORS_ORIGIN=https://prism.askthechamp.com
    VITE_API_URL=https://prism.askthechamp.com/api
    WEB_URL=https://prism.askthechamp.com

    API_PORT=4000
    WEB_PORT=5173

    AWS_ACCESS_KEY_ID=<your_key>
    AWS_SECRET_ACCESS_KEY=<your_secret>
    AWS_REGION=us-east-1

    SMTP_HOST=<smtp_host>
    SMTP_USER=<smtp_user>
    SMTP_PASSWORD=<smtp_password>

    SUPERADMIN_EMAIL=admin@askthechamp.com
    SUPERADMIN_PASSWORD=<strong_password>

--- 5. Initial Deployment ---

    cd ~/app
    docker compose up -d --build

    docker compose ps

--- 6. Set Up Nginx + SSL ---

    sudo apt install -y nginx certbot python3-certbot-nginx

    sudo nano /etc/nginx/sites-available/auditready

  Paste:

    server {
        listen 80;
        server_name prism.askthechamp.com;

        location /api/ {
            proxy_pass http://localhost:4000/api/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        location / {
            proxy_pass http://localhost:5173;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }

    sudo ln -s /etc/nginx/sites-available/auditready /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx

    sudo certbot --nginx -d prism.askthechamp.com


================================================================================
DEPLOYING UPDATES
================================================================================

--- Step 1: Push changes from local machine ---

    cd C:\Users\aum\Music\App-VPS

    git add .
    git commit -m "describe your changes"
    git push origin main


--- Step 2: SSH into server ---

    ssh -i .\prism_key.pem azureuser@20.193.251.171


--- Step 3: Backup current version ---

    cp -r ~/app ~/app_backup_$(date +%Y%m%d_%H%M%S)


--- Step 4: Pull and rebuild ---

    cd ~/app
    docker compose down
    git pull origin main
    docker compose up -d --build


--- Step 5: Apply database migrations (if any) ---

    docker compose exec db psql -U compliance -d compliance < migrations.sql

  Skip if no schema changes.


--- Step 6: Verify ---

    docker compose ps

  Expected: all containers show "Up"
    app-db-1    Up
    app-api-1   Up
    app-web-1   Up


================================================================================
USEFUL COMMANDS
================================================================================

View API logs:
    docker compose logs api -f

View web logs:
    docker compose logs web -f

View DB logs:
    docker compose logs db -f

Restart a single service (no rebuild):
    docker compose restart api
    docker compose restart web

Check container status:
    docker compose ps

Env-only change (no rebuild needed):
    nano ~/app/.env
    docker compose down && docker compose up -d

Rollback to backup:
    docker compose down
    rm -rf ~/app
    cp -r ~/app_backup_TIMESTAMP ~/app
    cd ~/app && docker compose up -d --build

Backup database:
    docker compose exec db pg_dump -U compliance compliance > backup_$(date +%Y%m%d).sql

Restore database:
    docker compose exec -T db psql -U compliance compliance < backup_YYYYMMDD.sql

Free up disk space:
    docker image prune -f

================================================================================
