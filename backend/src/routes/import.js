const express = require('express');
const { randomUUID } = require('crypto');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { pool } = require('../db');
const { authRequired, requirePermission } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const allowedCategoryKinds = new Set(['fixed', 'variable', 'income']);
const allowedCurrencies = new Set(['USD', 'BRL', 'EUR']);
const monthNameMap = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

const normalizeText = (value) => {
  if (!value) return '';
  return value
    .toString()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
};

const normalizeHeaderKey = (value) =>
  normalizeText(value).replace(/[^a-z0-9]/g, '');

const headerAliases = {
  tipo: 'type',
  tipotransacao: 'type',
  tipodeentrada: 'type',
  tipodesaida: 'type',
  tipolancamento: 'type',
  entradaesaida: 'type',
  entradasaida: 'type',
  type: 'type',
  data: 'date',
  datatransacao: 'date',
  datapagamento: 'date',
  datavencimento: 'date',
  competencia: 'periodMonth',
  mes: 'periodMonth',
  mesreferencia: 'periodMonth',
  period: 'periodMonth',
  periodmonth: 'periodMonth',
  descricao: 'description',
  descricaotransacao: 'description',
  description: 'description',
  valor: 'amount',
  valortotal: 'amount',
  amount: 'amount',
  categoria: 'category',
  category: 'category',
  classificacao: 'classification',
  classificacaocategoria: 'classification',
  kind: 'classification',
  moeda: 'currency',
  currency: 'currency',
  origem: 'source',
  origemconta: 'source',
  conta: 'source',
  source: 'source',
  recorrencia: 'recurrence',
  recorrenciatipo: 'recurrence',
  recurrence: 'recurrence',
};

const normalizeType = (value) => {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (['income', 'entrada', 'receita', 'credito', 'credit'].some((key) => raw.includes(key))) {
    return 'income';
  }
  if (['expense', 'Saída', 'despesa', 'debito', 'debit'].some((key) => raw.includes(key))) {
    return 'expense';
  }
  return null;
};

const normalizeKind = (value, type) => {
  if (type === 'income') return 'income';
  const raw = normalizeText(value);
  if (!raw) return 'variable';
  if (raw.includes('fixa') || raw.includes('fixed')) return 'fixed';
  if (raw.includes('variavel') || raw.includes('variable')) return 'variable';
  if (raw.includes('receita') || raw.includes('income')) return 'income';
  return 'variable';
};

const normalizeCurrency = (value) => {
  if (!value) return 'USD';
  const raw = value.toString().trim().toUpperCase();
  if (raw.includes('BRL') || raw.includes('R$')) return 'BRL';
  if (raw.includes('EUR') || raw.includes('€')) return 'EUR';
  if (raw.includes('USD') || raw.includes('$')) return 'USD';
  return allowedCurrencies.has(raw) ? raw : 'USD';
};

const normalizeDateFormat = (value) => {
  const raw = normalizeText(value);
  if (!raw) return 'auto';
  if (raw.includes('mdy') || raw.includes('mmdd')) return 'mdy';
  if (raw.includes('dmy') || raw.includes('ddmm')) return 'dmy';
  if (raw.includes('ymd') || raw.includes('yyyy')) return 'ymd';
  if (raw.includes('auto') || raw.includes('automatic')) return 'auto';
  return 'auto';
};

const parseAmount = (value) => {
  if (value == null || value === '') return null;
  const raw = value.toString().trim();
  const isNegative = raw.startsWith('(') && raw.endsWith(')');
  const cleaned = raw.replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized = cleaned;
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    normalized = cleaned.replace(decimalSeparator === '.' ? /,/g : /\./g, '');
    normalized = normalized.replace(decimalSeparator, '.');
  } else if (lastComma !== -1) {
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      normalized = `${parts[0].replace(/\./g, '')}.${parts[1]}`;
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else {
    normalized = cleaned.replace(/,/g, '');
  }
  const amount = Number(normalized);
  if (Number.isNaN(amount)) return null;
  return isNegative ? -Math.abs(amount) : amount;
};

const toIsoDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const parseDateValue = (value, format = 'auto') => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = value.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return toIsoDate(year, month, day);
  }
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(raw)) {
    const [year, month, day] = raw.split('/').map(Number);
    return toIsoDate(year, month, day);
  }
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    if (format === 'ymd') {
      return null;
    }
    const first = Number(match[1]);
    const second = Number(match[2]);
    let day = first;
    let month = second;
    if (format === 'mdy') {
      day = second;
      month = first;
    } else if (format === 'auto') {
      if (first > 12 && second <= 12) {
        day = first;
        month = second;
      } else if (second > 12 && first <= 12) {
        day = second;
        month = first;
      }
    }
    const yearRaw = match[3];
    const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    return toIsoDate(year, month, day);
  }
  return null;
};

