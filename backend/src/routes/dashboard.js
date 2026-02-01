const express = require('express');
const { pool } = require('../db');
const { authRequired, requirePermission } = require('../middleware/auth');

const router = express.Router();

const getMonthFilter = (startMonth, endMonth, values, column = 'period_month') => {
  const conditions = [];
  if (startMonth) {
    values.push(`${startMonth}-01`);
    conditions.push(`${column} >= $${values.length}`);
  }
  if (endMonth) {
    values.push(`${endMonth}-01`);
    conditions.push(`${column} <= $${values.length}`);
  }
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
};

const getTenantId = (req) => {
  if (req.user?.isMaster) {
    const fromQuery = req.query?.tenantId;
    if (fromQuery) {
      const parsed = Number(fromQuery);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }
  return req.user?.tenantId || null;
};

const getRecentMonths = async (tenantId, limit) => {
  const summaryResult = await pool.query(
    `
      SELECT period_month, income_total, expense_total, balance
      FROM monthly_summaries
      WHERE tenant_id = $1 AND period_month <= DATE_TRUNC('month', CURRENT_DATE)
      ORDER BY period_month DESC
      LIMIT $2
    `,
    [tenantId, limit]
  );
  if (summaryResult.rows.length > 0) {
    return summaryResult.rows.map((row) => ({
      periodMonth: row.period_month,
      income: Number(row.income_total),
      expense: Number(row.expense_total),
      net: Number(row.balance),
    }));
  }

  const result = await pool.query(
    `
      SELECT period_month,
             SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
             SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
       FROM transactions
      WHERE tenant_id = $1 AND period_month <= DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY period_month
      ORDER BY period_month DESC
      LIMIT $2
    `,
    [tenantId, limit]
  );
  return result.rows.map((row) => ({
    periodMonth: row.period_month,
    income: Number(row.income),
    expense: Number(row.expense),
    net: Number(row.income) - Number(row.expense),
  }));
};

router.get('/summary', authRequired, requirePermission('view'), async (req, res) => {
  const { startMonth, endMonth } = req.query;
  const tenantId = getTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }
  const values = [tenantId];
  const conditions = ['tenant_id = $1'];
  if (startMonth) {
    values.push(`${startMonth}-01`);
    conditions.push(`period_month >= $${values.length}`);
  }
  if (endMonth) {
    values.push(`${endMonth}-01`);
    conditions.push(`period_month <= $${values.length}`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const fixedValues = [tenantId];
  const fixedConditions = ['t.tenant_id = $1'];
  if (startMonth) {
    fixedValues.push(`${startMonth}-01`);
    fixedConditions.push(`t.period_month >= $${fixedValues.length}`);
  }
  if (endMonth) {
    fixedValues.push(`${endMonth}-01`);
    fixedConditions.push(`t.period_month <= $${fixedValues.length}`);
  }
  const fixedWhere = `WHERE ${fixedConditions.join(' AND ')}`;

  try {

    const summaryResult = await pool.query(
      `
        SELECT
          COALESCE(SUM(income_total), 0) AS income,
          COALESCE(SUM(expense_total), 0) AS expense,
          COALESCE(SUM(balance), 0) AS balance
        FROM monthly_summaries
        ${where}
      `,
      values
    );


    let totalIncome = Number(summaryResult.rows[0].income);
    let totalExpense = Number(summaryResult.rows[0].expense);
    let saldo = Number(summaryResult.rows[0].balance);

    if (totalIncome === 0 && totalExpense === 0 && saldo === 0) {
      const totalsResult = await pool.query(
        `
          SELECT
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
          FROM transactions
          ${where}
        `,
        values
      );

      totalIncome = Number(totalsResult.rows[0].income);
      totalExpense = Number(totalsResult.rows[0].expense);
      saldo = totalIncome - totalExpense;
    }
    const recent = await getRecentMonths(tenantId, 1);
    const fixedResult = await pool.query(
      `
        SELECT
          COALESCE(SUM(CASE WHEN t.type = 'expense' AND t.category_kind = 'fixed' THEN t.amount ELSE 0 END), 0) AS fixed_expense,
          COALESCE(SUM(CASE WHEN t.type = 'expense' AND (t.category_kind IS NULL OR t.category_kind <> 'fixed') THEN t.amount ELSE 0 END), 0) AS variable_expense
        FROM transactions t
        ${fixedWhere}
      `,
      fixedValues
    );

    const now = new Date();
    const serverMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return res.json({
      totalIncome,
      totalExpense,
      saldo,
      fixedExpense: Number(fixedResult.rows[0]?.fixed_expense || 0),
      variableExpense: Number(fixedResult.rows[0]?.variable_expense || 0),
      latestPeriod: recent[0] || null,
      serverMonth,
    });
  } catch (err) {
    console.error('Error in /dashboard/summary:', err.message, err.stack);
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.get('/monthly', authRequired, requirePermission('view'), async (req, res) => {
  const { startMonth, endMonth, months } = req.query;
  const tenantId = getTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }
  const values = [tenantId];
  const conditions = ['tenant_id = $1'];
  if (startMonth) {
    values.push(`${startMonth}-01`);
    conditions.push(`period_month >= $${values.length}`);
  }
  if (endMonth) {
    values.push(`${endMonth}-01`);
    conditions.push(`period_month <= $${values.length}`);
  }
  let where = `WHERE ${conditions.join(' AND ')}`;

  try {
    if (!startMonth && !endMonth && months) {
      const maxResult = await pool.query(
        'SELECT MAX(period_month) AS max_month FROM monthly_summaries WHERE tenant_id = $1',
        [tenantId]
      );
      const maxMonth = maxResult.rows[0].max_month;
      if (maxMonth) {
        const limitMonths = Number(months);
        const startDate = new Date(maxMonth);
        startDate.setUTCMonth(startDate.getUTCMonth() - (limitMonths - 1));
        values.push(startDate.toISOString().slice(0, 10));
        where = `WHERE tenant_id = $1 AND period_month >= $${values.length}`;
      }
    }

    const result = await pool.query(
      `
        SELECT period_month,
               income_total AS income,
               expense_total AS expense,
               balance
        FROM monthly_summaries
        ${where}
        ORDER BY period_month
      `,
      values
    );

    let rows = result.rows.map((row) => ({
      periodMonth: row.period_month,
      income: Number(row.income),
      expense: Number(row.expense),
      net: Number(row.balance),
    }));

    if (rows.length === 0) {
      const fallback = await pool.query(
        `
          SELECT period_month,
                 SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
                 SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
          FROM transactions
          ${where}
          GROUP BY period_month
          ORDER BY period_month
        `,
        values
      );
      rows = fallback.rows.map((row) => ({
        periodMonth: row.period_month,
        income: Number(row.income),
        expense: Number(row.expense),
        net: Number(row.income) - Number(row.expense),
      }));
    }

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.get('/categories', authRequired, requirePermission('view'), async (req, res) => {
  const { startMonth, endMonth } = req.query;
  const tenantId = getTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }
  const values = [tenantId];
  const conditions = ['tenant_id = $1'];
  if (startMonth) {
    values.push(`${startMonth}-01`);
    conditions.push(`period_month >= $${values.length}`);
  }
  if (endMonth) {
    values.push(`${endMonth}-01`);
    conditions.push(`period_month <= $${values.length}`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  try {
    const result = await pool.query(
      `
        SELECT
          CASE
            WHEN t.type = 'income' THEN 'Receitas'
            WHEN t.category_kind = 'fixed' THEN 'Despesas fixas'
            ELSE 'Despesas variáveis'
          END AS name,
          CASE WHEN t.type = 'income' THEN 'income' ELSE 'expense' END AS type,
          SUM(t.amount) AS total
        FROM transactions t
        ${where}
        GROUP BY name, type
        ORDER BY total DESC
      `,
      values
    );

    const response = { income: [], expense: [] };
    for (const row of result.rows) {
      const item = { name: row.name, total: Number(row.total) };
      if (row.type === 'income') {
        response.income.push(item);
      } else {
        response.expense.push(item);
      }
    }

    return res.json(response);
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.get('/projection', authRequired, requirePermission('view'), async (req, res) => {
  try {

    const tenantId = getTenantId(req);
    if (!tenantId) {

      return res.status(400).json({ error: 'Empresa não definida' });
    }

    const recent = await getRecentMonths(tenantId, 3);
    const nets = recent.map((row) => row.net);
    const average = nets.length
      ? nets.reduce((sum, value) => sum + value, 0) / nets.length
      : 0;

    const trend = nets.length >= 2 ? nets[0] - nets[1] : 0;
    return res.json({
      lastMonths: recent.reverse(),
      projectedNet: average,
      trend,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.get('/insights', authRequired, requirePermission('view'), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: 'Empresa não definida' });
    }
    const recent = await getRecentMonths(tenantId, 3);
    const insights = [];

    if (recent.length > 0 && recent[0].net < 0) {
      insights.push({
        type: 'negative-net',
        severity: 'high',
        data: { net: recent[0].net, periodMonth: recent[0].periodMonth },
      });
    }

    if (recent.length >= 2 && recent[0].expense > recent[1].expense) {
      insights.push({
        type: 'expense-up',
        severity: 'medium',
        data: { current: recent[0].expense, previous: recent[1].expense },
      });
    }

    if (recent.length >= 3) {
      const negativeMonths = recent.filter((row) => row.net < 0).length;
      if (negativeMonths >= 2) {
        insights.push({
          type: 'negative-streak',
          severity: 'high',
          data: { negativeMonths },
        });
      }
    }

    return res.json(insights);
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

module.exports = router;

