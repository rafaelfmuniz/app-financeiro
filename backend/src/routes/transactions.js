const express = require('express');
const { randomUUID } = require('crypto');
const { pool } = require('../db');
const { authRequired, requirePermission } = require('../middleware/auth');

const router = express.Router();

const normalizePeriodMonth = (value) => {
  if (!value) {
    return null;
  }
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : value.toString();
  return `${raw.slice(0, 7)}-01`;
};

const buildMonthRange = (startMonth, endMonth) => {
  if (!startMonth || !endMonth) {
    return [];
  }
  const start = new Date(`${startMonth.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${endMonth.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }
  const months = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
};

const allowedCategoryKinds = new Set(['fixed', 'variable', 'income']);
const allowedCurrencies = new Set(['USD', 'BRL', 'EUR']);

const normalizeCategoryKind = (type, categoryKind) => {
  const normalized = (categoryKind || '').toString().trim().toLowerCase();
  if (type === 'income') {
    return 'income';
  }
  if (type === 'expense' && allowedCategoryKinds.has(normalized)) {
    return normalized === 'income' ? 'variable' : normalized;
  }
  return 'variable';
};

const normalizeCurrency = (value) => {
  const code = (value || '').toString().trim().toUpperCase();
  return allowedCurrencies.has(code) ? code : 'USD';
};

const resolveCategory = async (categoryId) => {
  if (!categoryId) {
    return null;
  }
  const parsedId = Number(categoryId);
  if (Number.isNaN(parsedId)) {
    return null;
  }
  const result = await pool.query('SELECT id, kind FROM categories WHERE id = $1', [parsedId]);
  return result.rows[0] || null;
};

const resolveTenantId = (req) => {
  if (req.user?.isMaster) {
    const fromRequest = req.query?.tenantId || req.body?.tenantId;
    if (fromRequest) {
      const parsed = Number(fromRequest);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }
  return req.user?.tenantId || null;
};

const resolveDateForMonth = (dateValue, periodMonth) => {
  if (!dateValue || !periodMonth) {
    return null;
  }
  const base = new Date(dateValue);
  if (Number.isNaN(base.getTime())) {
    return null;
  }
  const [year, month] = periodMonth.split('-');
  const monthIndex = Number(month) - 1;
  const lastDay = new Date(Date.UTC(Number(year), monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(base.getUTCDate(), lastDay);
  return new Date(Date.UTC(Number(year), monthIndex, day)).toISOString().slice(0, 10);
};

const updateMonthlySummary = async (tenantId, periodMonth) => {
  if (!periodMonth || !tenantId) {
    return;
  }
  const totals = await pool.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
      FROM transactions
      WHERE period_month = $1 AND tenant_id = $2
    `,
    [periodMonth, tenantId]
  );
  const income = Number(totals.rows[0].income);
  const expense = Number(totals.rows[0].expense);
  const balance = income - expense;

  await pool.query(
    `
      INSERT INTO monthly_summaries (tenant_id, period_month, income_total, expense_total, balance)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, period_month)
      DO UPDATE SET income_total = EXCLUDED.income_total,
                    expense_total = EXCLUDED.expense_total,
                    balance = EXCLUDED.balance
    `,
    [tenantId, periodMonth, income, expense, balance]
  );
};

