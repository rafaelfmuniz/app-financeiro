#!/bin/bash
#
# Controle Financeiro - Instalador v1.6.0
# Sistema de Gestão Financeira Multi-tenant
#
# Uso: curl -fsSL https://raw.githubusercontent.com/rafaelfmuniz/app-financeiro/main/scripts/deploy/install.sh | sudo bash
#

set -euo pipefail

# ============================================
# CONFIGURAÇÕES
# ============================================
readonly SCRIPT_VERSION="1.6.0"
readonly INSTALL_DIR="/opt/controle-financeiro"
readonly SERVICE_NAME="controle-financeiro"
readonly REPO_URL="https://github.com/rafaelfmuniz/app-financeiro.git"
readonly REPO_BRANCH="main"
readonly TEMP_DIR="/tmp/financeiro-install"
readonly LOG_FILE="/var/log/financeiro-install.log"
readonly CREDENTIALS_FILE="/root/.financeiro-credentials"
readonly BACKUP_BASE_DIR="/opt/financeiro-backups"
readonly MAX_BACKUPS=5

# Opção para limpar cache
CLEAN_CACHE=0

# ============================================
# VARIÁVEIS GLOBAIS
# ============================================
DB_PASSWORD=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
BACKUP_DIR=""
ROLLBACK_POINT=""

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
    
    if [[ -f "$INSTALL_DIR/backend/src/server.js" ]]; then
        ((has_install++))
        log_success "Arquivo server.js encontrado em backend/src/"
    fi
    
    if [[ -d "$INSTALL_DIR/backend/node_modules" ]]; then
        ((has_install++))
        log_success "node_modules encontrado em backend/"
    fi
    
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        ((has_install++))
        log_success "Serviço systemd ativo"
    fi
    
    if [[ -f "$INSTALL_DIR/backend/.env" ]]; then
        ((has_install++))
        log_success "Arquivo .env encontrado"
    fi
    
    if [[ $has_install -ge 2 ]]; then
        return 0
    else
        return 1
    fi
}

get_installed_version() {
    if [[ -f "$INSTALL_DIR/backend/package.json" ]]; then
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
    log_success "Sistema: $PRETTY_NAME"
    
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
    
    # Limpar cache se solicitado
    if [[ $CLEAN_CACHE -eq 1 ]]; then
        log_info "Limpando cache..."
        rm -rf /tmp/financeiro-install 2>/dev/null || true
        
        # Limpar cache local do usuário
        if [[ -d "$HOME/.cache" ]]; then
            find "$HOME/.cache" -type f -name "*.sh" -delete 2>/dev/null || true
        fi
        
        log_success "Cache limpo"
    fi
    
    log_success "Sistema validado"
}

# ============================================
# BACKUP E ROLLBACK
# ============================================
create_backup() {
    log_info "Criando backup..."
    
    mkdir -p "$BACKUP_BASE_DIR"
    BACKUP_DIR="$BACKUP_BASE_DIR/financeiro-backup-$(date +%Y%m%d-%H%M%S)"
    
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
            log_success "Backup do banco de dados: $BACKUP_DIR/database.sql"
        else
            log_warning "Arquivo .env incompleto, pulando backup do banco"
        fi
    fi
    
    # Backup installation
    if [[ -d "$INSTALL_DIR/backend" ]]; then
        log_info "Fazendo backup do backend..."
        cp -r "$INSTALL_DIR/backend" "$BACKUP_DIR/backend" 2>/dev/null || true
        log_success "Backup do backend: $BACKUP_DIR/backend"
    fi
    
    # Backup frontend if exists
    if [[ -d "$INSTALL_DIR/frontend" ]]; then
        log_info "Fazendo backup do frontend..."
        cp -r "$INSTALL_DIR/frontend" "$BACKUP_DIR/frontend" 2>/dev/null || true
        log_success "Backup do frontend: $BACKUP_DIR/frontend"
    fi
    
    log_success "Backup completo: $BACKUP_DIR"
    
    rotate_backups
}

