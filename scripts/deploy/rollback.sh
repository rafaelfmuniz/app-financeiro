#!/usr/bin/env bash
# Rollback script to restore from backup

set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/opt/controle-financeiro/backups}
APP_DIR=${APP_DIR:-/opt/controle-financeiro}
SERVICE_NAME=${SERVICE_NAME:-controle-financeiro}

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

echo "=========================================="
echo "  Controle Financeiro - Rollback Script"
echo "=========================================="
echo ""

# List available backups
if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A $BACKUP_DIR)" ]; then
  echo "No backups found in $BACKUP_DIR"
  exit 1
fi

echo "Available backups:"
echo ""
ls -lht "$BACKUP_DIR"/*.sql 2>/dev/null | head -10 || echo "No SQL backups found"
ls -lht "$BACKUP_DIR"/env-backup-* 2>/dev/null | head -10 || echo "No ENV backups found"
echo ""

# Ask which backup to restore
read -p "Enter backup timestamp (e.g., 20260203-143022) or press Ctrl+C to cancel: " TIMESTAMP

if [ -z "$TIMESTAMP" ]; then
  echo "No timestamp provided. Exiting."
  exit 1
fi

SQL_BACKUP="$BACKUP_DIR/backup-$TIMESTAMP.sql"
ENV_BACKUP="$BACKUP_DIR/env-backup-$TIMESTAMP"

# Verify backups exist
if [ ! -f "$SQL_BACKUP" ]; then
  echo "ERROR: SQL backup not found: $SQL_BACKUP"
  exit 1
fi

if [ ! -f "$ENV_BACKUP" ]; then
  echo "ERROR: ENV backup not found: $ENV_BACKUP"
  exit 1
fi

echo ""
echo "You are about to restore from:"
echo "  Database: $SQL_BACKUP"
echo "  .env file: $ENV_BACKUP"
echo ""
read -p "This will OVERWRITE the current database and settings. Are you sure? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Rollback cancelled."
  exit 0
fi

# Stop service
echo "Stopping service..."
$SUDO systemctl stop "$SERVICE_NAME"

# Restore .env
echo "Restoring .env..."
$SUDO cp "$ENV_BACKUP" "$APP_DIR/backend/.env"

# Restore database
echo "Restoring database..."
DB_HOST=$(grep "^DB_HOST=" "$ENV_BACKUP" | cut -d'=' -f2)
DB_PORT=$(grep "^DB_PORT=" "$ENV_BACKUP" | cut -d'=' -f2)
DB_USER=$(grep "^DB_USER=" "$ENV_BACKUP" | cut -d'=' -f2)
DB_NAME=$(grep "^DB_NAME=" "$ENV_BACKUP" | cut -d'=' -f2)
DB_PASS=$(grep "^DB_PASS=" "$ENV_BACKUP" | cut -d'=' -f2)

$SUDO bash -c "PGPASSWORD='$DB_PASS' psql -h '$DB_HOST' -p '$DB_PORT' -U '$DB_USER' -d '$DB_NAME' < '$SQL_BACKUP'" || {
  echo "ERROR: Database restore failed!"
  $SUDO systemctl start "$SERVICE_NAME"
  exit 1
}

# Start service
echo "Starting service..."
$SUDO systemctl start "$SERVICE_NAME"

sleep 3

if $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
  echo ""
  echo "=========================================="
  echo "  Rollback completed successfully!"
  echo "=========================================="
  exit 0
else
  echo "ERROR: Service failed to start after rollback"
  $SUDO journalctl -u "$SERVICE_NAME" --no-pager -n 50
  exit 1
fi