const guessDateFormat = (records) => {
  let dmy = 0;
  let mdy = 0;
  records.forEach((row) => {
    const raw = row?.date ? row.date.toString().trim() : '';
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!match) return;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second <= 12) dmy += 1;
    if (second > 12 && first <= 12) mdy += 1;
  });
  if (mdy > dmy) return 'mdy';
  if (dmy > mdy) return 'dmy';
  return 'dmy';
};

const parseMonthValue = (value) => {
  if (!value) return null;
  const raw = value.toString().trim();
  if (/^\d{4}-\d{2}$/.test(raw)) {
    return `${raw}-01`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw.slice(0, 7)}-01`;
  }
  const match = raw.match(/^(\d{1,2})\/(\d{4})$/);
  if (match) {
    const month = Number(match[1]);
    const year = Number(match[2]);
    return toIsoDate(year, month, 1);
  }
  const normalized = normalizeText(raw);
  const monthMatch = normalized.match(/^([a-z]+)\s+(\d{4})$/);
  if (monthMatch) {
    const month = monthNameMap[monthMatch[1]];
    const year = Number(monthMatch[2]);
    if (month && !Number.isNaN(year)) {
      return toIsoDate(year, month, 1);
    }
  }
  return null;
};

const normalizeRecord = (record) => {
  const normalized = {};
  Object.entries(record || {}).forEach(([key, value]) => {
    const alias = headerAliases[normalizeHeaderKey(key)];
    if (!alias) return;
    if (normalized[alias] == null || normalized[alias] === '') {
      normalized[alias] = value;
    }
  });
  return normalized;
};

const resolveTenantId = (req) => {
  if (req.user?.isMaster) {
    const fromRequest = req.query?.tenantId || req.body?.tenantId;
    if (!fromRequest) return null;
    const parsed = Number(fromRequest);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return req.user?.tenantId || null;
};

const updateMonthlySummary = async (client, tenantId, periodMonth) => {
  if (!periodMonth || !tenantId) return;
  const totals = await client.query(
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
  await client.query(
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

const buildExportFilters = (query, tenantId) => {
  const conditions = [];
  const values = [];

  if (query.startDate) {
    values.push(query.startDate);
    conditions.push(`COALESCE(t.date, t.period_month) >= $${values.length}`);
  }
  if (query.endDate) {
    values.push(query.endDate);
    conditions.push(`COALESCE(t.date, t.period_month) <= $${values.length}`);
  }
  if (query.startMonth) {
    values.push(`${query.startMonth}-01`);
    conditions.push(`t.period_month >= $${values.length}`);
  }
  if (query.endMonth) {
    values.push(`${query.endMonth}-01`);
    conditions.push(`t.period_month <= $${values.length}`);
  }
  if (query.type) {
    values.push(query.type);
    conditions.push(`t.type = $${values.length}`);
  }
  const normalizedKind = normalizeText(query.categoryKind);
  if (normalizedKind && allowedCategoryKinds.has(normalizedKind)) {
    if (normalizedKind === 'income') {
      conditions.push(`t.type = 'income'`);
    } else {
      values.push(normalizedKind);
      conditions.push(`t.type = 'expense' AND t.category_kind = $${values.length}`);
    }
  }
  if (query.q) {
    values.push(`%${query.q}%`);
    conditions.push(`(t.description ILIKE $${values.length} OR COALESCE(t.source, '') ILIKE $${values.length} OR c.name ILIKE $${values.length})`);
  }
  values.push(tenantId);
  conditions.push(`t.tenant_id = $${values.length}`);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, values };
};

const buildCsvLine = (values) =>
  values
    .map((value) => {
      const raw = value == null ? '' : value.toString();
      if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
        return `"${raw.replace(/"/g, '""')}"`;
      }
      return raw;
    })
    .join(',');

router.get('/template', authRequired, requirePermission('edit'), (req, res) => {
  const header = ['tipo', 'data', 'descricao', 'valor', 'classificacao', 'categoria', 'moeda', 'origem', 'recorrencia'];
  const example = [
    'Entrada',
    '2025-01-15',
    'Salário',
    '3200.00',
    'Receita',
    'Salário',
    'USD',
    'Conta principal',
    'Mensal',
  ];
  const content = [buildCsvLine(header), buildCsvLine(example)].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao.csv"');
  return res.send(content);
});

