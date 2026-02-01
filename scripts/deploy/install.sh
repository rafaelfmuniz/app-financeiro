#!/usr/bin/env bash
set -euo pipefail

APP_USER=${APP_USER:-finance}
APP_DIR=${APP_DIR:-/opt/controle-financeiro}
SERVICE_NAME=${SERVICE_NAME:-controle-financeiro}
NODE_MAJOR=${NODE_MAJOR:-20}
NONINTERACTIVE=${NONINTERACTIVE:-1}
APP_PORT=${APP_PORT:-3000}
ALLOW_NODESOURCE=${ALLOW_NODESOURCE:-0}
ENV_FILE=${ENV_FILE:-$APP_DIR/backend/.env}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
  SUDO_E="sudo -E"
else
  SUDO=""
  SUDO_E=""
fi

require_cmd() {
  command -v "$1" >/dev/null 2>&1
}

gen_password() {
  openssl rand -base64 18 | tr -d '\n'
}

run_as_user() {
  local user="$1"
  shift
  if [ "$(id -u)" -eq 0 ]; then
    su -s /bin/bash -c "$(printf "%q " "$@")" "$user"
  else
    sudo -u "$user" "$@"
  fi
}

get_primary_ip() {
  local ip=""
  if command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
  fi
  echo "${ip:-SEU_SERVIDOR}"
}

backup_env_if_exists() {
  if [ -f "$ENV_FILE" ]; then
    ENV_BACKUP="$(mktemp)"
    $SUDO cp "$ENV_FILE" "$ENV_BACKUP"
  else
    ENV_BACKUP=""
  fi
}

restore_env_backup() {
  if [ -n "${ENV_BACKUP:-}" ] && [ -f "$ENV_BACKUP" ]; then
    $SUDO mkdir -p "$(dirname "$ENV_FILE")"
    $SUDO cp "$ENV_BACKUP" "$ENV_FILE"
    $SUDO chown "$APP_USER":"$APP_USER" "$ENV_FILE"
    $SUDO chmod 600 "$ENV_FILE"
  fi
}

install_packages() {
  if [ "$ALLOW_NODESOURCE" != "1" ]; then
    $SUDO rm -f /etc/apt/sources.list.d/nodesource.list /etc/apt/sources.list.d/nodesource.sources >/dev/null 2>&1 || true
  fi
  $SUDO apt-get update -y
  $SUDO apt-get install -y curl ca-certificates gnupg rsync openssl iproute2 git
  if ! require_cmd node; then
    $SUDO apt-get install -y nodejs npm || true
  fi
  if ! require_cmd node && [ "$ALLOW_NODESOURCE" = "1" ]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO_E bash -
    $SUDO apt-get install -y nodejs
  fi
  if ! require_cmd psql; then
    $SUDO apt-get install -y postgresql postgresql-contrib
    $SUDO systemctl enable --now postgresql >/dev/null 2>&1 || true
  fi
}

create_user() {
  if ! id "$APP_USER" >/dev/null 2>&1; then
    $SUDO useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  fi
}

read_env_value() {
  local key="$1"
  local value=""
  if [ -f "$ENV_FILE" ]; then
    value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
  fi
  echo "$value"
}

