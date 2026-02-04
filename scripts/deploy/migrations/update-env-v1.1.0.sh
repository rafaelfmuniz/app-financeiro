#!/usr/bin/env bash
# Script to update .env file with v1.1.0 variables

set -euo pipefail

APP_DIR=${APP_DIR:-/opt/controle-financeiro}
ENV_FILE="$APP_DIR/backend/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi

echo "Updating .env with v1.1.0 variables..."

# Add JWT_REFRESH_SECRET if not present
if ! grep -q "^JWT_REFRESH_SECRET=" "$ENV_FILE"; then
  # Generate random secret
  SECRET=$(openssl rand -hex 32 2>/dev/null || echo "$(date +%s)-$(whoami)-$(hostname)-refresh-secret-change-in-production")
  echo "JWT_REFRESH_SECRET=$SECRET" >> "$ENV_FILE"
  echo "Added: JWT_REFRESH_SECRET"
else
  echo "JWT_REFRESH_SECRET already exists, skipping"
fi

# Add JWT_ACCESS_EXPIRATION if not present
if ! grep -q "^JWT_ACCESS_EXPIRATION=" "$ENV_FILE"; then
  echo "JWT_ACCESS_EXPIRATION=15m" >> "$ENV_FILE"
  echo "Added: JWT_ACCESS_EXPIRATION"
else
  echo "JWT_ACCESS_EXPIRATION already exists, skipping"
fi

# Add JWT_REFRESH_EXPIRATION if not present
if ! grep -q "^JWT_REFRESH_EXPIRATION=" "$ENV_FILE"; then
  echo "JWT_REFRESH_EXPIRATION=7d" >> "$ENV_FILE"
  echo "Added: JWT_REFRESH_EXPIRATION"
else
  echo "JWT_REFRESH_EXPIRATION already exists, skipping"
fi

echo ".env file updated successfully!"
