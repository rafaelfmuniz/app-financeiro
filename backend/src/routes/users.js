const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { authRequired, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const resolveTenantScope = (req) => {
  if (req.user?.isMaster) {
    const tenantId = req.query?.tenantId || req.body?.tenantId;
    if (tenantId) {
      const parsed = Number(tenantId);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }
  return req.user?.tenantId || null;
};

const buildTenantWhere = (tenantId, values) => {
  if (tenantId) {
    values.push(tenantId);
    return ` AND u.tenant_id = $${values.length}`;
  }
  return '';
};

router.get('/', authRequired, requireAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantScope(req);
    const values = [];
    let where = '';
    if (tenantId) {
      values.push(tenantId);
      where = `WHERE u.tenant_id = $1`;
    }
    const result = await pool.query(
      `
        SELECT u.id, u.email, u.username, u.name, u.role, u.can_view, u.can_create, u.can_edit, u.can_delete,
               u.tenant_id, u.is_master, u.created_at, t.name AS tenant_name
        FROM users u
        LEFT JOIN tenants t ON t.id = u.tenant_id
        ${where}
        ORDER BY u.created_at DESC, u.id DESC
      `,
      values
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.patch('/me/profile', authRequired, async (req, res) => {
  const { name, username, email } = req.body || {};
  const canEditIdentity = !!req.user?.isMaster || req.user?.role === 'admin';

  try {
    if (!canEditIdentity) {
      if (username || email) {
        return res.status(403).json({ error: 'Apenas administradores podem alterar usuário ou e-mail' });
      }
      await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name || null, req.user.id]);
      return res.json({ ok: true });
    }

    const nextUsername = typeof username === 'string' ? username.trim() : '';
    const nextEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!nextUsername || !nextEmail) {
      return res.status(400).json({ error: 'E-mail e usuário são obrigatórios' });
    }

    const tenantScope = req.user?.tenantId ?? null;
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1 AND id <> $2 AND tenant_id IS NOT DISTINCT FROM $3',
      [nextUsername, req.user.id, tenantScope]
    );
    if (existingUser.rowCount > 0) {
      return res.status(409).json({ error: 'Usuário já está em uso' });
    }

    const existingEmail = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND id <> $2',
      [nextEmail, req.user.id]
    );
    if (existingEmail.rowCount > 0) {
      return res.status(409).json({ error: 'E-mail já está em uso' });
    }

    await pool.query(
      'UPDATE users SET name = $1, username = $2, email = $3 WHERE id = $4',
      [name || null, nextUsername, nextEmail, req.user.id]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.patch('/me/password', authRequired, async (req, res) => {
  const { currentPassword, newPassword, password } = req.body || {};

  const rawCurrent = typeof currentPassword === 'string' ? currentPassword : '';
  const rawNew = typeof newPassword === 'string' ? newPassword : typeof password === 'string' ? password : '';

  if (!rawCurrent || !rawNew || rawNew.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
  }

  try {
    const result = await pool.query(
      'SELECT password_hash, temp_password_hash, temp_password_expires FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    const user = result.rows[0];
    let ok = await bcrypt.compare(rawCurrent, user.password_hash);
    if (!ok && user.temp_password_hash) {
      if (user.temp_password_expires && new Date(user.temp_password_expires) < new Date()) {
        await pool.query(
          'UPDATE users SET temp_password_hash = NULL, temp_password_expires = NULL WHERE id = $1',
          [req.user.id]
        );
        return res.status(401).json({ error: 'Senha temporária expirada. Solicite uma nova.' });
      }
      ok = await bcrypt.compare(rawCurrent, user.temp_password_hash);
    }
    if (!ok) {
      return res.status(401).json({ error: 'Senha atual inválida' });
    }

    const hash = await bcrypt.hash(rawNew, 10);
    await pool.query(
      `
        UPDATE users
        SET password_hash = $1,
            temp_password_hash = NULL,
            temp_password_expires = NULL,
            must_reset_password = false
        WHERE id = $2
      `,
      [hash, req.user.id]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.patch('/:id/role', authRequired, requireAdmin, async (req, res) => {
  const { role } = req.body || {};
  const { id } = req.params;

  if (!['admin', 'guest'].includes(role)) {
    return res.status(400).json({ error: 'Função inválida' });
  }

  try {
    const tenantId = resolveTenantScope(req);
    if (!tenantId && !req.user?.isMaster) {
      return res.status(400).json({ error: 'Empresa não definida' });
    }
    const values = [role, id];
    let where = 'u.id = $2';
    where += buildTenantWhere(tenantId, values);
    await pool.query(`UPDATE users u SET role = $1 WHERE ${where}`, values);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.patch('/:id/permissions', authRequired, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { canView, canCreate, canEdit, canDelete } = req.body || {};

  try {
    const tenantId = resolveTenantScope(req);
    if (!tenantId && !req.user?.isMaster) {
      return res.status(400).json({ error: 'Empresa não definida' });
    }
    const values = [!!canView, !!canCreate, !!canEdit, !!canDelete, id];
    let where = 'u.id = $5';
    where += buildTenantWhere(tenantId, values);
    await pool.query(
      `
        UPDATE users u
        SET can_view = $1,
            can_create = $2,
            can_edit = $3,
            can_delete = $4
        WHERE ${where}
      `,
      values
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.patch('/:id/profile', authRequired, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, username, email } = req.body || {};

  try {
    const tenantId = resolveTenantScope(req);
    if (!tenantId && !req.user?.isMaster) {
      return res.status(400).json({ error: 'Empresa não definida' });
    }
    const normalizedEmail = email !== undefined ? email.trim().toLowerCase() : null;
    if (email !== undefined && !normalizedEmail) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }
    if (normalizedEmail) {
      const existingEmail = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id <> $2',
        [normalizedEmail, id]
      );
      if (existingEmail.rowCount > 0) {
        return res.status(409).json({ error: 'E-mail já está em uso' });
      }
    }
    if (username) {
      const existing = await pool.query(
        'SELECT id FROM users WHERE username = $1 AND id <> $2 AND tenant_id IS NOT DISTINCT FROM $3',
        [username, id, tenantId]
      );
      if (existing.rowCount > 0) {
        return res.status(409).json({ error: 'Usuário já está em uso' });
      }
    }
    const values = [name || null, username || null, normalizedEmail, id];
    let where = 'u.id = $4';
    where += buildTenantWhere(tenantId, values);
    await pool.query(
      'UPDATE users u SET name = $1, username = $2, email = COALESCE($3, email) WHERE ' + where,
      values
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.patch('/:id/password', authRequired, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { password } = req.body || {};

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
  }

  try {
    const tenantId = resolveTenantScope(req);
    if (!tenantId && !req.user?.isMaster) {
      return res.status(400).json({ error: 'Empresa não definida' });
    }
    const hash = await bcrypt.hash(password, 10);
    const values = [hash, id];
    let where = 'u.id = $2';
    where += buildTenantWhere(tenantId, values);
    await pool.query(`UPDATE users u SET password_hash = $1 WHERE ${where}`, values);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.delete('/:id', authRequired, requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'Não é possível excluir o próprio usuário' });
  }

  try {
    const tenantId = resolveTenantScope(req);
    if (!tenantId && !req.user?.isMaster) {
      return res.status(400).json({ error: 'Empresa não definida' });
    }
    const values = [id];
    let where = 'u.id = $1';
    where += buildTenantWhere(tenantId, values);
    await pool.query(`DELETE FROM users u WHERE ${where}`, values);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

module.exports = router;
