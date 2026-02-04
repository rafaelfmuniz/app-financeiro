#!/usr/bin/env bash
#
# Controle Financeiro - Installer
# Version: 1.1.0
# Requirements: Ubuntu 20.04+, Debian 11+
# Usage: curl -fsSL URL | sudo bash
#
set -euo pipefail

###############################################
# CONFIGURATION
###############################################

APP_VERSION="1.1.0"
APP_USER="finance"
APP_DIR="/opt/controle-financeiro"
SERVICE_NAME="controle-financeiro"
APP_PORT="3000"
BACKUP_DIR="$APP_DIR/backups"
NODE_MAJOR="20"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

###############################################
# FUNCTIONS
###############################################

print_header() {
  clear
  echo -e "${BOLD}${BLUE}"
  echo "╔══════════════════════════════════════╗"
  echo "║  Controle Financeiro Installer          ║"
  echo "║  Version: $APP_VERSION                      ║"
  echo "╚══════════════════════════════════════╝"
  echo -e "${NC}"
}

print_step() {
  echo -e "${CYAN}[$1] ${NC}$2"
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

check_cmd() {
  command -v "$1" >/dev/null 2>&1
}

gen_password() {
  openssl rand -base64 18 | tr -d '\n=+/'
}

###############################################
# INSTALLATION
###############################################

print_step "1/7" "Installing dependencies..."

# Update package list
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Install required packages
apt-get install -y -qq \
  curl \
  wget \
  ca-certificates \
  gnupg \
  git \
  build-essential \
  python3 \
  postgresql \
  postgresql-contrib \
  nodejs \
  npm >/dev/null 2>&1

# Enable and start PostgreSQL
systemctl enable postgresql >/dev/null 2>&1 || true
systemctl start postgresql >/dev/null 2>&1 || true

print_success "Dependencies installed"

print_step "2/7" "Creating system user..."

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

print_success "System user created"

print_step "3/7" "Setting up database..."

# Auto-generate database credentials
DB_NAME="finance_db"
DB_USER="finance_user"
DB_PASS=$(gen_password)

# Create PostgreSQL user
su - postgres -c "psql -c \"CREATE ROLE \\\"$DB_USER\\\" LOGIN PASSWORD '$DB_PASS';\"" 2>/dev/null || \
su - postgres -c "psql -c \"ALTER ROLE \\\"$DB_USER\\\" WITH PASSWORD '$DB_PASS';\""

# Create database
su - postgres -c "psql -c \"CREATE DATABASE \\\"$DB_NAME\\\" OWNER \\\"$DB_USER\\\";\"" 2>/dev/null || \
print_success "Database already exists"

# Grant privileges
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE \\\"$DB_NAME\\\" TO \\\"$DB_USER\\\";\""

print_success "Database configured"

print_step "4/7" "Deploying application..."

# Create directory
mkdir -p "$APP_DIR"

# Clone or update
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin >/dev/null 2>&1
  git reset --hard origin/main >/dev/null 2>&1
else
  rm -rf "$APP_DIR"
  git clone --depth 1 https://github.com/rafaelfmuniz/app-financeiro.git "$APP_DIR" >/dev/null 2>&1
fi

# Set ownership
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

print_success "Application deployed"

print_step "5/7" "Configuring application..."

# Auto-generate all credentials
MASTER_EMAIL="admin@controle-financeiro.local"
MASTER_PASSWORD=$(gen_password)
MASTER_NAME="Administrador"
MASTER_USERNAME="admin"
DEFAULT_TENANT_NAME="Principal"
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)

# Get server IP
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
SERVER_IP="${SERVER_IP:-$(hostname)}"

# Create .env file
cat > "$APP_DIR/backend/.env" <<EOF
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=$DB_USER
DB_PASS=$DB_PASS
DB_NAME=$DB_NAME

PORT=$APP_PORT
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=30m
DEFAULT_TENANT_NAME=$DEFAULT_TENANT_NAME

MASTER_EMAIL=$MASTER_EMAIL
MASTER_PASSWORD=$MASTER_PASSWORD
MASTER_NAME=$MASTER_NAME
MASTER_USERNAME=$MASTER_USERNAME

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_REPLY_TO=
APP_BASE_URL=http://$SERVER_IP:$APP_PORT
EOF

chmod 600 "$APP_DIR/backend/.env"
chown "$APP_USER:$APP_USER" "$APP_DIR/backend/.env"

