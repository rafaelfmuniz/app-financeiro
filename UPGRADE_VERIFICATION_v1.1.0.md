# v1.1.0 Update Verification Guide

This document provides a checklist to verify the v1.1.0 installation works correctly in production.

## 📋 Pre-Update Checklist

Before updating to v1.1.0:

- [ ] Backup database: `pg_dump -h localhost -U finance_user -d finance_db > backup-pre-v1.1.0.sql`
- [ ] Check current version: `cd /opt/controle-financeiro && git log -1 --oneline`
- [ ] Verify PostgreSQL is running: `sudo systemctl status postgresql`
- [ ] Verify app is running: `sudo systemctl status controle-financeiro`
- [ ] Note down current `.env` configuration

---

## 🚀 Update Process

### Option 1: Automatic Update (Recommended)

```bash
cd /opt/controle-financeiro
sudo bash scripts/deploy/update.sh
```

**Expected output**:
```
==========================================
  Controle Financeiro - Update Script
  Version: v1.1.0
==========================================

[1/7] Fazendo backup do banco de dados...
Backup salvo em: /opt/controle-financeiro/backups/backup-YYYYMMDD-HHMMSS.sql

[2/7] Fazendo backup do .env...
Backup do .env salvo em: /opt/controle-financeiro/backups/env-backup-YYYYMMDD-HHMMSS

[3/7] Parando serviço...
[4/7] Atualizando código...
Updating: <hash> -> <new_hash>
[5/7] Atualizando configurações...
Added: JWT_REFRESH_SECRET
Added: JWT_ACCESS_EXPIRATION
Added: JWT_REFRESH_EXPIRATION

[6/7] Executando migrations do banco de dados...
Migration v1.1.0 completed successfully!

[7/7] Reinstalando dependências...
Reiniciando serviço...
```

---

## ✅ Post-Update Verification

### 1. Check Service Status

```bash
sudo systemctl status controle-financeiro
```

**Expected**: Active (running)

---

### 2. Verify Database Migration

```bash
PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "\d refresh_tokens"
```

**Expected output**:
```
                           Table "public.refresh_tokens"
   Column    |            Type             | Collation | Nullable | Default
-------------+-----------------------------+-----------+----------+---------
 id          | integer                     |           | not null | nextval('refresh_tokens_id_seq'::regclass)
 user_id     | integer                     |           | not null |
 token_hash  | text                        |           | not null |
 expires_at  | timestamp without time zone |           | not null |
 created_at  | timestamp without time zone |           | not null | now()
```

---

### 3. Check Environment Variables

```bash
grep -E "JWT_REFRESH_SECRET|JWT_ACCESS_EXPIRATION|JWT_REFRESH_EXPIRATION" /opt/controle-financeiro/backend/.env
```

**Expected**: All three variables should be present

---

### 4. Test Login Endpoint

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email","password":"your-password"}'
```

**Expected response** (should include both tokens):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "a1b2c3d4e5f6...",
  "role": "admin",
  ...
}
```

---

### 5. Test Refresh Endpoint

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"your-refresh-token-from-login"}'
```

**Expected response**:
```json
{
  "accessToken": "new-access-token...",
  "refreshToken": "new-refresh-token..."
}
```

---

### 6. Test Logout Endpoint

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"your-refresh-token"}'
```

**Expected response**: `{"ok": true}`

---

### 7. Verify Web Interface

Open browser and test:

1. **Login**: Navigate to app and login normally
2. **Session Persistence**: Close browser, reopen, verify still logged in
3. **Auto-Refresh**: Wait 15 minutes (access token expires), continue using app
4. **Logout**: Click logout button, verify session is terminated
5. **Re-login**: Login again after logout

---

### 8. Check Application Logs

```bash
sudo journalctl -u controle-financeiro -f
```

**Expected**: No errors related to refresh_tokens or authentication

---

### 9. Check Backup Directory

```bash
ls -lh /opt/controle-financeiro/backups/
```

**Expected**: Recent backup files created during update

---

## 🔍 Troubleshooting

### Issue: Migration Failed

**Symptoms**: Error message about migration v1.1.0

**Solution**:
```bash
# Run migration manually
PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME \
  -f /opt/controle-financeiro/scripts/deploy/migrations/v1.1.0-refresh-tokens.sql
```

---

### Issue: Service Won't Start

**Symptoms**: `systemctl status` shows failed

**Solution**:
```bash
# Check logs
sudo journalctl -u controle-financeiro -n 100

# Verify .env has required variables
cat /opt/controle-financeiro/backend/.env | grep JWT

# If needed, restore from backup
sudo bash /opt/controle-financeiro/scripts/deploy/rollback.sh
```

---

### Issue: Frontend Shows Error

**Symptoms**: Browser console shows errors about refresh tokens

**Solution**:
1. Clear browser cache and localStorage
2. Hard refresh (Ctrl+Shift+R)
3. Verify frontend build completed: `cd /opt/controle-financeiro/frontend && npm run build`

---

### Issue: Login Returns Old Format

**Symptoms**: Login response only has `token`, no `refreshToken`

**Solution**:
- Verify backend code is updated: `git log -1`
- Check if `refresh_tokens` table exists
- Restart service: `sudo systemctl restart controle-financeiro`

---

## 📊 Performance Verification

After update, monitor:

- **Database Size**: Should not increase significantly
- **Response Time**: Login should complete in <1 second
- **Token Refresh**: Should complete in <500ms
- **Memory Usage**: No significant increase

---

## 🔒 Security Verification

After update, verify:

1. **Access Token Expiration**: Should be 15 minutes
2. **Refresh Token Storage**: Should be hashed in database
3. **Logout Invalidates**: Refresh token should be removed on logout
4. **Expired Cleanup**: Old tokens should be cleaned up

---

## ✨ Success Criteria

Update is successful when:

- [ ] Service is running without errors
- [ ] `refresh_tokens` table exists with indexes
- [ ] Login returns both `token` and `refreshToken`
- [ ] Token refresh works automatically
- [ ] Logout invalidates refresh token
- [ ] Web interface functions normally
- [ ] No data loss occurred
- [ ] Backups are created

---

## 🆘 Rollback Procedure

If update fails or issues arise:

### Automatic Rollback

```bash
cd /opt/controle-financeiro
sudo bash scripts/deploy/rollback.sh
```

Follow prompts to select backup.

### Manual Rollback

```bash
# Stop service
sudo systemctl stop controle-financeiro

# Restore database
PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME \
  < /opt/controle-financeiro/backups/backup-YYYYMMDD-HHMMSS.sql

# Restore .env
cp /opt/controle-financeiro/backups/env-backup-YYYYMMDD-HHMMSS \
   /opt/controle-financeiro/backend/.env

# Rollback code
git checkout v1.0.0

# Reinstall dependencies
cd /opt/controle-financeiro/backend
npm install --omit=dev

# Start service
sudo systemctl start controle-financeiro
```

---

## 📞 Support

If you encounter issues:

1. Check logs: `sudo journalctl -u controle-financeiro -n 200`
2. Review documentation: https://github.com/rafaelfmuniz/app-financeiro
3. Open issue: https://github.com/rafaelfmuniz/app-financeiro/issues

---

**Version**: 1.1.0
**Last Updated**: February 3, 2026
