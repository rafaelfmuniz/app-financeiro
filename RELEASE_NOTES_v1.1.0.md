# Release Notes v1.1.0 - Refresh Token System

## 🚀 Overview

This release implements a modern authentication system with refresh tokens and provides a **fully automated one-line installer**:

- **Problem**: Sessions remained open indefinitely (8 hours), causing security risks
- **Problem**: Closing and reopening browser showed logged-in state but with no visible data
- **Problem**: No automatic token renewal, forcing users to re-login
- **Problem**: Installation was complex and required multiple decisions
- **Solution**: Short access tokens (15min) + refresh tokens (30min) with automatic renewal
- **Solution**: Fully automated installer with zero user interaction

---

## ✨ New Features

### Refresh Token System
- **Access Token**: 15-minute expiration (reduced from 8 hours)
- **Refresh Token**: 30-minute expiration (standard enterprise/bigtech security)
- **Automatic Token Rotation**: New refresh token issued on each refresh
- **Seamless User Experience**: Tokens refresh transparently while user is active
- **Session Management**: Maximum session time of 30 minutes after login

### Backend Changes
- New table `refresh_tokens` in database
- Endpoint `POST /api/auth/refresh` for token renewal
- Endpoint `POST /api/auth/logout` to invalidate sessions
- Automatic cleanup of expired refresh tokens
- Configurable token expiration via environment variables

### Frontend Changes
- Response interceptor for automatic token refresh
- Centralized logout function in `api.js`
- Session expiration notification with toast messages
- Token validation on page load
- Callback system for custom session handling

---

## 🔧 Configuration

### New Environment Variables (Optional)

Add to your `.env` file:

```bash
# JWT Configuration (v1.1.0+)
JWT_REFRESH_SECRET=your-secret-key-minimum-32-characters
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=30m
```

**Note**: If not provided, defaults will be used. For production, set `JWT_REFRESH_SECRET` with a strong random value.

**Session Behavior (v1.1.0)**:
- **Access Token**: 15 minutes - Used for API requests
- **Refresh Token**: 30 minutes - Maximum session duration
- **When Active**: Tokens refresh automatically, session extends
- **After 30 Minutes**: User must login again (standard enterprise security)

---

## 📦 Installation Instructions

### NEW: Fully Automated Installer (Recommended)

**ONE COMMAND - EVERYTHING AUTOMATED**

```bash
curl -fsSL https://raw.githubusercontent.com/rafaelfmuniz/app-financeiro/main/scripts/deploy/install.sh | sudo bash
```

**That's it!** The installer automatically handles:
- ✅ All system dependencies (PostgreSQL, Node.js, etc.)
- ✅ Database creation and configuration
- ✅ Database credentials generation (auto)
- ✅ Admin account creation (auto)
- ✅ All secrets generation (JWT, etc.)
- ✅ Application configuration
- ✅ Database migrations
- ✅ npm dependencies installation
- ✅ Frontend build
- ✅ Systemd service setup
- ✅ Service start and health check
- ✅ Credentials saved to secure file

**What it DOES NOT ask:**
- ❌ Database name (auto: `finance_db`)
- ❌ Database user (auto: `finance_user`)
- ❌ Database password (auto-generated)
- ❌ Admin email (auto: `admin@controle-financeiro.local`)
- ❌ Admin password (auto-generated)
- ❌ Admin username (auto: `admin`)
- ❌ Tenant name (auto: `Principal`)
- ❌ JWT secrets (auto-generated)
- ❌ ANY decisions - fully automated!

**User responsibility: ZERO** 🎉

**After installation:**
- 📋 All credentials saved to: `/opt/controle-financeiro/credentials.txt`
- 🔗 Access URLs displayed at the end
- 📝 Management commands shown (restart, logs, etc.)
- 🚀 Ready to use immediately!

### For Existing Installations (Upgrade to v1.1.0)

#### Automatic Update (Recommended)

```bash
sudo bash scripts/deploy/update.sh
```

This script will:
1. ✅ Backup your database
2. ✅ Backup your .env file
3. ✅ Update code from Git
4. ✅ Add missing environment variables
5. ✅ Run database migrations
6. ✅ Restart service
7. ✅ Verify health check

**All data is preserved! No information will be lost.**

### For Existing Installations (Upgrade to v1.1.0)

#### Automatic Update (Recommended)

```bash
sudo bash scripts/deploy/update.sh
```

