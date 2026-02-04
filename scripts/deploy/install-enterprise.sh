#!/usr/bin/env bash
#
# Controle Financeiro - Enterprise All-in-One Installer
# Version: 1.1.0
# Compatible with: Ubuntu 20.04+, Debian 11+
#

set -euo pipefail

###############################################
# CONFIGURATION
###############################################

SCRIPT_VERSION="1.1.0"
APP_NAME="Controle Financeiro"
APP_USER=${APP_USER:-finance}
APP_DIR=${APP_DIR:-/opt/controle-financeiro}
SERVICE_NAME=${SERVICE_NAME:-controle-financeiro}
APP_PORT=${APP_PORT:-3000}
NODE_MAJOR=${NODE_MAJOR:-20}
BACKUP_DIR=${APP_DIR}/backups

COLOR_RED='\033[0;31m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_BLUE='\033[0;34m'
COLOR_CYAN='\033[0;36m'
COLOR_RESET='\033[0m'
COLOR_BOLD='\033[1m'

###############################################
# UTILITIES
###############################################

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
  SUDO_E="sudo -E"
else
  SUDO=""
  SUDO_E=""
fi

print_header() {
  echo -e "${COLOR_BOLD}${COLOR_BLUE}==========================================${COLOR_RESET}"
  echo -e "${COLOR_BOLD}${COLOR_BLUE}  $APP_NAME - Enterprise Installer${COLOR_RESET}"
  echo -e "${COLOR_BOLD}${COLOR_BLUE}  Version: $SCRIPT_VERSION${COLOR_RESET}"
  echo -e "${COLOR_BOLD}${COLOR_BLUE}==========================================${COLOR_RESET}"
  echo ""
}

print_success() {
  echo -e "${COLOR_GREEN}✓ $1${COLOR_RESET}"
}

print_error() {
  echo -e "${COLOR_RED}✗ $1${COLOR_RESET}"
}

print_warning() {
  echo -e "${COLOR_YELLOW}⚠ $1${COLOR_RESET}"
}

print_info() {
  echo -e "${COLOR_CYAN}ℹ $1${COLOR_RESET}"
}

confirm() {
  local prompt="$1"
  local default="${2:-n}"
  local response
  
  if [ "$default" = "y" ]; then
    prompt="$prompt [Y/n]"
  else
    prompt="$prompt [y/N]"
  fi
  
  read -p "$(echo -e ${COLOR_CYAN}$prompt${COLOR_RESET}) " response
  response=$(echo "$response" | tr '[:upper:]' '[:lower:]')
  
  if [ -z "$response" ]; then
    response="$default"
  fi
  
  [ "$response" = "y" ]
}

prompt_input() {
  local prompt="$1"
  local default="${2:-}"
  local response
  
  if [ -n "$default" ]; then
    read -p "$(echo -e ${COLOR_CYAN}$prompt [$default]${COLOR_RESET}) " response
    echo "${response:-$default}"
  else
    read -p "$(echo -e ${COLOR_CYAN}$prompt${COLOR_RESET}) " response
    echo "$response"
  fi
}

prompt_password() {
  local prompt="$1"
  local response
  
  while true; do
    read -s -p "$(echo -e ${COLOR_CYAN}$prompt${COLOR_RESET})" response
    echo ""
    read -s -p "$(echo -e ${COLOR_CYAN}Confirm password: ${COLOR_RESET})" response2
    echo ""
    
    if [ "$response" = "$response2" ]; then
      echo "$response"
      break
    else
      print_error "Passwords do not match. Please try again."
    fi
  done
}

check_command() {
  command -v "$1" >/dev/null 2>&1
}

###############################################
# INSTALLATION STEPS
###############################################

install_dependencies() {
  print_info "Installing system dependencies..."
  
  $SUDO apt-get update -y
  
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y \
    curl \
    wget \
    gnupg \
    lsb-release \
    ca-certificates \
    git \
    build-essential \
    python3
  
  print_success "System dependencies installed"
}

install_postgresql() {
  print_info "Checking PostgreSQL installation..."
  
  if check_command psql; then
    print_success "PostgreSQL already installed"
    
    PG_VERSION=$(psql --version | head -n1 | grep -oP '\d+\.\d+')
    print_info "PostgreSQL version: $PG_VERSION"
  else
    print_info "Installing PostgreSQL..."
    
    $SUDO apt-get install -y postgresql postgresql-contrib
    
    $SUDO systemctl enable postgresql
    $SUDO systemctl start postgresql
    
    print_success "PostgreSQL installed and started"
  fi
}

install_nodejs() {
  print_info "Checking Node.js installation..."
  
  if check_command node; then
    NODE_VERSION=$(node --version)
    print_success "Node.js already installed: $NODE_VERSION"
    
    MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$MAJOR_VERSION" -lt "$NODE_MAJOR" ]; then
      print_warning "Node.js version $NODE_VERSION is old. Recommended: $NODE_MAJOR.x"
      if confirm "Upgrade to Node.js $NODE_MAJOR.x?" "n"; then
        $SUDO apt-get install -y nodejs npm || {
          print_error "Failed to install Node.js via apt"
          print_info "Trying nodesource repository..."
          curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO_E bash -
          $SUDO apt-get install -y nodejs
        }
        print_success "Node.js upgraded"
      fi
    fi
  else
    print_info "Installing Node.js $NODE_MAJOR.x..."
    
    $SUDO apt-get install -y nodejs npm || {
      print_error "Failed to install Node.js via apt"
      print_info "Trying nodesource repository..."
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO_E bash -
      $SUDO apt-get install -y nodejs
    }
    
    print_success "Node.js $NODE_MAJOR.x installed"
  fi
}

create_user() {
  print_info "Creating system user..."
  
  if id "$APP_USER" >/dev/null 2>&1; then
    print_success "User $APP_USER already exists"
  else
    $SUDO useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
    print_success "User $APP_USER created"
  fi
}

deploy_app() {
  print_info "Deploying application code..."
  
  if [ -d "$APP_DIR/.git" ]; then
    print_info "Updating existing installation..."
    cd "$APP_DIR"
    $SUDO git fetch origin
    $SUDO git reset --hard origin/main
    print_success "Application code updated"
  else
    print_info "Cloning repository..."
    $SUDO mkdir -p "$APP_DIR"
    $SUDO git clone https://github.com/rafaelfmuniz/app-financeiro.git "$APP_DIR"
    print_success "Application code cloned"
  fi
  
  $SUDO chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
}

configure_database() {
  print_info "Configuring database..."
  
  # Ask for database credentials
  print_info ""
  echo -e "${COLOR_BOLD}${COLOR_CYAN}Database Configuration${COLOR_RESET}"
  echo "----------------------------------------"
  
  local db_name
  local db_user
  local db_pass
  
  if [ -f "$APP_DIR/backend/.env" ]; then
    # Read existing values
    db_name=$(grep "^DB_NAME=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    db_user=$(grep "^DB_USER=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    db_pass=$(grep "^DB_PASS=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    
    print_info "Existing configuration found:"
    print_info "  Database: $db_name"
    print_info "  User: $db_user"
    print_info "  Password: ********"
    echo ""
    
    if ! confirm "Use existing database configuration?" "y"; then
      db_name=$(prompt_input "Database name" "finance_db")
      db_user=$(prompt_input "Database user" "finance_user")
      db_pass=$(prompt_password "Database password")
    fi
  else
    db_name=$(prompt_input "Database name" "finance_db")
    db_user=$(prompt_input "Database user" "finance_user")
    db_pass=$(prompt_password "Database password")
  fi
  
  # Create database and user
  print_info "Creating PostgreSQL user and database..."
  
  local user_lit=$(printf "%s" "$db_user" | sed "s/'/''/g")
  local db_lit=$(printf "%s" "$db_name" | sed "s/'/''/g")
  local pass_lit=$(printf "%s" "$db_pass" | sed "s/'/''/g")
  local user_ident=$(printf "%s" "$db_user" | sed 's/"/\\"/g')
  local db_ident=$(printf "%s" "$db_name" | sed 's/"/\\"/g')
  
  # Create user if not exists
  if [ -z "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$user_lit'")" ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF
CREATE ROLE "${user_ident}" LOGIN PASSWORD '${pass_lit}';
EOF
    print_success "PostgreSQL user created"
  else
    sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF
ALTER ROLE "${user_ident}" WITH PASSWORD '${pass_lit}';
EOF
    print_success "PostgreSQL user password updated"
  fi
  
  # Create database if not exists
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
  
  DB_NAME="$db_name"
  DB_USER="$db_user"
  DB_PASS="$db_pass"
}

generate_secrets() {
  JWT_SECRET=$(openssl rand -hex 32)
  JWT_REFRESH_SECRET=$(openssl rand -hex 32)
}

configure_app() {
  print_info "Configuring application..."
  
  # Ask for master user configuration
  print_info ""
  echo -e "${COLOR_BOLD}${COLOR_CYAN}Master Administrator Configuration${COLOR_RESET}"
  echo "----------------------------------------"
  
  local master_email
  local master_password
  local master_name
  local master_username
  local tenant_name
  
  if [ -f "$APP_DIR/backend/.env" ]; then
    master_email=$(grep "^MASTER_EMAIL=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    master_name=$(grep "^MASTER_NAME=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    master_username=$(grep "^MASTER_USERNAME=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    tenant_name=$(grep "^DEFAULT_TENANT_NAME=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    
    print_info "Existing master user found: $master_email"
    
    if ! confirm "Use existing master user configuration?" "y"; then
      master_email=$(prompt_input "Master email" "admin@example.com")
      master_password=$(prompt_password "Master password")
      master_name=$(prompt_input "Master name" "Administrator")
      master_username=$(prompt_input "Master username" "admin")
      tenant_name=$(prompt_input "Default tenant name" "Principal")
    fi
  else
    master_email=$(prompt_input "Master email" "admin@example.com")
    master_password=$(prompt_password "Master password")
    master_name=$(prompt_input "Master name" "Administrator")
    master_username=$(prompt_input "Master username" "admin")
    tenant_name=$(prompt_input "Default tenant name" "Principal")
  fi
  
  MASTER_EMAIL="$master_email"
  MASTER_PASSWORD="$master_password"
  MASTER_NAME="$master_name"
  MASTER_USERNAME="$master_username"
  DEFAULT_TENANT_NAME="$tenant_name"
  
  # Generate secrets
  generate_secrets
  
  # Get server IP
  local server_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  server_ip="${server_ip:-$(hostname)}"
  
  # Create .env file
  print_info "Creating .env configuration file..."
  
  $SUDO mkdir -p "$APP_DIR/backend"
  $SUDO tee "$APP_DIR/backend/.env" >/dev/null <<EOF
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
APP_BASE_URL=http://$server_ip:$APP_PORT
EOF
  
  $SUDO chown "$APP_USER":"$APP_USER" "$APP_DIR/backend/.env"
  $SUDO chmod 600 "$APP_DIR/backend/.env"
  
  print_success "Application configuration created"
}

run_migrations() {
  print_info "Running database migrations..."
  
  # Import SQL directly
  local sql_file="$APP_DIR/backend/src/db.js"
  
  # Create tables using node
  cd "$APP_DIR/backend"
  
  # Use node to initialize database schema
  if $SUDO -u "$APP_USER" node -e "
    const { pool } = require('./src/db');
    (async () => {
      try {
        await require('./src/db').ensureSchema();
        console.log('Database schema created successfully');
        process.exit(0);
      } catch (err) {
        console.error('Database schema creation failed:', err);
        process.exit(1);
      }
    })();
  "; then
    print_success "Database migrations completed"
  else
    print_error "Database migrations failed"
    exit 1
  fi
}

install_npm_dependencies() {
  print_info "Installing npm dependencies..."
  
  cd "$APP_DIR/backend"
  $SUDO -u "$APP_USER" npm install --omit=dev --silent
  
  print_success "Backend dependencies installed"
  
  # Build frontend
  print_info "Building frontend..."
  cd "$APP_DIR/frontend"
  $SUDO -u "$APP_USER" npm install --silent
  $SUDO -u "$APP_USER" npm run build --silent
  
  print_success "Frontend built successfully"
}

configure_systemd() {
  print_info "Configuring systemd service..."
  
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"
  local node_path=$(command -v node || true)
  
  if [ -z "$node_path" ]; then
    print_error "Node.js not found"
    exit 1
  fi
  
  $SUDO tee "$service_file" >/dev/null <<EOF
[Unit]
Description=$APP_NAME
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
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
  
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable "$SERVICE_NAME"
  
  print_success "Systemd service configured"
}

start_service() {
  print_info "Starting application service..."
  
  $SUDO systemctl restart "$SERVICE_NAME"
  
  sleep 3
  
  if $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
    print_success "Application started successfully"
  else
    print_error "Failed to start application"
    echo ""
    print_info "Checking service logs..."
    $SUDO journalctl -u "$SERVICE_NAME" --no-pager -n 50
    exit 1
  fi
}

verify_installation() {
  print_info "Verifying installation..."
  
  # Check service
  if ! $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
    print_error "Service is not running"
    exit 1
  fi
  print_success "Service is running"
  
  # Check port
  if ! $SUDO ss -ltnp 2>/dev/null | grep -q ":$APP_PORT"; then
    print_warning "Port $APP_PORT is not listening"
  else
    print_success "Port $APP_PORT is listening"
  fi
  
  # Check HTTP
  if curl -fsS "http://127.0.0.1:$APP_PORT/" >/dev/null 2>&1; then
    print_success "Application is responding"
  else
    print_warning "Application is not responding on HTTP"
  fi
}

display_credentials() {
  local server_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  server_ip="${server_ip:-$(hostname)}"
  
  print_info ""
  echo -e "${COLOR_BOLD}${COLOR_GREEN}==========================================${COLOR_RESET}"
  echo -e "${COLOR_BOLD}${COLOR_GREEN}  Installation Complete!${COLOR_RESET}"
  echo -e "${COLOR_BOLD}${COLOR_GREEN}==========================================${COLOR_RESET}"
  echo ""
  echo -e "${COLOR_BOLD}${COLOR_CYAN}Access URLs:${COLOR_RESET}"
  echo -e "  ${COLOR_CYAN}Admin Panel:${COLOR_RESET} http://$server_ip:$APP_PORT/admin"
  echo -e "  ${COLOR_CYAN}User Panel:${COLOR_RESET}  http://$server_ip:$APP_PORT/"
  echo ""
  echo -e "${COLOR_BOLD}${COLOR_CYAN}Master Administrator:${COLOR_RESET}"
  echo -e "  ${COLOR_CYAN}Email:${COLOR_RESET}    $MASTER_EMAIL"
  echo -e "  ${COLOR_CYAN}Username:${COLOR_RESET} $MASTER_USERNAME"
  echo -e "  ${COLOR_CYAN}Password:${COLOR_RESET} $MASTER_PASSWORD"
  echo ""
  echo -e "${COLOR_YELLOW}⚠ IMPORTANT:${COLOR_RESET}"
  echo -e "  ${COLOR_YELLOW}•${COLOR_RESET} Save these credentials securely"
  echo -e "  ${COLOR_YELLOW}•${COLOR_RESET} Change the password after first login"
  echo -e "  ${COLOR_YELLOW}•${COLOR_RESET} Configure SMTP in admin panel for email features"
  echo ""
  
  # Save credentials to file
  $SUDO tee "$APP_DIR/credentials.txt" >/dev/null <<EOF
$APP_NAME - Installation Credentials
====================================
Generated: $(date)

Access URLs
-----------
Admin Panel: http://$server_ip:$APP_PORT/admin
User Panel:  http://$server_ip:$APP_PORT/

Master Administrator
------------------
Email:    $MASTER_EMAIL
Username: $MASTER_USERNAME
Password: $MASTER_PASSWORD

Database
--------
Host:     127.0.0.1
Port:     5432
Name:     $DB_NAME
User:     $DB_USER
Password: $DB_PASS

Configuration Files
------------------
.env:      $APP_DIR/backend/.env
Service:   /etc/systemd/system/$SERVICE_NAME.service

Logs
----
View:     sudo journalctl -u $SERVICE_NAME -f
Status:   sudo systemctl status $SERVICE_NAME

Backup Directory
-----------------
$BACKUP_DIR
EOF
  
  $SUDO chown "$APP_USER":"$APP_USER" "$APP_DIR/credentials.txt"
  $SUDO chmod 600 "$APP_DIR/credentials.txt"
  
  print_info "Credentials saved to: $APP_DIR/credentials.txt"
  print_info "View logs with: sudo journalctl -u $SERVICE_NAME -f"
  print_info "Manage service: sudo systemctl $SERVICE_NAME {start|stop|restart|status}"
}

###############################################
# MAIN INSTALLATION FLOW
###############################################

main() {
  print_header
  
  # Check if running as root
  if [ "$(id -u)" -ne 0 ]; then
    print_error "This script must be run as root (use sudo)"
    print_info "Run: sudo bash $0"
    exit 1
  fi
  
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
    if ! confirm "Continue anyway?" "n"; then
      exit 1
    fi
  fi
  
  print_info "Starting installation..."
  print_info ""
  
  # Installation steps
  install_dependencies
  install_postgresql
  install_nodejs
  create_user
  
  print_info ""
  echo -e "${COLOR_BOLD}${COLOR_CYAN}=== Configuration ===${COLOR_RESET}"
  echo ""
  
  deploy_app
  configure_database
  configure_app
  run_migrations
  
  print_info ""
  echo -e "${COLOR_BOLD}${COLOR_CYAN}=== Application Setup ===${COLOR_RESET}"
  echo ""
  
  install_npm_dependencies
  configure_systemd
  start_service
  
  print_info ""
  echo -e "${COLOR_BOLD}${COLOR_CYAN}=== Verification ===${COLOR_RESET}"
  echo ""
  
  verify_installation
  display_credentials
  
  echo ""
  echo -e "${COLOR_BOLD}${COLOR_GREEN}Installation completed successfully!${COLOR_RESET}"
  echo ""
}

main "$@"
