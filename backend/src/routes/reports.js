const express = require('express');
const { pool } = require('../db');
const { authRequired, requirePermission } = require('../middleware/auth');
const { sendMail } = require('../email');

const router = express.Router();

const resolveTenantId = (req) => {
  if (req.user?.isMaster) {
    return null;
  }
  return req.user?.tenantId || null;
};

const formatMonthLabel = (month) => {
  if (!month) return '';
  const [year, monthPart] = month.split('-');
  const date = new Date(Number(year), Number(monthPart) - 1, 1);
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

router.post('/monthly/email', authRequired, requirePermission('edit'), async (req, res) => {
  const {
    month,
    email,
    includeSummary = true,
    includeFixedVariable = true,
    includeCategories = true,
    includeTransactions = false,
  } = req.body || {};
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }
  const reportMonth = typeof month === 'string' && month.length >= 7
    ? month.slice(0, 7)
    : new Date().toISOString().slice(0, 7);
  const targetEmail = (email || req.user?.email || '').trim();
  if (!targetEmail) {
    return res.status(400).json({ error: 'E-mail de destino obrigatório' });
  }

  try {
    const periodDate = `${reportMonth}-01`;
    const summaryResult = await pool.query(
      `
        SELECT
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense,
          COALESCE(SUM(CASE WHEN type = 'expense' AND category_kind = 'fixed' THEN amount ELSE 0 END), 0) AS fixed_expense
        FROM transactions
        WHERE tenant_id = $1 AND period_month = $2
      `,
      [tenantId, periodDate]
    );
    const income = Number(summaryResult.rows[0].income || 0);
    const expense = Number(summaryResult.rows[0].expense || 0);
    const fixedExpense = Number(summaryResult.rows[0].fixed_expense || 0);
    const variableExpense = expense - fixedExpense;
    const balance = income - expense;

    const topCategories = includeCategories
      ? await pool.query(
        `
          SELECT COALESCE(c.name, 'Sem categoria') AS name,
                 SUM(t.amount) AS total
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
          WHERE t.tenant_id = $1
            AND t.period_month = $2
            AND t.type = 'expense'
          GROUP BY COALESCE(c.name, 'Sem categoria')
          ORDER BY SUM(t.amount) DESC
          LIMIT 5
        `,
        [tenantId, periodDate]
      )
      : { rows: [] };

    const transactionsResult = includeTransactions
      ? await pool.query(
        `
          SELECT type, description, amount, currency, date
          FROM transactions
          WHERE tenant_id = $1 AND period_month = $2
          ORDER BY date DESC NULLS LAST
          LIMIT 50
        `,
        [tenantId, periodDate]
      )
      : { rows: [] };

    const monthLabel = formatMonthLabel(reportMonth);
    const subject = `Relatório mensal — ${monthLabel}`;
    const lines = topCategories.rows
      .map((row) => `<li>${row.name}: ${Number(row.total).toFixed(2)}</li>`)
      .join('');
    const txLines = transactionsResult.rows
      .map((row) => {
        const label = row.type === 'income' ? 'Entrada' : 'Saída';
        const date = row.date ? new Date(row.date).toLocaleDateString('pt-BR') : '-';
        return `<li>${label} - ${row.description} (${date}): ${Number(row.amount).toFixed(2)} ${row.currency || ''}</li>`;
      })
      .join('');

    const summaryHtml = includeSummary
      ? `
        <ul>
          <li><strong>Receitas:</strong> ${income.toFixed(2)}</li>
          <li><strong>Despesas:</strong> ${expense.toFixed(2)}</li>
          ${includeFixedVariable ? `<li><strong>Despesas fixas:</strong> ${fixedExpense.toFixed(2)}</li>` : ''}
          ${includeFixedVariable ? `<li><strong>Despesas variáveis:</strong> ${variableExpense.toFixed(2)}</li>` : ''}
          <li><strong>Saldo:</strong> ${balance.toFixed(2)}</li>
        </ul>
      `
      : '<p>Resumo geral não incluído.</p>';

    const categoriesHtml = includeCategories
      ? `
        <p><strong>Top categorias de despesa:</strong></p>
        <ul>${lines || '<li>Sem dados</li>'}</ul>
      `
      : '';

    const transactionsHtml = includeTransactions
      ? `
        <p><strong>Lançamentos do mês:</strong></p>
        <ul>${txLines || '<li>Sem lançamentos</li>'}</ul>
      `
      : '';

    const html = `
      <h2>Relatório mensal</h2>
      <p><strong>Período:</strong> ${monthLabel}</p>
      ${summaryHtml}
      ${categoriesHtml}
      ${transactionsHtml}
    `;

    const summaryText = includeSummary
      ? `Receitas: ${income.toFixed(2)}\nDespesas: ${expense.toFixed(2)}\n${
        includeFixedVariable ? `Despesas fixas: ${fixedExpense.toFixed(2)}\nDespesas variáveis: ${variableExpense.toFixed(2)}\n` : ''
      }Saldo: ${balance.toFixed(2)}`
      : 'Resumo geral não incluído';
    const categoriesText = includeCategories
      ? `\nTop categorias:\n${topCategories.rows.map((row) => `- ${row.name}: ${Number(row.total).toFixed(2)}`).join('\n') || 'Sem dados'}`
      : '';
    const transactionsText = includeTransactions
      ? `\nLançamentos:\n${transactionsResult.rows.map((row) => {
        const label = row.type === 'income' ? 'Entrada' : 'Saída';
        const date = row.date ? new Date(row.date).toLocaleDateString('pt-BR') : '-';
        return `- ${label} ${row.description} (${date}): ${Number(row.amount).toFixed(2)} ${row.currency || ''}`;
      }).join('\n') || 'Sem lançamentos'}`
      : '';

    const text = `Relatório mensal ${monthLabel}\n${summaryText}${categoriesText}${transactionsText}`;

    await sendMail({ to: targetEmail, subject, html, text });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erro ao enviar relatório' });
  }
});

module.exports = router;
