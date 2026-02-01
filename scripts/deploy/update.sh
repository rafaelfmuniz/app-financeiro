#!/usr/bin/env bash
set -euo pipefail

APP_USER=${APP_USER:-finance}
APP_DIR=${APP_DIR:-/opt/controle-financeiro}
SERVICE_NAME=${SERVICE_NAME:-controle-financeiro}

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

echo "Atualizando Controle Financeiro..."

# Verificar se diretório existe
if [ ! -d "$APP_DIR" ]; then
  echo "Erro: Diretório $APP_DIR não encontrado. Execute install.sh primeiro."
  exit 1
fi

# Backup do .env atual
if [ -f "$APP_DIR/backend/.env" ]; then
  echo "Fazendo backup do .env..."
  $SUDO cp "$APP_DIR/backend/.env" "/tmp/env-backup-$(date +%Y%m%d-%H%M%S)"
fi

# Atualizar código
echo "Atualizando código..."
$SUDO bash -c "cd '$APP_DIR' && git fetch origin && git reset --hard origin/main"

# Restaurar permissões
$SUDO chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# Reinstalar dependências
echo "Reinstalando dependências..."
$SUDO su -s /bin/bash -c "cd '$APP_DIR/backend' && npm install --omit=dev" "$APP_USER"

# Reiniciar serviço
echo "Reiniciando serviço..."
$SUDO systemctl restart "$SERVICE_NAME"

sleep 2

if $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "Atualização concluída com sucesso!"
  echo "Verificando status..."
  $SUDO systemctl status "$SERVICE_NAME" --no-pager
else
  echo "Erro: Serviço não iniciou após atualização."
  $SUDO systemctl status "$SERVICE_NAME" --no-pager || true
  $SUDO journalctl -u "$SERVICE_NAME" --no-pager -n 50 || true
  exit 1
fi