This script will:
1. ✅ Backup your database
2. ✅ Backup your .env file
3. ✅ Update code from Git
4. ✅ Add missing environment variables
5. ✅ Run database migrations
6. ✅ Restart service
7. ✅ Verify health check

**All data is preserved! No information will be lost.**

#### Manual Update

If you prefer manual steps:

1. **Backup your database**:
   ```bash
   pg_dump -h localhost -U finance_user -d finance_db > backup-$(date +%Y%m%d).sql
   ```

2. **Update code**:
   ```bash
   cd /opt/controle-financeiro
   git fetch origin
   git pull origin main
   ```

3. **Update .env file**:
   ```bash
   # Add these lines to backend/.env
   JWT_REFRESH_SECRET=$(openssl rand -hex 32)
   JWT_ACCESS_EXPIRATION=15m
   JWT_REFRESH_EXPIRATION=30m
   ```

4. **Run database migration**:
   ```bash
   psql -h localhost -U finance_user -d finance_db -f scripts/deploy/migrations/v1.1.0-refresh-tokens.sql
   ```

5. **Install dependencies**:
   ```bash
   cd /opt/controle-financeiro/backend
   npm install --omit=dev
   ```

6. **Restart service**:
   ```bash
   sudo systemctl restart controle-financeiro
   ```

---

## 🔒 Security Improvements

1. **Short Access Tokens**: Reduced attack window from 8 hours to 15 minutes
2. **30-Minute Session**: Standard enterprise security, prevents session hijacking
3. **Refresh Token Rotation**: New tokens issued on each refresh, preventing reuse
4. **Token Hashing**: Refresh tokens stored with SHA-256 hash in database
5. **Automatic Cleanup**: Expired tokens removed automatically
6. **Secure Logout**: Refresh tokens invalidated on logout

---

## 🧪 Testing After Update

Verify your installation works correctly:

1. **Test Login**:
   ```bash
   curl -X POST http://your-server:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"your-email","password":"your-password"}'
   ```

2. **Check for Both Tokens**:
   - Response should include: `token` (access token) and `refreshToken`

3. **Test Refresh**:
   ```bash
   curl -X POST http://your-server:3000/api/auth/refresh \
     -H "Content-Type: application/json" \
     -d '{"refreshToken":"your-refresh-token"}'
   ```

4. **Test Logout**:
   ```bash
   curl -X POST http://your-server:3000/api/auth/logout \
     -H "Content-Type: application/json" \
     -d '{"refreshToken":"your-refresh-token"}'
   ```

5. **Verify Web Interface**:
   - Open your browser
   - Login normally
   - Close and reopen browser (within 30 minutes)
   - Verify session is maintained
   - Wait 15 minutes (access token expires)
   - Continue using app (should refresh automatically)
   - After 30 minutes total, should require login

---

## 🔄 Rollback Instructions

If you need to rollback to v1.0.0:

### Automatic Rollback

```bash
sudo bash scripts/deploy/rollback.sh
```

Follow prompts to select backup to restore.

### Manual Rollback

1. Restore database:
   ```bash
   psql -h localhost -U finance_user -d finance_db < backup-YYYYMMDD-HHMMSS.sql
   ```

2. Restore .env:
   ```bash
   cp /opt/controle-financeiro/backups/env-backup-YYYYMMDD-HHMMSS /opt/controle-financeiro/backend/.env
   ```

3. Rollback code:
   ```bash
   cd /opt/controle-financeiro
   git checkout v1.0.0
   ```

4. Restart service:
   ```bash
   sudo systemctl restart controle-financeiro
   ```

---

## 📋 Database Changes

### New Table: `refresh_tokens`

```sql
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
```

### Existing Tables: No Changes

All existing tables remain unchanged. **No data loss risk.**

---

## ⚠️ Known Issues

None reported in this release.

---

## 📝 Breaking Changes

**None.** This release is fully backward compatible.

- Existing sessions will work until they expire (8 hours)
- After update, new sessions will use refresh token system
- Users can continue using app seamlessly

---

## 🙏 Credits

This release addresses user-reported authentication issues and implements industry-standard refresh token patterns with enterprise security practices.

---

## 📞 Support

For issues or questions:
- GitHub Issues: https://github.com/rafaelfmuniz/app-financeiro/issues
- Documentation: https://github.com/rafaelfmuniz/app-financeiro#readme

---

**Release Date**: February 3, 2026
**Version**: 1.1.0

