#!/bin/bash
#
# Controle Financeiro - Instalador v1.3.2 - FIX CRÍTICO
# Sistema de Gestão Financeira Multi-tenant
#
# Uso: curl -fsSL https://github.com/rafaelfmuniz/app-financeiro/main/scripts/deploy/install.sh | sudo bash
#

set -euo pipefail

# ============================================
# CONFIGURAÇÕES
# ============================================
readonly SCRIPT_VERSION="1.3.2"
readonly INSTALL_DIR="/opt/controle-financeiro"
readonly SERVICE_NAME="controle-financeiro"
readonly REPO_URL="https://github.com/rafaelfmuniz/app-financeiro.git"
readonly REPO_BRANCH="main"
readonly TEMP_DIR="/tmp/financeiro-install"
readonly LOG_FILE="/var/log/financeiro-install.log"
readonly CREDENTIALS_FILE="/root/.financeiro-credentials"
readonly BACKUP_BASE_DIR="/opt/financeiro-backups"
readonly MAX_BACKUPS=5

# ============================================
# VARIÁVEIS GLOBAIS
# ============================================
DB_PASSWORD=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
BACKUP_DIR=""
ROLLBACK_POINT=""

# ============================================
# CORES (PROFISSIONAIS - UMA ÚNICA COR PRINCIPAL)
# ============================================
setup_colors() {
    if [[ -t 2 ]] && [[ -z "${NO_COLOR:-}" ]] && [[ "${TERM:-}" != "dumb" ]]; then
        NC='\033[0m'
        DIM='\033[2m'
        BOLD='\033[1m'
        YELLOW='\033[0;33m'
        GREEN='\033[0;32m'
        RED='\033[0;31m'
    else
        NC='' DIM='' BOLD='' YELLOW='' GREEN='' RED=''
    fi
}

setup_colors

# ============================================
# FUNÇÕES DE LOG
# ============================================
log_info() {
    echo -e "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "[OK] $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "[!] $1" | tee -a "$LOG_FILE" >&2
}

log_error() {
    echo -e "[ERROR] $1" | tee -a "$LOG_FILE" >&2
}

# ============================================
# TRATAMENTO DE ERROS
# ============================================
error_handler() {
    local line_no=$1
    local bash_lineno=$2
    local exit_code=$3
    
    echo ""
    echo "========================================"
    echo "ERRO FATAL DURANTE A INSTALAÇÃO"
    echo "========================================"
    echo ""
    echo "Linha:   $line_no"
    echo "Comando: ${BASH_COMMAND}"
    echo "Exit:    $exit_code"
    echo ""
    echo "Soluções:"
    echo "  1. Verifique o log: $LOG_FILE"
    echo "  2. Execute novamente com debug:"
    echo "     curl -fsSL $REPO_URL/raw/main/scripts/deploy/install.sh | sudo bash -s -- --debug"
    echo ""
    
    if [[ -n "$ROLLBACK_POINT" ]]; then
        echo "Tentando rollback..."
        perform_rollback "$ROLLBACK_POINT" 2>/dev/null || true
    fi
    
    exit $exit_code
}

trap 'error_handler ${LINENO} ${BASH_LINENO} $?' ERR

# ============================================
# FUNÇÃO DE LEITURA DE TTY
# ============================================
read_tty() {
    local prompt="$1"
    local response
    
    if [[ -t 0 ]]; then
        read -rp "$prompt" response
    else
        read -rp "$prompt" response < /dev/tty
    fi
    
    echo "$response"
}

# ============================================
# VERIFICAÇÃO DE INSTALAÇÃO EXISTENTE
# ============================================
check_existing_installation() {
    local has_install=0
    
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        ((has_install++))
    fi
    
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        ((has_install++))
    fi
    
    if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
        ((has_install++))
    fi
    
    if [[ -d "$INSTALL_DIR/backend/src" ]] && [[ -f "$INSTALL_DIR/backend/src/server.js" ]]; then
        ((has_install++))
    fi
    
    if [[ -f "$INSTALL_DIR/backend/.env" ]]; then
        ((has_install++))
    fi
    
    if [[ $has_install -ge 2 ]]; then
        return 0
    else
        return 1
    fi
}

