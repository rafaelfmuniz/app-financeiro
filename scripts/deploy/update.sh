#!/usr/bin/env bash
set -euo pipefail

APP_USER=${APP_USER:-finance}
APP_DIR=${APP_DIR:-/opt/controle-financeiro}
SERVICE_NAME=${SERVICE_NAME:-controle-financeiro}
BACKUP_DIR=${BACKUP_DIR:-/opt/controle-financeiro/backups}
MIGRATIONS_DIR="$APP_DIR/scripts/deploy/migrations"

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "=========================================="
echo "  Controle Financeiro - Update Script"
echo "  Version: v1.1.0"
echo "=========================================="
echo ""

# Verificar se diretório existe
if [ ! -d "$APP_DIR" ]; then
  echo "Erro: Diretório $APP_DIR não encontrado. Execute install.sh primeiro."
  exit 1
fi

# Criar diretório de backups
$SUDO mkdir -p "$BACKUP_DIR"

# Passo 1: Backup do banco de dados
echo "[1/7] Fazendo backup do banco de dados..."
DB_HOST=$(grep "^DB_HOST=" "$APP_DIR/backend/.env" 2>/dev/null | cut -d'=' -f2)
DB_PORT=$(grep "^DB_PORT=" "$APP_DIR/backend/.env" 2>/dev/null | cut -d'=' -f2)
DB_USER=$(grep "^DB_USER=" "$APP_DIR/backend/.env" 2>/dev/null | cut -d'=' -f2)
DB_NAME=$(grep "^DB_NAME=" "$APP_DIR/backend/.env" 2>/dev/null | cut -d'=' -f2)
DB_PASS=$(grep "^DB_PASS=" "$APP_DIR/backend/.env" 2>/dev/null | cut -d'=' -f2)

if [ -n "$DB_NAME" ]; then
  BACKUP_FILE="$BACKUP_DIR/backup-$TIMESTAMP.sql"
  $SUDO bash -c "PGPASSWORD='$DB_PASS' pg_dump -h '$DB_HOST' -p '$DB_PORT' -U '$DB_USER' '$DB_NAME' > '$BACKUP_FILE'" || {
    echo "WARNING: Backup do banco de dados falhou. Continuando..."
  }
  echo "Backup salvo em: $BACKUP_FILE"
fi

# Passo 2: Backup do .env
echo "[2/7] Fazendo backup do .env..."
$SUDO cp "$APP_DIR/backend/.env" "$BACKUP_DIR/env-backup-$TIMESTAMP"
echo "Backup do .env salvo em: $BACKUP_DIR/env-backup-$TIMESTAMP"

# Passo 3: Parar serviço
echo "[3/7] Parando serviço..."
$SUDO systemctl stop "$SERVICE_NAME" || true

# Passo 4: Atualizar código
echo "[4/7] Atualizando código..."
$SUDO bash -c "cd '$APP_DIR' && git fetch origin" || {
  echo "Erro: Falha ao buscar código do Git."
  echo "Restaurando serviço..."
  $SUDO systemctl start "$SERVICE_NAME" || true
  exit 1
}

# Verificar hash atual e novo
CURRENT_HASH=$($SUDO bash -c "cd '$APP_DIR' && git rev-parse HEAD")
NEW_HASH=$($SUDO bash -c "cd '$APP_DIR' && git rev-parse origin/main")

if [ "$CURRENT_HASH" = "$NEW_HASH" ]; then
  echo "Já está na versão mais recente."
  echo "Nenhuma atualização necessária."
  $SUDO systemctl start "$SERVICE_NAME"
  exit 0
fi

echo "Atualizando: $CURRENT_HASH -> $NEW_HASH"
$SUDO bash -c "cd '$APP_DIR' && git reset --hard origin/main" || {
  echo "Erro: Falha ao atualizar código."
  echo "Restaurando serviço..."
  $SUDO systemctl start "$SERVICE_NAME" || true
  exit 1
}

# Passo 5: Atualizar .env com novas variáveis
echo "[5/7] Atualizando configurações..."
if [ -f "$MIGRATIONS_DIR/update-env-v1.1.0.sh" ]; then
  $SUDO bash "$MIGRATIONS_DIR/update-env-v1.1.0.sh" || {
    echo "WARNING: Falha ao atualizar .env. Verifique manualmente."
  }
fi

# Passo 6: Executar migrations do banco de dados
echo "[6/7] Executando migrations do banco de dados..."
if [ -f "$MIGRATIONS_DIR/v1.1.0-refresh-tokens.sql.sh" ]; then
  $SUDO bash "$MIGRATIONS_DIR/v1.1.0-refresh-tokens.sql.sh" || {
    echo "WARNING: Falha ao executar migration v1.1.0. Tente manualmente:"
    echo "  psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f $MIGRATIONS_DIR/v1.1.0-refresh-tokens.sql"
  }
elif [ -f "$MIGRATIONS_DIR/v1.1.0-refresh-tokens.sql" ]; then
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$MIGRATIONS_DIR/v1.1.0-refresh-tokens.sql" || {
    echo "WARNING: Falha ao executar migration v1.1.0."
  }
else
  echo "No migration files found for v1.1.0. Skipping."
fi

# Restaurar permissões
echo "Restaurando permissões..."
$SUDO chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# Passo 7: Reinstalar dependências e reiniciar
echo "[7/7] Reinstalando dependências..."
$SUDO su -s /bin/bash -c "cd '$APP_DIR/backend' && npm install --omit=dev" "$APP_USER" || {
  echo "Erro: Falha ao instalar dependências."
  echo "Verifique logs: $SUDO journalctl -u $SERVICE_NAME -n 100"
  exit 1
}

echo "Reiniciando serviço..."
$SUDO systemctl start "$SERVICE_NAME"

# Aguardar serviço iniciar
sleep 5

# Verificar status
if $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
  echo ""
  echo "=========================================="
  echo "  Atualização concluída com sucesso!"
  echo "=========================================="
  echo ""
  echo "Verificando logs..."
  $SUDO journalctl -u "$SERVICE_NAME" --no-pager -n 20
  echo ""
  echo "Backup salvo em: $BACKUP_DIR"
  echo ""
  
  # Health check
  echo "Executando health check..."
  if curl -s -f http://localhost:3000/api/dashboard/summary > /dev/null 2>&1 || curl -s -f http://localhost:3000/ > /dev/null 2>&1; then
    echo "✓ Health check passou!"
  else
    echo "WARNING: Health check falhou, mas serviço está rodando."
    echo "Verifique manualmente: curl http://localhost:3000/"
  fi
  
  exit 0
else
  echo ""
  echo "=========================================="
  echo "  ERRO: Falha na atualização"
  echo "=========================================="
  echo ""
  echo "Serviço não iniciou após atualização."
  echo ""
  echo "Logs recentes:"
  $SUDO journalctl -u "$SERVICE_NAME" --no-pager -n 50
  echo ""
  echo "Para restaurar o backup do banco de dados:"
  echo "  $SUDO psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME < $BACKUP_FILE"
  echo ""
  echo "Para restaurar o .env:"
  echo "  $SUDO cp $BACKUP_DIR/env-backup-$TIMESTAMP $APP_DIR/backend/.env"
  echo ""
  exit 1
fi
