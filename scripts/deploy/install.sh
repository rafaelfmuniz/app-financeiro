#!/usr/bin/env bash
#
# Controle Financeiro - Installer
# Version: 1.1.0
# Requirements: Ubuntu 20.04+, Debian 11+
# Usage: curl -fsSL URL | sudo bash
#
set -euo pipefail

# Forçar interpretação de escape sequences em echo
export SHELLOPTS

###############################################
# CONFIGURAÇÃO
###############################################

APP_VERSION="1.1.0"
APP_USER="finance"
APP_DIR="/opt/controle-financeiro"
SERVICE_NAME="controle-financeiro"
APP_PORT="3000"
BACKUP_DIR="$APP_DIR/backups"
NODE_MAJOR="20"

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

###############################################
# FUNÇÕES AUXILIARES
###############################################

print_header() {
  clear
  echo -e "${BOLD}${BLUE}"
  echo "╔════════════════════════════════════╗"
  echo "║  Controle Financeiro Installer          ║"
  echo "║  Version: $APP_VERSION                      ║"
  echo "╚══════════════════════════════════╝"
  echo -e "${NC}"
}

print_step() {
  echo -e "${CYAN}[1/11] ${NC}$2"
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
  echo -e "${CYAN}ℹ${NC} $1"
}

check_cmd() {
  command -v "$1" >/dev/null 2>&1
}

gen_password() {
  openssl rand -base64 18 | tr -d '\n=+/'
}

verifica_instalacao_existente() {
  print_step "VERIFICAR" "Verificando instalação existente..."
  
  INSTALACAO_EXISTENTE=0
  
  # Verificar múltiplos indicadores de instalação
  TEM_GIT=0
  TEM_SERVICO=0
  TEM_BACKEND=0
  TEM_FRONTEND=0
  TEM_BANCO=0
  
  # 1. Verificar se existe diretório .git
  if [ -d "$APP_DIR/.git" ]; then
    TEM_GIT=1
  fi
  
  # 2. Verificar se serviço existe
  if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ]; then
    TEM_SERVICO=1
  fi
  
  # 3. Verificar se backend existe
  if [ -d "$APP_DIR/backend" ] && [ -f "$APP_DIR/backend/src/server.js" ]; then
    TEM_BACKEND=1
  fi
  
  # 4. Verificar se frontend existe
  if [ -d "$APP_DIR/frontend" ] && [ -f "$APP_DIR/frontend/package.json" ]; then
    TEM_FRONTEND=1
  fi
  
  # 5. Verificar se banco existe (via .env)
  if [ -f "$APP_DIR/backend/.env" ]; then
    TEM_BANCO=1
  fi
  
  # Decidir se existe instalação
  # Precisa de PELO MENOS 2 destes indicadores
  TOTAL_INDICADORES=$((TEM_GIT + TEM_SERVICO + TEM_BACKEND + TEM_FRONTEND + TEM_BANCO))
  
  if [ $TOTAL_INDICADORES -ge 2 ]; then
    INSTALACAO_EXISTENTE=1
    print_success "Instalação existente detectada em: $APP_DIR"
    echo -e "  ${CYAN}✓${NC} Git: $([ $TEM_GIT -eq 1 ] && echo 'Sim' || echo 'Não')"
    echo -e "  ${CYAN}✓${NC} Serviço: $([ $TEM_SERVICO -eq 1 ] && echo 'Sim' || echo 'Não')"
    echo -e "  ${CYAN}✓${NC} Backend: $([ $TEM_BACKEND -eq 1 ] && echo 'Sim' || echo 'Não')"
    echo -e "  ${CYAN}✓${NC} Frontend: $([ $TEM_FRONTEND -eq 1 ] && echo 'Sim' || echo 'Não')"
    echo -e "  ${CYAN}✓${NC} Banco: $([ $TEM_BANCO -eq 1 ] && echo 'Sim' || echo 'Não')"
    echo ""
    
    # Verificar versão instalada (se tiver git)
    if [ $TEM_GIT -eq 1 ]; then
      cd "$APP_DIR" 2>/dev/null || true
      if git rev-parse --git-dir >/dev/null 2>&1; then
        CURRENT_VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "desconhecida")
        echo -e "Versão instalada: ${CYAN}$CURRENT_VERSION${NC}"
      else
        CURRENT_VERSION="desconhecida"
        echo -e "Versão instalada: ${CYAN}desconhecida${NC}"
      fi
    else
      CURRENT_VERSION="desconhecida"
      echo -e "Versão instalada: ${CYAN}desconhecida (sem git)${NC}"
    fi
    
    # Verificar se serviço está rodando
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
      SERVICE_RUNNING=true
      print_success "Serviço rodando"
    else
      SERVICE_RUNNING=false
      print_info "Serviço parado"
    fi
    
    return 0  # Retorna 0 = instalação existe (sucesso)
  else
    INSTALACAO_EXISTENTE=0
    print_info "Nenhuma instalação detectada"
    echo -e "  ${YELLOW}Indicadores encontrados: $TOTAL_INDICADORES/5${NC}"
    
    # Tentar detectar em locais alternativos
    echo ""
    print_info "Verificando locais alternativos..."
    
    # Listar possíveis locais onde poderia estar
    LOCAIS=("/var/www/controle-financeiro" "/home/controle-financeiro" "/opt/financeiro")
    for local in "${LOCAIS[@]}"; do
      if [ -d "$local" ]; then
        echo -e "  ${YELLOW}⚠${NC} Encontrado: $local (instalação fora do padrão)"
      fi
    done
    
    return 1  # Retorna 1 = não tem instalação (erro)
  fi
}

