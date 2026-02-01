#!/usr/bin/env bash
set -euo pipefail

APP_USER=${APP_USER:-finance}
APP_DIR=${APP_DIR:-/opt/controle-financeiro}
DB_NAME=${DB_NAME:-finance_db}
BACKUP_DIR=${BACKUP_DIR:-/opt/backups/controle-financeiro}
RETENTION_DAYS=${RETENTION_DAYS:-30}

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

echo "Criando backup do Controle Financeiro..."

# Criar diretório de backup
$SUDO mkdir -p "$BACKUP_DIR"

# Timestamp para o backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="backup_${TIMESTAMP}"

# Backup do banco de dados
echo "Fazendo backup do banco de dados..."
$SUDO su -s /bin/bash -c "pg_dump -Fc $DB_NAME > '$BACKUP_DIR/${BACKUP_NAME}.dump'" postgres

# Backup dos arquivos de configuração
echo "Fazendo backup dos arquivos de configuração..."
$SUDO tar -czf "$BACKUP_DIR/${BACKUP_NAME}.tar.gz" -C "$APP_DIR" backend/.env credentials.txt 2>/dev/null || true

# Backup do código (opcional - se houver mudanças locais)
if [ -d "$APP_DIR/.git" ]; then
  echo "Fazendo backup do estado do repositório..."
  $SUDO bash -c "cd '$APP_DIR' && git status > '$BACKUP_DIR/${BACKUP_NAME}-git-status.txt' 2>/dev/null || true"
fi

# Listar backups criados
echo ""
echo "Backup criado: ${BACKUP_NAME}"
echo "Local: $BACKUP_DIR"
echo ""
echo "Backups disponíveis:"
$SUDO ls -lh "$BACKUP_DIR" | grep -E "(backup_|total)" || echo "Nenhum backup encontrado"

# Limpar backups antigos
echo ""
echo "Limpando backups mais antigos que $RETENTION_DAYS dias..."
$SUDO find "$BACKUP_DIR" -name "backup_*" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

echo "Backup concluído!"
