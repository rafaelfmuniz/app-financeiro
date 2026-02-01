# AGENTS.md

Guidelines para AI Agents trabalhando neste projeto.

## 🎯 Visão Geral do Projeto

**Controle Financeiro** é um sistema multi-tenant de gestão financeira construído com:
- **Backend**: Node.js + Express + PostgreSQL
- **Frontend**: React + Vite
- **Padrão**: Monorepo com workspaces npm

## 📋 Convenções de Código

### Nomenclatura

```javascript
// ✅ Variáveis: camelCase
const userData = { email: 'user@example.com' };
const transactionValue = 100.50;

// ✅ Funções: camelCase descritivo
const getTransactionsByCategory = async (userId, categoryId) => { };
const calculateMonthlyBalance = (transactions) => { };

// ✅ Constantes: UPPER_SNAKE_CASE
const MAX_LOGIN_ATTEMPTS = 5;
const JWT_EXPIRATION_DAYS = 7;
const DEFAULT_CURRENCY = 'BRL';

// ✅ Rotas: kebab-case nos endpoints
router.get('/api/user-transactions', auth, handler);
router.post('/api/bulk-import', auth, handler);
```

### Async/Await

```javascript
// ✅ SEMPRE use async/await com try/catch
router.get('/api/dados', auth, async (req, res) => {
  try {
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[ROUTE_NAME] Error:', err);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// ❌ NUNCA use callbacks aninhados
// router.get('/api/dados', auth, (req, res) => {
//   query(sql, params, (err, result) => { ... });
// });
```

### SQL Seguro

```javascript
// ✅ SEMPRE use prepared statements
await query('SELECT * FROM users WHERE id = $1', [userId]);
await query(
  'INSERT INTO transactions (user_id, value, description) VALUES ($1, $2, $3)',
  [userId, value, description]
);

// ❌ NUNCA concatene strings SQL
// await query(`SELECT * FROM users WHERE id = ${userId}`);
```

### Logs Descritivos

```javascript
// ✅ BOM: Contexto claro e prefixo
console.log('[TRANSACTIONS] Creating transaction for user:', userId);
console.error('[TRANSACTIONS] Failed to create:', err.message);
console.log('[AUTH] Login attempt for:', email);

// ❌ RUIM: Vago ou sem contexto
console.log('Error');
console.log('Done');
```

## 🗄️ Banco de Dados

### Estrutura Principal

```sql
-- Users (com tenant)
users (id, email, password_hash, name, username, tenant_id, created_at)

-- Categories
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) DEFAULT '#22c55e',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Transactions
CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  category_id INT REFERENCES categories(id),
  type VARCHAR(10) CHECK (type IN ('income', 'expense')),
  value DECIMAL(10,2) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tenants
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- App Settings (SMTP config encrypted)
CREATE TABLE app_settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Padrão de Query

```javascript
// Buscar dados do usuário atual (sempre filtrar por tenant quando aplicável)
const result = await query(
  'SELECT * FROM transactions WHERE user_id = $1 AND tenant_id = $2 ORDER BY date DESC',
  [req.user.id, req.user.tenant_id]
);

// Inserir com RETURNING
const result = await query(
  'INSERT INTO categories (user_id, name, color) VALUES ($1, $2, $3) RETURNING *',
  [req.user.id, name, color]
);
```

## 🔐 Autenticação

### Uso do Middleware

```javascript
// ✅ Proteger rotas sempre
router.get('/api/protected-route', auth, async (req, res) => {
  // req.user contém: { id, email, tenant_id, ... }
  const userId = req.user.id;
  const tenantId = req.user.tenant_id;
});

// Rotas públicas (sem auth)
router.post('/api/auth/login', async (req, res) => { });
```

### Header Authorization

```javascript
// Cliente envia:
headers: {
  'Authorization': 'Bearer <jwt_token>'
}

// Middleware auth extrai e valida automaticamente
```

## 📧 Sistema de Email

### Configuração SMTP

```javascript
// Config é armazenada criptografada no banco
// Use smtp.js para gerenciar
const smtpConfig = await getSmtpConfig();

// Enviar email
await sendMail({
  to: 'user@example.com',
  subject: 'Assunto',
  html: '<p>Corpo do email</p>'
});
```

### Provedores Suportados

- Gmail (smtp.gmail.com:587)
- Outlook (smtp.office365.com:587)
- SMTP customizado
- Qualquer provedor RFC-compliant

## 🧪 Testes

### Testar API Manualmente

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin","password":"admin123"}'

# Usar token retornado
curl -X GET http://localhost:3000/api/dashboard \
  -H "Authorization: Bearer <token>"

# Criar transação
curl -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"type":"expense","value":100.50,"description":"Test","category_id":1}'
```

## 🚀 Deploy

### Estrutura de Produção

```
/opt/controle-financeiro/
├── backend/
│   ├── src/
│   ├── package.json
│   └── .env (gerado pelo install.sh)
├── scripts/
│   └── deploy/
│       ├── install.sh
│       ├── update.sh
│       └── backup.sh
└── credentials.txt (gerado automaticamente)
```

### Comandos Deploy

```bash
# Instalação limpa
sudo bash scripts/deploy/install.sh

# Atualização (preserva dados)
sudo bash scripts/deploy/update.sh

# Backup manual
sudo bash scripts/deploy/backup.sh
```

## 📝 Tarefas Comuns

### Adicionar Nova Rota API

1. Criar arquivo em `backend/src/routes/nome-da-rota.js`
2. Seguir padrão existente (ver routes/transactions.js)
3. Registrar em `backend/src/server.js`
4. Adicionar teste manual (curl/Postman)

### Adicionar Nova Tabela

1. Adicionar CREATE TABLE em `backend/src/db.js` na função `createTables`
2. Criar rota correspondente
3. Testar inserção e consulta
4. Documentar no schema

### Modificar Frontend

1. Editar componente em `frontend/src/App.jsx` ou criar novo
2. Usar api.js para chamadas HTTP
3. Testar em dev: `npm run dev`
4. Build: `npm run build`

## ⚠️ Regras Importantes

### NUNCA faça:

❌ Expor senhas ou tokens em logs ou respostas  
❌ Concatenar SQL diretamente (SQL injection)  
❌ Ignorar erros com catch vazio  
❌ Commitar .env ou arquivos sensíveis  
❌ Quebrar compatibilidade de API sem versionar  

### SEMPRE faça:

✅ Usar prepared statements em queries  
✅ Adicionar logs descritivos com prefixo  
✅ Tratar erros com try/catch  
✅ Validar input do usuário  
✅ Testar antes de commitar  
✅ Atualizar CHANGELOG.md  

## 🔍 Troubleshooting

### Erro Comuns

**"Cannot find module 'pg'"**
```bash
cd backend && npm install
```

**"ECONNREFUSED 127.0.0.1:5432"**
PostgreSQL não está rodando:
```bash
# Linux
sudo systemctl start postgresql

# Windows
pg_ctl start
```

**"JWT verification failed"**
- Verificar JWT_SECRET no .env
- Token pode estar expirado (7 dias)

## 📚 Referências

- [README.md](./README.md) - Documentação principal
- [CHANGELOG.md](./CHANGELOG.md) - Histórico de mudanças
- Estrutura do projeto segue padrão do [socialbluepro](https://github.com/rafaelfmuniz/socialbluepro)

---

**Última atualização:** 2026-01-31  
**Versão:** 1.0.0
