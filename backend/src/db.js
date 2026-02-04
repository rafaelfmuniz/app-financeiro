const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS ?? '',
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 5432),
});

const ensureSchema = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      ALTER TABLE tenants
      DROP CONSTRAINT IF EXISTS tenants_name_key;
    `);
    const defaultTenantName = process.env.DEFAULT_TENANT_NAME || 'Principal';
    const tenantCount = await client.query('SELECT COUNT(*)::int AS total FROM tenants');
    let defaultTenantId = null;
    if (Number(tenantCount.rows[0]?.total || 0) === 0) {
      const tenantInsert = await client.query(
        'INSERT INTO tenants (name) VALUES ($1) RETURNING id',
        [defaultTenantName]
      );
      defaultTenantId = tenantInsert.rows[0]?.id || null;
    } else {
      const existingDefault = await client.query(
        'SELECT id FROM tenants WHERE name = $1 ORDER BY id LIMIT 1',
        [defaultTenantName]
      );
      if (existingDefault.rowCount > 0) {
        defaultTenantId = existingDefault.rows[0].id;
      } else {
        const firstTenant = await client.query('SELECT id FROM tenants ORDER BY id LIMIT 1');
        defaultTenantId = firstTenant.rows[0]?.id || null;
      }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        username TEXT,
        name TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'guest')),
        is_master BOOLEAN NOT NULL DEFAULT false,
        tenant_id INTEGER REFERENCES tenants(id),
        can_view BOOLEAN NOT NULL DEFAULT true,
        can_create BOOLEAN NOT NULL DEFAULT false,
        can_edit BOOLEAN NOT NULL DEFAULT false,
        can_delete BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS smtp_settings (
        id INTEGER PRIMARY KEY,
        host TEXT,
        port INTEGER,
        secure BOOLEAN NOT NULL DEFAULT false,
        username TEXT,
        password_encrypted TEXT,
        from_address TEXT,
        reply_to TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      INSERT INTO smtp_settings (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS name TEXT;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS username TEXT;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_master BOOLEAN NOT NULL DEFAULT false;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
    `);
    await client.query(`
      DROP INDEX IF EXISTS users_username_idx;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS users_username_idx
      ON users (username);
    `);
    await client.query(`
      UPDATE users
      SET username = SPLIT_PART(email, '@', 1)
      WHERE username IS NULL;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS can_view BOOLEAN NOT NULL DEFAULT true;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS can_create BOOLEAN NOT NULL DEFAULT false;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS can_edit BOOLEAN NOT NULL DEFAULT false;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT false;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS temp_password_hash TEXT;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS temp_password_expires TIMESTAMP;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT false;
    `);
    await client.query(`
      UPDATE users
      SET tenant_id = $1
      WHERE tenant_id IS NULL AND (is_master IS NULL OR is_master = false)
    `, [defaultTenantId]);
    if (process.env.MASTER_EMAIL) {
      await client.query(
        'UPDATE users SET is_master = true WHERE email = $1',
        [process.env.MASTER_EMAIL]
      );
    }
    await client.query(`
      UPDATE users
      SET can_view = true
      WHERE can_view IS NULL;
    `);
    await client.query(`
      UPDATE users
      SET must_reset_password = false
      WHERE must_reset_password IS NULL;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS refresh_tokens_token_hash_idx
      ON refresh_tokens (token_hash);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx
      ON refresh_tokens (expires_at);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx
      ON refresh_tokens (user_id);
    `);
    await client.query(`
      UPDATE users
      SET can_view = true, can_create = true, can_edit = true, can_delete = true
      WHERE role = 'admin';
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        tenant_id INTEGER REFERENCES tenants(id),
        kind TEXT NOT NULL DEFAULT 'variable',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      ALTER TABLE categories
      ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
    `);
    await client.query(`
      UPDATE categories
      SET tenant_id = $1
      WHERE tenant_id IS NULL
    `, [defaultTenantId]);
    await client.query(`
      ALTER TABLE categories
      DROP CONSTRAINT IF EXISTS categories_name_key;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_name_idx
      ON categories (tenant_id, name);
    `);
    await client.query(`
      ALTER TABLE categories
      ADD COLUMN IF NOT EXISTS kind TEXT;
    `);
    await client.query(`
      ALTER TABLE categories
      ALTER COLUMN kind SET DEFAULT 'variable';
    `);
    await client.query(`
      UPDATE categories
      SET kind = 'variable'
      WHERE kind IS NULL;
    `);
    await client.query(`
      UPDATE categories
      SET kind = 'fixed'
      WHERE LOWER(name) IN ('telefone', 'carro', 'aluguel apt', 'seguro carro');
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        date DATE,
        period_month DATE NOT NULL,
        recurrence_type TEXT NOT NULL DEFAULT 'one_time',
        recurrence_group_id TEXT,
        description TEXT NOT NULL,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        category_kind TEXT NOT NULL DEFAULT 'variable',
        amount NUMERIC(12, 2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        tenant_id INTEGER REFERENCES tenants(id),
        source TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_summaries (
        period_month DATE NOT NULL,
        tenant_id INTEGER REFERENCES tenants(id),
        income_total NUMERIC(12, 2) NOT NULL,
        expense_total NUMERIC(12, 2) NOT NULL,
        balance NUMERIC(12, 2) NOT NULL
      );
    `);
    await client.query(`
      UPDATE categories
      SET kind = 'income'
      WHERE kind <> 'fixed'
        AND id IN (
          SELECT c.id
          FROM categories c
          JOIN transactions t ON t.category_id = c.id
          GROUP BY c.id
          HAVING SUM(CASE WHEN t.type = 'expense' THEN 1 ELSE 0 END) = 0
        );
    `);
    await client.query(`
      INSERT INTO categories (tenant_id, name, kind)
      SELECT t.id, v.name, v.kind
      FROM tenants t
      CROSS JOIN (
        VALUES
          ('Despesa fixa', 'fixed'),
          ('Despesa vari�vel', 'variable'),
          ('Receita', 'income')
      ) AS v(name, kind)
      WHERE NOT EXISTS (
        SELECT 1 FROM categories c WHERE c.tenant_id = t.id AND c.kind = v.kind
      );
    `);
    await client.query(`
      UPDATE categories
      SET name = 'Despesa vari�vel'
      WHERE name = 'Despesa vari�vel';
    `);
    await client.query(`
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS period_month DATE;
    `);
    await client.query(`
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS recurrence_type TEXT;
    `);
    await client.query(`
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS recurrence_group_id TEXT;
    `);
    await client.query(`
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
    `);
    await client.query(`
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS category_kind TEXT;
    `);
    await client.query(`
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS currency TEXT;
    `);
    await client.query(`
      UPDATE transactions
      SET tenant_id = $1
      WHERE tenant_id IS NULL
    `, [defaultTenantId]);
    await client.query(`
      UPDATE transactions t
      SET category_id = c.id
      FROM categories c
      WHERE t.category_id IS NULL
        AND t.tenant_id = c.tenant_id
        AND c.name IN ('Despesa fixa', 'Despesa vari�vel', 'Despesa vari�vel', 'Receita')
        AND (
          (t.type = 'income' AND c.kind = 'income')
          OR (t.type = 'expense' AND t.category_kind = c.kind)
        );
    `);
    await client.query(`
      UPDATE transactions
      SET recurrence_type = 'one_time'
      WHERE recurrence_type IS NULL;
    `);
    await client.query(`
      UPDATE transactions
      SET category_kind = CASE
        WHEN type = 'income' THEN 'income'
        WHEN LOWER(TRIM(description)) IN ('telefone', 'carro', 'aluguel apt', 'seguro carro') THEN 'fixed'
        ELSE 'variable'
      END
      WHERE category_kind IS NULL;
    `);
    await client.query(`
      UPDATE transactions
      SET currency = 'USD'
      WHERE currency IS NULL;
    `);
    await client.query(`
      ALTER TABLE transactions
      ALTER COLUMN date DROP NOT NULL;
    `);
    await client.query(`
      UPDATE transactions
      SET period_month = DATE_TRUNC('month', date)::date
      WHERE period_month IS NULL AND date IS NOT NULL;
    `);
    await client.query(`
      ALTER TABLE transactions
      ALTER COLUMN category_kind SET DEFAULT 'variable';
    `);
    await client.query(`
      ALTER TABLE transactions
      ALTER COLUMN currency SET DEFAULT 'USD';
    `);
    await client.query(`
      ALTER TABLE transactions
      ALTER COLUMN period_month SET NOT NULL;
    `);
    await client.query(`
      ALTER TABLE transactions
      ALTER COLUMN category_kind SET NOT NULL;
    `);
    await client.query(`
      ALTER TABLE transactions
      ALTER COLUMN currency SET NOT NULL;
    `);
    await client.query(`
      ALTER TABLE transactions
      ALTER COLUMN tenant_id SET NOT NULL;
    `);
    await client.query(`
      ALTER TABLE monthly_summaries
      ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
    `);
    await client.query(`
      UPDATE monthly_summaries
      SET tenant_id = $1
      WHERE tenant_id IS NULL
    `, [defaultTenantId]);
    await client.query(`
      ALTER TABLE monthly_summaries
      DROP CONSTRAINT IF EXISTS monthly_summaries_pkey;
    `);
    await client.query(`
      ALTER TABLE monthly_summaries
      ADD PRIMARY KEY (tenant_id, period_month);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS transactions_period_month_idx
      ON transactions (period_month);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS transactions_recurrence_group_idx
      ON transactions (recurrence_group_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS transactions_tenant_idx
      ON transactions (tenant_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS transactions_date_idx
      ON transactions (date);
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const ensureMasterUser = async () => {
  const email = process.env.MASTER_EMAIL;
  const password = process.env.MASTER_PASSWORD;
  if (!email || !password) {
    return;
  }
  const name = process.env.MASTER_NAME || 'Master';
  const username = process.env.MASTER_USERNAME || email.split('@')[0];

  const byEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (byEmail.rowCount > 0) {
    await pool.query('UPDATE users SET is_master = true, tenant_id = NULL WHERE email = $1', [email]);
    return;
  }

  const byUsername = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (byUsername.rowCount > 0) {
    // Se já existe um usuário com este username, apenas promovemos a master e não inserimos outro.
    await pool.query('UPDATE users SET is_master = true, tenant_id = NULL WHERE username = $1', [username]);
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `
      INSERT INTO users (email, username, name, password_hash, role, is_master, tenant_id, can_view, can_create, can_edit, can_delete)
      VALUES ($1, $2, $3, $4, $5, true, NULL, true, true, true, true)
    `,
    [email, username, name, hash, 'admin']
  );
};

module.exports = {
  pool,
  ensureSchema,
  ensureMasterUser,
};


