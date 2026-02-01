const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { parse } = require('csv-parse');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.sample') });

const { pool, ensureSchema } = require('./db');

const csvPath = path.join(__dirname, '..', 'data.csv');
const fixedExpenseNames = new Set(['telefone', 'carro', 'aluguel apt', 'seguro carro']);

const ensureUser = async ({ email, password, role, name, username, tenantId, isMaster }) => {
  if (!email || !password) {
    return;
  }
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rowCount > 0) {
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  const normalizedUsername = username || email.split('@')[0];
  const canEdit = role === 'admin';
  await pool.query(
    `
      INSERT INTO users (email, username, name, password_hash, role, is_master, tenant_id, can_view, can_create, can_edit, can_delete)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      email,
      normalizedUsername,
      name || null,
      hash,
      role,
      !!isMaster,
      tenantId || null,
      true,
      canEdit,
      canEdit,
      canEdit,
    ]
  );
};

const parseCsv = (filePath) => new Promise((resolve, reject) => {
  const rows = [];
  fs.createReadStream(filePath)
    .pipe(parse({ columns: true, trim: true }))
    .on('data', (row) => rows.push(row))
    .on('end', () => resolve(rows))
    .on('error', reject);
});

const normalizeText = (value) => {
  if (!value) {
    return '';
  }
  return value
    .toString()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
};


const seed = async () => {
  await ensureSchema();

  const defaultTenantName = process.env.DEFAULT_TENANT_NAME || 'Principal';
  const tenantCount = await pool.query('SELECT COUNT(*)::int AS total FROM tenants');
  let defaultTenantId = null;
  if (Number(tenantCount.rows[0]?.total || 0) === 0) {
    const inserted = await pool.query('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [defaultTenantName]);
    defaultTenantId = inserted.rows[0]?.id || null;
  } else {
    const defaultTenantRow = await pool.query('SELECT id FROM tenants WHERE name = $1 ORDER BY id LIMIT 1', [defaultTenantName]);
    if (defaultTenantRow.rowCount > 0) {
      defaultTenantId = defaultTenantRow.rows[0]?.id || null;
    } else {
      const firstTenant = await pool.query('SELECT id FROM tenants ORDER BY id LIMIT 1');
      defaultTenantId = firstTenant.rows[0]?.id || null;
    }
  }

  await ensureUser({
    email: process.env.MASTER_EMAIL,
    password: process.env.MASTER_PASSWORD,
    role: 'admin',
    isMaster: true,
    tenantId: null,
  });
  await ensureUser({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    role: 'admin',
    tenantId: defaultTenantId,
  });
  await ensureUser({
    email: 'guest@example.com',
    password: 'guest123',
    role: 'guest',
    tenantId: defaultTenantId,
  });

  if (process.env.SEED_RESET === '1') {
    await pool.query('TRUNCATE transactions RESTART IDENTITY');
    await pool.query('TRUNCATE categories RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE monthly_summaries');
  }

  if (defaultTenantId) {
    const defaults = [
      { name: 'Despesa fixa', kind: 'fixed' },
      { name: 'Despesa variável', kind: 'variable' },
      { name: 'Receita', kind: 'income' },
    ];
    for (const item of defaults) {
      await pool.query(
        'INSERT INTO categories (tenant_id, name, kind) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, name) DO NOTHING',
        [defaultTenantId, item.name, item.kind]
      );
    }
  }

  const categoryMapResult = defaultTenantId
    ? await pool.query('SELECT id, kind FROM categories WHERE tenant_id = $1', [defaultTenantId])
    : { rows: [] };
  const categoryByKind = categoryMapResult.rows.reduce((acc, row) => {
    acc[row.kind] = row.id;
    return acc;
  }, {});

  if (fs.existsSync(csvPath)) {
    const rows = await parseCsv(csvPath);
    for (const row of rows) {
      const categoryName = row.category?.trim();
      const amount = Number(String(row.amount).replace(',', '.'));
      const type = row.type?.trim();
      const date = row.date?.trim();
      const description = row.description?.trim() || 'Sem descrição';
      const source = row.source?.trim() || null;
      const kind = type === 'income'
        ? 'income'
        : (categoryName && fixedExpenseNames.has(normalizeText(categoryName)) ? 'fixed' : 'variable');

      if (!date || !type || Number.isNaN(amount)) {
        continue;
      }

      await pool.query(
        `
          INSERT INTO transactions (type, date, period_month, description, category_id, category_kind, amount, source, currency, tenant_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          type,
          date,
          `${date.slice(0, 7)}-01`,
          description,
          categoryByKind[kind] || null,
          kind,
          amount,
          source,
          'USD',
          defaultTenantId,
        ]
      );
    }

    console.log('Seed completed from CSV.');
    return;
  }

  console.log('No CSV found, skipping import.');
};

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seed failed', err);
    pool.end();
    process.exit(1);
  });
