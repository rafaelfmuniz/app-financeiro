const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { authRequired, requireAdmin, requireMaster } = require('../middleware/auth');

const router = express.Router();

const defaultCategories = [
  { name: 'Despesa fixa', kind: 'fixed' },
  { name: 'Despesa variável', kind: 'variable' },
  { name: 'Receita', kind: 'income' },
];

router.get('/', authRequired, requireMaster, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT t.id, t.name, t.created_at,
               COUNT(u.id) FILTER (WHERE u.is_master = false) AS user_count
        FROM tenants t
        LEFT JOIN users u ON u.tenant_id = t.id
        GROUP BY t.id
        ORDER BY t.created_at DESC, t.id DESC
      `
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.post('/', authRequired, requireMaster, async (req, res) => {
  const { name, adminEmail, adminPassword, adminName, adminUsername } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nome da empresa é obrigatório' });
  }
  if (!adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'E-mail e senha do admin são obrigatórios' });
  }
  if (adminPassword.length < 6) {
    return res.status(400).json({ error: 'Senha muito curta' });
  }
  const normalizedUsername = (adminUsername || adminEmail.split('@')[0]).trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [adminEmail]
    );
    if (existingUser.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'E-mail já cadastrado' });
    }

    const tenantResult = await client.query(
      'INSERT INTO tenants (name) VALUES ($1) RETURNING id, name, created_at',
      [name.trim()]
    );
    const tenantId = tenantResult.rows[0].id;

    const hash = await bcrypt.hash(adminPassword, 10);
    const userResult = await client.query(
      `
        INSERT INTO users (email, username, name, password_hash, role, can_view, can_create, can_edit, can_delete, tenant_id)
        VALUES ($1, $2, $3, $4, 'admin', true, true, true, true, $5)
        RETURNING id, email, username, name, role, tenant_id
      `,
      [adminEmail, normalizedUsername, adminName || null, hash, tenantId]
    );

    for (const item of defaultCategories) {
      await client.query(
        'INSERT INTO categories (tenant_id, name, kind) VALUES ($1, $2, $3)',
        [tenantId, item.name, item.kind]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({
      tenant: tenantResult.rows[0],
      admin: userResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Erro no servidor' });
  } finally {
    client.release();
  }
});

router.patch('/self', authRequired, requireAdmin, async (req, res) => {
  if (req.user?.isMaster) {
    return res.status(403).json({ error: 'Administrador do sistema não pode usar este endpoint' });
  }
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nome da empresa é obrigatório' });
  }
  try {
    const result = await pool.query(
      'UPDATE tenants SET name = $1 WHERE id = $2 RETURNING id, name',
      [name.trim(), req.user.tenantId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.patch('/:id', authRequired, requireMaster, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nome da empresa é obrigatório' });
  }
  try {
    const result = await pool.query(
      'UPDATE tenants SET name = $1 WHERE id = $2 RETURNING id, name',
      [name.trim(), id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.delete('/:id', authRequired, requireMaster, async (req, res) => {
  const { id } = req.params;
  const tenantId = Number(id);
  if (Number.isNaN(tenantId)) {
    return res.status(400).json({ error: 'Empresa inválida' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM transactions WHERE tenant_id = $1', [tenantId]);
    await client.query('DELETE FROM monthly_summaries WHERE tenant_id = $1', [tenantId]);
    await client.query('DELETE FROM categories WHERE tenant_id = $1', [tenantId]);
    await client.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
    const result = await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Erro no servidor' });
  } finally {
    client.release();
  }
});

module.exports = router;
