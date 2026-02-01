# 💰 Controle Financeiro

> Sistema de Controle Financeiro Multi-tenant com Dashboard, Relatórios e Gestão de Usuários

[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18+-blue)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-13+-blue)](https://www.postgresql.org/)
[![Express](https://img.shields.io/badge/Express-4.x-lightgrey)](https://expressjs.com/)

---

## 📋 Índice

- [Visão Geral](#visão-geral)
- [Tecnologias](#tecnologias)
- [Arquitetura](#arquitetura)
- [Funcionalidades](#funcionalidades)
- [Instalação](#instalação)
- [Desenvolvimento](#desenvolvimento)
- [Deploy](#deploy)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Comandos](#comandos)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Contribuição](#contribuição)

---

## 🎯 Visão Geral

O **Controle Financeiro** é uma aplicação web moderna para gestão financeira pessoal e empresarial com:

- **Multi-tenant**: Suporte a múltiplas empresas/usuários isolados
- **Dashboard em Tempo Real**: Visualização de saldos, entradas e saídas
- **Relatórios Completos**: Gráficos mensais, anuais e por categoria
- **Gestão de Categorias**: Organização personalizada de receitas e despesas
- **Sistema de Email**: Configuração SMTP dinâmica para notificações
- **Autenticação JWT**: Segura com proteção brute-force
- **API REST**: Completa e documentada

---

## 🚀 Tecnologias

### Core Stack

| Tecnologia | Versão | Propósito |
|-----------|--------|-----------|
| **Node.js** | 18+ | Runtime JavaScript |
| **Express** | 4.x | Framework web |
| **React** | 18+ | Biblioteca UI |
| **Vite** | 5.x | Build tool |
| **PostgreSQL** | 13+ | Banco de dados relacional |
| **Nodemailer** | 6.x | Envio de emails |

### Bibliotecas Principais

```json
{
  "bcryptjs": "^2.4.3",
  "jsonwebtoken": "^9.0.2",
  "pg": "^8.12.0",
  "axios": "^1.7.2",
  "recharts": "^3.6.0"
}
```

---

## 🏗️ Arquitetura

### Padrão: Monolito Full-Stack

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENTE (Browser)                        │
│  React SPA → Comunica via HTTP/JSON com API Backend         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTP REST API
                         │
┌────────────────────────▼────────────────────────────────────┐
│                 EXPRESS.JS SERVER (Node.js)                  │
│  Port 3000 - Processa requisições, lógica de negócio        │
│                                                              │
│  ├── Autenticação (JWT)                                     │
│  ├── Rotas de API (/api/*)                                  │
│  ├── Servir frontend estático                               │
│  └── Validação de dados                                     │
└────────┬─────────────────────┬──────────────────────────────┘
         │                      │
    ┌────▼───────┐         ┌───▼──────────┐
    │ PostgreSQL  │         │ Nodemailer   │
    │ Database    │         │ (Email/SMTP) │
    └────────────┘         └──────────────┘
```

### Fluxo de Requisição

```
1. CLIENTE (Frontend)
   └─> Faz requisição HTTP
       GET /api/dashboard
       POST /api/transactions
       
2. EXPRESS SERVER
   ├─> Middleware (cors, json parser)
   ├─> AUTENTICAÇÃO
   │   └─> Valida JWT token
   ├─> ROTA HANDLER
   │   ├─> Query ao banco de dados
   │   └─> Retorna resposta JSON
   
3. RESPOSTA (JSON)
   ├─> Sucesso: 200 + dados
   └─> Erro: 4xx ou 5xx + mensagem
```

---

## ✨ Funcionalidades

### 1. 🔐 Autenticação
- Login com email/senha
- JWT token com expiração de 7 dias
- Proteção brute-force (bloqueio após tentativas)
- Reset de senha via senha temporária

### 2. 📊 Dashboard
- Resumo de saldo atual
- Entradas e saídas do mês
- Gráfico de gastos por categoria
- Últimas transações

### 3. 💰 Transações
- CRUD completo (receitas e despesas)
- Filtros por data, categoria e descrição
- Importação CSV
- Categorização automática

### 4. 🏷️ Categorias
- CRUD de categorias personalizadas
- Cores para identificação visual
- Relatórios por categoria

### 5. 📈 Relatórios
- Gráficos mensais e anuais
- Comparativo de períodos
- Exportação de dados
- Análise por categoria

### 6. ⚙️ Administração
- Configuração SMTP dinâmica
- Teste de envio de email
- Gestão de tenants
- Logs do sistema

---

## 📦 Instalação

### Instalação Automatizada (Ubuntu/Debian)

Execute em seu servidor:

```bash
curl -fsSL https://raw.githubusercontent.com/rafaelfmuniz/app-financeiro/main/scripts/deploy/install.sh | sudo bash
```

O instalador irá:
- Instalar Node.js, PostgreSQL e dependências
- Criar banco de dados e usuário dedicado
- Configurar serviço systemd
- Iniciar a aplicação automaticamente

### Instalação Manual

#### 1. Pré-requisitos

```bash
# Node.js 18+
node --version

# PostgreSQL 13+
psql --version
```

#### 2. Clone o Repositório

```bash
git clone https://github.com/rafaelfmuniz/app-financeiro.git
cd app-financeiro
```

#### 3. Instale as Dependências

```bash
# Instala em todos os workspaces
npm run install:all
```

#### 4. Configure o Banco de Dados

```bash
# Acesse o PostgreSQL
psql -U postgres

# Crie o banco e usuário
CREATE DATABASE controle_financeiro;
CREATE USER finance_user WITH PASSWORD 'senha_segura';
GRANT ALL PRIVILEGES ON DATABASE controle_financeiro TO finance_user;
\q
```

#### 5. Configure as Variáveis de Ambiente

```bash
cp backend/.env.sample backend/.env
# Edite backend/.env com suas configurações
```

#### 6. Inicialize o Banco

```bash
npm run seed
```

#### 7. Inicie a Aplicação

```bash
# Desenvolvimento
npm run dev

# Produção
npm run build
npm start
```

---

## 💻 Desenvolvimento

### Comandos Disponíveis

```bash
# Desenvolvimento (backend + frontend)
npm run dev

# Apenas backend
npm run dev:backend

# Apenas frontend
npm run dev:frontend

# Build do frontend
npm run build:frontend

# Build completo
npm run build

# Iniciar em produção
npm start

# Seed do banco de dados
npm run seed
```

### Estrutura de Desenvolvimento

```
backend/src/
├── server.js              # Express app
├── db.js                  # PostgreSQL connection
├── email.js               # Email sender
├── smtp.js                # SMTP config
├── seed.js                # Initial data
├── middleware/
│   └── auth.js            # JWT authentication
├── routes/                # API endpoints
│   ├── auth.js
│   ├── dashboard.js
│   ├── transactions.js
│   ├── categories.js
│   ├── reports.js
│   ├── admin.js
│   ├── tenants.js
│   └── users.js
└── utils/
    └── build-frontend.js

frontend/src/
├── main.jsx               # React entry
├── App.jsx                # Main component
├── api.js                 # HTTP client
└── styles.css
```

### Padrão de Código

```javascript
// ✅ BOM: Async/await com tratamento de erro
router.get('/api/dados', auth, async (req, res) => {
  try {
    const resultado = await query(sql, params);
    res.json(resultado.rows);
  } catch (err) {
    console.error('[ROTA] Erro:', err);
    res.status(500).json({ error: 'Erro ao buscar dados' });
  }
});

// ✅ BOM: SQL seguro (prepared statements)
await query('SELECT * FROM users WHERE id = $1', [userId]);

// ✅ BOM: Logs descritivos
console.log('[TRANSACTIONS] Criando transação para user:', userId);
```

---

## 🚀 Deploy

### Usando o Script de Deploy

```bash
# Clone o repositório no servidor
git clone https://github.com/rafaelfmuniz/app-financeiro.git /opt/controle-financeiro
cd /opt/controle-financeiro

# Execute o instalador
sudo bash scripts/deploy/install.sh
```

### Configuração Nginx (Opcional)

```nginx
server {
    listen 80;
    server_name seu-dominio.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Comandos do Sistema

```bash
# Iniciar
sudo systemctl start controle-financeiro

# Parar
sudo systemctl stop controle-financeiro

# Reiniciar
sudo systemctl restart controle-financeiro

# Status
sudo systemctl status controle-financeiro

# Logs
sudo journalctl -u controle-financeiro -f
```

---

## 🔧 Variáveis de Ambiente

### Backend (.env)

```env
# Ambiente
NODE_ENV=production

# Banco de Dados
DB_HOST=localhost
DB_PORT=5432
DB_USER=finance_user
DB_PASS=senha_segura
DB_NAME=controle_financeiro

# Servidor
PORT=3000
JWT_SECRET=chave_secreta_jwt_aleatoria

# Master User
MASTER_EMAIL=admin@example.com
MASTER_PASSWORD=senha_admin
MASTER_NAME=Administrador
MASTER_USERNAME=admin
DEFAULT_TENANT_NAME=Principal

# SMTP (Opcional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=seu_email@gmail.com
SMTP_PASS=sua_app_password
SMTP_FROM=Controle Financeiro <noreply@exemplo.com>
SMTP_REPLY_TO=suporte@exemplo.com
APP_BASE_URL=http://localhost:3000
```

---

## ⌨️ Comandos

### Desenvolvimento

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Inicia backend e frontend em modo desenvolvimento |
| `npm run dev:backend` | Apenas backend |
| `npm run dev:frontend` | Apenas frontend |
| `npm run build` | Build do frontend para produção |
| `npm start` | Inicia servidor em produção |
| `npm run seed` | Popula banco com dados iniciais |

### Deploy

| Comando | Descrição |
|---------|-----------|
| `sudo systemctl start controle-financeiro` | Inicia serviço |
| `sudo systemctl stop controle-financeiro` | Para serviço |
| `sudo systemctl restart controle-financeiro` | Reinicia serviço |
| `sudo journalctl -u controle-financeiro -f` | Logs em tempo real |

---

## 📁 Estrutura do Projeto

```
app-financeiro/
│
├── 📁 backend/                    # Backend Express
│   ├── package.json
│   ├── .env.sample
│   └── src/
│       ├── server.js
│       ├── db.js
│       ├── email.js
│       ├── smtp.js
│       ├── seed.js
│       ├── middleware/
│       │   └── auth.js
│       ├── routes/
│       │   ├── auth.js
│       │   ├── dashboard.js
│       │   ├── transactions.js
│       │   ├── categories.js
│       │   ├── reports.js
│       │   ├── admin.js
│       │   ├── tenants.js
│       │   └── users.js
│       └── utils/
│           └── build-frontend.js
│
├── 📁 frontend/                   # Frontend React
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api.js
│       └── styles.css
│
├── 📁 scripts/                    # Scripts de deploy
│   └── deploy/
│       ├── install.sh
│       ├── update.sh
│       ├── backup.sh
│       └── config/
│           ├── nginx/
│           └── systemd/
│
├── 📄 .gitignore
├── 📄 .env.example
├── 📄 README.md                   # Este arquivo
├── 📄 CHANGELOG.md                # Histórico de versões
├── 📄 AGENTS.md                   # Guidelines para AI agents
└── 📄 package.json                # Configuração monorepo
```

---

## 🗄️ Banco de Dados

### Schema Principal

```sql
-- Usuários
users (id, email, password_hash, name, username, tenant_id, created_at)

-- Categorias
categories (id, user_id, name, color, created_at)

-- Transações
transactions (id, user_id, category_id, type, value, description, date, created_at)

-- Tenants
tenants (id, name, created_at)

-- Configurações SMTP
app_settings (key, value, updated_at)

-- Audit Logs
audit_logs (id, user_id, action, details, created_at)
```

---

## 🤝 Contribuição

### Guidelines

1. Siga o padrão de código existente
2. Use async/await com try/catch
3. Valide todas as entradas de usuário
4. Adicione logs descritivos
5. Teste antes de commitar
6. Atualize o CHANGELOG.md

### Para Agents AI

Consulte o arquivo `AGENTS.md` para guidelines específicas.

---

## 📝 Licença

Este projeto é privado e proprietário.

---

## 📞 Suporte

Para dúvidas ou suporte, consulte:
- [CHANGELOG.md](./CHANGELOG.md) - Histórico de mudanças
- [AGENTS.md](./AGENTS.md) - Guidelines de desenvolvimento

---

**Last Update:** 2026-01-31  
**Version:** 1.0.0