prompt_env() {
  $SUDO mkdir -p "$(dirname "$ENV_FILE")"

  # Se o .env já existe e não foi solicitado recriar, leia valores para variáveis e reutilize
  if [ -f "$ENV_FILE" ] && [ "${FORCE_RECREATE_ENV:-0}" != "1" ]; then
    DB_NAME=${DB_NAME:-$(read_env_value DB_NAME)}
    DB_USER=${DB_USER:-$(read_env_value DB_USER)}
    DB_PASS=${DB_PASS:-$(read_env_value DB_PASS)}
    MASTER_EMAIL=${MASTER_EMAIL:-$(read_env_value MASTER_EMAIL)}
    MASTER_PASSWORD=${MASTER_PASSWORD:-$(read_env_value MASTER_PASSWORD)}
    MASTER_NAME=${MASTER_NAME:-$(read_env_value MASTER_NAME)}
    MASTER_USERNAME=${MASTER_USERNAME:-$(read_env_value MASTER_USERNAME)}
    DEFAULT_TENANT_NAME=${DEFAULT_TENANT_NAME:-$(read_env_value DEFAULT_TENANT_NAME)}
    JWT_SECRET=${JWT_SECRET:-$(read_env_value JWT_SECRET)}
    SMTP_HOST=${SMTP_HOST:-$(read_env_value SMTP_HOST)}
    SMTP_PORT=${SMTP_PORT:-$(read_env_value SMTP_PORT)}
    SMTP_SECURE=${SMTP_SECURE:-$(read_env_value SMTP_SECURE)}
    SMTP_USER=${SMTP_USER:-$(read_env_value SMTP_USER)}
    SMTP_PASS=${SMTP_PASS:-$(read_env_value SMTP_PASS)}
    SMTP_FROM=${SMTP_FROM:-$(read_env_value SMTP_FROM)}
    SMTP_REPLY_TO=${SMTP_REPLY_TO:-$(read_env_value SMTP_REPLY_TO)}
    APP_BASE_URL=${APP_BASE_URL:-$(read_env_value APP_BASE_URL)}
    echo "Arquivo .env existente encontrado em $ENV_FILE — reutilizando sem sobrescrever."
    return
  fi

  if [ -f "$ENV_FILE" ]; then
    DB_NAME=${DB_NAME:-$(read_env_value DB_NAME)}
    DB_USER=${DB_USER:-$(read_env_value DB_USER)}
    DB_PASS=${DB_PASS:-$(read_env_value DB_PASS)}
    MASTER_EMAIL=${MASTER_EMAIL:-$(read_env_value MASTER_EMAIL)}
    MASTER_PASSWORD=${MASTER_PASSWORD:-$(read_env_value MASTER_PASSWORD)}
    MASTER_NAME=${MASTER_NAME:-$(read_env_value MASTER_NAME)}
    MASTER_USERNAME=${MASTER_USERNAME:-$(read_env_value MASTER_USERNAME)}
    DEFAULT_TENANT_NAME=${DEFAULT_TENANT_NAME:-$(read_env_value DEFAULT_TENANT_NAME)}
    JWT_SECRET=${JWT_SECRET:-$(read_env_value JWT_SECRET)}
    SMTP_HOST=${SMTP_HOST:-$(read_env_value SMTP_HOST)}
    SMTP_PORT=${SMTP_PORT:-$(read_env_value SMTP_PORT)}
    SMTP_SECURE=${SMTP_SECURE:-$(read_env_value SMTP_SECURE)}
    SMTP_USER=${SMTP_USER:-$(read_env_value SMTP_USER)}
    SMTP_PASS=${SMTP_PASS:-$(read_env_value SMTP_PASS)}
    SMTP_FROM=${SMTP_FROM:-$(read_env_value SMTP_FROM)}
    SMTP_REPLY_TO=${SMTP_REPLY_TO:-$(read_env_value SMTP_REPLY_TO)}
    APP_BASE_URL=${APP_BASE_URL:-$(read_env_value APP_BASE_URL)}
  fi

  DB_NAME=${DB_NAME:-finance_db}
  DB_USER=${DB_USER:-finance_user}
  DB_PASS=${DB_PASS:-$(gen_password)}
  MASTER_EMAIL=${MASTER_EMAIL:-admin@example.com}
  MASTER_PASSWORD=${MASTER_PASSWORD:-$(gen_password)}
  MASTER_NAME=${MASTER_NAME:-Admin}
  MASTER_USERNAME=${MASTER_USERNAME:-admin}
  DEFAULT_TENANT_NAME=${DEFAULT_TENANT_NAME:-Principal}

  JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 32)}
  SMTP_HOST=${SMTP_HOST:-}
  SMTP_PORT=${SMTP_PORT:-587}
  SMTP_SECURE=${SMTP_SECURE:-false}
  SMTP_USER=${SMTP_USER:-}
  SMTP_PASS=${SMTP_PASS:-}
  SMTP_FROM=${SMTP_FROM:-}
  SMTP_REPLY_TO=${SMTP_REPLY_TO:-}

  local server_ip
  server_ip="$(get_primary_ip)"
  APP_BASE_URL=${APP_BASE_URL:-http://$server_ip:$APP_PORT}

  $SUDO tee "$ENV_FILE" >/dev/null <<EOF
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=$DB_USER
DB_PASS=$DB_PASS
DB_NAME=$DB_NAME

PORT=$APP_PORT
JWT_SECRET=$JWT_SECRET
DEFAULT_TENANT_NAME=$DEFAULT_TENANT_NAME

MASTER_EMAIL=$MASTER_EMAIL
MASTER_PASSWORD=$MASTER_PASSWORD
MASTER_NAME=$MASTER_NAME
MASTER_USERNAME=$MASTER_USERNAME

SMTP_HOST=$SMTP_HOST
SMTP_PORT=${SMTP_PORT:-587}
SMTP_SECURE=${SMTP_SECURE:-false}
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
SMTP_FROM=$SMTP_FROM
SMTP_REPLY_TO=$SMTP_REPLY_TO
APP_BASE_URL=$APP_BASE_URL
EOF
  $SUDO chown "$APP_USER":"$APP_USER" "$ENV_FILE"
  $SUDO chmod 600 "$ENV_FILE"

  CRED_FILE="$APP_DIR/credentials.txt"
  $SUDO tee "$CRED_FILE" >/dev/null <<EOF
Admin URL: http://$server_ip:$APP_PORT/admin
User URL: http://$server_ip:$APP_PORT/
Master email: $MASTER_EMAIL
Master password: $MASTER_PASSWORD
EOF
  $SUDO chown "$APP_USER":"$APP_USER" "$CRED_FILE"
  $SUDO chmod 600 "$CRED_FILE"
}