get_installed_version() {
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        cd "$INSTALL_DIR" 2>/dev/null || true
        local version
        version=$(git describe --tags --abbrev=0 2>/dev/null || echo "unknown")
        echo "$version"
    elif [[ -f "$INSTALL_DIR/backend/package.json" ]]; then
        local version
        version=$(grep '"version"' "$INSTALL_DIR/backend/package.json" 2>/dev/null | head -1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')
        if [[ -n "$version" ]]; then
            echo "v$version"
        else
            echo "unknown"
        fi
    else
        echo "unknown"
    fi
}

# ============================================
# VALIDAÇÃO DO SISTEMA
# ============================================
validate_system() {
    log_info "Validando requisitos do sistema..."
    
    if [[ $EUID -ne 0 ]]; then
        log_error "Execute como root: sudo bash install.sh"
        exit 1
    fi
    
    if [[ ! -f /etc/os-release ]]; then
        log_error "Não foi possível identificar o sistema"
        exit 1
    fi
    
    source /etc/os-release
    log_info "Sistema: $PRETTY_NAME"
    
    if [[ "$ID" != "ubuntu" ]] && [[ "$ID" != "debian" ]]; then
        log_warning "Sistema não oficialmente suportado: $ID"
        local confirm
        confirm=$(read_tty "Deseja continuar? (s/N): ")
        if [[ ! "$confirm" =~ ^[Ss]$ ]]; then
            log_info "Instalação cancelada"
            exit 0
        fi
    fi
    
    local total_mem_mb
    total_mem_mb=$(free -m | awk '/^Mem:/{print $2}')
    log_info "RAM: ${total_mem_mb}MB"
    
    if [[ $total_mem_mb -lt 1024 ]]; then
        log_warning "RAM abaixo do recomendado (1GB)"
        local confirm
        confirm=$(read_tty "Deseja continuar? (s/N): ")
        if [[ ! "$confirm" =~ ^[Ss]$ ]]; then
            log_info "Instalação cancelada"
            exit 0
        fi
    fi
    
    local free_disk_gb
    free_disk_gb=$(df -BG /opt 2>/dev/null | awk 'NR==2{print $4}' | sed 's/G//')
    log_info "Disco: ${free_disk_gb}GB livres"
    
    if [[ $free_disk_gb -lt 3 ]]; then
        log_error "Espaço insuficiente (mínimo: 3GB)"
        exit 1
    fi
    
    check_port 3000 "Aplicação"
    check_port 5432 "PostgreSQL"
    
    if ! ping -c 1 -W 2 github.com &>/dev/null; then
        log_error "Sem conexão com GitHub"
        exit 1
    fi
    
    log_success "Sistema validado"
}

check_port() {
    local port=$1
    local service=$2
    
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        local pid=$(lsof -Pi :$port -sTCP:LISTEN -t)
        log_warning "Porta $port em uso pelo processo $pid ($service)"
        local confirm
        confirm=$(read_tty "Matar processo e continuar? (s/N): ")
        if [[ "$confirm" =~ ^[Ss]$ ]]; then
            kill -9 $pid 2>/dev/null || true
        else
            log_info "Instalação cancelada"
            exit 0
        fi
    fi
}

# ============================================
# BACKUP E ROLLBACK
# ============================================
create_backup() {
    local backup_type=$1
    
    echo ""
    log_info "Deseja criar backup antes de $backup_type?"
    local backup_choice
    backup_choice=$(read_tty "Digite 's' para sim ou 'n' para não (padrão: s): ")
    
    if [[ "$backup_choice" =~ ^[Nn]$ ]]; then
        log_info "Backup ignorado pelo usuário"
        BACKUP_DIR=""
        return
    fi
    
    mkdir -p "$BACKUP_BASE_DIR"
    BACKUP_DIR="$BACKUP_BASE_DIR/financeiro-backup-$(date +%Y%m%d-%H%M%S)"
    
    log_info "Criando backup em: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"
    
    # Backup database
    if [[ -f "$INSTALL_DIR/backend/.env" ]]; then
        local DB_HOST DB_PORT DB_NAME DB_USER DB_PASS
        DB_HOST=$(grep "^DB_HOST=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
        DB_PORT=$(grep "^DB_PORT=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
        DB_NAME=$(grep "^DB_NAME=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
        DB_USER=$(grep "^DB_USER=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
        DB_PASS=$(grep "^DB_PASS=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
        
        if [[ -n "$DB_NAME" ]] && [[ -n "$DB_USER" ]] && [[ -n "$DB_PASS" ]]; then
            log_info "Fazendo backup do banco de dados..."
            PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_DIR/database.sql" 2>/dev/null || {
                log_warning "Não foi possível fazer backup do banco de dados"
            }
        fi
    fi
    
    # Backup installation directory
    if [[ -d "$INSTALL_DIR" ]]; then
        log_info "Fazendo backup do diretório de instalação..."
        cp -r "$INSTALL_DIR" "$BACKUP_DIR/installation" 2>/dev/null || {
            log_warning "Não foi possível fazer backup da instalação"
        }
    fi
    
    # Backup .env file
    if [[ -f "$INSTALL_DIR/backend/.env" ]]; then
        log_info "Fazendo backup do arquivo .env..."
        cp "$INSTALL_DIR/backend/.env" "$BACKUP_DIR/.env" 2>/dev/null || {
            log_warning "Não foi possível fazer backup do .env"
        }
    fi
    
    log_success "Backup criado em: $BACKUP_DIR"
    
    rotate_backups "$BACKUP_BASE_DIR" $MAX_BACKUPS
}

rotate_backups() {
    local backup_dir=$1
    local max_backups=$2
    
    log_info "Gerenciando rotação de backups (mantendo os $max_backups mais recentes)..."
    
    local backups
    backups=$(ls -1td "$backup_dir"/financeiro-backup-* 2>/dev/null || true)
    
    if [[ -z "$backups" ]]; then
        log_info "Nenhum backup encontrado para rotação"
        return
    fi
    
    local total_count
    total_count=$(echo "$backups" | wc -l)
    
    local to_remove=$((total_count - max_backups))
    
    if [[ $to_remove -gt 0 ]]; then
        log_info "Removendo $to_remove backup(s) antigo(s)..."
        echo "$backups" | tail -n "$to_remove" | while read -r old_backup; do
            if [[ -d "$old_backup" ]]; then
                rm -rf "$old_backup"
                log_info "Removido: $(basename "$old_backup")"
            fi
        done
        log_success "Rotação de backups concluída"
    else
        log_info "Nenhum backup antigo para remover ($total_count total, máximo: $max_backups)"
    fi
}

perform_rollback() {
    local backup_dir=$1
    
    log_warning "Rollback de $backup_dir..."
    
    if [[ -f "$backup_dir/database.sql" ]]; then
        if [[ -f "$INSTALL_DIR/backend/.env" ]]; then
            local DB_HOST DB_PORT DB_NAME DB_USER DB_PASS
            DB_HOST=$(grep "^DB_HOST=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
            DB_PORT=$(grep "^DB_PORT=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
            DB_NAME=$(grep "^DB_NAME=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
            DB_USER=$(grep "^DB_USER=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
            DB_PASS=$(grep "^DB_PASS=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
            
            if [[ -n "$DB_NAME" ]] && [[ -n "$DB_USER" ]] && [[ -n "$DB_PASS" ]]; then
                PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "$backup_dir/database.sql" 2>/dev/null || true
            fi
        fi
    fi
    
    if [[ -d "$backup_dir/installation" ]]; then
        rm -rf "$INSTALL_DIR"
        cp -r "$backup_dir/installation" "$INSTALL_DIR" 2>/dev/null || true
    fi
    
    if [[ -f "$backup_dir/.env" ]]; then
        cp "$backup_dir/.env" "$INSTALL_DIR/backend/.env" 2>/dev/null || true
    fi
}

# ============================================
# INSTALAÇÃO DE DEPENDÊNCIAS
# ============================================
install_dependencies() {
    log_info "Instalando dependências do sistema..."
    
    apt-get update -qq || {
        log_error "Falha ao atualizar repositórios"
        exit 1
    }
    
    apt-get install -y nodejs npm postgresql postgresql-client git curl openssl build-essential python3 -qq || {
        log_error "Falha ao instalar pacotes"
        exit 1
    }
    
    log_success "Node.js: $(node --version)"
    log_success "PostgreSQL: $(psql --version | awk '{print $3}')"
}

# ============================================
# CONFIGURAÇÃO DO BANCO DE DADOS
# ============================================
setup_database() {
    log_info "Configurando banco de dados..."
    
    systemctl start postgresql
    systemctl enable postgresql
    
    local max_attempts=30
    local attempt=0
    while ! sudo -u postgres psql -c "SELECT 1" &>/dev/null; do
        ((attempt++))
        if [[ $attempt -ge $max_attempts ]]; then
            log_error "PostgreSQL não iniciou"
            exit 1
        fi
        sleep 1
    done
    
    DB_PASSWORD=$(openssl rand -hex 24)
    
    local DB_NAME="finance_db"
    local DB_USER="finance_user"
    
    sudo -u postgres psql <<EOF
DROP DATABASE IF EXISTS ${DB_NAME};
DROP USER IF EXISTS ${DB_USER};
CREATE DATABASE ${DB_NAME};
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
\c ${DB_NAME}
GRANT ALL ON SCHEMA public TO ${DB_USER};
EOF
    
    log_success "Banco de dados configurado"
}

# ============================================
# DOWNLOAD DA APLICAÇÃO
# ============================================
download_application() {
    log_info "Baixando aplicação..."
    
    mkdir -p "$INSTALL_DIR"
    
    git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR" || {
        log_error "Falha ao clonar repositório"
        exit 1
    }
    
    cd "$INSTALL_DIR" || exit 1
    
    local SERVER_IP
    SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    SERVER_IP="${SERVER_IP:-$(hostname)}"
    
    local MASTER_EMAIL="admin@controle-financeiro.local"
    local MASTER_PASSWORD=$(openssl rand -hex 16)
    local MASTER_NAME="Administrador"
    local MASTER_USERNAME="admin"
    local DEFAULT_TENANT_NAME="Principal"
    local JWT_SECRET=$(openssl rand -hex 32)
    local JWT_REFRESH_SECRET=$(openssl rand -hex 32)
    
    cat > "$INSTALL_DIR/backend/.env" <<EOF
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=${DB_USER}
DB_PASS=${DB_PASSWORD}
DB_NAME=${DB_NAME}

PORT=3000
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=30m
DEFAULT_TENANT_NAME=${DEFAULT_TENANT_NAME}

MASTER_EMAIL=${MASTER_EMAIL}
MASTER_PASSWORD=${MASTER_PASSWORD}
MASTER_NAME=${MASTER_NAME}
MASTER_USERNAME=${MASTER_USERNAME}

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_REPLY_TO=
APP_BASE_URL=http://${SERVER_IP}:3000
EOF
    
    chmod 600 "$INSTALL_DIR/backend/.env"
    
    ADMIN_EMAIL="$MASTER_EMAIL"
    ADMIN_PASSWORD="$MASTER_PASSWORD"
    
    log_success "Aplicação baixada"
}

# ============================================
# INSTALAÇÃO DE DEPENDÊNCIAS NPM
# ============================================
install_npm_dependencies() {
    log_info "Instalando dependências npm..."
    
    cd "$INSTALL_DIR/backend" || exit 1
    
    log_info "Instalando dependências do backend..."
    npm install --no-audit --no-fund --silent || {
        log_error "Falha no npm install (backend)"
        exit 1
    }
    
    cd "$INSTALL_DIR/frontend" || exit 1
    
    log_info "Instalando dependências do frontend..."
    npm install --no-audit --no-fund --silent || {
        log_error "Falha no npm install (frontend)"
        exit 1
    }
    
    log_info "Compilando frontend..."
    npm run build || {
        log_error "Falha no build do frontend"
        exit 1
    }
    
    log_info "Copiando frontend para backend/src/frontend-dist..."
    rm -rf "$INSTALL_DIR/backend/src/frontend-dist"
    mkdir -p "$INSTALL_DIR/backend/src/frontend-dist"
    cp -r "$INSTALL_DIR/frontend/dist/"* "$INSTALL_DIR/backend/src/frontend-dist/"
    
    log_success "Dependências instaladas e aplicação compilada"
}

# ============================================
# SERVIÇO SYSTEMD
# ============================================
setup_service() {
    log_info "Configurando serviço systemd..."
    
    local node_path
    node_path=$(which node)
    
    if [[ -z "$node_path" ]]; then
        log_error "Node.js não encontrado"
        exit 1
    fi
    
    cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Controle Financeiro
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/backend
EnvironmentFile=$INSTALL_DIR/backend/.env
ExecStart=$node_path $INSTALL_DIR/backend/src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    
    log_success "Serviço systemd configurado"
}

# ============================================
# VERIFICAÇÃO DE SAÚDE
# ============================================
health_check() {
    log_info "Realizando verificações de saúde..."
    echo ""
    
    echo -n "[    ] Serviço systemd..."
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        echo -e "\r[ OK ]"
    else
        echo -e "\r[FALHA]"
        echo "   → Verifique: sudo systemctl status $SERVICE_NAME"
        return 1
    fi
    
    echo -n "[    ] Resposta HTTP na porta 3000..."
    local attempts=0
    local max_attempts=10
    local http_ok=false
    
    while [[ $attempts -lt $max_attempts ]]; do
        if command -v curl &>/dev/null; then
            if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200\|301\|302"; then
                http_ok=true
                break
            fi
        fi
        attempts=$((attempts + 1))
        sleep 1
    done
    
    if [[ "$http_ok" == "true" ]]; then
        echo -e "\r[ OK ]"
    else
        echo -e "\r[FALHA]"
        echo "   → A aplicação não respondeu após $max_attempts tentativas"
        return 1
    fi
    
    echo -n "[    ] Conexão com PostgreSQL..."
    if sudo -u postgres psql -c "SELECT 1" 2>/dev/null | grep -q "1"; then
        echo -e "\r[ OK ]"
    else
        echo -e "\r[FALHA]"
        echo "   → Verifique: sudo systemctl status postgresql"
    fi
    
    echo ""
    return 0
}

# ============================================
# SALVAR CREDENCIAIS
# ============================================
save_credentials() {
    local ip_address
    ip_address=$(hostname -I | awk '{print $1}')
    
    cat > "$CREDENTIALS_FILE" <<EOF
========================================
Controle Financeiro - Credenciais
Versão: ${SCRIPT_VERSION}
Gerado: $(date)
========================================

ADMIN:
  Email:    ${ADMIN_EMAIL}
  Senha:    ${ADMIN_PASSWORD}

BANCO DE DADOS:
  Host:     127.0.0.1
  Porta:    5432
  Banco:    finance_db
  Usuario:  finance_user
  Senha:    ${DB_PASSWORD}

ACESSO:
  Local:    http://localhost:3000
  Rede:     http://${ip_address}:3000

! IMPORTANTE - Mude a senha do admin após primeiro login !

COMANDOS:
  sudo systemctl start ${SERVICE_NAME}
  sudo systemctl stop ${SERVICE_NAME}
  sudo systemctl restart ${SERVICE_NAME}
  sudo systemctl status ${SERVICE_NAME}
  sudo journalctl -u ${SERVICE_NAME} -f

LOG:
  ${LOG_FILE}
========================================
EOF
    
    chmod 600 "$CREDENTIALS_FILE"
    log_success "Credenciais salvas em: $CREDENTIALS_FILE"
}

# ============================================
# LIMPEZA
# ============================================
cleanup() {
    log_info "Limpando arquivos temporários..."
    rm -rf "$TEMP_DIR" 2>/dev/null || true
    log_success "Arquivos temporários removidos"
}

# ============================================
# SHOW FINAL SUMMARY
# ============================================
show_final_summary() {
    local operation=$1
    
    echo ""
    echo "========================================"
    echo "  RESUMO DA OPERAÇÃO"
    echo "========================================"
    echo ""
    
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        echo "  [✓] Serviço Controle Financeiro ativo"
    else
        echo "  [✗] Serviço Controle Financeiro (falha)"
    fi
    
    local ip_address
    ip_address=$(hostname -I | awk '{print $1}')
    
    echo ""
    echo "Acesso: http://${ip_address}:3000"
    echo ""
    
    if [[ "$operation" == "install" ]]; then
        echo "Credenciais:"
        echo "  Email: ${ADMIN_EMAIL}"
        echo "  Senha: ${ADMIN_PASSWORD}"
        echo ""
        echo "! Mude a senha após o primeiro login!"
    fi
    
    echo "========================================"
    echo ""
}

# ============================================
# INSTALAÇÃO COMPLETA
# ============================================
install_new() {
    log_info "Iniciando instalação limpa..."
    
    validate_system
    create_backup "pre-install"
    ROLLBACK_POINT="$BACKUP_DIR"
    
    install_dependencies
    setup_database
    download_application
    install_npm_dependencies
    setup_service
    
    log_info "Iniciando serviço..."
    systemctl start "$SERVICE_NAME" || {
        log_error "Falha ao iniciar serviço"
        exit 1
    }
    
    sleep 5
    
    health_check
    save_credentials
    cleanup
    
    show_final_summary "install"
}

# ============================================
# REINSTALAÇÃO
# ============================================
reinstall() {
    log_warning "Iniciando reinstalação..."
    
    echo ""
    echo "========================================"
    echo "ATENÇÃO: Isso removerá TODOS os dados!"
    echo "========================================"
    echo ""
    
    local confirm
    confirm=$(read_tty "Digite 'SIM' para confirmar: ")
    
    if [[ "$confirm" != "SIM" ]]; then
        log_info "Reinstalação cancelada"
        exit 0
    fi
    
    create_backup "pre-reinstall"
    
    log_info "Parando serviço..."
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload 2>/dev/null || true
    
    log_info "Removendo banco de dados..."
    sudo -u postgres psql <<EOF 2>/dev/null || true
DROP DATABASE IF EXISTS finance_db;
DROP USER IF EXISTS finance_user;
EOF
    
    log_info "Removendo arquivos..."
    rm -rf "$INSTALL_DIR"
    rm -rf "$TEMP_DIR"
    
    log_success "Limpeza concluída"
    echo ""
    
    install_new
}

# ============================================
# ATUALIZAÇÃO
# ============================================
update() {
    log_info "Iniciando atualização..."
    
    if [[ ! -d "$INSTALL_DIR" ]]; then
        log_error "Instalação não encontrada"
        exit 1
    fi
    
    # Verificar se é repositório git
    if [[ ! -d "$INSTALL_DIR/.git" ]]; then
        create_backup "pre-update"
        ROLLBACK_POINT="$BACKUP_DIR"
        
        cd "$INSTALL_DIR" || exit 1
        
        log_info "Parando serviço..."
        if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            timeout 10 systemctl stop "$SERVICE_NAME" 2>/dev/null || {
                log_warning "Serviço não parou em 10s, forçando..."
                systemctl kill "$SERVICE_NAME" 2>/dev/null || true
                sleep 1
            }
        fi
        
        log_info "Salvando configurações..."
        cp backend/.env /tmp/financeiro-env-backup 2>/dev/null || true
        
        log_info "Baixando nova versão..."
        rm -rf "$TEMP_DIR"
        mkdir -p "$TEMP_DIR"
        git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$TEMP_DIR" || {
            log_error "Falha ao clonar repositório"
            perform_rollback "$ROLLBACK_POINT"
            exit 1
        }
        
        log_info "Atualizando arquivos do backend..."
        # Copiar backend/src/*
        rm -rf "$INSTALL_DIR/backend/src"
        
        # Usar tar para copiar recursivamente
        (cd "$TEMP_DIR/backend/src" && tar cf - .) | (cd "$INSTALL_DIR/backend" && tar xf -) 2>/dev/null || true
        
        # Copiar backend/*.js, *.json
        cp "$TEMP_DIR/backend/"*.js "$INSTALL_DIR/backend/" 2>/dev/null || true
        cp "$TEMP_DIR/backend/"*.json "$INSTALL_DIR/backend/" 2>/dev/null || true
        
        log_info "Atualizando arquivos do frontend..."
        cd "$INSTALL_DIR/frontend" || exit 1
        npm install --no-audit --no-fund --silent || {
            log_error "Falha ao atualizar dependências (frontend)"
            perform_rollback "$ROLLBACK_POINT"
            exit 1
        }
        
        npm run build || {
            log_error "Falha no build do frontend"
            perform_rollback "$ROLLBACK_POINT"
            exit 1
        }
        
        log_info "Copiando frontend para backend/src/frontend-dist..."
        rm -rf "$INSTALL_DIR/backend/src/frontend-dist"
        mkdir -p "$INSTALL_DIR/backend/src/frontend-dist"
        cp -r "$INSTALL_DIR/frontend/dist/"* "$INSTALL_DIR/backend/src/frontend-dist/"
        
        log_info "Restaurando configurações..."
        cp /tmp/financeiro-env-backup "$INSTALL_DIR/backend/.env" 2>/dev/null || true
        
        log_success "Código atualizado"
        
        rm -rf "$TEMP_DIR"
    else
        # Instalação via git - usar git fetch/reset
        create_backup "pre-update"
        ROLLBACK_POINT="$BACKUP_DIR"
        
        cd "$INSTALL_DIR" || exit 1
        
        log_info "Parando serviço..."
        if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            timeout 10 systemctl stop "$SERVICE_NAME" 2>/dev/null || {
                log_warning "Serviço não parou em 10s, forçando..."
                systemctl kill "$SERVICE_NAME" 2>/dev/null || true
                sleep 1
            }
        fi
        
        log_info "Salvando configurações..."
        cp backend/.env /tmp/financeiro-env-backup 2>/dev/null || true
        
        log_info "Atualizando código via git..."
        git fetch origin || {
            log_error "Falha ao buscar atualizações"
            perform_rollback "$ROLLBACK_POINT"
            exit 1
        }
        
        git reset --hard "origin/${REPO_BRANCH}" || {
            log_error "Falha ao atualizar código"
            perform_rollback "$ROLLBACK_POINT"
            exit 1
        }
        
        log_success "Código atualizado para a versão mais recente"
        
        log_info "Restaurando configurações..."
        cp /tmp/financeiro-env-backup backend/.env 2>/dev/null || true
        
        log_info "Atualizando dependências..."
        
        cd "$INSTALL_DIR/backend" || exit 1
        npm install --no-audit --no-fund --silent || {
            log_error "Falha ao atualizar dependências (backend)"
            perform_rollback "$ROLLBACK_POINT"
            exit 1
        }
        
        cd "$INSTALL_DIR/frontend" || exit 1
        npm install --no-audit --no-fund --silent || {
            log_error "Falha ao atualizar dependências (frontend)"
            perform_rollback "$ROLLBACK_POINT"
            exit 1
        }
        
        npm run build || {
            log_error "Falha no build do frontend"
            perform_rollback "$ROLLBACK_POINT"
            exit 1
        }
        
        log_info "Copiando frontend para backend/src/frontend-dist..."
        rm -rf "$INSTALL_DIR/backend/src/frontend-dist"
        mkdir -p "$INSTALL_DIR/backend/src/frontend-dist"
        cp -r "$INSTALL_DIR/frontend/dist/"* "$INSTALL_DIR/backend/src/frontend-dist/"
        
        log_success "Dependências atualizadas"
    fi
    
    log_info "Reiniciando serviço..."
    systemctl start "$SERVICE_NAME" || {
        log_error "Falha ao iniciar serviço"
        perform_rollback "$ROLLBACK_POINT"
        exit 1
    }
    
    sleep 5
    
    health_check
    cleanup
    
    show_final_summary "update"
}

# ============================================
# DESINSTALAÇÃO
# ============================================
uninstall() {
    echo ""
    echo "========================================"
    echo "DESINSTALAÇÃO DO CONTROLE FINANCEIRO"
    echo "========================================"
    echo ""
    echo "Isso removerá:"
    echo "  - Banco de dados (todos os dados)"
    echo "  - Arquivos da aplicação"
    echo "  - Usuário do PostgreSQL"
    echo "  - Serviço systemd"
    echo ""
    
    local confirm
    confirm=$(read_tty "Deseja continuar? (Digite 'SIM'): ")
    
    if [[ "$confirm" != "SIM" ]]; then
        log_info "Desinstalação cancelada"
        exit 0
    fi
    
    log_info "Parando serviço..."
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload 2>/dev/null || true
    
    log_info "Removendo banco de dados..."
    sudo -u postgres psql <<EOF 2>/dev/null || true
DROP DATABASE IF EXISTS finance_db;
DROP USER IF EXISTS finance_user;
EOF
    
    log_info "Removendo arquivos..."
    rm -rf "$INSTALL_DIR"
    rm -rf "$TEMP_DIR"
    rm -f "$CREDENTIALS_FILE"
    
    cleanup
    
    echo ""
    echo "========================================"
    echo "Controle Financeiro removido com sucesso!"
    echo "========================================"
    echo ""
}

# ============================================
# SHOW MENU
# ============================================
show_menu() {
    clear
    
    echo "========================================"
    echo "Controle Financeiro - Instalador v${SCRIPT_VERSION}"
    echo "Sistema de Gestão Financeira"
    echo "========================================"
    echo ""
    
    if check_existing_installation; then
        local current_version
        local latest_version
        current_version=$(get_installed_version)
        latest_version=$(get_latest_version)
        echo "Instalação detectada em: $INSTALL_DIR"
        echo "Versão atual:  $current_version"
        echo "Nova versão:   $latest_version"
        echo ""
    fi
    
    echo "Selecione uma opção:"
    echo ""
    echo "  1) Instalar (instalação limpa)"
    echo "  2) Reinstalar (remove tudo e reinstala)"
    echo "  3) Atualizar (mantém dados)"
    echo "  4) Desinstalar (remove tudo)"
    echo "  5) Sair"
    echo ""
}

get_latest_version() {
    local api_url="https://api.github.com/repos/rafaelfmuniz/app-financeiro/releases/latest"
    local version=""
    
    local response
    response=$(curl -s --max-time 5 "$api_url" 2>/dev/null) || {
        log_warning "Falha ao buscar versão mais recente (timeout ou erro de conexão)"
        echo "$SCRIPT_VERSION"
        return
    }
    
    if [[ -z "$response" ]] || [[ "$response" == "null" ]]; then
        log_warning "Resposta vazia da API do GitHub"
        echo "$SCRIPT_VERSION"
        return
    fi
    
    version=$(echo "$response" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4) || true
    
    if [[ -z "$version" ]]; then
        log_warning "Não foi possível extrair versão da resposta da API"
        echo "$SCRIPT_VERSION"
        return
    fi
    
    if [[ ! "$version" =~ ^v ]]; then
        version="v$version"
    fi
    
    if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
        log_warning "Formato de versão inválido: $version"
        echo "v$SCRIPT_VERSION"
        return
    fi
    
    echo "$version"
}

# ============================================
# MAIN
# ============================================
main() {
    log_info "=========================================="
    log_info "Iniciando instalador v${SCRIPT_VERSION}"
    log_info "=========================================="
    
    show_menu
    
    local choice
    choice=$(read_tty "Digite uma opção (1-5): ")
    
    case "$choice" in
        1)
            echo ""
            if check_existing_installation; then
                log_error "Instalação já existe"
                echo "Use a opção 2 (Reinstalar) para limpar e reinstalar"
                exit 1
            fi
            install_new
            ;;
        2)
            echo ""
            if ! check_existing_installation; then
                log_error "Nenhuma instalação encontrada"
                echo "Use a opção 1 (Instalar) para nova instalação"
                exit 1
            fi
            reinstall
            ;;
        3)
            echo ""
            if ! check_existing_installation; then
                log_error "Nenhuma instalação encontrada"
                echo "Use a opção 1 (Instalar) para nova instalação"
                exit 1
            fi
            update
            ;;
        4)
            echo ""
            if ! check_existing_installation; then
                log_error "Nenhuma instalação encontrada"
                exit 1
            fi
            uninstall
            ;;
        5)
            echo ""
            log_info "Instalação cancelada"
            exit 0
            ;;
        *)
            echo ""
            log_error "Opção inválida"
            exit 1
            ;;
    esac
}

main "$@"
