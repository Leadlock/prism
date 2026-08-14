FROM node:24-slim

WORKDIR /app

# Upgrade npm itself so its bundled deps (tar, brace-expansion) are patched
RUN npm install -g npm@latest

# Install system deps: PostgreSQL client
RUN apt-get update -y && \
    apt-get upgrade -y && \
    apt-get install -y postgresql-client gosu && \
    rm -rf /var/lib/apt/lists/*

# Install Node dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy all app files
COPY . .

RUN chmod +x wait-for-db.sh start.sh docker-entrypoint.sh

RUN mkdir -p exports uploads

RUN addgroup --system appgroup \
 && adduser --system --ingroup appgroup appuser \
 && chown -R appuser:appgroup /app

EXPOSE 4000

# Entrypoint runs as root to fix named-volume ownership, then drops to appuser via gosu
ENTRYPOINT ["sh", "docker-entrypoint.sh"]
