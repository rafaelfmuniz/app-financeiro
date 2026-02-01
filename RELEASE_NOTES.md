# 🎉 Release v1.0.0 - Controle Financeiro

**Data:** 31 de Janeiro de 2026  
**Tag:** [v1.0.0](../../releases/tag/v1.0.0)

---

## 🚀 O que há de novo

Primeira release estável do **Controle Financeiro** - Sistema completo de gestão financeira multi-tenant!

### ✨ Principais Features

- **🏢 Multi-tenant Architecture**
  - Suporte a múltiplas empresas/usuários isolados
  - Gestão completa de tenants
  - Dados segregados por tenant

- **📊 Dashboard em Tempo Real**
  - Visualização de saldo atual
  - Entradas e saídas do mês
  - Gráficos de gastos por categoria
  - Últimas transações

- **💰 Gestão Financeira Completa**
  - CRUD de transações (receitas e despesas)
  - Categorias personalizadas com cores
  - Filtros avançados por data/categoria
  - Importação CSV
  - Relatórios mensais e anuais

- **🔐 Segurança Enterprise**
  - Autenticação JWT com expiração de 7 dias
  - Proteção brute-force (bloqueio após tentativas)
  - Reset de senha via senha temporária
  - Criptografia AES-256-GCM para dados sensíveis
  - SQL injection protection (prepared statements)
  - Hash de senhas com bcrypt (10 salts)

- **📧 Sistema de Email Profissional**
  - Configuração SMTP dinâmica via interface web
  - Suporte a Gmail, Outlook e SMTP customizado
  - Teste de envio integrado
  - Credenciais criptografadas no banco

- **⚙️ Administração Completa**
  - Painel administrativo
  - Configurações de sistema
  - Gestão de usuários
  - Logs de auditoria

- **🛠️ DevOps Profissional**
  - Scripts de deploy automatizado
  - Instalação em uma linha
  - Configuração Systemd
  - Nginx reverse proxy ready
  - Backup automático
  - Atualização simplificada

---

## 📦 Instalação

### Método 1: Script de Instalação (Recomendado)

```bash
curl -fsSL https://raw.githubusercontent.com/rafaelfmuniz/app-financeiro/v1.0.0/scripts/deploy/install.sh | sudo bash
```

### Método 2: Clone e Instalação Manual

```bash
git clone --branch v1.0.0 https://github.com/rafaelfmuniz/app-financeiro.git
cd app-financeiro
npm run install:all
npm run seed
npm start
```

---

## 🏗️ Stack Tecnológico

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| **Backend** | Node.js | 18+ |
| | Express | 4.x |
| | PostgreSQL | 13+ |
| | Nodemailer | 6.x |
| **Frontend** | React | 18+ |
| | Vite | 5.x |
| **DevOps** | Systemd | - |
| | Nginx | Opcional |

---

## 📁 Estrutura do Projeto

```
app-financeiro/
├── backend/           # Express + PostgreSQL
├── frontend/          # React + Vite
├── scripts/deploy/    # Scripts de deploy
├── README.md          # Documentação
├── CHANGELOG.md       # Histórico
└── AGENTS.md          # Guidelines dev
```

---

## 🔧 Comandos Úteis

```bash
# Desenvolvimento
npm run dev              # Backend + Frontend
npm run dev:backend      # Apenas backend
npm run dev:frontend     # Apenas frontend

# Produção
npm run build           # Build do frontend
npm start               # Inicia em produção

# Deploy
sudo systemctl start controle-financeiro
sudo systemctl status controle-financeiro
sudo journalctl -u controle-financeiro -f
```

---

## 📚 Documentação

- 📖 [README.md](../../blob/main/README.md) - Documentação completa
- 🏗️ [Arquitetura](../../blob/main/README.md#arquitetura) - Visão técnica
- 💻 [Desenvolvimento](../../blob/main/README.md#desenvolvimento) - Como contribuir
- 🔧 [Deploy](../../blob/main/README.md#deploy) - Guia de produção

---

## ⚠️ Breaking Changes

Nenhuma - esta é a release inicial.

---

## 🐛 Bug Fixes

N/A - release inicial

---

## 🙏 Agradecimentos

Estrutura do projeto baseada em [socialbluepro](https://github.com/rafaelfmuniz/socialbluepro) - padrão profissional de organização.

---

## 📞 Suporte

- 🐛 **Issues:** [GitHub Issues](../../issues)
- 📧 **Email:** Consulte a documentação
- 💬 **Discussões:** [GitHub Discussions](../../discussions)

---

## 📝 Licença

Este projeto é privado e proprietário.

---

<div align="center">

**🚀 Pronto para produção!**

[![Download v1.0.0](https://img.shields.io/badge/download-v1.0.0-blue)](../../archive/refs/tags/v1.0.0.zip)

</div>
