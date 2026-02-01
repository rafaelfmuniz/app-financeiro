const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool, ensureMasterUser } = require('../db');
const { authRequired, requireAdmin } = require('../middleware/auth');
const { sendMail } = require('../email');

const router = express.Router();

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const TEMP_PASSWORD_MINUTES = 10;
const loginAttempts = new Map();

const isValidEmail = (value) => /.+@.+\..+/.test(value);

const getLoginKey = (req, identifier) => {
  const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
  const ip = Array.isArray(rawIp) ? rawIp[0] : String(rawIp).split(',')[0].trim();
  return `${ip || 'unknown'}|${(identifier || '').toLowerCase()}`;
};

const getAttempt = (key) => loginAttempts.get(key);

const isBlocked = (attempt) => attempt?.lockUntil && attempt.lockUntil > Date.now();

const registerFailure = (key) => {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now - current.firstAttempt > LOGIN_WINDOW_MS) {
    const next = { count: 1, firstAttempt: now, lockUntil: null };
    loginAttempts.set(key, next);
    return next;
  }
  const nextCount = current.count + 1;
  const lockUntil = nextCount >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_BLOCK_MS : current.lockUntil;
  const next = {
    count: nextCount,
    firstAttempt: current.firstAttempt,
    lockUntil,
  };
  loginAttempts.set(key, next);
  return next;
};

const clearAttempts = (key) => {
  if (loginAttempts.has(key)) {
    loginAttempts.delete(key);
  }
};