router.get('/export', authRequired, requirePermission('edit'), async (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }
  try {
    const { where, values } = buildExportFilters(req.query || {}, tenantId);
    const result = await pool.query(
      `
        SELECT t.type,
               to_char(t.date, 'YYYY-MM-DD') AS "dateText",
               to_char(t.period_month, 'YYYY-MM-DD') AS "periodMonthText",
               t.description,
               t.amount,
               t.currency,
               t.source,
               t.category_kind AS "categoryKind",
               t.recurrence_type AS "recurrenceType",
               c.name AS "categoryName"
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        ${where}
        ORDER BY COALESCE(t.date, t.period_month) DESC, t.id DESC
      `,
      values
    );
    const header = ['tipo', 'data', 'descricao', 'valor', 'classificacao', 'categoria', 'moeda', 'origem', 'recorrencia'];
    const rows = result.rows.map((row) => {
      const typeLabel = row.type === 'income' ? 'Entrada' : 'Saída';
      const kindLabel = row.type === 'income'
        ? 'Receita'
        : row.categoryKind === 'fixed'
          ? 'Despesa fixa'
          : 'Despesa variável';
      const recurrenceLabel = row.recurrenceType === 'monthly' ? 'Mensal' : 'Único';
      const dateValue = row.dateText || row.periodMonthText || '';
      return buildCsvLine([
        typeLabel,
        dateValue || '',
        row.description,
        Number(row.amount).toFixed(2),
        kindLabel,
        row.categoryName || kindLabel,
        row.currency || 'USD',
        row.source || '',
        recurrenceLabel,
      ]);
    });
    const content = [buildCsvLine(header), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transacoes.csv"');
    return res.send(content);
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

router.post('/transactions', authRequired, requirePermission('edit'), upload.single('file'), async (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({ error: 'Empresa não definida' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Arquivo CSV não enviado' });
  }
  const createMissing = ['1', 'true', 'yes', 'on'].includes(
    String(req.body?.createMissingCategories || '').toLowerCase()
  );
  const mode = normalizeText(req.body?.mode || req.query?.mode);
  const isCheckOnly = mode === 'check' || mode === 'preview';
  const rawDuplicatePolicy = normalizeText(req.body?.duplicatePolicy || req.query?.duplicatePolicy);
  const duplicatePolicy = ['skip', 'replace', 'allow'].includes(rawDuplicatePolicy) ? rawDuplicatePolicy : 'skip';

  let records = [];
  try {
    const rawContent = req.file.buffer.toString('utf8');
    const content = rawContent.replace(/^\uFEFF/, '');
    const [headerLine] = content.split(/\r?\n/);
    const commaCount = (headerLine.match(/,/g) || []).length;
    const semicolonCount = (headerLine.match(/;/g) || []).length;
    const delimiter = semicolonCount > commaCount ? ';' : ',';
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter,
    });
  } catch (err) {
    return res.status(400).json({ error: 'Formato CSV inválido' });
  }

  const normalizedRecords = records.map(normalizeRecord);
  const requestedDateFormat = normalizeDateFormat(req.body?.dateFormat);
  const dateFormat = requestedDateFormat === 'auto' ? guessDateFormat(normalizedRecords) : requestedDateFormat;
  const allowCategoryCreation = createMissing && !isCheckOnly;

  const client = await pool.connect();
  try {
    const categoryRows = await client.query(
      'SELECT id, name, kind FROM categories WHERE tenant_id = $1',
      [tenantId]
    );
    const categoryByName = new Map();
    const defaultByKind = {};
    categoryRows.rows.forEach((row) => {
      categoryByName.set(normalizeText(row.name), row);
      if (!defaultByKind[row.kind]) {
        defaultByKind[row.kind] = row;
      }
    });

    let imported = 0;
    let skipped = 0;
    let duplicateCount = 0;
    const duplicates = [];
    const errors = [];
    const periodsToUpdate = new Set();

    for (let index = 0; index < normalizedRecords.length; index += 1) {
      const rowNumber = index + 2;
      const row = normalizedRecords[index];

      const description = row.description
        ? row.description.toString().trim()
        : (row.category ? row.category.toString().trim() : 'Sem descrição');
      const rawAmount = parseAmount(row.amount);
      const typeFromRow = normalizeType(row.type);
      const kindFromRow = row.classification ? normalizeKind(row.classification, null) : null;
      const typeFromKind = kindFromRow ? (kindFromRow === 'income' ? 'income' : 'expense') : null;
      const type = typeFromRow || typeFromKind;

      if (!type || rawAmount == null) {
        skipped += 1;
        errors.push({ row: rowNumber, error: 'Campos obrigatórios ausentes' });
        continue;
      }

      const dateValue = parseDateValue(row.date, dateFormat);
      const periodFromRow = parseMonthValue(row.periodMonth);
      const periodMonth = periodFromRow || (dateValue ? `${dateValue.slice(0, 7)}-01` : null);
      if (!periodMonth) {
        skipped += 1;
        errors.push({ row: rowNumber, error: 'Data ou mês inválido' });
        continue;
      }

      let categoryKind = normalizeKind(row.classification, type);
      if (type === 'income') {
        categoryKind = 'income';
      } else if (!allowedCategoryKinds.has(categoryKind) || categoryKind === 'income') {
        categoryKind = 'variable';
      }

      let categoryRow = null;
      if (row.category) {
        const normalizedCategory = normalizeText(row.category);
        categoryRow = categoryByName.get(normalizedCategory) || null;
        if (!categoryRow && allowCategoryCreation) {
          const insert = await client.query(
            'INSERT INTO categories (tenant_id, name, kind) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, name) DO NOTHING RETURNING id, name, kind',
            [tenantId, row.category.toString().trim(), categoryKind]
          );
          if (insert.rows[0]) {
            categoryRow = insert.rows[0];
            categoryByName.set(normalizedCategory, categoryRow);
            if (!defaultByKind[categoryRow.kind]) {
              defaultByKind[categoryRow.kind] = categoryRow;
            }
          } else {
            const existing = await client.query(
              'SELECT id, name, kind FROM categories WHERE tenant_id = $1 AND name = $2',
              [tenantId, row.category.toString().trim()]
            );
            categoryRow = existing.rows[0] || null;
          }
        }
      }

      if (categoryRow) {
        if (type === 'income' && categoryRow.kind !== 'income') {
          categoryRow = defaultByKind.income || null;
        }
        if (type === 'expense' && categoryRow.kind === 'income') {
          categoryRow = defaultByKind[categoryKind] || null;
        }
      }

      if (categoryRow) {
        categoryKind = categoryRow.kind;
      }

      const amount = Math.abs(Number(rawAmount));
      const currency = normalizeCurrency(row.currency);
      const source = row.source ? row.source.toString().trim() : null;
      const recurrenceType = normalizeText(row.recurrence).includes('mensal') ||
        normalizeText(row.recurrence).includes('monthly') ||
        normalizeText(row.recurrence).includes('recorr')
        ? 'monthly'
        : 'one_time';

      const matchDate = dateValue || periodMonth;
      if (duplicatePolicy !== 'allow' && matchDate) {
        const duplicateResult = await client.query(
          `
            SELECT id FROM transactions
            WHERE tenant_id = $1
              AND type = $2
              AND amount = $3
              AND currency = $4
              AND COALESCE(date, period_month) = $5
              AND LOWER(description) = LOWER($6)
            LIMIT 1
          `,
          [tenantId, type, amount, currency, matchDate, description]
        );
        if (duplicateResult.rows[0]) {
          duplicateCount += 1;
          if (isCheckOnly) {
            duplicates.push({
              row: rowNumber,
              date: matchDate,
              description,
              amount,
            });
            continue;
          }
          if (duplicatePolicy === 'skip') {
            errors.push({ row: rowNumber, error: 'Duplicado' });
            skipped += 1;
            continue;
          }
          if (duplicatePolicy === 'replace') {
            await client.query(
              `
                DELETE FROM transactions
                WHERE tenant_id = $1
                  AND type = $2
                  AND amount = $3
                  AND currency = $4
                  AND COALESCE(date, period_month) = $5
                  AND LOWER(description) = LOWER($6)
              `,
              [tenantId, type, amount, currency, matchDate, description]
            );
          }
        }
      }

      if (isCheckOnly) {
        imported += 1;
        continue;
      }

      await client.query(
        `
          INSERT INTO transactions (type, date, period_month, recurrence_type, recurrence_group_id, description, category_id, category_kind, amount, source, currency, tenant_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        [
          type,
          dateValue || null,
          periodMonth,
          recurrenceType,
          recurrenceType === 'monthly' ? randomUUID() : null,
          description,
          categoryRow ? categoryRow.id : (defaultByKind[categoryKind]?.id || null),
          categoryKind,
          amount,
          source || null,
          currency,
          tenantId,
        ]
      );
      periodsToUpdate.add(periodMonth);
      imported += 1;
    }

    for (const periodMonth of periodsToUpdate) {
      await updateMonthlySummary(client, tenantId, periodMonth);
    }

    if (isCheckOnly) {
      return res.json({
        checked: imported,
        duplicateCount,
        duplicates: duplicates.slice(0, 25),
      });
    }

    return res.json({ imported, skipped, duplicateCount, errors: errors.slice(0, 25) });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  } finally {
    client.release();
  }
});

module.exports = router;

