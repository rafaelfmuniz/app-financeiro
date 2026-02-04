# 🎉 Release v1.1.0 - Sistema de Refresh Token

**Data:** 3 de Fevereiro de 2026  
**Tag:** [v1.1.0](../../releases/tag/v1.1.0)

---

## 🚀 O que há de novo

### Sistema de Refresh Token Profissional

- **🔐 Access Token Curto:** 15 minutos de validade (reduzido de 8 horas)
  - Reduz janela de ataque drasticamente
  - Renova automaticamente enquanto usuário está ativo
  - Segurança de nível enterprise/bigtech

- **🔄 Refresh Token Médio:** 30 minutos de validade
  - Sessão máxima permitida: 30 minutos
  - Padrão de segurança enterprise
  - Usuário ativo: tokens renovam automaticamente
  - Após 30 min: login obrigatório (mesmo se estiver usando)

- **🔄 Rotação Automática de Tokens:**
  - Novo refresh token emitido em cada refresh
  - Prevenção de reuso de tokens
  - Tokens antigos invalidados automaticamente

### Novos Endpoints API

- **`POST /api/auth/refresh`** - Renova tokens expirados
  - Valida refresh token
  - Emite novo access token e novo refresh token
  - Remove refresh token antigo (rotação)

- **`POST /api/auth/logout`** - Encerra sessão completamente
  - Invalida refresh token no banco
  - Remove todos os tokens do usuário
  - Previne reuso de sessões

### Alterações no Frontend

- **🛡️ Interceptor de Response Automático:**
  - Detecta erro 401 automaticamente
  - Tenta refresh de token antes de mostrar erro
  - Repete requisição original automaticamente
  - Usuário nem percebe que o token expirou

- **🔔 Notificação de Sessão Expirada:**
  - Toast amigável quando refresh token expira
  - "Sessão expirada. Por favor, faça login novamente."
  - Redirecionamento automático para login

- **✅ Verificação Inicial de Token:**
  - Ao carregar a página, verifica se token ainda é válido
  - Se expirou, tenta refresh automático
  - Se refresh expirou, redireciona para login

- **💾 Persistência Automática:**
  - Fechar e reabrir navegador funciona (por até 30 min)
  - Sessão mantida sem precisar re-login
  - Após 30 min: login obrigatório

### Alterações no Backend

- **📊 Nova Tabela `refresh_tokens`:**
  - Armazena tokens de refresh de forma segura
  - Token hash com SHA-256
  - Expiração automática de tokens
  - Cascata ao deletar usuário

- **🗑️ Limpeza Automática de Tokens:**
  - Remove tokens expirados do banco
  - Executado automaticamente em cada refresh
  - Melhora performance do banco

- **🔒 Segurança Melhorada:**
  - Configuração via variáveis de ambiente
  - `JWT_ACCESS_EXPIRATION=15m`
  - `JWT_REFRESH_EXPIRATION=30m`
  - `JWT_REFRESH_SECRET` opcional

---

## 🛠️ Alterações Compatíveis

### Comportamento da Sessão

| Situação | Comportamento Antes (v1.0.0) | Comportamento Novo (v1.1.0) |
|----------|----------------------------------|--------------------------------|
| **Acesso via API** | Token válido por 8 horas | Token válido por 15 minutos |
| **Fechar navegador** | Sessão mantida por 8 horas | Sessão mantida por 30 minutos |
| **Reabrir após 5 min** | Ainda logado | Ainda logado |
| **Reabrir após 20 min** | Ainda logado | Ainda logado |
| **Reabrir após 40 min** | Ainda logado | **Login obrigatório** |
| **Token expira** | Erro 401, travamento | **Refresh automático, transparente** |
| **Usuário ativo** | Sessão se perde após 8h | Sessão se estende automaticamente |

### Benefícios da Nova Autenticação

✅ **Segurança:** Janela de ataque reduzida de 8h → 15min  
✅ **Experiência:** Refresh automático, usuário nem percebe  
✅ **Profissional:** Padrão enterprise/bigtech de 30min de sessão  
✅ **Conveniente:** Pode fechar/reabrir navegador rapidamente  
✅ **Controle:** Sessão expira mesmo se usuário ativo por 30min  

---

## 📦 Instalação

### Nova Instalação (Recomendado)

**INSTALADOR 100% AUTOMATIZADO - ZERO PERGUNTAS**

```bash
curl -fsSL https://raw.githubusercontent.com/rafaelfmuniz/app-financeiro/main/scripts/deploy/install.sh | sudo bash
```

**O instalador cria automaticamente:**
- ✅ Banco de dados PostgreSQL com credenciais geradas
- ✅ Usuário e senha do banco (auto-gerados)
- ✅ Conta de administrador (auto-gerada)
- ✅ Secrets JWT (auto-gerados)
- ✅ Todas as tabelas do banco (migrations)
- ✅ Dependências npm instaladas
- ✅ Frontend compilado
- ✅ Serviço systemd configurado
- ✅ Aplicação iniciada e verificada
- ✅ Credenciais salvas em arquivo seguro

**Tudo pronto pra usar!** 🚀

**Credenciais salvas em:** `/opt/controle-financeiro/credentials.txt`

---

## 🔧 Atualização (Existente)

### Atualização Automática

```bash
cd /opt/controle-financeiro
sudo bash scripts/deploy/update.sh
```