router.post('/register', authRequired, requireAdmin, async (req, res) => {
  const { email, password, name, username, tenantId } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Informe um e-mail válido' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Senha muito curta' });
  }
  const normalizedUsername = (username || email.split('@')[0]).trim();

  try {
    const resolvedTenantId = req.user?.isMaster
      ? (tenantId ? Number(tenantId) : null)
      : req.user?.tenantId;
    if (!resolvedTenantId) {
      return res.status(400).json({ error: 'Empresa não definida' });
    }
    const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail.rowCount > 0) {
      return res.status(409).json({ error: 'E-mail já cadastrado' });
    }
    if (normalizedUsername) {
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE username = $1 AND tenant_id IS NOT DISTINCT FROM $2',
        [normalizedUsername, resolvedTenantId]
      );
      if (existingUser.rowCount > 0) {
        return res.status(409).json({ error: 'Usuário já cadastrado nesta empresa' });
      }
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `
        INSERT INTO users (email, username, name, password_hash, role, can_view, can_create, can_edit, can_delete, tenant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, role, name, username, can_view, can_create, can_edit, can_delete, tenant_id
      `,
      [email, normalizedUsername, name || null, hash, 'guest', true, false, false, false, resolvedTenantId]
    );

    const tenantInfo = await pool.query('SELECT name FROM tenants WHERE id = $1', [resolvedTenantId]);
    const token = jwt.sign(
      {
        id: result.rows[0].id,
        email,
        role: result.rows[0].role,
        tenantId: result.rows[0].tenant_id,
        isMaster: false,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.status(201).json({
      token,
      role: result.rows[0].role,
      name: result.rows[0].name,
      username: result.rows[0].username,
      tenantId: result.rows[0].tenant_id,
      tenantName: tenantInfo.rows[0]?.name || null,
      permissions: {
        canView: result.rows[0].can_view,
        canCreate: result.rows[0].can_create,
        canEdit: result.rows[0].can_edit,
        canDelete: result.rows[0].can_delete,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const identifier = (email || '').trim();
  if (!identifier || !password) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
  }
  if (!isValidEmail(identifier)) {
    const attempt = registerFailure(getLoginKey(req, identifier));
    return res.status(401).json({
      error: 'Use o e-mail cadastrado para entrar.',
      attempts: attempt?.count || 1,
      lockedUntil: attempt?.lockUntil || null,
    });
  }

  try {
    const loginKey = getLoginKey(req, identifier);
    const attempt = getAttempt(loginKey);
    if (isBlocked(attempt)) {
      const retryAfter = Math.ceil((attempt.lockUntil - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: 'Muitas tentativas. Tente novamente em alguns minutos.',
        attempts: attempt.count,
        lockedUntil: attempt.lockUntil,
      });
    }

    const envMasterEmail = (process.env.MASTER_EMAIL || '').toLowerCase();
    const identifierLower = identifier.toLowerCase();
    const matchesEmail = envMasterEmail && identifierLower === envMasterEmail;
    if (matchesEmail) {
      await ensureMasterUser();
    }

    const result = await pool.query(
      `
        SELECT u.id, u.email, u.username, u.name, u.password_hash, u.temp_password_hash, u.temp_password_expires,
               u.must_reset_password, u.role, u.can_view, u.can_create, u.can_edit, u.can_delete,
               u.tenant_id, u.is_master, t.name AS tenant_name
        FROM users u
        LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE email = $1
      `,
      [identifier]
    );
    if (result.rowCount === 0) {
      const nextAttempt = registerFailure(loginKey);
      return res.status(401).json({
        error: 'Credenciais inválidas',
        attempts: nextAttempt?.count || 1,
        lockedUntil: nextAttempt?.lockUntil || null,
      });
    }

    const user = result.rows[0];
    let ok = await bcrypt.compare(password, user.password_hash);
    let usedTemp = false;
    if (!ok && user.temp_password_hash) {
      if (user.temp_password_expires && new Date(user.temp_password_expires) < new Date()) {
        await pool.query(
          'UPDATE users SET temp_password_hash = NULL, temp_password_expires = NULL WHERE id = $1',
          [user.id]
        );
      } else {
        usedTemp = await bcrypt.compare(password, user.temp_password_hash);
        ok = usedTemp;
      }
    }
    if (!ok) {
      const nextAttempt = registerFailure(loginKey);
      return res.status(401).json({
        error: 'Credenciais inválidas',
        attempts: nextAttempt?.count || 1,
        lockedUntil: nextAttempt?.lockUntil || null,
      });
    }

    clearAttempts(loginKey);
    let isMaster = user.is_master;
    const accountMatchesEmail = envMasterEmail && user.email && user.email.toLowerCase() === envMasterEmail;
    if (accountMatchesEmail) {
      isMaster = true;
      if (!user.is_master || user.tenant_id) {
        await pool.query('UPDATE users SET is_master = true, tenant_id = NULL WHERE id = $1', [user.id]);
      }
    }

    if (usedTemp || user.must_reset_password) {
      await pool.query('UPDATE users SET must_reset_password = true WHERE id = $1', [user.id]);
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenant_id,
        isMaster,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      token,
      role: user.role,
      name: user.name,
      username: user.username,
      email: user.email,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      isMaster,
      mustResetPassword: usedTemp || user.must_reset_password,
      permissions: {
        canView: user.can_view,
        canCreate: user.can_create,
        canEdit: user.can_edit,
        canDelete: user.can_delete,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.post('/forgot', async (req, res) => {
  const { email } = req.body || {};
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return res.status(400).json({ error: 'E-mail obrigatório' });
  }
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Informe um e-mail válido' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (result.rowCount > 0) {
      const user = result.rows[0];
      const tempPassword = crypto.randomBytes(8)
        .toString('base64')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 10);
      const tempHash = await bcrypt.hash(tempPassword, 10);
      const expiresAt = new Date(Date.now() + TEMP_PASSWORD_MINUTES * 60 * 1000);
      await pool.query(
        `
          UPDATE users
          SET temp_password_hash = $1,
              temp_password_expires = $2,
              must_reset_password = true,
              reset_token_hash = NULL,
              reset_token_expires = NULL
          WHERE id = $3
        `,
        [tempHash, expiresAt, user.id]
      );

      const subject = 'Senha temporária de acesso';
      const text = `Sua senha temporária é: ${tempPassword}\nEla expira em ${TEMP_PASSWORD_MINUTES} minutos.`;
      const html = `
        <p>Sua senha temporária é:</p>
        <p><strong>${tempPassword}</strong></p>
        <p>Ela expira em ${TEMP_PASSWORD_MINUTES} minutos.</p>
        <p>Ao entrar, você será solicitado a criar uma nova senha.</p>
      `;
      await sendMail({ to: user.email, subject, text, html });
    }

    return res.json({ ok: true, message: 'Se o e-mail existir, enviaremos uma senha temporária.' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erro ao enviar e-mail' });
  }
});

router.post('/reset', async (req, res) => {
  const { token, newPassword, password } = req.body || {};
  const rawToken = typeof token === 'string' ? token.trim() : '';
  const rawPassword = typeof newPassword === 'string' ? newPassword : typeof password === 'string' ? password : '';

  if (!rawToken || !rawPassword) {
    return res.status(400).json({ error: 'Token e nova senha são obrigatórios' });
  }
  if (rawPassword.length < 6) {
    return res.status(400).json({ error: 'Senha muito curta' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const result = await pool.query(
      `
        SELECT id
        FROM users
        WHERE reset_token_hash = $1
          AND reset_token_expires IS NOT NULL
          AND reset_token_expires > NOW()
      `,
      [tokenHash]
    );
    if (result.rowCount === 0) {
      return res.status(400).json({ error: 'Token inválido ou expirado' });
    }

    const hash = await bcrypt.hash(rawPassword, 10);
    await pool.query(
      `
        UPDATE users
        SET password_hash = $1,
            reset_token_hash = NULL,
            reset_token_expires = NULL
        WHERE id = $2
      `,
      [hash, result.rows[0].id]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

module.exports = router;