router.get('/', authRequired, requirePermission('view'), async (req, res) => {
  const {
    startDate,
    endDate,
    startMonth,
    endMonth,
    type,
    categoryId,
    categoryKind,
    q,
  } = req.query;
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }
  const conditions = [];
  const values = [];

  if (startDate) {
    values.push(startDate);
    conditions.push(`COALESCE(t.date, t.period_month) >= $${values.length}`);
  }
  if (endDate) {
    values.push(endDate);
    conditions.push(`COALESCE(t.date, t.period_month) <= $${values.length}`);
  }
  if (startMonth) {
    values.push(`${startMonth}-01`);
    conditions.push(`t.period_month >= $${values.length}`);
  }
  if (endMonth) {
    values.push(`${endMonth}-01`);
    conditions.push(`t.period_month <= $${values.length}`);
  }
  if (type) {
    values.push(type);
    conditions.push(`t.type = $${values.length}`);
  }
  if (categoryId) {
    const parsedId = Number(categoryId);
    if (!Number.isNaN(parsedId)) {
      values.push(parsedId);
      conditions.push(`t.category_id = $${values.length}`);
    }
  }
  const normalizedCategoryFilter = (categoryKind || '').toString().trim().toLowerCase();
  if (normalizedCategoryFilter && allowedCategoryKinds.has(normalizedCategoryFilter)) {
    if (normalizedCategoryFilter === 'income') {
      conditions.push(`t.type = 'income'`);
    } else {
      values.push(normalizedCategoryFilter);
      conditions.push(`t.type = 'expense' AND t.category_kind = $${values.length}`);
    }
  }
  if (q) {
    values.push(`%${q}%`);
    conditions.push(`(t.description ILIKE $${values.length} OR COALESCE(t.source, '') ILIKE $${values.length} OR c.name ILIKE $${values.length})`);
  }
  values.push(tenantId);
  conditions.push(`t.tenant_id = $${values.length}`);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `
        SELECT t.id, t.type, t.date, t.period_month AS "periodMonth", t.description, t.amount, t.source,
               t.category_id AS "categoryId", c.name AS "categoryName",
               t.category_kind AS "categoryKind", t.currency,
               t.recurrence_type AS "recurrenceType", t.recurrence_group_id AS "recurrenceGroupId"
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        ${where}
        ORDER BY COALESCE(t.date, t.period_month) DESC, t.id DESC
      `,
      values
    );

    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.post('/', authRequired, requirePermission('create'), async (req, res) => {
  const {
    type,
    date,
    periodMonth,
    description,
    categoryKind,
    categoryId,
    currency,
    amount,
    source,
    recurrenceType = 'one_time',
    recurrenceEndMonth,
  } = req.body || {};
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }

  if (!type || !description || amount == null || (!date && !periodMonth)) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  try {
    const periodValue = normalizePeriodMonth(date || periodMonth);
    if (!periodValue) {
      return res.status(400).json({ error: 'Mês inválido' });
    }

    const categoryRow = await resolveCategory(categoryId);
    if (categoryId && !categoryRow) {
      return res.status(400).json({ error: 'Categoria inválida' });
    }
    if (categoryRow && type === 'income' && categoryRow.kind !== 'income') {
      return res.status(400).json({ error: 'Categoria de despesa não pode ser usada em receita' });
    }
    if (categoryRow && type === 'expense' && categoryRow.kind === 'income') {
      return res.status(400).json({ error: 'Categoria de receita não pode ser usada em despesa' });
    }
    const normalizedKind = categoryRow ? normalizeCategoryKind(type, categoryRow.kind) : normalizeCategoryKind(type, categoryKind);
    const normalizedCurrency = normalizeCurrency(currency);
    const categoryIdValue = categoryRow ? categoryRow.id : null;

    if (recurrenceType === 'monthly') {
      const endValue = normalizePeriodMonth(recurrenceEndMonth || periodValue);
      if (!endValue) {
        return res.status(400).json({ error: 'Mês final da recorrência inválido' });
      }
      const months = buildMonthRange(periodValue, endValue);
      if (!months.length) {
        return res.status(400).json({ error: 'Intervalo de recorrência inválido' });
      }
      const groupId = randomUUID();
      for (const month of months) {
        const resolvedDate = resolveDateForMonth(date, month);
        await pool.query(
          `
            INSERT INTO transactions (type, date, period_month, recurrence_type, recurrence_group_id, description, category_id, category_kind, amount, source, currency, tenant_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `,
          [type, resolvedDate, month, 'monthly', groupId, description, categoryIdValue, normalizedKind, amount, source || null, normalizedCurrency, tenantId]
        );
        await updateMonthlySummary(tenantId, month);
      }
      return res.status(201).json({ ok: true, recurrenceGroupId: groupId, count: months.length });
    }

    const result = await pool.query(
      `
        INSERT INTO transactions (type, date, period_month, recurrence_type, description, category_id, category_kind, amount, source, currency, tenant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `,
      [type, date || null, periodValue, 'one_time', description, categoryIdValue, normalizedKind, amount, source || null, normalizedCurrency, tenantId]
    );
    await updateMonthlySummary(tenantId, periodValue);

    return res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.put('/:id', authRequired, requirePermission('edit'), async (req, res) => {
  const { id } = req.params;
  const {
    type,
    date,
    periodMonth,
    description,
    categoryKind,
    categoryId,
    currency,
    amount,
    source,
    applyToSeries,
  } = req.body || {};
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }

  if (!type || !description || amount == null || (!date && !periodMonth)) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  const periodValue = normalizePeriodMonth(date || periodMonth);
  const categoryRow = await resolveCategory(categoryId);
  if (categoryId && !categoryRow) {
    return res.status(400).json({ error: 'Categoria inválida' });
  }
  if (categoryRow && type === 'income' && categoryRow.kind !== 'income') {
    return res.status(400).json({ error: 'Categoria de despesa não pode ser usada em receita' });
  }
  if (categoryRow && type === 'expense' && categoryRow.kind === 'income') {
    return res.status(400).json({ error: 'Categoria de receita não pode ser usada em despesa' });
  }
  const normalizedKind = categoryRow ? normalizeCategoryKind(type, categoryRow.kind) : normalizeCategoryKind(type, categoryKind);
  const normalizedCurrency = normalizeCurrency(currency);
  const categoryIdValue = categoryRow ? categoryRow.id : null;

  try {
    const existing = await pool.query(
      'SELECT period_month, recurrence_group_id FROM transactions WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    const previousPeriod = existing.rows[0]?.period_month;
    const groupId = existing.rows[0]?.recurrence_group_id;
    if (!previousPeriod) {
      return res.status(404).json({ error: 'Lançamento não encontrado' });
    }

    if (applyToSeries && groupId) {
      await pool.query(
        `
          UPDATE transactions
          SET type = $1,
              description = $2,
              category_id = $3,
              category_kind = $4,
              amount = $5,
              source = $6,
              currency = $7
          WHERE recurrence_group_id = $8 AND tenant_id = $9
        `,
        [type, description, categoryIdValue, normalizedKind, amount, source || null, normalizedCurrency, groupId, tenantId]
      );
      const periods = await pool.query(
        'SELECT DISTINCT period_month FROM transactions WHERE recurrence_group_id = $1 AND tenant_id = $2',
        [groupId, tenantId]
      );
      for (const row of periods.rows) {
        await updateMonthlySummary(tenantId, row.period_month);
      }
      return res.json({ ok: true, seriesUpdated: true });
    }

    await pool.query(
      `
        UPDATE transactions
        SET type = $1,
            date = $2,
            period_month = $3,
            description = $4,
            category_id = $5,
            category_kind = $6,
            amount = $7,
            source = $8,
            currency = $9
        WHERE id = $10 AND tenant_id = $11
      `,
      [type, date || null, periodValue, description, categoryIdValue, normalizedKind, amount, source || null, normalizedCurrency, id, tenantId]
    );
    await updateMonthlySummary(tenantId, periodValue);
    if (previousPeriod && previousPeriod !== periodValue) {
      await updateMonthlySummary(tenantId, previousPeriod);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.delete('/:id', authRequired, requirePermission('delete'), async (req, res) => {
  const { id } = req.params;
  const { series } = req.query;
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }

  try {
    const existing = await pool.query(
      'SELECT period_month, recurrence_group_id FROM transactions WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    const previousPeriod = existing.rows[0]?.period_month;
    const groupId = existing.rows[0]?.recurrence_group_id;
    if (!previousPeriod) {
      return res.status(404).json({ error: 'Lançamento não encontrado' });
    }

    if (series === 'true' && groupId) {
      const periods = await pool.query(
        'SELECT DISTINCT period_month FROM transactions WHERE recurrence_group_id = $1 AND tenant_id = $2',
        [groupId, tenantId]
      );
      await pool.query('DELETE FROM transactions WHERE recurrence_group_id = $1 AND tenant_id = $2', [groupId, tenantId]);
      for (const row of periods.rows) {
        await updateMonthlySummary(tenantId, row.period_month);
      }
      return res.json({ ok: true, seriesDeleted: true });
    }

    await pool.query('DELETE FROM transactions WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (previousPeriod) {
      await updateMonthlySummary(tenantId, previousPeriod);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

module.exports = router;

