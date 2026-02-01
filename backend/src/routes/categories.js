const express = require('express');
const { pool } = require('../db');
const { authRequired, requirePermission } = require('../middleware/auth');

const router = express.Router();
const allowedKinds = new Set(['fixed', 'variable', 'income']);

const resolveTenantId = (req) => {
  if (req.user?.isMaster) {
    const fromRequest = req.query?.tenantId || req.body?.tenantId;
    if (!fromRequest) {
      return null;
    }
    const parsed = Number(fromRequest);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return req.user?.tenantId || null;
};

router.get('/', authRequired, requirePermission('view'), async (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }
  try {
    const result = await pool.query(
      `
        SELECT id, name, kind
        FROM categories
        WHERE tenant_id = $1
        ORDER BY
          CASE kind
            WHEN 'income' THEN 1
            WHEN 'fixed' THEN 2
            ELSE 3
          END,
          name
      `,
      [tenantId]
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erro no servidor' });
  }
});

router.post('/', authRequired, requirePermission('create'), async (req, res) => {
  const { name, kind } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }
  const normalizedKind = kind && allowedKinds.has(kind) ? kind : 'variable';

  try {
    const existing = await pool.query(
      'SELECT id FROM categories WHERE name = $1 AND tenant_id = $2',
      [name.trim(), tenantId]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'Categoria já existe' });
    }
    const result = await pool.query(
      'INSERT INTO categories (name, kind, tenant_id) VALUES ($1, $2, $3) RETURNING id',
      [name.trim(), normalizedKind, tenantId]
    );
    return res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Categoria já existe' });
    }
    return res.status(500).json({ error: err.message || 'Erro no servidor' });
  }
});

router.put('/:id', authRequired, requirePermission('edit'), async (req, res) => {
  const { id } = req.params;
  const { name, kind } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }
  if (kind && !allowedKinds.has(kind)) {
    return res.status(400).json({ error: 'Classificação de categoria inválida' });
  }
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }
  try {
    const existing = await pool.query(
      'SELECT id FROM categories WHERE name = $1 AND id <> $2 AND tenant_id = $3',
      [name.trim(), id, tenantId]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'Categoria já existe' });
    }
    await pool.query(
      'UPDATE categories SET name = $1, kind = $2 WHERE id = $3 AND tenant_id = $4',
      [name.trim(), kind || 'variable', id, tenantId]
    );
    return res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Categoria já existe' });
    }
    return res.status(500).json({ error: err.message || 'Erro no servidor' });
  }
});

router.delete('/:id', authRequired, requirePermission('delete'), async (req, res) => {
  const { id } = req.params;
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }
  try {
    await pool.query('DELETE FROM categories WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erro no servidor' });
  }
});

router.post('/reset', authRequired, requirePermission('edit'), async (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }

  const defaults = [
    { name: 'Despesa fixa', kind: 'fixed' },
    { name: 'Despesa variável', kind: 'variable' },
    { name: 'Receita', kind: 'income' },
  ];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM categories WHERE tenant_id = $1', [tenantId]);
    for (const item of defaults) {
      await client.query(
        'INSERT INTO categories (tenant_id, name, kind) VALUES ($1, $2, $3)',
        [tenantId, item.name, item.kind]
      );
    }
    const categoryRows = await client.query(
      'SELECT id, kind FROM categories WHERE tenant_id = $1',
      [tenantId]
    );
    const kindMap = categoryRows.rows.reduce((acc, row) => {
      acc[row.kind] = row.id;
      return acc;
    }, {});
    await client.query(
      `
        UPDATE transactions
        SET category_id = CASE
          WHEN type = 'income' THEN $1
          WHEN category_kind = 'fixed' THEN $2
          ELSE $3
        END
        WHERE tenant_id = $4
      `,
      [kindMap.income || null, kindMap.fixed || null, kindMap.variable || null, tenantId]
    );
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: err.message || 'Erro no servidor' });
  } finally {
    client.release();
  }
});

module.exports = router;
