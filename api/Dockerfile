FROM node:20-slim

WORKDIR /app

# Install system deps: PostgreSQL client + Python
RUN apt-get update -y && \
    apt-get install -y postgresql-client python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt ./requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt fpdf2

# Install Node dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy all app files
COPY . .

RUN chmod +x wait-for-db.sh start.sh

RUN mkdir -p prism_dpdp/data exports

EXPOSE 4000 8080

CMD ["sh", "start.sh"]