setup_db() {
  local user_lit db_lit pass_lit user_ident db_ident
  user_lit=$(printf "%s" "$DB_USER" | sed "s/'/''/g")
  db_lit=$(printf "%s" "$DB_NAME" | sed "s/'/''/g")
  pass_lit=$(printf "%s" "$DB_PASS" | sed "s/'/''/g")
  user_ident=$(printf "%s" "$DB_USER" | sed 's/\"/\"\"/g')
  db_ident=$(printf "%s" "$DB_NAME" | sed 's/\"/\"\"/g')

  if [ -z "$(run_as_user postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$user_lit'")" ]; then
    run_as_user postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE \"${user_ident}\" LOGIN PASSWORD '${pass_lit}'"
  fi
  run_as_user postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE \"${user_ident}\" WITH PASSWORD '${pass_lit}'"

  if [ -z "$(run_as_user postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$db_lit'")" ]; then
    run_as_user postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${db_ident}\" OWNER \"${user_ident}\""
  fi

  run_as_user postgres psql -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE \"${db_ident}\" TO \"${user_ident}\""
}

deploy_app() {
  # Release version to install
  RELEASE_VERSION="${RELEASE_VERSION:-v1.0.0}"
  
  if [ -d "$APP_DIR/.git" ]; then
    echo "Atualizando para release $RELEASE_VERSION..."
    $SUDO bash -c "cd '$APP_DIR' && git fetch origin && git checkout $RELEASE_VERSION"
  else
    echo "Clonando release $RELEASE_VERSION..."
    $SUDO mkdir -p "$APP_DIR"
    $SUDO git clone --branch $RELEASE_VERSION --single-branch https://github.com/rafaelfmuniz/app-financeiro.git "$APP_DIR"
  fi
  $SUDO chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
}

