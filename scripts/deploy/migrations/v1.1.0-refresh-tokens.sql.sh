#!/usr/bin/env bash
# Migration script for v1.1.0 - Refresh Tokens
# This script adds the refresh_tokens table and indexes

set -euo pipefail

APP_DIR=${APP_DIR:-/opt/controle-financeiro}
DB_HOST=${DB_HOST:-127.0.0.1}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-finance_user}
DB_NAME=${DB_NAME:-finance_db}
DB_PASS=${DB_PASS:-}

# Load environment variables if available
if [ -f "$APP_DIR/backend/.env" ]; then
  source "$APP_DIR/backend/.env"
  DB_HOST=${DB_HOST:-$DB_HOST}
  DB_PORT=${DB_PORT:-$DB_PORT}
  DB_USER=${DB_USER:-$DB_USER}
  DB_NAME=${DB_NAME:-$DB_NAME}
fi

echo "Running migration v1.1.0 - Refresh Tokens..."

# Check if refresh_tokens table already exists
TABLE_EXISTS=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'refresh_tokens');")

if [ "$TABLE_EXISTS" = "t" ]; then
  echo "Table refresh_tokens already exists. Skipping migration."
  exit 0
fi

# Create refresh_tokens table
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<EOF
CREATE TABLE refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX refresh_tokens_token_hash_idx ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
EOF

echo "Migration v1.1.0 completed successfully!"
echo "Table refresh_tokens created with indexes."