**O script de update:**
- ✅ Backup completo do banco de dados
- ✅ Backup do arquivo .env
- ✅ Atualiza código do GitHub
- ✅ Adiciona variáveis de ambiente faltantes
- ✅ Executa migrations do banco
- ✅ Reinstala dependências npm
- ✅ Reinicia serviço
- ✅ Verifica health check

**Backup automático em:** `/opt/controle-financeiro/backups/`

---

## 🔒 Segurança

### Melhorias de Segurança Implementadas

1. **Tokens de Acesso Curtos:**
   - 15 minutos de validade (reduzido de 8 horas)
   - Janela de ataque drasticamente menor
   - Renova automaticamente se usuário ativo

2. **Sessão Limitada a 30 Minutos:**
   - Padrão enterprise/bigtech
   - Previne sequestro de sessão prolongado
   - Usuário ativo se beneficia, mas ainda precisa re-login após 30min

3. **Rotação de Refresh Tokens:**
   - Novo token emitido em cada refresh
   - Tokens antigos invalidados imediatamente
   - Prevenção de replay attacks

4. **Hash de Tokens:**
   - Refresh tokens armazenados com SHA-256
   - Tokens vazios no banco (não texto plano)

5. **Logout Seguro:**
   - Remove todos os refresh tokens do usuário
   - Invalida sessão completamente
   - Previne reuso de tokens

6. **Limpeza Automática:**
   - Tokens expirados removidos do banco
   - Melhora performance
   - Mantém banco limpo

---

## ⚠️ Breaking Changes

**Nenhum!** Esta release é totalmente compatível com v1.0.0.

### Compatibilidade Backward

- ✅ Sessões existentes (v1.0.0) continuam funcionando até expirarem (8h)
- ✅ Após atualização, novas sessões usam sistema de refresh token
- ✅ Usuários podem continuar usando o app sem interrupção
- ✅ Dados de usuários, transações e categorias **preservados**
- ✅ Nenhuma perda de dados
- ✅ Nenhuma migração manual necessária

---

## 🧪 Testes Recomendados Após Atualização

### Teste de Login

```bash
curl -X POST http://seu-servidor:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"seu-email","password":"sua-senha"}'
```

**Resposta esperada (deve incluir ambos):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "a1b2c3d4e5f6...",
  "role": "admin",
  "email": "admin@exemplo.com",
  ...
}
```

### Teste de Refresh Token

```bash
curl -X POST http://seu-servidor:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"seu-refresh-token"}'
```

**Resposta esperada:**
```json
{
  "accessToken": "novo-access-token...",
  "refreshToken": "novo-refresh-token..."
}
```

### Teste de Logout

```bash
curl -X POST http://seu-servidor:3000/api/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"seu-refresh-token"}'
```

**Resposta esperada:**
```json
{
  "ok": true
}
```

### Teste de Interface Web

1. Acesse `http://seu-servidor:3000/`
2. Faça login com credenciais
3. Feche o navegador
4. Reabra o navegador (dentro de 30 minutos)
5. **Verifique:** Ainda logado? ✅
6. Use o app por alguns minutos
7. **Verifique:** Funcionando normalmente? ✅
8. Aguarde 15 minutos (access token expira)
9. **Verifique:** Ainda funcionando? ✅ (refresh automático)
10. Aguarde até 30 minutos totais
11. **Verifique:** Pediu login? ✅ (sessão expirou)

---

## 🔄 Rollback

Se precisar voltar para v1.0.0:

### Rollback Automático

```bash
cd /opt/controle-financeiro
sudo bash scripts/deploy/rollback.sh
```

Siga as instruções para selecionar o backup a restaurar.

### Rollback Manual

```bash
# Restaurar banco de dados
psql -h localhost -U finance_user -d finance_db < backup-YYYYMMDD-HHMMSS.sql

# Restaurar .env
cp /opt/controle-financeiro/backups/env-backup-YYYYMMDD-HHMMSS /opt/controle-financeiro/backend/.env

# Voltar código
cd /opt/controle-financeiro
git checkout v1.0.0

# Reinstalar dependências
cd backend
npm install --omit=dev

# Reiniciar serviço
sudo systemctl restart controle-financeiro
```

---

## 📋 Mudanças no Banco de Dados

### Nova Tabela: `refresh_tokens`

```sql
CREATE TABLE refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX refresh_tokens_token_hash_idx ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
```

### Tabelas Existentes: Nenhuma Alteração

Todas as tabelas existentes permanecem inalteradas.  
**Zero risco de perda de dados.**

---

## 🗄️ Issues Conhecidos

Nenhum issue reportado nesta release.

---

## 🙏 Agradecimentos

Esta release implementa sistema de autenticação moderno com padrões enterprise/bigtech, baseado em feedback de usuários sobre problemas de sessões infinitas.

---

## 📞 Suporte

Para issues ou dúvidas:

- 🐛 **Issues:** [GitHub Issues](../../issues)
- 💬 **Discussões:** [GitHub Discussions](../../discussions)
- 📧 **Email:** Consulte a documentação

- 📚 **Documentação:** [README](../../blob/main/README.md)

---

## 📝 Licença

Este projeto é privado e proprietário.

---

<div align="center">

**🚀 Pronto para produção!**

[![Download v1.1.0](https://img.shields.io/badge/download-v1.1.0-blue)](../../archive/refs/tags/v1.1.0.zip)

</div>