busca_ultima_versao() {
  print_step "INFO" "Buscando versão mais recente..."
  
  LATEST_VERSION=$(curl -s https://api.github.com/repos/rafaelfmuniz/app-financeiro/releases/latest 2>/dev/null | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
  
  if [ -z "$LATEST_VERSION" ]; then
    LATEST_VERSION="v1.1.0"
  fi
  
  echo -e "${CYAN}Versão mais recente: $LATEST_VERSION${NC}"
}

confirma_atualizacao() {
  printf '\n'
  printf '%b═══════════════════════════════════════%b\n' "$YELLOW" "$NC"
  printf '%b NOVA VERSÃO DISPONÍVEL%b\n' "$YELLOW" "$NC"
  printf '%b═════════════════════════════════════%b\n' "$YELLOW" "$NC"
  printf '\n'
  printf '%bVersão instalada: %b%s%b\n' "$CYAN" "$NC" "$CURRENT_VERSION" "$NC"
  printf '%bVersão disponível: %b%s%b\n' "$CYAN" "$NC" "$LATEST_VERSION" "$NC"
  printf '\n'
  print_warning "Uma nova versão do Controle Financeiro está disponível."
  printf '\n'
  printf '%bEscolha uma opção:%b\n' "$YELLOW" "$NC"
  printf '\n'
  printf "  1) %bATUALIZAR%b para %s (recomendado)\n" "$GREEN" "$NC" "$LATEST_VERSION"
  printf "  2) %bMANTER%b versão atual (%s)\n" "$YELLOW" "$NC" "$CURRENT_VERSION"
  printf "  3) %bCANCELAR%b\n" "$RED" "$NC"
  printf '\n'
  
  # Ler do terminal real (/dev/tty) em vez de stdin
  read -p "Sua escolha [1-3]: " escolha < /dev/tty
  
  case "$escolha" in
    1)
      printf '\n'
      print_success "Opção selecionada: Atualizar"
      return 0
      ;;
    2)
      printf '\n'
      print_info "Opção selecionada: Manter versão atual"
      return 1
      ;;
    3)
      printf '\n'
      print_info "Instalação cancelada pelo usuário"
      exit 0
      ;;
    *)
      printf '\n'
      print_error "Opção inválida"
      return 2
      ;;
  esac
}

