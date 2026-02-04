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
  echo "╔════════════════════════════════════╗"
  echo "║  Controle Financeiro Installer          ║"
  echo "║  Version: $APP_VERSION                      ║"
  echo "╚════════════════════════════════════╝"
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

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
  echo -e "${CYAN}ℹ${NC} $1"
}

check_cmd() {
  command -v "$1" >/dev/null 2>&1
}

check_existing_installation() {
  print_step "CHECK" "Checking for existing installation..."
  
  if [ -d "$APP_DIR/.git" ]; then
    # Get current version
    cd "$APP_DIR"
    if git rev-parse --git-dir >/dev/null 2>&1; then
      CURRENT_COMMIT=$(git rev-parse HEAD)
      CURRENT_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "unknown")
    else
      CURRENT_TAG="unknown"
    fi
    
    # Check if service is running
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
      SERVICE_RUNNING=true
    else
      SERVICE_RUNNING=false
    fi
    
    echo ""
    echo -e "${BOLD}${BLUE}╔════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${BLUE}║  EXISTING INSTALLATION DETECTED!       ║${NC}"
    echo -e "${BOLD}${BLUE}╚════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}Current Version:${NC} $CURRENT_TAG"
    echo -e "${CYAN}Current Commit:${NC} ${CURRENT_COMMIT:0:8}"
    echo -e "${CYAN}Installation Dir:${NC} $APP_DIR"
    echo -e "${CYAN}Service Status:${NC} $( [ "$SERVICE_RUNNING" = true ] && echo "${GREEN}Running${NC}" || echo "${YELLOW}Stopped${NC}" )"
    echo ""
    return 0
  fi
  
  return 1
}

get_remote_version() {
  print_step "INFO" "Fetching latest version from GitHub..."
  
  LATEST_TAG=$(curl -s https://api.github.com/repos/rafaelfmuniz/app-financeiro/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
  
  if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG="v1.1.0"
  fi
  
  echo -e "${CYAN}Latest Version:${NC} $LATEST_TAG"
}

confirm_update() {
  echo ""
  print_warning "A NEW VERSION is available!"
  echo -e "${CYAN}  Installed: $CURRENT_TAG${NC}"
  echo -e "${CYAN}  Available: $LATEST_TAG${NC}"
  echo ""
  echo -e "${YELLOW}Do you want to update to $LATEST_TAG?${NC}"
  echo -e "${YELLOW}Options:${NC}"
  echo "  1) ${GREEN}YES${NC} - Update to latest version"
  echo "  2) ${RED}NO${NC}  - Keep current version and reconfigure"
  echo "  3) ${RED}CANCEL${NC}  - Exit installer"
  echo ""
  
  read -p "Enter your choice [1-3]: " choice
  
  case "$choice" in
    1) return 0 ;; # Yes, update
    2) return 1 ;; # No, reconfigure
    3) return 2 ;; # Cancel
    *) echo -e "${RED}Invalid choice${NC}"; exit 1 ;;
  esac
}

confirm_install() {
  echo ""
  print_warning "This will INSTALL a fresh version of Controle Financeiro"
  echo -e "${RED}ALL DATA IN $APP_DIR WILL BE DELETED!${NC}"
  echo ""
  echo -e "${YELLOW}Do you want to continue with installation?${NC}"
  echo "  1) ${GREEN}YES${NC} - Install fresh version"
  echo "  2) ${RED}NO${NC}  - Cancel"
  echo ""
  
  read -p "Enter your choice [1-2]: " choice
  
  case "$choice" in
    1) return 0 ;; # Yes, install
    2) return 1 ;; # No
    *) echo -e "${RED}Invalid choice${NC}"; exit 1 ;;
  esac
}