setup_service() {
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  local override_dir="/etc/systemd/system/${SERVICE_NAME}.service.d"
  local node_path
  node_path="$(command -v node || true)"
  if [ -z "$node_path" ]; then
    echo "Erro: node nao encontrado."
    exit 1
  fi
  if [ ! -f "$ENV_FILE" ]; then
    echo "Erro: arquivo .env nao encontrado em $ENV_FILE"
    exit 1
  fi
  if [ ! -f "$APP_DIR/backend/src/server.js" ]; then
    echo "Erro: server.js nao encontrado em $APP_DIR/backend/src/server.js"
    exit 1
  fi
  $SUDO rm -rf "$override_dir"
  $SUDO rm -f "$SERVICE_FILE"

  $SUDO tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Controle Financeiro
After=network.target postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$ENV_FILE
ExecStart=$node_path $APP_DIR/backend/src/server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

   $SUDO systemctl daemon-reload
   $SUDO systemctl enable "$SERVICE_NAME"
}

restart_related_services() {
  echo "Reiniciando serviços relacionados..."
  
  # Reiniciar PostgreSQL se estiver instalado
  if $SUDO systemctl is-enabled postgresql >/dev/null 2>&1; then
    echo "Reiniciando PostgreSQL..."
    $SUDO systemctl restart postgresql
    sleep 2
    if ! $SUDO systemctl is-active --quiet postgresql; then
      echo "Aviso: PostgreSQL não reiniciou corretamente."
    else
      echo "PostgreSQL reiniciado com sucesso."
    fi
  fi
  
  # Reiniciar nginx se estiver instalado (proxy reverso comum)
  if $SUDO systemctl is-enabled nginx >/dev/null 2>&1; then
    echo "Reiniciando nginx..."
    $SUDO systemctl restart nginx
    sleep 1
    if ! $SUDO systemctl is-active --quiet nginx; then
      echo "Aviso: nginx não reiniciou corretamente."
    else
      echo "nginx reiniciado com sucesso."
    fi
  fi
  
  # Sempre reiniciar o serviço principal para aplicar mudanças
  echo "Reiniciando serviço principal $SERVICE_NAME..."
  $SUDO systemctl restart "$SERVICE_NAME"
  sleep 2
}

install_packages
create_user
backup_env_if_exists
deploy_app
restore_env_backup
prompt_env
setup_db

run_as_user "$APP_USER" bash -lc "cd '$APP_DIR/backend' && npm install --omit=dev"

setup_service
restart_related_services

if ! $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "Erro: o servico nao iniciou corretamente."
  $SUDO systemctl status "$SERVICE_NAME" --no-pager || true
  $SUDO journalctl -u "$SERVICE_NAME" --no-pager -n 50 || true
  exit 1
fi

SERVER_IP="$(get_primary_ip)"
echo "Instalacao concluida."
echo "Admin URL: http://$SERVER_IP:$APP_PORT/admin"
echo "User URL: http://$SERVER_IP:$APP_PORT/"
echo "Master email: $MASTER_EMAIL"
echo "Master password: $MASTER_PASSWORD"
echo "Credenciais salvas em: $APP_DIR/credentials.txt"

sleep 2
if ! $SUDO ss -ltnp | grep -q ":$APP_PORT"; then
  echo "Erro: a porta $APP_PORT nao esta ouvindo."
  $SUDO systemctl status "$SERVICE_NAME" --no-pager || true
  $SUDO journalctl -u "$SERVICE_NAME" --no-pager -n 80 || true
  exit 1
fi

if ! curl -fsS "http://127.0.0.1:$APP_PORT/" >/dev/null 2>&1; then
  echo "Aviso: o servico nao respondeu via localhost. Verifique firewall/proxy."
fi