cria_backup_completo() {
  print_step "BACKUP" "Criando backup completo..."
  
  mkdir -p "$BACKUP_DIR"
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  
  # Backup do banco de dados
  if [ -f "$APP_DIR/backend/.env" ]; then
    DB_HOST=$(grep "^DB_HOST=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_PORT=$(grep "^DB_PORT=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_NAME=$(grep "^DB_NAME=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_USER=$(grep "^DB_USER=" "$_DIR/backend/.env" | cut -d'=' -f2)
    DB_PASS=$(grep "^DB_PASS=" "$APP_DIR/backend/.env" | cut -d'=' -f2)
    
    PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_DIR/db-backup-$TIMESTAMP.sql" 2>/dev/null
    
    if [ -f "$BACKUP_DIR/db-backup-$TIMESTAMP.sql" ]; then
      print_success "Banco de dados backupado"
    else
      print_error "Falha ao fazer backup do banco de dados"
      return 1
    fi
  else
    print_warning "Arquivo .env não encontrado. Backup do banco não realizado."
  fi
  
  # Backup do .env
  cp "$APP_DIR/backend/.env" "$BACKUP_DIR/env-backup-$TIMESTAMP" 2>/dev/null
  print_success "Configuração backupada"
  
  # Backup do commit atual
  cd "$APP_DIR" 2>/dev/null || true
  if git rev-parse HEAD > "$BACKUP_DIR/git-commit-$TIMESTAMP.txt" 2>/dev/null; then
    print_success "Commit atual salvo"
  fi
  
  echo ""
  echo -e "${GREEN}✓ Backup completo salvo em: $BACKUP_DIR${NC}"
  echo -e "${YELLOW}Backup: db-backup-$TIMESTAMP.sql${NC}"
  echo -e "${YELLOW}Backup: env-backup-$TIMESTAMP${NC}"
  echo -e "${YELLOW}Backup: git-commit-$TIMESTAMP.txt${NC}"
  echo ""
  
  return 0
}

instala_fresh() {
  print_header
  echo -e "${YELLOW}═════════════════════════════════════${NC}"
  echo -e "${YELLOW}MODO: INSTALAÇÃO FRESH${NC}"
  echo -e "${YELLOW}═════════════════════════════════════${NC}"
  echo ""
  
   print_warning "Isso irá: ${RED}DELETAR TODOS OS DADOS${NC} em $APP_DIR"
   print_warning "Incluindo banco de dados, configurações, etc."
   echo ""
   print_warning "Se você tem dados importantes, ${YELLOW}FAÇA BACKUP MANUAL ANTES!${NC}"
   echo ""
   
   print_info "Pressione ENTER para continuar ou CTRL+C para cancelar..."
   read -r < /dev/tty
  
  print_step "1/11" "Instalando dependências do sistema..."
  
  apt-get update -qq
  
  DEBIAN_FRONTEND=noninteractive
  apt-get install -y -qq \
    curl \
    wget \
    ca-certificates \
    gnupg \
    git \
    build-essential \
    python3 \
    postgresql \
    postgresql-contrib \
    nodejs \
    npm >/dev/null 2>&1
  
  # Habilitar e iniciar PostgreSQL
  systemctl enable postgresql >/dev/null 2>&1 || true
  systemctl start postgresql >/dev/null 2>&1 || true
  
  print_success "Dependências instaladas"
  
  print_step "2/11" "Criando usuário do sistema..."
  
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  fi
  print_success "Usuário criado"
  
  print_step "3/11" "Configurando banco de dados..."
  
  # Gerar credenciais do banco
  DB_NAME="finance_db"
  DB_USER="finance_user"
  DB_PASS=$(gen_password)
  
  # Criar usuário e banco
  user_lit=$(printf "%s" "$DB_USER" | sed "s/'/''/g")
  pass_lit=$(printf "%s" "$DB_PASS" | sed "s/'/''/g")
  user_ident=$(printf "%s" "$DB_USER" | sed 's/"/\\"/g')
  db_ident=$(printf "%s" "$DB_NAME" | sed 's/"/\\"/g')
  
  # Criar usuário se não existe
  if [ -z "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$user_lit'" 2>/dev/null)" ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF
CREATE ROLE "${user_ident}" LOGIN PASSWORD '${pass_lit}';
EOF
  fi
  
  # Criar banco se não existe
  if [ -z "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$db_lit'" 2>/dev/null)" ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF
CREATE DATABASE "${db_ident}" OWNER "${user_ident}";
EOF
  fi
  
  # Conceder privilégios
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF
GRANT ALL PRIVILEGES ON DATABASE "${db_ident}" TO "${user_ident}";
EOF
  
  print_success "Banco de dados configurado"
  
  print_step "4/11" "Implantando aplicação..."
  
  mkdir -p "$APP_DIR"
  
  # Clonar repositório
  rm -rf "$APP_DIR"
  git clone --depth 1 https://github.com/rafaelfmuniz/app-financeiro.git "$APP_DIR"  >/dev/null 2>&1
  
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  print_success "Aplicação instalada"
  
  print_step "5/11" "Configurando aplicação..."
  
  # Gerar credenciais do admin
  MASTER_EMAIL="admin@controle-financeiro.local"
  MASTER_PASSWORD=$(gen_password)
  MASTER_NAME="Administrador"
  MASTER_USERNAME="admin"
  DEFAULT_TENANT_NAME="Principal"
  JWT_SECRET=$(openssl rand -hex 32)
  JWT_REFRESH_SECRET=$(openssl rand -hex 32)
  
  # Pegar IP do servidor
  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  SERVER_IP="${SERVER_IP:-$(hostname)}"
  
  # Criar arquivo .env
  cat > "$APP_DIR/backend/.env" <<EOF
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=$DB_USER
DB_PASS=$DB_PASS
DB_NAME=$DB_NAME

PORT=$APP_PORT
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=30m
DEFAULT_TENANT_NAME=$DEFAULT_TENANT_NAME

MASTER_EMAIL=$MASTER_EMAIL
MASTER_PASSWORD=$MASTER_PASSWORD
MASTER_NAME=$MASTER_NAME
MASTER_USERNAME=$MASTER_USERNAME

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_REPLY_TO=
APP_BASE_URL=http://$SERVER_IP:$APP_PORT
EOF
  
  chmod 600 "$APP_DIR/backend/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/backend/.env"
  
  print_success "Aplicação configurada"
  
  print_step "6/11" "Instalando dependências e compilando..."
  
  # Backend
  cd "$APP_DIR/backend"
  su -s /bin/bash -c "cd '$APP_DIR/backend' && npm install --silent --no-audit --no-fund" "$APP_USER"
  
  # Frontend
  cd "$APP_DIR/frontend"
  su -s /bin/bash -c "cd '$APP_DIR/frontend' && npm install --silent --no-audit --no-fund && npm run build --silent" "$APP_USER"
  
  # Copiar build
  rm -rf "$APP_DIR/backend/frontend-dist"
  cp -r "$APP_DIR/frontend/dist" "$APP_DIR/backend/frontend-dist"
  
  print_success "Dependências instaladas e aplicação compilada"
  
  print_step "7/11" "Configurando serviço systemd..."
  
  local service_file="/etc/systemd/system/$SERVICE_NAME.service"
  local node_path=$(which node)
  
  if [ -z "$node_path" ]; then
    print_error "Node.js não encontrado"
    exit 1
  fi
  
  cat > "$service_file" <<EOF
[Unit]
Description=Controle Financeiro
After=network.target postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/backend/.env
ExecStart=$node_path $APP_DIR/backend/src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
  print_success "Serviço systemd configurado"
  
  print_step "8/11" "Iniciando serviço..."
  
  systemctl restart "$SERVICE_NAME"
  
  sleep 3
  
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    print_success "Serviço iniciado com sucesso"
  else
    print_error "Falha ao iniciar o serviço"
    echo ""
    print_info "Verificando logs do serviço..."
    journalctl -u "$SERVICE_NAME" --no-pager -n 50
    exit 1
  fi
  
  # Verificação final
  echo ""
  print_step "9/11" "Verificação final..."
  
  # Verificar se serviço está rodando
  if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    print_error "Serviço não está rodando"
    exit 1
  fi
  
  # Verificar se porta está aberta
  if ! ss -ltnp 2>/dev/null | grep -q ":$APP_PORT"; then
    print_error "Porta $APP_PORT não está escutando"
    exit 1
  fi
  
  # Verificar se responde HTTP
  if curl -fsS "http://127.0.0.1:$APP_PORT/" >/dev/null 2>&1; then
    print_success "Aplicação respondendo"
  else
    print_warning "Aplicação não respondeu em HTTP. Verifique firewall."
  fi
  
  # Salvar credenciais
  mostrar_credenciais
}

mostra_credenciais() {
  local server_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  server_ip="${server_ip:-$(hostname)}"
  
  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}${GREEN}║   INSTALAÇÃO CONCLUÍDA COM SUCESSO!   ║${NC}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════╝${NC}"
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  URL DE ACESSO                        ║${NC}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════╝${NC}"
  echo -e "  Painel Admin: http://$server_ip:$APP_PORT/admin"
  echo -e "  Painel Usuário: http://$server_ip:$APP_PORT/"
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  CONTA DE ADMINISTRADOR             ║${NC}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════╝${NC}"
  echo -e "  E-mail:     $MASTER_EMAIL"
  echo "  Usuário:   $MASTER_USERNAME"
  echo -e "  Senha:     $MASTER_PASSWORD"
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  BANCO DE DADOS                    ║${NC}"
  echo -e "${BOLD}${BLUE}╚════════════════════════════════════╝${NC}"
  echo -e "  Host:         127.0.0.1"
  echo -e "  Porta:         5432"
  echo -e "  Banco:       $DB_NAME"
  echo -e "  Usuário:     $DB_USER"
  echo -e "  Senha:       $DB_PASS"
  echo ""
  echo -e "${BOLD}${BLUE}╔════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  ARQUIVO DE CREDENCIAIS             ║${NC}"
  echo -e "${BOLD}${BLUE}╚════════════════════════════════════╝${NC}"
  echo -e "  $APP_DIR/credentials.txt"
  echo ""
  echo -e "${BOLD}${BLUE}╔════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  COMANDOS DE GERENCIAMENTO           ║${NC}"
  echo -e "${BOLD}${BLUE}╚════════════════════════════════════╝${NC}"
  echo -e "  Ver logs:     journalctl -u $SERVICE_NAME -f"
  echo -e "  Reiniciar:     systemctl restart $SERVICE_NAME"
  echo -e "  Parar:        systemctl stop $SERVICE_NAME"
  echo -e "  Status:       systemctl status $SERVICE_NAME"
  echo ""
  echo -e "${BOLD}${BLUE}╔════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  ARQUIVO DE CONFIGURAÇÃO           ║${NC}"
  echo -e "${BOLD}${BLUE}╚════════════════════════════════════╝${NC}"
  echo -e "  Aplicação:  $APP_DIR/backend/.env"
  echo -e "  Serviço:    /etc/systemd/system/$SERVICE_NAME.service"
  echo ""
  echo -e "${BOLD}${BLUE}╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  PRÓXIMOS PASSOS                      ║${NC}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════════╝${NC}"
  echo -e " 1. Acesse o painel admin para criar usuários"
  echo -e " 2. Configure o SMTP para envio de e-mails (opcional)"
  echo -e " 3. Altere a senha do administrador após primeiro acesso"
  echo -e " 4. Faça backup regular do banco de dados"
  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${GREEN}║   PRONTO PARA USO!                  ║${NC}"
  echo -e "${BOLD}${GREEN}╚════════════════════════════════════════╝${NC}"
  echo -e "  Abra seu navegador e acesse: http://$server_ip:$APP_PORT/"
  echo ""
}

atualiza_existente() {
  print_header
  echo -e "${YELLOW}═════════════════════════════════════${NC}"
  echo -e "${YELLOW}MODO: ATUALIZAÇÃO DE INSTALAÇÃO EXISTENTE${NC}"
  echo -e "${YELLOW}═══════════════════════════════════${NC}"
  echo ""
  
  # Criar backup
  cria_backup_completo
  if [ $? -ne 0 ]; then
    print_error "Falha ao criar backup. Operação abortada."
    exit 1
  fi
  
  print_step "ATUALIZAR" "Atualizando código da aplicação..."
  
  cd "$APP_DIR"
  git fetch origin >/dev/null 2>&1
  git reset --hard origin/main >/dev/null 2>&1
  
  print_success "Código atualizado para versão: $LATEST_VERSION"
  
  print_step "INSTALAR" "Instalando/Atualizando dependências..."
  
  cd "$APP_DIR/backend"
  su -s /bin/bash -c "cd '$APP_DIR/backend' && npm install --silent --no-audit --no-fund" "$APP_USER"
  
  cd "$APP_DIR/frontend"
  su -s /bin/bash -c "cd '$APP_DIR/frontend' && npm install --silent --no-audit --no-fund && npm run build --silent" "$APP_USER"
  
  rm -rf "$APP_DIR/backend/frontend-dist"
  cp -r "$APP_DIR/frontend/dist" "$APP_DIR/backend/frontend-dist"
  
  print_success "Dependências instaladas e aplicação compilada"
  
  # Reiniciar serviço
  print_step "REINICIAR" "Reiniciando serviço..."
  systemctl restart "$SERVICE_NAME"
  
  sleep 3
  
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    print_success "Serviço reiniciado com sucesso"
  else
    print_error "Falha ao reiniciar o serviço"
    exit 1
  fi
  
  # Mostrar credenciais
  mostrar_credenciais
}

###############################################
# MAIN - FLUXO PRINCIPAL
###############################################

main() {
  # Verificar se está rodando como root
  if [ "$(id -u)" -ne 0 ]; then
    print_error "Este script deve ser executado como root (use sudo)"
    print_info "Comando: sudo bash $0"
    exit 1
  fi
  
  # Verificar sistema operacional
  print_info "Verificando sistema operacional..."
  if [ ! -f /etc/os-release ]; then
    print_error "Sistema operacional não suportado"
    exit 1
  fi
  
  source /etc/os-release
  print_success "Sistema: $PRETTY_NAME"
  
  # Verificar se é Ubuntu ou Debian
  if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    print_warning "Este instalador é testado em Ubuntu e Debian."
    print_warning "Outras distribuições podem exigir ajustes manuais."
    if ! confirm "Deseja continuar?" "n"; then
      exit 0
    fi
  fi
  
  # Verificar se existe instalação
  print_info "Verificando instalação existente..."
  
  verifica_instalacao_existente
  TEM_INSTALACAO=$?
  
  if [ "$TEM_INSTALACAO" -eq 0 ]; then
    # EXISTE instalação (return 0 = sucesso)
    print_success "Instalação existente detectada"
    
    # Buscar versão mais recente
    busca_ultima_versao
    
    # Confirmar atualização
    confirma_atualizacao
    RESULTADO=$?
    
    if [ "$RESULTADO" -eq 0 ]; then
      # Usuário escolheu atualizar
      atualiza_existente
    elif [ "$RESULTADO" -eq 1 ]; then
      # Usuário escolheu manter versão atual
      print_info "Nenhuma alteração realizada. Aplicação atual será mantida."
      print_info ""
      mostra_credenciais
    else
      # Usuário cancelou
      print_info "Atualização cancelada pelo usuário."
      exit 0
    fi
  else
    # NÃO existe instalação (return não-zero = erro/sem instalação)
    print_warning "Nenhuma instalação detectada em: $APP_DIR"
    print_warning ""
    print_warning "ATENÇÃO: Isso instalará uma versão FRESH do Controle Financeiro."
    print_warning "Isso irá DELETAR tudo em $APP_DIR"
    print_warning "Se você tem uma instalação existente em outro local, cancele agora."
    print_warning ""
    print_info "Pressione ENTER para continuar ou CTRL+C para cancelar..."
    read -r < /dev/tty
    
    # Instalação fresh
    instala_fresh
  fi
}

main "$@"
