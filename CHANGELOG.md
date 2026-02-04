# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere a [Semantic Versioning](https://semver.org/lang/pt-BR/spec/v2.0.0.html).

## [1.1.0] - 2026-02-04 (Versão Estável)

### Adicionado
- Sistema de refresh token para autenticação
- **Instalador v1.7.0** com argumentos de linha de comando (--install, --update, --reinstall, --uninstall)
- Modo não-interativo para automação via CI/CD
- Confirmação interativa antes de criar backup
- Feedback claro sobre local e arquivos do backup
- Documentação completa de segurança no README
- Tabela `refresh_tokens` no banco de dados
- Endpoint `POST /api/auth/refresh` para renovar tokens
- Endpoint `POST /api/auth/logout` para encerrar sessões
- Interceptor de response automático para refresh de tokens
- Toast de alerta quando sessão expira
- Índices otimizados para refresh_tokens (token_hash, expires_at, user_id)
- Rotação automática de refresh tokens (rotação por uso)
- Limpeza automática de tokens expirados

### Modificado
- README.md atualizado com instruções detalhadas do instalador
- Seção de segurança adicionada ao README
- Versão do frontend atualizada para 1.1.0
- Expiração do access token reduzida de 8h para 15 minutos
- Sessão máxima reduzida para 30 minutos (padrão enterprise)
- Fluxo de autenticação para usar access token curto + refresh token médio
- Função `handleAuth` para salvar refresh token no localStorage
- Sistema de logout centralizado em `api.js`
- Verificação inicial de token ao carregar página
- Timer de inatividade para considerar refresh token
- Atualização de variáveis de ambiente em arquivos .env.sample

### Instalação
- **Instalador totalmente reescrito com práticas profissionais**
- Detecção de instalações existentes antes de qualquer ação
- Compara versão instalada vs versão remota
- Menu de opções: Atualizar / Reconfigurar / Cancelar
- Backup completo automático (banco de dados, .env, commit git)
- Feedback claro em cada passo (1/12, 2/12, etc.)
- Preservação de instalações existentes ao atualizar
- Modo de instalação fresca com aviso claro sobre perda de dados
- Formatação profissional com caixas ASCII artísticas

### Segurança
- Verificação de arquivos sensíveis antes de commits
- .env.example atualizado com exemplos seguros
- Documentação sobre práticas de segurança
- Implementação de refresh token com rotação automática
- Tokens de acesso com expiração curta (15min) reduzindo janela de ataque
- Sessão limitada a 30 minutos (padrão enterprise/bigtech)
- Armazenamento seguro de refresh tokens no banco com hash SHA-256
- Invalidação de refresh tokens ao fazer logout
- Proteção CSRF com cookies httpOnly (preparado para implementação futura)
- Previne perda de dados em atualizações (backup automático antes de mudanças)

### Corrigido
- **Crítico**: Sobrescrição silenciosa de aplicações em produção
- **Crítico**: Perda de dados ao sobrescrever instalação existente
- **Corrigido**: Instalador detecta, avisa e cria backups automáticos
- **Corrigido**: Feedback claro ao usuário em cada etapa da instalação
- **Corrigido**: Separção entre instalação nova e atualização de existente

## [1.0.0] - 2026-01-31

### Adicionado
- Estrutura monorepo com workspaces npm
- Sistema de Controle Financeiro completo
- Autenticação JWT com proteção brute-force
- Dashboard com gráficos em tempo real
- CRUD de transações (receitas e despesas)
- CRUD de categorias com cores
- Relatórios mensais e anuais
- Sistema de email com configuração SMTP dinâmica
- Suporte multi-tenant
- Painel administrativo
- Scripts de deploy automatizado
- Documentação completa no README.md
- Configuração Nginx e Systemd

### Modificado
- Reorganização completa da estrutura de pastas
- Migração para padrão monorepo (igual socialbluepro)
- Atualização do README.md com documentação profissional
- Consolidação de documentação dispersa

### Removido
- Pasta `prod/app/backend/` (cópia duplicada desatualizada)
- Pasta `backend/src/frontend-dist/` (build duplicado)
- Pasta `documentacao/` (documentação consolidada no README)
- Arquivos de teste temporários (test-*.js, list-users.js)
- Arquivos de log antigos e desnecessários
- Arquivo `nul` (vazio)
- Arquivo `Chat.txt` (temporário)

### Segurança
- Implementação de criptografia AES-256-GCM para dados sensíveis
- Proteção contra SQL injection via prepared statements
- Hash de senhas com bcrypt (10 salts)
- Proteção brute-force no login

## [0.9.0] - 2025-12-23

### Adicionado
- Sistema de email funcional com Nodemailer
- Suporte a Gmail, Outlook e SMTP customizado
- Configuração SMTP via interface administrativa
- Teste de envio de email no painel admin
- Documentação extensa sobre SMTP

### Corrigido
- Correções diversas no sistema de email
- Ajustes na autenticação JWT
- Melhorias no tratamento de erros

## [0.8.0] - 2025-12-15

### Adicionado
- Sistema multi-tenant básico
- Gestão de usuários e tenants
- Schema de banco de dados para multi-tenancy
- Rotas de administração

### Modificado
- Refatoração do sistema de autenticação
- Melhorias no dashboard

## [0.7.0] - 2025-12-01

### Adicionado
- Relatórios com gráficos (Recharts)
- Filtros avançados em transações
- Importação CSV de transações
- Categorização automática

## [0.6.0] - 2025-11-20

### Adicionado
- Sistema de categorias com cores
- CRUD completo de categorias
- Associação de transações a categorias

## [0.5.0] - 2025-11-10

### Adicionado
- Dashboard com resumo financeiro
- Gráfico de gastos por categoria
- Lista de últimas transações

## [0.4.0] - 2025-11-01

### Adicionado
- CRUD de transações (receitas e despesas)
- Filtros por data e descrição
- Cálculo de saldo

## [0.3.0] - 2025-10-20

### Adicionado
- Autenticação JWT completa
- Login e logout
- Proteção de rotas
- Middleware de autenticação

## [0.2.0] - 2025-10-10

### Adicionado
- Frontend React com Vite
- Interface de usuário básica
- Comunicação com API backend
- Estilos CSS

## [0.1.0] - 2025-10-01

### Adicionado
- Setup inicial do projeto
- Backend Express básico
- Conexão com PostgreSQL
- Estrutura inicial de pastas
- Primeiras rotas da API

---

## Tipos de Mudanças

- **Adicionado** para novas funcionalidades.
- **Modificado** para mudanças em funcionalidades existentes.
- **Corrigido** para correções de bugs.
- **Removido** para funcionalidades removidas.
- **Segurança** para vulnerabilidades corrigidas.

---

**Nota:** Este changelog começou a ser mantido de forma rigorosa na versão 1.0.0.
Versões anteriores são documentadas de forma resumida baseada no histórico de commits.