print_success "Application configured"

print_step "6/7" "Installing dependencies and building..."

# Install npm dependencies
cd "$APP_DIR/backend"
su -s /bin/bash -c "cd '$APP_DIR/backend' && npm install --silent --no-audit --no-fund" "$APP_USER"

# Build frontend
cd "$APP_DIR/frontend"
su -s /bin/bash -c "cd '$APP_DIR/frontend' && npm install --silent --no-audit --no-fund && npm run build --silent" "$APP_USER"

# Copy frontend build to backend
rm -rf "$APP_DIR/backend/frontend-dist"
cp -r "$APP_DIR/frontend/dist" "$APP_DIR/backend/frontend-dist"

print_success "Dependencies installed and frontend built"

print_step "7/7" "Setting up service..."

# Create systemd service file
cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Controle Financeiro
After=network.target postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/backend/.env
ExecStart=$(which node) $APP_DIR/backend/src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Reload and enable
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1

# Start service
systemctl restart "$SERVICE_NAME"

# Wait for service to start
sleep 3

# Check status
if systemctl is-active --quiet "$SERVICE_NAME"; then
  print_success "Service started successfully"
else
  print_error "Service failed to start"
  echo ""
  echo "=== Service Logs ==="
  journalctl -u "$SERVICE_NAME" --no-pager -n 50
  exit 1
fi

###############################################
# FINALIZE
###############################################

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║   INSTALLATION COMPLETED SUCCESSFULLY!   ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""

# Create credentials file
cat > "$APP_DIR/credentials.txt" <<EOF
╔══════════════════════════════════════╗
║  Controle Financeiro - CREDENTIALS        ║
║  Generated: $(date '+%Y-%m-%d %H:%M:%S')       ║
╚══════════════════════════════════════╝

╔══════════════════════════════════════╗
║  ACCESS URLs                              ║
╚══════════════════════════════════════╝
Admin Panel:  http://$SERVER_IP:$APP_PORT/admin
User Panel:   http://$SERVER_IP:$APP_PORT/

╔══════════════════════════════════════╗
║  ADMINISTRATOR ACCOUNT                   ║
╚══════════════════════════════════════╝
Email:        $MASTER_EMAIL
Username:     $MASTER_USERNAME
Password:     $MASTER_PASSWORD

╔══════════════════════════════════════╗
║  DATABASE CREDENTIALS                    ║
╚══════════════════════════════════════╝
Host:         127.0.0.1
Port:         5432
Database:     $DB_NAME
User:         $DB_USER
Password:     $DB_PASS

╔══════════════════════════════════════╗
║  MANAGEMENT COMMANDS                     ║
╚══════════════════════════════════════╝
View logs:    journalctl -u $SERVICE_NAME -f
Restart app:  systemctl restart $SERVICE_NAME
Stop app:     systemctl stop $SERVICE_NAME
Check status: systemctl status $SERVICE_NAME

╔══════════════════════════════════════╗
║  CONFIGURATION FILES                     ║
╚══════════════════════════════════════╝
Application:  $APP_DIR/backend/.env
Service file: /etc/systemd/system/$SERVICE_NAME.service
Credentials:   $APP_DIR/credentials.txt

╔══════════════════════════════════════╗
║  NEXT STEPS                             ║
╚══════════════════════════════════════╝
1. Access the application using the URLs above
2. Login with the administrator credentials
3. Change the master password immediately
4. Configure SMTP for email features (optional)
5. Start managing your finances!

╔══════════════════════════════════════╗
║  SECURITY NOTES                           ║
╚══════════════════════════════════════╝
⚠  IMPORTANT: Keep credentials.txt secure
⚠  IMPORTANT: Change admin password ASAP
⚠  IMPORTANT: Backup database regularly
⚠  IMPORTANT: Configure firewall properly

For support: https://github.com/rafaelfmuniz/app-financeiro/issues
EOF

chmod 600 "$APP_DIR/credentials.txt"
chown "$APP_USER:$APP_USER" "$APP_DIR/credentials.txt"

echo -e "${CYAN}📋 Credentials saved to:${NC} $APP_DIR/credentials.txt"
echo ""
echo -e "${BOLD}${BLUE}═════════════════════════════════════════${NC}"
echo -e "${BOLD}${BLUE}   Ready to use! Open your browser now.   ${NC}"
echo -e "${BOLD}${BLUE}═════════════════════════════════════════${NC}"
echo ""