backup_existing_installation() {
  print_step "BACKUP" "Creating backup of existing installation..."
  
  mkdir -p "$BACKUP_DIR"
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  
  # Backup database
  if [ -f "$APP_DIR/backend/.env" ]; then
    DB_HOST=$(grep "^DB_HOST=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_PORT=$(grep "^DB_PORT=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_NAME=$(grep "^DB_NAME=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_USER=$(grep "^DB_USER=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_PASS=$(grep "^DB_PASS=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    
    if [ -n "$DB_NAME" ]; then
      print_info "Backing up database..."
      PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_DIR/db-backup-$TIMESTAMP.sql" 2>/dev/null
      
      if [ -f "$BACKUP_DIR/db-backup-$TIMESTAMP.sql" ]; then
        print_success "Database backed up to $BACKUP_DIR/db-backup-$TIMESTAMP.sql"
      else
        print_error "Database backup failed"
        exit 1
      fi
    fi
  fi
  
  # Backup configuration
  cp "$APP_DIR/backend/.env" "$BACKUP_DIR/env-backup-$TIMESTAMP" 2>/dev/null
  print_success "Configuration backed up to $BACKUP_DIR/env-backup-$TIMESTAMP"
  
  # Backup current commit
  cd "$APP_DIR"
  git rev-parse HEAD > "$BACKUP_DIR/git-commit-$TIMESTAMP.txt" 2>/dev/null
  print_success "Git commit saved: $(cat "$BACKUP_DIR/git-commit-$TIMESTAMP.txt")"
  
  echo ""
  echo -e "${GREEN}Backup completed successfully!${NC}"
}

install_dependencies() {
  print_step "1/8" "Installing system dependencies..."
  
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  
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
}

install_postgresql() {
  print_step "2/8" "Setting up PostgreSQL..."
  
  if check_cmd psql; then
    PG_VERSION=$(psql --version | head -n1 | grep -oP '\d+\.\d+')
    print_success "PostgreSQL already installed: $PG_VERSION"
  else
    print_info "Installing PostgreSQL..."
    apt-get install -y -qq postgresql postgresql-contrib
    systemctl enable postgresql
    systemctl start postgresql
    print_success "PostgreSQL installed and started"
  fi
}

install_nodejs() {
  print_step "3/8" "Setting up Node.js..."
  
  if check_cmd node; then
    NODE_VERSION=$(node --version)
    print_success "Node.js already installed: $NODE_VERSION"
    
    MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$MAJOR_VERSION" -lt "$NODE_MAJOR" ]; then
      print_warning "Node.js version $NODE_VERSION is old. Upgrading..."
      apt-get install -y -qq nodejs npm
      print_success "Node.js upgraded to $NODE_MAJOR.x"
    fi
  else
    print_info "Installing Node.js $NODE_MAJOR.x..."
    apt-get install -y -qq nodejs npm || {
      print_error "Failed to install Node.js via apt"
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash
      apt-get install -y -qq nodejs
    }
    print_success "Node.js $NODE_MAJOR.x installed"
  fi
}

create_user() {
  print_step "4/8" "Creating system user..."
  
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
    print_success "System user created"
  else
    print_success "System user already exists"
  fi
}

setup_database() {
  print_step "5/8" "Setting up database..."
  
  # Auto-generate database credentials
  DB_NAME="finance_db"
  DB_USER="finance_user"
  DB_PASS=$(openssl rand -base64 18 | tr -d '\n=+/')
  
  # Create PostgreSQL user
  user_lit=$(printf "%s" "$DB_USER" | sed "s/'/''/g")
  pass_lit=$(printf "%s" "$DB_PASS" | sed "s/'/''/g")
  user_ident=$(printf "%s" "$DB_USER" | sed 's/"/\\"/g')
  
  if [ -z "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$user_lit'")" ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF
CREATE ROLE "${user_ident}" LOGIN PASSWORD '${pass_lit}';
EOF
    print_success "PostgreSQL user created"
  else
    # Update password
    sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF
ALTER ROLE "${user_ident}" WITH PASSWORD '${pass_lit}';
EOF
    print_success "PostgreSQL user password updated"
  fi
  
  # Create database
  db_lit=$(printf "%s" "$DB_NAME" | sed "s/'/''/g")
  db_ident=$(printf "%s" "$DB_NAME" | sed 's/"/\\"/g')
  
  if [ -z "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$db_lit'")" ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF
CREATE DATABASE "${db_ident}" OWNER "${user_ident}";
EOF
    print_success "PostgreSQL database created"
  else
    print_success "Database already exists"
  fi
  
  # Grant privileges
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF
GRANT ALL PRIVILEGES ON DATABASE "${db_ident}" TO "${user_ident}";
EOF
  print_success "Database privileges granted"
}

deploy_app() {
  print_step "6/8" "Deploying application..."
  
  mkdir -p "$APP_DIR"
  
  # Clone or update
  if [ -d "$APP_DIR/.git" ]; then
    print_info "Updating existing code..."
    cd "$APP_DIR"
    git fetch origin >/dev/null 2>&1
    git reset --hard origin/main >/dev/null 2>&1
    print_success "Application code updated"
  else
    print_info "Cloning repository..."
    rm -rf "$APP_DIR"
    git clone --depth 1 https://github.com/rafaelfmuniz/app-financeiro.git "$APP_DIR" >/dev/null 2>&1
    print_success "Application code cloned"
  fi
  
  # Set ownership
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
}

configure_app() {
  print_step "7/8" "Configuring application..."
  
  # Auto-generate all credentials
  MASTER_EMAIL="admin@controle-financeiro.local"
  MASTER_PASSWORD=$(openssl rand -base64 18 | tr -d '\n=+/')
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
}

run_migrations() {
  print_step "8/8" "Running database migrations..."
  
  # Check if we need to create refresh_tokens table
  if su -s /bin/bash -c "cd '$APP_DIR/backend' && node -e \"const { pool } = require('./src/db'); (async () => { const tables = await pool.query('SELECT tablename FROM pg_tables WHERE schemaname = '\\\"public\\\"'); const hasRefreshTokens = tables.rows.some(t => t.tablename === 'refresh_tokens'); console.log(hasRefreshTokens ? 'refresh_tokens exists' : 'creating refresh_tokens'); process.exit(hasRefreshTokens ? 1 : 0); })();\" $APP_USER"; then
    print_success "Database schema verified"
  else
    print_info "Creating database schema..."
    su -s /bin/bash -c "cd '$APP_DIR/backend' && node -e \"require('./src/db').ensureSchema()\" $APP_USER"
    print_success "Database schema created"
  fi
}

install_npm_dependencies() {
  print_step "INSTALL/9" "Installing dependencies and building..."
  
  # Install npm dependencies
  cd "$APP_DIR/backend"
  su -s /bin/bash -c "cd '$APP_DIR/backend' && npm install --silent --no-audit --no-fund" "$APP_USER"
  print_success "Backend dependencies installed"
  
  # Build frontend
  cd "$APP_DIR/frontend"
  su -s /bin/bash -c "cd '$APP_DIR/frontend' && npm install --silent --no-audit --no-fund && npm run build --silent" "$APP_USER"
  print_success "Frontend built successfully"
  
  # Copy frontend build to backend
  rm -rf "$APP_DIR/backend/frontend-dist"
  cp -r "$APP_DIR/frontend/dist" "$APP_DIR/backend/frontend-dist"
}

configure_systemd() {
  print_step "INSTALL/10" "Configuring systemd service..."
  
  local service_file="/etc/systemd/system/$SERVICE_NAME.service"
  local node_path=$(which node)
  
  if [ -z "$node_path" ]; then
    print_error "Node.js not found"
    exit 1
  fi
  
  cat > "$service_file" <<EOF
[Unit]
Description=Controle Financeiro
After=network.target postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/backend/.env
ExecStart=$node_path $APP_DIR/backend/src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
  print_success "Systemd service configured"
}

start_service() {
  print_step "INSTALL/11" "Starting service..."
  
  systemctl restart "$SERVICE_NAME"
  
  # Wait for service to start
  sleep 3
  
  # Check status
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    print_success "Service started successfully"
  else
    print_error "Service failed to start"
    echo ""
    print_info "Checking service logs..."
    journalctl -u "$SERVICE_NAME" --no-pager -n 50
    exit 1
  fi
}

verify_installation() {
  print_step "INSTALL/12" "Verifying installation..."
  
  # Check service
  if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    print_error "Service is not running"
    exit 1
  fi
  print_success "Service is running"
  
  # Check port
  if ! ss -ltnp 2>/dev/null | grep -q ":$APP_PORT"; then
    print_warning "Port $APP_PORT is not listening"
  else
    print_success "Port $APP_PORT is listening"
  fi
  
  # Check HTTP
  sleep 2
  if curl -fsS "http://127.0.0.1:$APP_PORT/" >/dev/null 2>&1; then
    print_success "Application is responding"
  else
    print_warning "Application is not responding on HTTP"
  fi
}

display_credentials() {
  local server_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  server_ip="${server_ip:-$(hostname)}"
  
  echo ""
  echo -e "${BOLD}${GREEN}╔════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${GREEN}║   INSTALLATION COMPLETED!             ║${NC}"
  echo -e "${BOLD}${GREEN}╚════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  ACCESS URLs                             ║${NC}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════╝${NC}"
  echo -e "  ${CYAN}Admin Panel:${NC} http://$server_ip:$APP_PORT/admin"
  echo -e "  ${CYAN}User Panel:${NC}  http://$server_ip:$APP_PORT/"
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  ADMINISTRATOR ACCOUNT                   ║${NC}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════╝${NC}"
  echo -e "  ${CYAN}Email:${NC}        $MASTER_EMAIL"
  echo -e "  ${CYAN}Username:${NC}     $MASTER_USERNAME"
  echo -e "  ${CYAN}Password:${NC}     $MASTER_PASSWORD"
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  DATABASE CREDENTIALS                    ║${NC}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════╝${NC}"
  echo -e "  ${CYAN}Host:${NC}         127.0.0.1"
  echo -e "  ${CYAN}Port:${NC}         5432"
  echo -e "  ${CYAN}Database:${NC}     $DB_NAME"
  echo -e "  ${CYAN}User:${NC}         $DB_USER"
  echo -e "  ${CYAN}Password:${NC}     $DB_PASS"
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  MANAGEMENT COMMANDS                     ║${NC}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════╝${NC}"
  echo -e "  ${CYAN}View logs:${NC}    journalctl -u $SERVICE_NAME -f"
  echo -e "  ${CYAN}Restart app:${NC}  systemctl restart $SERVICE_NAME"
  echo -e "  ${CYAN}Stop app:${NC}     systemctl stop $SERVICE_NAME"
  echo -e "  ${CYAN}Check status:${NC} systemctl status $SERVICE_NAME"
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  CONFIGURATION FILES                     ║${NC}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════╝${NC}"
  echo -e "  ${CYAN}Application:${NC}  $APP_DIR/backend/.env"
  echo -e "  ${CYAN}Service file:${NC}  /etc/systemd/system/$SERVICE_NAME.service"
  echo -e "  ${CYAN}Credentials:${NC}   $APP_DIR/credentials.txt"
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  BACKUP DIRECTORY                       ║${NC}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════╝${NC}"
  echo -e "  ${CYAN}Backups stored in:${NC} $BACKUP_DIR"
  echo ""
  echo -e "${YELLOW}⚠ IMPORTANT:${NC} Backup files created in $BACKUP_DIR"
  echo ""
  
  # Save credentials to file
  cat > "$APP_DIR/credentials.txt" <<EOF
╔══════════════════════════════════════╗
║  Controle Financeiro - CREDENTIALS        ║
║  Generated: $(date '+%Y-%m-%d %H:%M:%S')       ║
╚══════════════════════════════════════╝

╔════════════════════════════════════╗
║  ACCESS URLs                              ║
╚══════════════════════════════════════╝
Admin Panel:  http://$server_ip:$APP_PORT/admin
User Panel:   http://$server_ip:$APP_PORT/

╔════════════════════════════════════╗
║  ADMINISTRATOR ACCOUNT                   ║
╚════════════════════════════════════╝
Email:        $MASTER_EMAIL
Username:     $MASTER_USERNAME
Password:     $MASTER_PASSWORD

╔════════════════════════════════════╗
║  DATABASE CREDENTIALS                    ║
╚════════════════════════════════════╝
Host:         127.0.0.1
Port:         5432
Database:     $DB_NAME
User:         $DB_USER
Password:     $DB_PASS

╔════════════════════════════════════╗
║  MANAGEMENT COMMANDS                     ║
╚════════════════════════════════════╝
View logs:    journalctl -u $SERVICE_NAME -f
Restart app:  systemctl restart $SERVICE_NAME
Stop app:     systemctl stop $SERVICE_NAME
Check status: systemctl status $SERVICE_NAME

╔════════════════════════════════════╗
║  CONFIGURATION FILES                     ║
╚══════════════════════════════════════╝
Application:  $APP_DIR/backend/.env
Service file: /etc/systemd/system/$SERVICE_NAME.service
Credentials:   $APP_DIR/credentials.txt

╔══════════════════════════════════════╗
║  BACKUP DIRECTORY                       ║
╚════════════════════════════════════════╝
Backups stored in: $BACKUP_DIR
EOF
  
  chmod 600 "$APP_DIR/credentials.txt"
  chown "$APP_USER:$APP_USER" "$APP_DIR/credentials.txt"
  
  echo -e "${CYAN}📋 Credentials saved to:${NC} $APP_DIR/credentials.txt"
  echo ""
  echo -e "${BOLD}${BLUE}╔════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║   READY TO USE! Open your browser now.   ║${NC}"
  echo -e "${BOLD}${BLUE}╚════════════════════════════════════╝${NC}"
  echo ""
}

###############################################
# MAIN INSTALLATION FLOW
###############################################

main() {
  print_header
  
  # Check OS
  print_info "Checking operating system..."
  if [ ! -f /etc/os-release ]; then
    print_error "Unsupported operating system"
    exit 1
  fi
  
  source /etc/os-release
  print_success "OS: $PRETTY_NAME"
  
  if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    print_warning "This installer is tested on Ubuntu and Debian"
    print_warning "Other distributions may require manual adjustments"
  fi
  
  # Check for existing installation
  check_existing_installation
  EXISTING=$?
  
  if [ "$EXISTING" -eq 0 ]; then
    # Existing installation found
    get_remote_version
    confirm_update
    CHOICE=$?
    
    if [ "$CHOICE" -eq 0 ]; then
      # User wants to update
      backup_existing_installation
      echo ""
      print_warning "Continuing with update..."
    elif [ "$CHOICE" -eq 1 ]; then
      # User wants to reconfigure
      echo ""
      print_info "Reconfiguring existing installation..."
      print_success "Installation skipped (keeping existing code)"
      return 0
    elif [ "$CHOICE" -eq 2 ]; then
      # User cancelled
      print_info "Installation cancelled by user"
      exit 0
    fi
  else
    # No existing installation
    print_info "No existing installation detected"
    echo ""
    print_warning "This will install a FRESH copy of Controle Financeiro"
    print_warning "If you have data to preserve, please BACKUP FIRST!"
    echo ""
    confirm_install
    CHOICE=$?
    
    if [ "$CHOICE" -eq 1 ]; then
      # User confirmed installation
      echo ""
    elif [ "$CHOICE" -eq 2 ]; then
      # User cancelled
      print_info "Installation cancelled by user"
      exit 0
    fi
  fi
  
  # Installation steps
  echo ""
  echo -e "${BOLD}${BLUE}╔════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  STARTING INSTALLATION PROCESS             ║${NC}"
  echo -e "${BOLD}${BLUE}╚════════════════════════════════════╝${NC}"
  echo ""
  
  install_dependencies
  install_postgresql
  install_nodejs
  create_user
  setup_database
  deploy_app
  configure_app
  run_migrations
  install_npm_dependencies
  configure_systemd
  start_service
  
  echo ""
  echo -e "${BOLD}${BLUE}╔════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  VERIFICATION PHASE                     ║${NC}"
  echo -e "${BOLD}${BLUE}╚════════════════════════════════════╝${NC}"
  echo ""
  
  verify_installation
  display_credentials
}

main "$@"