rotate_backups() {
    log_info "Gerenciando rotação de backups (mantendo $MAX_BACKUPS mais recentes)..."
    
    local backups=($(ls -1td "$BACKUP_BASE_DIR"/financeiro-backup-* 2>/dev/null || true))
    local total=${#backups[@]}
    
    if [[ $total -gt $MAX_BACKUPS ]]; then
        local to_remove=$((total - MAX_BACKUPS))
        log_info "Removendo $to_remove backup(s) antigo(s)..."
        local i=0
        while [[ $i -lt $to_remove ]]; do
            if [[ -d "${backups[$i]}" ]]; then
                rm -rf "${backups[$i]}"
                log_info "Removido: $(basename "${backups[$i]}")"
            fi
            ((i++))
        done
        log_success "Rotação concluída"
    else
        log_success "Nenhum backup antigo para remover ($total total, máximo: $MAX_BACKUPS)"
    fi
}

perform_rollback() {
    local backup_dir=$1
    
    log_warning "Executando rollback de: $backup_dir"
    
    # Parar serviço
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    
    # Verificar e restaurar .env
    if [[ -f "$backup_dir/backend/.env" ]]; then
        log_info "Restaurando .env..."
        cp "$backup_dir/backend/.env" "$INSTALL_DIR/backend/.env"
    fi
    
    # Restaurar banco se existir
    if [[ -f "$backup_dir/database.sql" ]]; then
        log_info "Restaurando banco de dados..."
        if [[ -f "$INSTALL_DIR/backend/.env" ]]; then
            local DB_HOST DB_PORT DB_NAME DB_USER DB_PASS
            DB_HOST=$(grep "^DB_HOST=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
            DB_PORT=$(grep "^DB_PORT=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
            DB_NAME=$(grep "^DB_NAME=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
            DB_USER=$(grep "^DB_USER=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
            DB_PASS=$(grep "^DB_PASS=" "$INSTALL_DIR/backend/.env" | cut -d'=' -f2)
            
            if [[ -n "$DB_NAME" ]] && [[ -n "$DB_USER" ]] && [[ -n "$DB_PASS" ]]; then
                PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "$backup_dir/database.sql" 2>/dev/null || {
                    log_warning "Não foi possível restaurar banco de dados"
                }
                log_success "Banco de dados restaurado"
            fi
        fi
    fi
    
    # Reiniciar serviço
    log_info "Reiniciando serviço..."
    systemctl start "$SERVICE_NAME" 2>/dev/null || true
    
    sleep 3
    
    log_success "Rollback concluído"
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
    
    DEBIAN_FRONTEND=noninteractive
    apt-get install -y nodejs npm postgresql postgresql-client git curl openssl -qq || {
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
    
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    
    git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$TEMP_DIR" || {
        log_error "Falha ao clonar repositório"
        exit 1
    }
    
    # Criar estrutura de diretórios
    mkdir -p "$INSTALL_DIR"
    
    # Mover backend
    mv "$TEMP_DIR/backend" "$INSTALL_DIR/"
    
    # Mover frontend
    mv "$TEMP_DIR/frontend" "$INSTALL_DIR/"
    
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
User=finance
Group=finance
WorkingDirectory=$INSTALL_DIR/backend
EnvironmentFile=$INSTALL_DIR/backend/.env
ExecStart=$node_path $INSTALL_DIR/backend/src/server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
    
    # Criar usuário finance se não existir
    if ! id -u finance &>/dev/null; then
        useradd -r -s /bin/false finance
    fi
    
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
        echo "   → Verificando logs..."
        echo ""
        journalctl -u "$SERVICE_NAME" -n 30 --no-pager 2>&1
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
# ATUALIZAÇÃO
# ============================================
update() {
    log_info "Iniciando atualização..."
    
    if [[ ! -d "$INSTALL_DIR" ]]; then
        log_error "Instalação não encontrada"
        exit 1
    fi
    
    create_backup
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
    
    # Verificar se é repositório git
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        log_info "Atualizando via git..."
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
        log_success "Código atualizado via git"
    else
        log_info "Atualizando via download (instalação não-git)..."
        
        # Baixar nova versão
        rm -rf "$TEMP_DIR"
        mkdir -p "$TEMP_DIR"
        git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$TEMP_DIR" || {
            log_error "Falha ao clonar repositório"
            perform_rollback "$ROLLBACK_POINT"
            exit 1
        }
        
        # Preservar node_modules para agilizar
        if [[ -d "$INSTALL_DIR/backend/node_modules" ]]; then
            log_info "Preservando node_modules do backend..."
            mv "$INSTALL_DIR/backend/node_modules" /tmp/financeiro-backend-modules
        fi
        
        # Remover e recriar estrutura
        rm -rf "$INSTALL_DIR/backend/src"
        rm -rf "$INSTALL_DIR/frontend"
        
        # Copiar novos arquivos
        cp -r "$TEMP_DIR/backend/src" "$INSTALL_DIR/backend/"
        cp -r "$TEMP_DIR/frontend" "$INSTALL_DIR/"
        
        # Restaurar node_modules se preservado
        if [[ -d /tmp/financeiro-backend-modules ]]; then
            mv /tmp/financeiro-backend-modules "$INSTALL_DIR/backend/node_modules"
        fi
        
        log_success "Código atualizado via download"
    fi
    
    log_info "Restaurando configurações..."
    cp /tmp/financeiro-env-backup "$INSTALL_DIR/backend/.env" 2>/dev/null || true
    
    log_info "Atualizando dependências do backend..."
    cd "$INSTALL_DIR/backend" || exit 1
    npm install --no-audit --no-fund --silent || {
        log_error "Falha ao atualizar dependências (backend)"
        perform_rollback "$ROLLBACK_POINT"
        exit 1
    }
    
    log_info "Atualizando dependências do frontend..."
    cd "$INSTALL_DIR/frontend" || exit 1
    npm install --no-audit --no-fund --silent || {
        log_error "Falha ao atualizar dependências (frontend)"
        perform_rollback "$ROLLBACK_POINT"
        exit 1
    }
    
    log_info "Compilando frontend..."
    npm run build || {
        log_error "Falha no build do frontend"
        perform_rollback "$ROLLBACK_POINT"
        exit 1
    }
    
    log_info "Copiando frontend para backend/src/frontend-dist..."
    rm -rf "$INSTALL_DIR/backend/src/frontend-dist"
    mkdir -p "$INSTALL_DIR/backend/src/frontend-dist"
    cp -r "$INSTALL_DIR/frontend/dist/"* "$INSTALL_DIR/backend/src/frontend-dist/"
    
    log_info "Ajustando permissões..."
    chown -R finance:finance "$INSTALL_DIR" 2>/dev/null || true
    
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
    
    # Ajustar permissões
    chown -R finance:finance "$INSTALL_DIR"
    
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
        echo "Versão instalada: $current_version"
        echo "Nova versão:    $latest_version"
        echo ""
    fi
    
    echo "Selecione uma opção:"
    echo ""
    echo "  1) Instalar (instalação limpa)"
    echo "  2) Reinstalar (remove tudo e reinstala)"
    echo "  3) Atualizar (mantém dados)"
    echo "  4) Desinstalar (remove tudo)"
    echo "  5) Restaurar backup"
    echo "  6) Sair"
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
    
    # Extrair tag_name corretamente
    version=$(echo "$response" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4 | sed 's/"//g' || true)
    
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
        echo "$SCRIPT_VERSION"
        return
    fi
    
    echo "$version"
}

restore_backup() {
    log_info "Restaurando backup..."
    
    # Listar backups disponíveis
    local backups=($(ls -1td "$BACKUP_BASE_DIR"/financeiro-backup-* 2>/dev/null || true))
    local total=${#backups[@]}
    
    if [[ $total -eq 0 ]]; then
        log_error "Nenhum backup encontrado em: $BACKUP_BASE_DIR"
        exit 1
    fi
    
    echo ""
    echo "Backups disponíveis:"
    echo "========================================"
    local i=1
    for backup in "${backups[@]}"; do
        local backup_date=$(basename "$backup" | sed 's/financeiro-backup-//')
        echo "  $i) $backup_date"
        ((i++))
    done
    echo ""
    
    local choice
    choice=$(read_tty "Digite o número do backup para restaurar (1-$total): ")
    
    if ! [[ "$choice" =~ ^[0-9]+$ ]] || [[ "$choice" -lt 1 ]] || [[ "$choice" -gt $total ]]; then
        log_error "Opção inválida"
        exit 1
    fi
    
    local selected_backup="${backups[$((choice-1))]}"
    
    echo ""
    echo "========================================"
    echo "Backup selecionado: $(basename "$selected_backup")"
    echo "========================================"
    echo ""
    
    local confirm
    confirm=$(read_tty "Tem certeza que deseja restaurar este backup? (Digite 'SIM' para confirmar): ")
    
    if [[ "$confirm" != "SIM" ]]; then
        log_info "Restauração cancelada"
        return
    fi
    
    perform_rollback "$selected_backup"
}

# ============================================
# MAIN
# ============================================
main() {
    log_info "=========================================="
    log_info "Instalador v${SCRIPT_VERSION}"
    log_info "=========================================="
    
    # Verificar argumentos de linha de comando
    if [[ $# -gt 0 ]]; then
        case "$1" in
            --install|-i)
                echo ""
                if check_existing_installation; then
                    log_error "Instalação já existe"
                    echo "Use --reinstall ou --update"
                    exit 1
                fi
                install_new
                ;;
            --reinstall|-r)
                echo ""
                if ! check_existing_installation; then
                    log_error "Nenhuma instalação encontrada"
                    echo "Use --install"
                    exit 1
                fi
                reinstall
                ;;
            --update|-u)
                echo ""
                if ! check_existing_installation; then
                    log_error "Nenhuma instalação encontrada"
                    echo "Use --install"
                    exit 1
                fi
                update
                ;;
            --uninstall)
                echo ""
                if ! check_existing_installation; then
                    log_error "Nenhuma instalação encontrada"
                    exit 1
                fi
                uninstall
                ;;
            --help|-h)
                echo "Uso: $0 [OPÇÃO]"
                echo ""
                echo "Opções:"
                echo "  --install, -i      Instalação limpa"
                echo "  --reinstall, -r    Reinstalação (remove tudo)"
                echo "  --update, -u       Atualizar (mantém dados)"
                echo "  --uninstall        Desinstalar"
                echo "  --help, -h         Mostrar esta ajuda"
                echo ""
                echo "Sem opções: modo interativo com menu"
                exit 0
                ;;
            *)
                log_error "Opção inválida: $1"
                echo "Use --help para ver as opções disponíveis"
                exit 1
                ;;
        esac
    else
        # Modo interativo
        show_menu
        
        local choice
        choice=$(read_tty "Digite uma opção (1-6): ")
        
        case "$choice" in
            1)
                echo ""
                if check_existing_installation; then
                    log_error "Instalação já existe"
                    echo "Use a opção 2 (Reinstalar) ou 3 (Atualizar)"
                    exit 1
                fi
                install_new
                ;;
            2)
                echo ""
                if ! check_existing_installation; then
                    log_error "Nenhuma instalação encontrada"
                    echo "Use a opção 1 (Instalar)"
                    exit 1
                fi
                reinstall
                ;;
            3)
                echo ""
                if ! check_existing_installation; then
                    log_error "Nenhuma instalação encontrada"
                    echo "Use a opção 1 (Instalar)"
                    exit 1
                fi
                update
                ;;
            4)
                echo ""
                if ! check_existing_installation; then
                    log_error "Nenhuma instalação encontrada"
                    echo "Use a opção 1 (Instalar)"
                    exit 1
                fi
                uninstall
                ;;
            5)
                echo ""
                if ! check_existing_installation; then
                    log_error "Nenhum backup encontrado para restaurar"
                    exit 1
                fi
                restore_backup
                ;;
            6)
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
    fi
}

main "$@"
