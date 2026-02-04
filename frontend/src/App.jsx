
import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api, { logout, setTokenRefreshCallback, setSessionExpiredCallback } from './api';

const currencyOptions = {
  USD: { label: 'USD ($)', locale: 'en-US', code: 'USD' },
  BRL: { label: 'BRL (R$)', locale: 'pt-BR', code: 'BRL' },
  EUR: { label: 'EUR (€)', locale: 'de-DE', code: 'EUR' },
};

const defaultCategoryLabels = {
  fixed: 'Despesa fixa',
  variable: 'Despesa variável',
  income: 'Receita',
};

const categoryKindOrder = ['income', 'fixed', 'variable'];

const normalizeMonth = (period) => {
  if (!period) return '';
  if (period instanceof Date) {
    return period.toISOString().slice(0, 7);
  }
  if (typeof period === 'string') {
    return period.slice(0, 7);
  }
  return String(period).slice(0, 7);
};

const normalizeText = (value) => {
  if (!value) return '';
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
};

const formatMonth = (period) => {
  const normalized = normalizeMonth(period);
  if (!normalized) return '-';
  const [year, month] = normalized.split('-');
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${meses[Number(month) - 1]} · ${year}`;
};

const formatMonthFull = (period, withYear = false) => {
  const normalized = normalizeMonth(period);
  if (!normalized) return '-';
  const [year, month] = normalized.split('-');
  const meses = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];
  const name = meses[Number(month) - 1];
  return withYear ? `${name} ${year}` : name;
};

const Icon = ({ name }) => <span className="material-symbols-rounded" aria-hidden>{name}</span>;

const StatusPill = ({ children, tone = 'neutral' }) => (
  <span className={`pill pill-${tone}`}>{children}</span>
);

const periodParams = (filters) => {
  if (filters.useSingleMonth && filters.singleMonth) {
    return { startMonth: filters.singleMonth, endMonth: filters.singleMonth };
  }
  return {
    ...(filters.startMonth ? { startMonth: filters.startMonth } : {}),
    ...(filters.endMonth ? { endMonth: filters.endMonth } : {}),
  };
};

const createDefaultTx = (currency = 'USD') => ({
  type: 'income',
  date: '',
  periodMonth: '',
  description: '',
  categoryId: '',
  categoryKind: 'income',
  amount: '',
  currency,
  source: '',
  recurrenceType: 'one_time',
  recurrenceEndMonth: '',
  recurrenceGroupId: '',
  applyToSeries: false,
});

const safeGetItem = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
};

const safeSetItem = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    return;
  }
};

const safeRemoveItem = (key) => {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    return;
  }
};

const safeParse = (key, defaultValue = null) => {
  try {
    const raw = safeGetItem(key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch (err) {
    safeRemoveItem(key);
    return defaultValue;
  }
};

const safeParseUser = () => {
  try {
    const raw = safeGetItem('userMeta');
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    safeRemoveItem('userMeta');
    return null;
  }
};

export default function App() {
  const [token, setToken] = useState(() => {
    const raw = safeGetItem('token');
    return raw && raw !== 'undefined' ? raw : '';
  });
  const [refreshToken, setRefreshToken] = useState(() => {
    const raw = safeGetItem('refreshToken');
    return raw && raw !== 'undefined' ? raw : '';
  });
  const [userMeta, setUserMeta] = useState(() => safeParseUser());
  const [authForm, setAuthForm] = useState({ login: '', password: '' });
  const [loginFailures, setLoginFailures] = useState(0);
  const [resetToken, setResetToken] = useState(() => {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('reset') || '';
  });
  const [resetForm, setResetForm] = useState({ newPassword: '', confirmPassword: '' });
  const [activePage, setActivePage] = useState('dashboard');
  const [themeChoice, setThemeChoice] = useState(() => safeGetItem('themeChoice') || 'system');
  const [currencyChoice, setCurrencyChoice] = useState(() => safeGetItem('currencyChoice') || 'USD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isAdminRoute, setIsAdminRoute] = useState(() => {
    const path = window.location.pathname || '/';
    return path === '/admin' || path.startsWith('/admin/');
  });

  const [filters, setFilters] = useState(() => 
    safeParse('filters', { startMonth: '', endMonth: '', singleMonth: '', useSingleMonth: true })
  );
  const [txFilters, setTxFilters] = useState(() =>
    safeParse('txFilters', {
      startDate: '',
      endDate: '',
      type: '',
      categoryKind: '',
      q: '',
    })
   );

  useEffect(() => {
    safeSetItem('filters', JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    safeSetItem('txFilters', JSON.stringify(txFilters));
  }, [txFilters]);



  const [summary, setSummary] = useState(null);
  const [currentMonthSummary, setCurrentMonthSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState({ income: [], expense: [] });
  const [categories, setCategories] = useState([]);
  const [projection, setProjection] = useState(null);
  const [insights, setInsights] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [editTx, setEditTx] = useState(null);
  const [txForm, setTxForm] = useState(() => createDefaultTx(safeGetItem('currencyChoice') || 'USD'));
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState({ name: '', kind: 'variable' });
  const [categoryEdits, setCategoryEdits] = useState({});
  const [importFile, setImportFile] = useState(null);
  const [importCreateCategories, setImportCreateCategories] = useState(true);
  const [importDateFormat, setImportDateFormat] = useState('auto');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ email: '', username: '', password: '', name: '' });
  const [tenants, setTenants] = useState([]);
  const [tenantForm, setTenantForm] = useState({
    name: '',
    adminName: '',
    adminEmail: '',
    adminUsername: '',
    adminPassword: '',
  });
  const [activeTenantId, setActiveTenantId] = useState(null);
  const [activeTenantNameDraft, setActiveTenantNameDraft] = useState('');
  const [profileForm, setProfileForm] = useState({
    name: '',
    username: '',
    email: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [reportForm, setReportForm] = useState({
    email: '',
    month: '',
    includeSummary: true,
    includeFixedVariable: true,
    includeCategories: true,
    includeTransactions: false,
  });
  const [navOpen, setNavOpen] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [fatalError, setFatalError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [promptDialog, setPromptDialog] = useState(null);
  const [showPasswordResetModal, setShowPasswordResetModal] = useState(false);
  const [resetCurrentPassword, setResetCurrentPassword] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetProcessing, setResetProcessing] = useState(false);
  const [smtpForm, setSmtpForm] = useState({
    host: '',
    port: 587,
    secure: false,
    username: '',
    password: '',
    fromAddress: '',
    replyTo: '',
    hasPassword: false,
    testEmail: '',
  });
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpVerifying, setSmtpVerifying] = useState(false);

  const isMaster = !!userMeta?.isMaster;
  const role = userMeta?.role || 'guest';
  const perms = userMeta?.permissions || { canView: true, canCreate: false, canEdit: false, canDelete: false };
  
  useEffect(() => {
    // Initialize default filter to current month if not set
    if (!isMaster && filters.useSingleMonth && !filters.singleMonth) {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      setFilters(prev => ({ ...prev, singleMonth: currentMonth, useSingleMonth: true }));
    }
  }, [isMaster, filters.useSingleMonth, filters.singleMonth]);
  
  const isAdmin = role === 'admin' && !isMaster;
  const canCreate = !isMaster && (isAdmin || perms.canCreate);
  const canEdit = !isMaster && (isAdmin || perms.canEdit);
  const canDelete = !isMaster && (isAdmin || perms.canDelete);
  const canManageUsers = isMaster || isAdmin;
  const canEditIdentity = isMaster || isAdmin;
  const canImport = isAdmin || canEdit;
  const canSendReports = isAdmin || canEdit;
  const tenantName = userMeta?.tenantName || '';
  const systemName = isMaster
    ? 'Painel Administrativo'
    : (tenantName ? `Controle Financeiro de ${tenantName}` : 'Controle Financeiro');
  const displayRole = isMaster ? 'Administrativo' : (role === 'admin' ? 'Administrador' : 'Colaborador');
  const currencyMeta = currencyOptions[currencyChoice] || currencyOptions.USD;
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat(currencyMeta.locale, {
      style: 'currency',
      currency: currencyMeta.code,
      maximumFractionDigits: 2,
    }),
    [currencyMeta.locale, currencyMeta.code]
  );
  const currencyFormatters = useMemo(
    () => Object.fromEntries(
      Object.entries(currencyOptions).map(([key, meta]) => ([
        key,
        new Intl.NumberFormat(meta.locale, {
          style: 'currency',
          currency: meta.code,
          maximumFractionDigits: 2,
        }),
      ]))
    ),
    []
  );

  const categoryKindOptions = [
    { value: 'income', label: defaultCategoryLabels.income },
    { value: 'fixed', label: defaultCategoryLabels.fixed },
    { value: 'variable', label: defaultCategoryLabels.variable },
  ];

  const categoriesByKind = useMemo(() => categories.reduce((acc, cat) => {
    if (!acc[cat.kind]) {
      acc[cat.kind] = [];
    }
    acc[cat.kind].push(cat);
    return acc;
  }, {}), [categories]);

  const sortedCategories = useMemo(() => [...categories].sort((a, b) => {
    const aIndex = categoryKindOrder.indexOf(a.kind);
    const bIndex = categoryKindOrder.indexOf(b.kind);
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    return (a.name || '').localeCompare(b.name || '', 'pt-BR');
  }), [categories]);
  const formatCurrency = (value) => currencyFormatter.format(value ?? 0);
  const formatCurrencyByCode = (value, code) => {
    const formatter = currencyFormatters[code] || currencyFormatter;
    return formatter.format(value ?? 0);
  };
  const themeIcons = { system: 'contrast', light: 'light_mode', dark: 'dark_mode' };
  const themeLabels = { system: 'Tema automático', light: 'Tema claro', dark: 'Tema escuro' };
  const toggleTheme = () => {
    const order = ['system', 'light', 'dark'];
    const index = order.indexOf(themeChoice);
    const next = order[(index + 1) % order.length];
    setThemeChoice(next);
  };

  const pushToast = (message, tone = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4200);
  };

  const downloadBlob = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  };

  const downloadTemplate = async () => {
    try {
      const response = await api.get('/import/template', { responseType: 'blob' });
      downloadBlob(response.data, 'modelo-importacao.csv');
    } catch (err) {
      pushToast('Não foi possível baixar o modelo', 'danger');
    }
  };

  const exportTransactionsCsv = async () => {
    setExporting(true);
    try {
      const response = await api.get('/import/export', {
        params: txFilters,
        responseType: 'blob',
      });
      const dateLabel = new Date().toISOString().slice(0, 10);
      downloadBlob(response.data, `transacoes-${dateLabel}.csv`);
    } catch (err) {
      pushToast('Falha ao exportar CSV', 'danger');
    } finally {
      setExporting(false);
    }
  };

  const buildImportFormData = (extra = {}) => {
    const formData = new FormData();
    formData.append('file', importFile);
    formData.append('createMissingCategories', importCreateCategories ? 'true' : 'false');
    formData.append('dateFormat', importDateFormat);
    Object.entries(extra).forEach(([key, value]) => formData.append(key, value));
    return formData;
  };

  const importTransactionsCsv = async () => {
    if (!importFile) return;
    if (!canImport) {
      pushToast('Sem permissão para importar', 'danger');
      return;
    }
    setImporting(true);
    try {
      const checkForm = buildImportFormData({ mode: 'check' });
      const checkResponse = await api.post('/import/transactions', checkForm);
      const duplicateCount = Number(checkResponse.data?.duplicateCount || 0);
      let duplicatePolicy = 'skip';
      if (duplicateCount > 0) {
        const choice = await confirmAction({
          title: 'Duplicidades encontradas',
          message: `Encontramos ${duplicateCount} possíveis duplicados. Como deseja prosseguir?`,
          actions: [
            { label: 'Ignorar duplicados', value: 'skip', tone: 'ghost' },
            { label: 'Substituir duplicados', value: 'replace', tone: 'primary' },
            { label: 'Importar tudo', value: 'allow', tone: 'ghost' },
          ],
          cancelLabel: 'Cancelar',
        });
        if (!choice) {
          setImporting(false);
          return;
        }
        duplicatePolicy = choice;
      }

      const formData = buildImportFormData({ duplicatePolicy });
      const { data } = await api.post('/import/transactions', formData);
      pushToast(`Importação concluída: ${data.imported || 0} itens`, 'success');
      if (data.skipped) {
        pushToast(`${data.skipped} linhas ignoradas`, 'warning');
      }
      setImportFile(null);
      await refreshAll();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Falha ao importar CSV', 'danger');
    } finally {
      setImporting(false);
    }
  };

  const confirmAction = (options) =>
    new Promise((resolve) => {
      setConfirmDialog({ ...options, resolve });
    });

  const promptAction = (options) =>
    new Promise((resolve) => {
      setPromptDialog({ ...options, value: '', resolve });
    });

  const renderGlobalLayers = () => (
    <>
      {showPasswordResetModal && (
        <div className="modal-backdrop">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Trocar senha</h3>
              <p className="muted">Você entrou com uma senha temporária. Crie uma nova senha para continuar.</p>
            </div>
            <label className="modal-field">
              <span>Senha atual (temporária)</span>
              <input type="password" value={resetCurrentPassword} onChange={(e) => setResetCurrentPassword(e.target.value)} />
            </label>
            <label className="modal-field">
              <span>Nova senha</span>
              <input type="password" value={resetNewPassword} onChange={(e) => setResetNewPassword(e.target.value)} />
            </label>
            <label className="modal-field">
              <span>Confirme a nova senha</span>
              <input type="password" value={resetConfirmPassword} onChange={(e) => setResetConfirmPassword(e.target.value)} />
            </label>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => { setShowPasswordResetModal(false); handleLogout(); }} disabled={resetProcessing}>Sair</button>
              <button className="btn btn-primary" onClick={submitTempPasswordReset} disabled={resetProcessing}>{resetProcessing ? '⏳ Salvando...' : 'Salvar senha'}</button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog && (
        <div className="modal-backdrop" onClick={() => { confirmDialog.resolve(null); setConfirmDialog(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{confirmDialog.title}</h3>
              <p className="muted">{confirmDialog.message}</p>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => { confirmDialog.resolve(null); setConfirmDialog(null); }}
              >
                {confirmDialog.cancelLabel || 'Cancelar'}
              </button>
              {confirmDialog.actions?.map((action) => (
                <button
                  key={action.label}
                  className={`btn ${action.tone === 'danger' ? 'btn-danger' : action.tone === 'ghost' ? 'btn-ghost' : 'btn-primary'}`}
                  onClick={() => { confirmDialog.resolve(action.value); setConfirmDialog(null); }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {promptDialog && (
        <div className="modal-backdrop" onClick={() => { promptDialog.resolve(null); setPromptDialog(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{promptDialog.title}</h3>
              <p className="muted">{promptDialog.message}</p>
            </div>
            <label className="modal-field">
              <span>{promptDialog.label}</span>
              <input
                type={promptDialog.type || 'text'}
                value={promptDialog.value}
                onChange={(e) => setPromptDialog((prev) => ({ ...prev, value: e.target.value }))}
                placeholder={promptDialog.placeholder}
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => { promptDialog.resolve(null); setPromptDialog(null); }}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={() => { promptDialog.resolve(promptDialog.value); setPromptDialog(null); }}
              >
                {promptDialog.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
       {showFiltersModal && (
        <div className="modal-backdrop" onClick={() => setShowFiltersModal(false)}>
          <div className="modal filters-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <p className="eyebrow">Filtros rápidos</p>
              <h3>Período e exibição</h3>
            </div>
            <div className="filters-grid">
              <label>
                <span>Mês inicial</span>
                <input
                  type="month"
                  value={filters.startMonth}
                  onChange={(e) => setFilters({ ...filters, startMonth: e.target.value, useSingleMonth: false })}
                  disabled={filters.useSingleMonth}
                />
              </label>
              <label>
                <span>Mês final</span>
                <input
                  type="month"
                  value={filters.endMonth}
                  onChange={(e) => setFilters({ ...filters, endMonth: e.target.value, useSingleMonth: false })}
                  disabled={filters.useSingleMonth}
                />
              </label>
              <label>
                <span>Mês específico</span>
                <input
                  type="month"
                  value={filters.singleMonth}
                  onChange={(e) => setFilters({ ...filters, singleMonth: e.target.value, useSingleMonth: !!e.target.value })}
                  disabled={!filters.useSingleMonth}
                />
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={filters.useSingleMonth}
                  onChange={(e) => setFilters({ ...filters, useSingleMonth: e.target.checked })}
                />
                <span>Focar em um único mês</span>
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowFiltersModal(false)}>
                Fechar
              </button>
              <button className="btn btn-primary" onClick={() => setShowFiltersModal(false)}>
                Aplicar filtros
              </button>
            </div>
          </div>
        </div>
      )}
      {showImportModal && (
        <div className="modal-backdrop" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <p className="eyebrow">Importação</p>
              <h3>Importar e exportar dados</h3>
              <div className="card-head-actions">
                <StatusPill tone="info">CSV</StatusPill>
              </div>
            </div>
            <div className="form-grid import-grid">
              <label className="form-span-2">
                <span>Arquivo CSV</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                />
                {importFile && (
                  <small className="helper">Selecionado: {importFile.name}</small>
                )}
                <small className="helper import-note">
                  Colunas aceitas: tipo, data, descrição, valor, classificação, categoria, moeda, origem, recorrência.
                </small>
              </label>
              <label>
                <span>Formato da data</span>
                <select value={importDateFormat} onChange={(e) => setImportDateFormat(e.target.value)}>
                  <option value="auto">Automático</option>
                  <option value="dmy">DD/MM/AAAA</option>
                  <option value="mdy">MM/DD/AAAA</option>
                  <option value="ymd">AAAA-MM-DD</option>
                </select>
                <small className="helper">Use automático para planilhas desconhecidas.</small>
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={importCreateCategories}
                  onChange={(e) => setImportCreateCategories(e.target.checked)}
                  disabled={!canImport}
                />
                <span>Criar categorias ausentes</span>
              </label>
              <div className="import-actions">
                <button className="btn btn-ghost" type="button" onClick={downloadTemplate}>
                  <Icon name="download" /> Modelo CSV
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={exportTransactionsCsv}
                  disabled={exporting}
                >
                  <Icon name="upload_file" /> {exporting ? 'Exportando...' : 'Exportar CSV'}
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={importTransactionsCsv}
                  disabled={!importFile || importing || !canImport}
                >
                  <Icon name="file_upload" /> {importing ? 'Importando...' : 'Importar CSV'}
                </button>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowImportModal(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
      {!!toasts.length && (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.tone}`}>
              <Icon name={toast.tone === 'success' ? 'check_circle' : toast.tone === 'danger' ? 'error' : toast.tone === 'warning' ? 'warning' : 'info'} />
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const updateUserLocal = (id, changes) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...changes } : u)));
  };

  const updateCategoryLocal = (id, changes) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)));
  };

  // Activity tracking for inactivity auto-refresh + logout timer
  const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // refresh every 5 minutes (if data is stale)
  const inactivityTimerRef = useRef(null);
  const refreshIntervalRef = useRef(null);

  const resetInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    if (!token) return;
    inactivityTimerRef.current = setTimeout(() => {
      // Inactivity timeout reached: log out and show toast
      pushToast('Sessão encerrada por inatividade', 'warning');
      logout();
    }, INACTIVITY_TIMEOUT_MS);
  };

  const startRefreshInterval = () => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }
    if (!token) return;
    refreshIntervalRef.current = setInterval(() => {
      // Refresh dashboard data periodically when app is in focus
      if (document.hidden) return;
      if (isMaster) {
        fetchTenants();
      } else {
        refreshAll();
      }
    }, REFRESH_INTERVAL_MS);
  };

  // Listen for user activity and reset inactivity timer
  useEffect(() => {
    if (!token) return;
    const handleActivity = () => {
      resetInactivityTimer();
    };
    document.addEventListener('mousemove', handleActivity);
    document.addEventListener('keydown', handleActivity);
    document.addEventListener('touchstart', handleActivity);
    document.addEventListener('click', handleActivity);
    // Initial start
    resetInactivityTimer();
    startRefreshInterval();
    return () => {
      document.removeEventListener('mousemove', handleActivity);
      document.removeEventListener('keydown', handleActivity);
      document.removeEventListener('touchstart', handleActivity);
      document.removeEventListener('click', handleActivity);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [token]);

  useEffect(() => {
    if (themeChoice === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', themeChoice);
    }
    safeSetItem('themeChoice', themeChoice);
  }, [themeChoice]);

  useEffect(() => {
    safeSetItem('currencyChoice', currencyChoice);
  }, [currencyChoice]);

  useEffect(() => {
    if (editTx) return;
    setTxForm((prev) => ({ ...prev, currency: currencyChoice }));
  }, [currencyChoice, editTx]);

  useEffect(() => {
    const onError = (event) => {
      const message = event?.message || 'Erro inesperado';
      setFatalError(message);
    };
    const onRejection = (event) => {
      const message = event?.reason?.message || 'Erro inesperado';
      setFatalError(message);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname || '/';
      setIsAdminRoute(path === '/admin' || path.startsWith('/admin/'));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 240);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!token) {
      safeRemoveItem('token');
      return;
    }
    safeSetItem('token', token);
  }, [token]);

  useEffect(() => {
    if (!refreshToken) {
      safeRemoveItem('refreshToken');
      return;
    }
    safeSetItem('refreshToken', refreshToken);
  }, [refreshToken]);

  useEffect(() => {
    if (!token || !userMeta) return;
    if (userMeta.isMaster) {
      fetchTenants();
      return;
    }
    refreshAll();
  }, [token, userMeta]);

  useEffect(() => {
    if (!token || !userMeta) return;
    if (userMeta.isMaster && !isAdminRoute) {
      window.location.href = '/admin';
      return;
    }
    if (!userMeta.isMaster && isAdminRoute) {
      setToken('');
      setUserMeta(null);
      safeRemoveItem('token');
      safeRemoveItem('userMeta');
      setActivePage('dashboard');
      window.location.href = '/';
    }
  }, [token, userMeta, isAdminRoute]);

  useEffect(() => {
    if (!userMeta) return;
    setProfileForm((prev) => ({
      ...prev,
      name: userMeta.name || '',
      username: userMeta.username || '',
      email: userMeta.email || '',
    }));
  }, [userMeta]);

  useEffect(() => {
    if (!userMeta || isMaster) return;
    const fallbackMonth = (summary?.serverMonth || filters.singleMonth || new Date().toISOString().slice(0, 7));
    setReportForm((prev) => ({
      email: prev.email || userMeta.email || '',
      month: prev.month || fallbackMonth,
      includeSummary: prev.includeSummary ?? true,
      includeFixedVariable: prev.includeFixedVariable ?? true,
      includeCategories: prev.includeCategories ?? true,
      includeTransactions: prev.includeTransactions ?? false,
    }));
  }, [userMeta, summary?.serverMonth, filters.singleMonth, isMaster]);

  useEffect(() => {
    if (reportForm.includeSummary) return;
    if (!reportForm.includeFixedVariable) return;
    setReportForm((prev) => ({ ...prev, includeFixedVariable: false }));
  }, [reportForm.includeSummary]);

  useEffect(() => {
    setTxForm((prev) => {
      let next = { ...prev };
      if (prev.type === 'income') {
        next.categoryKind = 'income';
      }
      if (prev.type === 'expense' && prev.categoryKind === 'income') {
        next.categoryKind = 'variable';
      }
      const list = categoriesByKind[next.categoryKind] || [];
      const hasCurrent = list.some((cat) => String(cat.id) === String(prev.categoryId));
      if (!list.length) {
        next.categoryId = '';
      } else if (!hasCurrent) {
        next.categoryId = String(list[0].id);
      }
      return next;
    });
  }, [txForm.type, categoriesByKind]);

  useEffect(() => {
    if (!userMeta) return;
    if (userMeta.isMaster && !['master', 'smtp', 'conta'].includes(activePage)) {
      setActivePage('master');
    }
    if (!userMeta.isMaster && ['master', 'smtp'].includes(activePage)) {
      setActivePage('dashboard');
    }
  }, [userMeta, activePage]);

  useEffect(() => {
    if (!token || isMaster) return;
    refreshDataForFilters();
  }, [filters, isMaster, token]);

  useEffect(() => {
    if (!token || activePage !== 'usuarios' || !isAdmin) return;
    refreshUsers();
  }, [activePage, isAdmin, token]);

  useEffect(() => {
    if (!token || activePage !== 'transacoes') return;
    fetchTransactions();
  }, [activePage, token]);

  useEffect(() => {
    if (!token || !isMaster || activePage !== 'smtp') return;
    fetchSmtpSettings();
  }, [activePage, isMaster, token]);

  useEffect(() => {
    if (!token || activePage !== 'transacoes') return;
    const timer = setTimeout(() => fetchTransactions(), 300);
    return () => clearTimeout(timer);
  }, [txFilters, activePage, token]);

  useEffect(() => {
    if (!token || !isMaster || activePage !== 'master') return;
    fetchTenants();
  }, [activePage, isMaster, token]);

  const refreshAll = async () => {
    if (isMaster) {
      await fetchTenants();
      return;
    }
    await Promise.all([
      refreshDataForFilters(),
      fetchTransactions(),
      fetchCategories(),
      fetchProjection(),
      fetchInsights(),
    ]);
  };

  const refreshDataForFilters = async () => {
    if (isMaster) return;
    await Promise.all([
      fetchSummary(),
      fetchMonthly(),
      fetchCategoryBreakdown(),
      fetchTransactions(),
    ]);
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', {
        email: authForm.login,
        password: authForm.password,
      });
      if (isAdminRoute && !data.isMaster) {
        setError('Acesso restrito à área administrativa.');
        return;
      }
      setLoginFailures(0);
      setToken(data.token);
      setRefreshToken(data.refreshToken || '');
      const meta = {
        role: data.role,
        name: data.name,
        username: data.username,
        email: data.email || authForm.login,
        permissions: data.permissions,
        tenantId: data.tenantId,
        tenantName: data.tenantName,
        isMaster: data.isMaster,
      };
      setUserMeta(meta);
      safeSetItem('userMeta', JSON.stringify(meta));
      setProfileForm((prev) => ({
        ...prev,
        name: data.name || '',
        username: data.username || '',
        email: data.email || authForm.login,
      }));
      setActivePage(data.isMaster ? 'master' : 'dashboard');
      // If backend indicates must-reset-password (temp password or after forgot), open modal blocking navigation
      if (data.mustResetPassword) {
        setResetCurrentPassword(authForm.password || '');
        setResetNewPassword('');
        setResetConfirmPassword('');
        setShowPasswordResetModal(true);
      } else {
        if (!isAdminRoute && data.isMaster) {
          window.location.href = '/admin';
          return;
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Falha ao autenticar');
      setLoginFailures((prev) => prev + 1);
    } finally {
      setLoading(false);
    }
  };

  const submitTempPasswordReset = async () => {
    if (!resetNewPassword || resetNewPassword.length < 6) {
      pushToast('A nova senha deve ter ao menos 6 caracteres', 'danger');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      pushToast('Confirmação de senha não confere', 'danger');
      return;
    }
    setResetProcessing(true);
    try {
      await api.patch('/users/me/password', {
        currentPassword: resetCurrentPassword,
        newPassword: resetNewPassword,
      });
      pushToast('Senha atualizada com sucesso', 'success');
      setShowPasswordResetModal(false);
      setResetCurrentPassword('');
      setResetNewPassword('');
      setResetConfirmPassword('');
    } catch (err) {
      pushToast(err.response?.data?.error || 'Falha ao atualizar senha', 'danger');
    } finally {
      setResetProcessing(false);
    }
  };

  const handleLogout = () => {
    setToken('');
    setRefreshToken('');
    setUserMeta(null);
    setTenants([]);
    setActiveTenantId(null);
    setActivePage('dashboard');
    logout();
  };

  useEffect(() => {
    const validateAndRefreshToken = async () => {
      if (!token) return;
      if (!userMeta && refreshToken) {
        try {
          const { data } = await api.post('/auth/refresh', { refreshToken });
          setToken(data.accessToken);
          setRefreshToken(data.refreshToken);
        } catch (err) {
          handleLogout();
        }
      }
    };
    validateAndRefreshToken();
  }, [token, refreshToken, userMeta]);

  useEffect(() => {
    setSessionExpiredCallback(() => {
      pushToast('Sessão expirada. Por favor, faça login novamente.', 'warning');
    });
  }, []);

  const buildPeriod = () => periodParams(filters);

  const fetchSummary = async () => {
    if (isMaster) return;
    try {
      const { data } = await api.get('/dashboard/summary', { params: buildPeriod() });
      const latest = data.latestPeriod
        ? { ...data.latestPeriod, periodMonth: normalizeMonth(data.latestPeriod.periodMonth) }
        : null;
      const serverMonth = data.serverMonth ? normalizeMonth(data.serverMonth) : '';
      console.log('Server month:', serverMonth, 'Filters singleMonth:', filters.singleMonth, 'Summary data:', data);
      setSummary({ ...data, latestPeriod: latest });
      if (serverMonth && !filters.singleMonth) {
        setFilters((prev) => ({ ...prev, singleMonth: serverMonth, useSingleMonth: true }));
      }
      // Fetch current month balance for sidebar
      const currentMonth = serverMonth || getCurrentMonth();
      console.log('Current month for sidebar:', currentMonth);
      if (currentMonth) {
        try {
          const { data: currentMonthData } = await api.get('/dashboard/summary', {
            params: { startMonth: currentMonth, endMonth: currentMonth }
          });
          console.log('Current month balance data:', currentMonthData);
          setCurrentMonthSummary(currentMonthData);
        } catch (err) {
          console.error('Failed to fetch current month balance:', err);
          // Fallback to main summary if current month fetch fails
          setCurrentMonthSummary(data);
        }
      } else {
        // If no current month, use main summary
        setCurrentMonthSummary(data);
      }
    } catch (err) {
      console.error(err);
      // Even if main fetch fails, try to get current month
      const currentMonth = getCurrentMonth();
      if (currentMonth) {
        try {
          const { data: currentMonthData } = await api.get('/dashboard/summary', {
            params: { startMonth: currentMonth, endMonth: currentMonth }
          });
          setCurrentMonthSummary(currentMonthData);
        } catch (err2) {
          console.error('Failed to fetch current month as fallback:', err2);
        }
      }
    }
  };

  const getCurrentMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  const fetchMonthly = async () => {
    if (isMaster) return;
    try {
      const { data } = await api.get('/dashboard/monthly', { params: buildPeriod() });
      const normalized = data.map((row) => ({
        ...row,
        periodMonth: normalizeMonth(row.periodMonth),
      }));
      setMonthly(normalized);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchCategoryBreakdown = async () => {
    if (isMaster) return;
    try {
      const { data } = await api.get('/dashboard/categories', { params: buildPeriod() });
      setCategoryBreakdown(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchCategories = async () => {
    if (isMaster) return;
    try {
      const { data } = await api.get('/categories');
      const normalized = data.map((item) => ({
        ...item,
        kind: item.kind || 'variable',
      }));
      setCategories(normalized);
      setCategoryEdits({});
    } catch (err) {
      console.error(err);
    }
  };

  const fetchProjection = async () => {
    if (isMaster) return;
    console.log('Fetching projection...');
    try {
      const { data } = await api.get('/dashboard/projection');
      console.log('Projection data:', data);
      const normalized = {
        lastMonths: data.lastMonths || [],
        projectedNet: data.projectedNet || 0,
        trend: data.trend || 0
      };
      setProjection(normalized);
    } catch (err) {
      console.error('Projection fetch error:', err);
      // Set default projection to avoid infinite loading
      setProjection({ lastMonths: [], projectedNet: 0, trend: 0 });
    }
  };

  const fetchInsights = async () => {
    if (isMaster) return;
    try {
      const { data } = await api.get('/dashboard/insights');
      setInsights(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTransactions = async () => {
    if (isMaster) return;
    try {
      const params = { ...txFilters };
      if (activePage !== 'transacoes') {
        const period = buildPeriod();
        if (filters.useSingleMonth && filters.singleMonth) {
          params.startMonth = filters.singleMonth;
          params.endMonth = filters.singleMonth;
        } else {
          Object.assign(params, period);
        }
      }
      const { data } = await api.get('/transactions', { params });
      const normalized = data.map((item) => ({
        ...item,
        periodMonth: normalizeMonth(item.periodMonth),
        recurrenceType: item.recurrenceType || 'one_time',
        recurrenceGroupId: item.recurrenceGroupId || '',
        categoryKind: item.categoryKind || '',
        categoryId: item.categoryId ? String(item.categoryId) : '',
        categoryName: item.categoryName || '',
        currency: item.currency || currencyChoice,
      }));
      setTransactions(normalized);
    } catch (err) {
      console.error(err);
    }
  };


  const fetchUsers = async (tenantId) => {
    try {
      const { data } = await api.get('/users', tenantId ? { params: { tenantId } } : undefined);
      setUsers(data);
      if (tenantId) {
        setActiveTenantId(tenantId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const refreshUsers = async () => {
    await fetchUsers(isMaster ? activeTenantId : undefined);
  };

  const fetchTenants = async () => {
    if (!isMaster) return;
    try {
      const { data } = await api.get('/tenants');
      setTenants(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSmtpSettings = async () => {
    if (!isMaster) return;
    setSmtpLoading(true);
    try {
      const { data } = await api.get('/admin/smtp');
      setSmtpForm((prev) => ({
        ...prev,
        host: data.host || '',
        port: data.port || 587,
        secure: !!data.secure,
        username: data.username || '',
        fromAddress: data.fromAddress || '',
        replyTo: data.replyTo || '',
        hasPassword: !!data.hasPassword,
        password: '',
        testEmail: prev.testEmail || userMeta?.email || '',
      }));
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao carregar SMTP', 'danger');
    } finally {
      setSmtpLoading(false);
    }
  };

  const saveSmtpSettings = async () => {
    if (!isMaster) return;
    if (!smtpForm.host) {
      pushToast('Informe o servidor SMTP.', 'warning');
      return;
    }
    setSmtpSaving(true);
    try {
      const response = await api.put('/admin/smtp', {
        host: smtpForm.host,
        port: Number(smtpForm.port) || 587,
        secure: !!smtpForm.secure,
        username: smtpForm.username,
        password: smtpForm.password || undefined,
        fromAddress: smtpForm.fromAddress,
        replyTo: smtpForm.replyTo,
      });
      pushToast('✓ SMTP atualizado com sucesso!', 'success');
      setSmtpForm((prev) => ({
        ...prev,
        password: '',
        hasPassword: !!(prev.password || prev.hasPassword),
      }));
    } catch (err) {
      const errorMsg = err.response?.data?.error || 'Erro ao salvar SMTP';
      pushToast(errorMsg, 'danger');
    } finally {
      setSmtpSaving(false);
    }
  };

  const verifySmtpConnection = async () => {
    if (!isMaster) return;
    if (!smtpForm.host) {
      pushToast('Configure o servidor SMTP primeiro.', 'warning');
      return;
    }
    setSmtpVerifying(true);
    try {
      const response = await api.post('/admin/smtp/verify');
      pushToast(`✓ ${response.data.message || 'SMTP validado com sucesso!'}`, 'success');
    } catch (err) {
      const errorMsg = err.response?.data?.error || 'Erro ao validar SMTP';
      pushToast(errorMsg, 'danger');
    } finally {
      setSmtpVerifying(false);
    }
  };

  const sendSmtpTest = async () => {
    if (!isMaster) return;
    const target = smtpForm.testEmail || userMeta?.email;
    if (!target) {
      pushToast('Informe um e-mail para teste.', 'warning');
      return;
    }
    setSmtpTesting(true);
    try {
      const response = await api.post('/admin/smtp/test', { email: target });
      pushToast(`✓ ${response.data.message || 'E-mail de teste enviado com sucesso!'}`, 'success');
    } catch (err) {
      const errorMsg = err.response?.data?.error || 'Erro ao enviar e-mail de teste';
      pushToast(errorMsg, 'danger');
    } finally {
      setSmtpTesting(false);
    }
  };

  const saveTransaction = async (e) => {
    e.preventDefault();
    if (editTx && !canEdit) {
      pushToast('Você não tem permissão para editar lançamentos.', 'danger');
      return;
    }
    if (!editTx && !canCreate) {
      pushToast('Você não tem permissão para criar lançamentos.', 'danger');
      return;
    }
    if (editTx && txForm.applyToSeries) {
      const choice = await confirmAction({
        title: 'Atualizar série',
        message: 'As alterações serão aplicadas em todos os meses da série. Deseja continuar?',
        actions: [{ label: 'Atualizar série', value: 'confirm', tone: 'primary' }],
        cancelLabel: 'Cancelar',
      });
      if (!choice) return;
    }
    if (!txForm.date) {
      pushToast('Informe a data do lançamento.', 'warning');
      return;
    }
    setLoading(true);
    const periodMonth = txForm.date.slice(0, 7);
    const payload = {
      type: txForm.type,
      date: txForm.date || null,
      periodMonth,
      description: txForm.description,
      amount: Number(txForm.amount),
      categoryKind: txForm.type === 'income' ? 'income' : (txForm.categoryKind || 'variable'),
      categoryId: txForm.categoryId || null,
      currency: txForm.currency || currencyChoice,
      source: txForm.source,
      recurrenceType: txForm.recurrenceType,
      recurrenceEndMonth: txForm.recurrenceType === 'monthly'
        ? (txForm.recurrenceEndMonth || periodMonth)
        : null,
      ...(editTx ? { applyToSeries: !!txForm.applyToSeries } : {}),
    };
    try {
      const response = editTx
        ? await api.put(`/transactions/${editTx}`, payload)
        : await api.post('/transactions', payload);
      if (editTx && response?.data?.seriesUpdated) {
        pushToast('Série atualizada com sucesso.', 'success');
      } else if (!editTx && response?.data?.count) {
        pushToast(`Lançamento recorrente criado (${response.data.count} meses).`, 'success');
      } else {
        pushToast(editTx ? 'Lançamento atualizado.' : 'Lançamento salvo.', 'success');
      }
      setTxForm(createDefaultTx(currencyChoice));
      setEditTx(null);
      setError('');
      await refreshDataForFilters();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao salvar lançamento', 'danger');
    } finally {
      setLoading(false);
    }
  };

  const deleteTransaction = async (tx) => {
    if (!canDelete) {
      pushToast('Você não tem permissão para excluir lançamentos.', 'danger');
      return;
    }
    const isRecurring = tx?.recurrenceGroupId && tx?.recurrenceType === 'monthly';
    let choice = null;
    if (isRecurring) {
      choice = await confirmAction({
        title: 'Excluir lançamento recorrente',
        message: 'Este lançamento faz parte de uma série mensal. O que deseja excluir?',
        actions: [
          { label: 'Só este mês', value: 'single', tone: 'ghost' },
          { label: 'Excluir série', value: 'series', tone: 'danger' },
        ],
        cancelLabel: 'Cancelar',
      });
    } else {
      choice = await confirmAction({
        title: 'Excluir lançamento',
        message: 'Confirma excluir este lançamento?',
        actions: [{ label: 'Excluir', value: 'single', tone: 'danger' }],
        cancelLabel: 'Cancelar',
      });
    }
    if (!choice) return;

    try {
      const response = choice === 'series'
        ? await api.delete(`/transactions/${tx.id}?series=true`)
        : await api.delete(`/transactions/${tx.id}`);
      if (response?.data?.seriesDeleted) {
        pushToast('Série removida com sucesso.', 'success');
      } else {
        pushToast('Lançamento excluído.', 'success');
      }
      setError('');
      await refreshDataForFilters();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao excluir', 'danger');
    }
  };

  const startEdit = (tx) => {
    const fallbackDate = tx.periodMonth ? `${tx.periodMonth.slice(0, 7)}-01` : '';
    setEditTx(tx.id);
    setTxForm({
      type: tx.type,
      date: tx.date ? tx.date.slice(0, 10) : fallbackDate,
      periodMonth: tx.periodMonth ? tx.periodMonth.slice(0, 7) : '',
      description: tx.description,
      categoryId: tx.categoryId || '',
      categoryKind: tx.categoryKind || (tx.type === 'income' ? 'income' : 'variable'),
      amount: tx.amount,
      currency: tx.currency || currencyChoice,
      source: tx.source || '',
      recurrenceType: tx.recurrenceType || 'one_time',
      recurrenceEndMonth: '',
      recurrenceGroupId: tx.recurrenceGroupId || '',
      applyToSeries: false,
    });
    setActivePage('nova');
  };

  const saveUserPermissions = async (id, perms) => {
    if (!canManageUsers) {
      pushToast('Você não tem permissão para alterar usuários.', 'danger');
      return;
    }
    try {
      await api.patch(`/users/${id}/permissions`, perms);
      pushToast('Permissões atualizadas.', 'success');
      await refreshUsers();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao atualizar permissões', 'danger');
    }
  };

  const saveUserRole = async (id, role) => {
    if (!canManageUsers) {
      pushToast('Você não tem permissão para alterar usuários.', 'danger');
      return;
    }
    try {
      await api.patch(`/users/${id}/role`, { role });
      pushToast('Função atualizada.', 'success');
      await refreshUsers();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao atualizar função', 'danger');
    }
  };

    const buildUserProfilePayload = (user) => ({
      name: (user.name || '').trim(),
      username: (user.username || '').trim(),
      email: (user.email || '').trim(),
    });

    const saveUserProfile = async (id, payload) => {
      if (!canManageUsers) {
        pushToast('Você não tem permissão para alterar usuários.', 'danger');
        return;
      }
      try {
      await api.patch(`/users/${id}/profile`, payload);
      pushToast('Usuário atualizado.', 'success');
      await refreshUsers();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao atualizar usuário', 'danger');
      await refreshUsers();
    }
  };

  const deleteUser = async (id) => {
    if (!canManageUsers) {
      pushToast('Você não tem permissão para alterar usuários.', 'danger');
      return;
    }
    const choice = await confirmAction({
      title: 'Excluir usuário',
      message: 'Confirma excluir este usuário? Esta ação não pode ser desfeita.',
      actions: [{ label: 'Excluir', value: 'confirm', tone: 'danger' }],
      cancelLabel: 'Cancelar',
    });
    if (!choice) return;
    try {
      await api.delete(`/users/${id}`);
      await refreshUsers();
      pushToast('Usuário excluído.', 'success');
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao excluir usuário', 'danger');
    }
  };

  const resetUserPassword = async (id) => {
    if (!canManageUsers) {
      pushToast('Você não tem permissão para alterar usuários.', 'danger');
      return;
    }
    const password = await promptAction({
      title: 'Resetar senha',
      message: 'Defina uma nova senha para o usuário.',
      label: 'Nova senha (mínimo 6 caracteres)',
      placeholder: 'Digite a nova senha',
      type: 'password',
      confirmLabel: 'Atualizar senha',
    });
    if (!password) return;
    if (password.trim().length < 6) {
      pushToast('A senha precisa ter ao menos 6 caracteres.', 'warning');
      return;
    }
    try {
      await api.patch(`/users/${id}/password`, { password });
      pushToast('Senha atualizada.', 'success');
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao atualizar senha', 'danger');
    }
  };

  const createUser = async (e) => {
    e.preventDefault();
    if (!canManageUsers) {
      pushToast('Você não tem permissão para criar usuários.', 'danger');
      return;
    }
    if (isMaster && !activeTenantId) {
      pushToast('Selecione uma empresa para criar o usuário.', 'warning');
      return;
    }
    try {
      await api.post('/auth/register', {
        ...newUser,
        username: newUser.username.trim(),
        tenantId: isMaster ? activeTenantId : undefined,
      });
      setNewUser({ email: '', username: '', password: '', name: '' });
      pushToast('Usuário criado com sucesso.', 'success');
      await fetchUsers(isMaster ? activeTenantId : undefined);
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao criar usuário', 'danger');
    }
  };

  const createTenant = async (e) => {
    e.preventDefault();
    if (!isMaster) return;
    try {
      await api.post('/tenants', tenantForm);
      setTenantForm({ name: '', adminName: '', adminEmail: '', adminUsername: '', adminPassword: '' });
      pushToast('Empresa criada com sucesso.', 'success');
      await fetchTenants();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao criar empresa', 'danger');
    }
  };

  const renameTenant = async (tenant) => {
    if (!isMaster) return;
    const name = await promptAction({
      title: 'Renomear empresa',
      message: 'Defina o novo nome para este controle financeiro.',
      label: 'Nome da empresa',
      placeholder: tenant?.name || 'Novo nome',
      confirmLabel: 'Salvar',
    });
    if (!name) return;
    try {
      await api.patch(`/tenants/${tenant.id}`, { name });
      pushToast('Empresa atualizada.', 'success');
      await fetchTenants();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao atualizar empresa', 'danger');
    }
  };

  const deleteTenant = async (tenant) => {
    if (!isMaster) return;
    const choice = await confirmAction({
      title: 'Remover empresa',
      message: 'Essa ação remove usuários e lançamentos vinculados à empresa. Deseja continuar?',
      actions: [{ label: 'Remover', value: 'confirm', tone: 'danger' }],
      cancelLabel: 'Cancelar',
    });
    if (!choice) return;
    try {
      await api.delete(`/tenants/${tenant.id}`);
      pushToast('Empresa removida.', 'success');
      setTenants((prev) => prev.filter((item) => item.id !== tenant.id));
      if (activeTenantId === tenant.id) {
        setActiveTenantId(null);
        setUsers([]);
      }
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao remover empresa', 'danger');
    }
  };

  const updateActiveTenantName = async () => {
    if (!isMaster || !activeTenantId) return;
    if (!activeTenantNameDraft.trim()) {
      pushToast('Informe o nome do controle financeiro.', 'warning');
      return;
    }
    try {
      const { data } = await api.patch(`/tenants/${activeTenantId}`, { name: activeTenantNameDraft.trim() });
      setTenants((prev) => prev.map((tenant) => (
        tenant.id === activeTenantId ? { ...tenant, name: data.name } : tenant
      )));
      pushToast('Nome do sistema atualizado.', 'success');
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao atualizar nome', 'danger');
    }
  };

  const createCategory = async (e) => {
    e.preventDefault();
    if (!canCreate) {
      pushToast('Você não tem permissão para criar categorias.', 'danger');
      return;
    }
    const name = categoryDraft.name.trim();
    if (!name) {
      pushToast('Informe o nome da categoria.', 'warning');
      return;
    }
    try {
      await api.post('/categories', {
        name,
        kind: categoryDraft.kind,
        tenantId: isMaster ? activeTenantId : undefined,
      });
      setCategoryDraft({ name: '', kind: 'variable' });
      pushToast('Categoria criada.', 'success');
      await fetchCategories();
      await refreshDataForFilters();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao criar categoria', 'danger');
    }
  };

  const saveCategory = async (id) => {
    if (!canEdit) {
      pushToast('Você não tem permissão para editar categorias.', 'danger');
      return;
    }
    const draft = categoryEdits[id];
    const current = categories.find((cat) => cat.id === id);
    const name = (draft?.name ?? current?.name ?? '').trim();
    const kind = draft?.kind ?? current?.kind ?? 'variable';
    if (!name) {
      pushToast('Informe o nome da categoria.', 'warning');
      return;
    }
    try {
      await api.put(`/categories/${id}`, { name, kind });
      pushToast('Categoria atualizada.', 'success');
      await fetchCategories();
      await refreshDataForFilters();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao atualizar categoria', 'danger');
    }
  };

  const deleteCategory = async (id) => {
    if (!canDelete) {
      pushToast('Você não tem permissão para excluir categorias.', 'danger');
      return;
    }
    const choice = await confirmAction({
      title: 'Excluir categoria',
      message: 'Excluir categoria não apaga lançamentos, mas remove a referência nas transações.',
      actions: [{ label: 'Excluir', value: 'confirm', tone: 'danger' }],
      cancelLabel: 'Cancelar',
    });
    if (!choice) return;
    try {
      await api.delete(`/categories/${id}`);
      pushToast('Categoria excluída.', 'success');
      await fetchCategories();
      await refreshDataForFilters();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao excluir categoria', 'danger');
    }
  };

  const resetCategories = async () => {
    if (!canEdit) {
      pushToast('Você não tem permissão para atualizar categorias.', 'danger');
      return;
    }
    const choice = await confirmAction({
      title: 'Reiniciar categorias',
      message: 'Isso redefine as categorias para Receita, Despesa fixa e Despesa variável. Os lançamentos são mantidos.',
      actions: [{ label: 'Reiniciar', value: 'confirm', tone: 'danger' }],
      cancelLabel: 'Cancelar',
    });
    if (!choice) return;
    try {
      await api.post('/categories/reset');
      pushToast('Categorias reiniciadas.', 'success');
      await fetchCategories();
      await refreshDataForFilters();
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao reiniciar categorias', 'danger');
    }
  };

  const updateProfile = async () => {
    try {
      const payload = { name: profileForm.name };
      if (canEditIdentity) {
        if (!profileForm.username?.trim()) {
          pushToast('Informe um nome de usuário válido.', 'warning');
          return;
        }
        if (!profileForm.email?.trim()) {
          pushToast('Informe um e-mail válido.', 'warning');
          return;
        }
        payload.username = profileForm.username.trim();
        payload.email = profileForm.email.trim();
      }
      await api.patch('/users/me/profile', payload);
      setUserMeta((prev) => {
        const meta = { ...prev, name: profileForm.name };
        if (canEditIdentity) {
          meta.username = payload.username;
          meta.email = payload.email;
        }
        safeSetItem('userMeta', JSON.stringify(meta));
        return meta;
      });
      pushToast('Perfil atualizado.', 'success');
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao salvar perfil', 'danger');
    }
  };

  const updatePassword = async () => {
    const currentPassword = (profileForm.currentPassword || '').trim();
    const newPassword = (profileForm.newPassword || '').trim();
    const confirmPassword = (profileForm.confirmPassword || '').trim();
    if (!currentPassword || !newPassword || !confirmPassword) {
      pushToast('Preencha senha atual, nova senha e confirmação.', 'warning');
      return;
    }
    if (newPassword.length < 6) {
      pushToast('A nova senha deve ter pelo menos 6 caracteres.', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      pushToast('A confirmação não confere com a nova senha.', 'warning');
      return;
    }
    try {
      await api.patch('/users/me/password', {
        currentPassword,
        newPassword,
      });
      setProfileForm((prev) => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      }));
      pushToast('Senha atualizada.', 'success');
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao atualizar senha', 'danger');
    }
  };

  const requestPasswordReset = async () => {
    const email = await promptAction({
      title: 'Recuperar senha',
      message: 'Informe o e-mail cadastrado para receber o link de redefinição.',
      label: 'E-mail',
      type: 'email',
      placeholder: 'seu@email.com',
      confirmLabel: 'Enviar link',
    });
    if (!email) return;
    try {
      await api.post('/auth/forgot', { email });
      pushToast('Se o e-mail existir, enviaremos as instruções.', 'success');
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao enviar e-mail', 'danger');
    }
  };

  const submitPasswordReset = async (e) => {
    e.preventDefault();
    const newPassword = (resetForm.newPassword || '').trim();
    const confirmPassword = (resetForm.confirmPassword || '').trim();
    if (!newPassword || !confirmPassword) {
      pushToast('Preencha a nova senha e a confirmação.', 'warning');
      return;
    }
    if (newPassword.length < 6) {
      pushToast('A nova senha deve ter pelo menos 6 caracteres.', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      pushToast('A confirmação não confere com a nova senha.', 'warning');
      return;
    }
    try {
      await api.post('/auth/reset', { token: resetToken, newPassword });
      setResetForm({ newPassword: '', confirmPassword: '' });
      setResetToken('');
      window.history.replaceState({}, document.title, window.location.pathname);
      pushToast('Senha redefinida com sucesso.', 'success');
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao redefinir senha', 'danger');
    }
  };

  const sendMonthlyReport = async () => {
    if (!reportForm.email) {
      pushToast('Informe o e-mail de destino.', 'warning');
      return;
    }
    try {
      await api.post('/reports/monthly/email', {
        email: reportForm.email,
        month: reportForm.month,
        includeSummary: reportForm.includeSummary,
        includeFixedVariable: reportForm.includeFixedVariable,
        includeCategories: reportForm.includeCategories,
        includeTransactions: reportForm.includeTransactions,
      });
      pushToast('Relatório enviado com sucesso.', 'success');
    } catch (err) {
      pushToast(err.response?.data?.error || 'Erro ao enviar relatório', 'danger');
    }
  };

  const getCategoryKindValue = (tx) => {
    if (tx?.type === 'income') return 'income';
    return tx?.categoryKind || 'variable';
  };

  const txSummary = useMemo(() => {
    const income = transactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const expense = transactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const fixedExpense = transactions
      .filter((t) => t.type === 'expense' && getCategoryKindValue(t) === 'fixed')
      .reduce((sum, t) => sum + Number(t.amount), 0);
    return { income, expense, net: income - expense, fixedExpense, variableExpense: expense - fixedExpense };
  }, [transactions]);

  const selectedMonth = filters.useSingleMonth ? filters.singleMonth : '';
  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === activeTenantId),
    [tenants, activeTenantId]
  );
  useEffect(() => {
    if (!isMaster) return;
    setActiveTenantNameDraft(activeTenant?.name || '');
  }, [isMaster, activeTenant]);
  const monthDetail = useMemo(() => {
    if (!selectedMonth) return null;
    const monthData = monthly.find((m) => m.periodMonth?.startsWith(selectedMonth));
    const txs = transactions.filter((t) => t.periodMonth?.startsWith(selectedMonth));
    return { monthData, txs };
  }, [selectedMonth, monthly, transactions]);

  const monthlySorted = useMemo(
    () => [...monthly].sort((a, b) => (b.periodMonth || '').localeCompare(a.periodMonth || '')),
    [monthly]
  );

  const insightMeta = {
    'negative-net': {
      title: 'Saldo negativo',
      message: (data) => `O mês ${formatMonth(data.periodMonth)} fechou em ${formatCurrency(data.net)}. Revise despesas variáveis e ajuste metas de receita.`,
    },
    'expense-up': {
      title: 'Despesas em alta',
      message: (data) => `As despesas subiram de ${formatCurrency(data.previous)} para ${formatCurrency(data.current)}. Verifique quais custos aumentaram.`,
    },
    'negative-streak': {
      title: 'Sequência no vermelho',
      message: (data) => `${data.negativeMonths} meses seguidos no negativo. Priorize cortes e renegociações.`,
    },
  };

  const getCategoryKindLabel = (tx) => getCategoryKindLabelByKind(getCategoryKindValue(tx));

  const getCategoryKindTone = (tx) => {
    const kind = getCategoryKindValue(tx);
    if (kind === 'income') return 'success';
    return kind === 'fixed' ? 'warning' : 'info';
  };

  const getCategoryTone = (kind) => {
    if (kind === 'income') return 'success';
    return kind === 'fixed' ? 'warning' : 'info';
  };

  const getCategoryKindLabelByKind = (kind) => defaultCategoryLabels[kind] || defaultCategoryLabels.variable;

  const appVersion = 'V1.0.0';
  const navItems = isMaster
    ? [
        { id: 'master', label: 'Administrativo', icon: 'shield_person' },
        { id: 'smtp', label: 'SMTP', icon: 'mail' },
        { id: 'conta', label: 'Conta', icon: 'person' },
      ]
    : [
        { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
        { id: 'transacoes', label: 'Transações', icon: 'view_list' },
        canSendReports ? { id: 'relatorios', label: 'Relatórios', icon: 'insights' } : null,
        (canCreate || canEdit) ? { id: 'nova', label: 'Novo lançamento', icon: 'add_circle' } : null,
        isAdmin ? { id: 'usuarios', label: 'Usuários', icon: 'group' } : null,
        { id: 'conta', label: 'Conta', icon: 'person' },
      ].filter(Boolean);


  if (!token) {
    return (
      <div className="auth-shell">
        <div className="auth-panel">
          <div className="brand">
            <div className="logo-dot">
              <Icon name="account_balance_wallet" />
            </div>
            <div>
              <p className="eyebrow">{isAdminRoute ? 'Área administrativa' : 'SaaS financeiro'}</p>
              <h1>{isAdminRoute ? 'Área administrativa' : 'Controle Financeiro'}</h1>
              <p className="muted">
                {isAdminRoute
                  ? 'Login exclusivo para administradores.'
                  : 'Entradas, Saídas e insights sempre claros.'}
              </p>
            </div>
          </div>
          <div className="auth-content">
            {
            resetToken ? (
              <form className="form-stack" onSubmit={submitPasswordReset}>
                <label>
                  <span>Nova senha</span>
                  <input
                    type="password"
                    required
                    value={resetForm.newPassword}
                    onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })}
                  />
                </label>
                <label>
                  <span>Confirmar nova senha</span>
                  <input
                    type="password"
                    required
                    value={resetForm.confirmPassword}
                    onChange={(e) => setResetForm({ ...resetForm, confirmPassword: e.target.value })}
                  />
                </label>
                {error && <div className="error-box">{error}</div>}
                <button className="btn btn-primary" disabled={loading}>
                  {loading ? 'Aguarde.' : 'Redefinir senha'}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    setResetForm({ newPassword: '', confirmPassword: '' });
                    setResetToken('');
                    window.history.replaceState({}, document.title, window.location.pathname);
                  }}
                >
                  Voltar ao login
                </button>
                <span className="version-tag version-center">{appVersion}</span>
              </form>
            ) : (
              <form className="form-stack" onSubmit={handleAuth}>
                <label>
                  <span>{isAdminRoute ? 'E-mail administrativo' : 'E-mail'}</span>
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={authForm.login}
                    placeholder={isAdminRoute ? 'admin@exemplo.com' : 'seu@email.com'}
                    onChange={(e) => setAuthForm({ ...authForm, login: e.target.value })}
                  />
                </label>
                <label>
                  <span>Senha</span>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={authForm.password}
                    onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                  />
                </label>
                {error && <div className="error-box">{error}</div>}
                <button className="btn btn-primary" disabled={loading}>
                  {loading ? 'Aguarde.' : 'Entrar'}
                </button>
                {loginFailures >= 3 && (
                  <button className="btn btn-ghost" type="button" onClick={requestPasswordReset}>
                    Esqueci minha senha
                  </button>
                )}
                <span className="version-tag version-center">{appVersion}</span>
              </form>
            )
          }
          </div>
        </div>
        {renderGlobalLayers()}
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="auth-shell">
        <div className="auth-panel">
          <div className="auth-content">
            <h2>Erro ao carregar</h2>
            <p className="muted">{fatalError}</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                safeRemoveItem('token');
                safeRemoveItem('userMeta');
                window.location.reload();
              }}
            >
              Resetar sessão
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderTopbar = () => (
    <header className="topbar">
      <div>
        <p className="eyebrow">{systemName}</p>
        <h2>{isMaster ? 'Área administrativa' : `Olá, ${userMeta?.name || 'usuário'}`}</h2>
        <p className="muted">
          {isMaster
            ? 'Gerencie empresas, usuários e permissões em um único painel.'
            : 'Acompanhe saldos, lançamentos e permissões em um painel único.'}
        </p>
      </div>
       <div className="top-actions">
         <div className="chip">{displayRole}</div>
         {!isMaster && activePage === 'dashboard' && (
           <button className="btn btn-ghost btn-icon" onClick={() => setShowFiltersModal(true)} title="Filtros de período">
             <Icon name="filter_list" />
           </button>
         )}
         <button className="btn btn-ghost btn-icon" onClick={toggleTheme} title={themeLabels[themeChoice]}>
           <Icon name={themeIcons[themeChoice]} />
         </button>
          <button className="btn btn-ghost" onClick={handleLogout}>
            <Icon name="logout" />
            Sair
          </button>
       </div>
    </header>
  );

    const renderSummaryCards = () => {
      if (!summary) return null;
      const saldoClass = summary.saldo >= 0 ? 'positive' : 'negative';
      const isSingleMonth = filters.useSingleMonth && filters.singleMonth;
      const saldoLabel = isSingleMonth
        ? `Saldo em ${formatMonthFull(filters.singleMonth)}`
        : 'Saldo atual';
      const saldoHint = isSingleMonth
        ? `Balanço de ${formatMonthFull(filters.singleMonth, true)}`
        : 'Somatório dos balanços mensais';
      return (
        <div className="metric-grid">
        <div className="card metric">
          <div className="metric-top">
            <p className="muted">Receitas</p>
            <StatusPill tone="info">Entrada</StatusPill>
          </div>
          <strong>{formatCurrency(summary.totalIncome)}</strong>
          <p className="muted">Total no período filtrado</p>
        </div>
        <div className="card metric">
          <div className="metric-top">
            <p className="muted">Despesas</p>
            <StatusPill tone="warning">Saída</StatusPill>
          </div>
          <strong>{formatCurrency(summary.totalExpense)}</strong>
          <p className="muted">Total no período filtrado</p>
        </div>
        <div className="card metric">
          <div className="metric-top">
            <p className="muted">Despesas fixas</p>
            <StatusPill tone="warning">Fixa</StatusPill>
          </div>
          <strong>{formatCurrency(summary.fixedExpense || 0)}</strong>
          <p className="muted">No período filtrado</p>
        </div>
        <div className="card metric">
          <div className="metric-top">
            <p className="muted">Despesas variáveis</p>
            <StatusPill tone="info">Variável</StatusPill>
          </div>
          <strong>{formatCurrency(summary.variableExpense || 0)}</strong>
          <p className="muted">No período filtrado</p>
        </div>
        <div className={`card metric ${saldoClass}`}>
          <div className="metric-top">
            <p className="muted">{saldoLabel}</p>
            <StatusPill tone={summary.saldo >= 0 ? 'success' : 'danger'}>
              {summary.saldo >= 0 ? 'Positivo' : 'Negativo'}
            </StatusPill>
          </div>
          <strong>{formatCurrency(summary.saldo)}</strong>
          <p className="muted">{saldoHint}</p>
        </div>

      </div>
    );
  };

  const renderFilters = () => (
    <div className="card filters">
      <div>
        <p className="eyebrow">Filtros rápidos</p>
        <h3>Período e exibição</h3>
      </div>
      <div className="filters-grid">
        <label>
          <span>Mês inicial</span>
          <input
            type="month"
            value={filters.startMonth}
            onChange={(e) => setFilters({ ...filters, startMonth: e.target.value, useSingleMonth: false })}
            disabled={filters.useSingleMonth}
          />
        </label>
        <label>
          <span>Mês final</span>
          <input
            type="month"
            value={filters.endMonth}
            onChange={(e) => setFilters({ ...filters, endMonth: e.target.value, useSingleMonth: false })}
            disabled={filters.useSingleMonth}
          />
        </label>
        <label>
          <span>Mês específico</span>
          <input
            type="month"
            value={filters.singleMonth}
            onChange={(e) => setFilters({ ...filters, singleMonth: e.target.value, useSingleMonth: !!e.target.value })}
            disabled={!filters.useSingleMonth}
          />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={filters.useSingleMonth}
            onChange={(e) => setFilters({ ...filters, useSingleMonth: e.target.checked })}
          />
          <span>Focar em um único mês</span>
        </label>
      </div>
    </div>
  );

  const renderCharts = () => {
    const merged = {};
    categoryBreakdown.expense.forEach((item) => {
      merged[item.name] = { name: item.name, expense: item.total, income: 0 };
    });
    categoryBreakdown.income.forEach((item) => {
      merged[item.name] = { ...(merged[item.name] || { name: item.name, expense: 0 }), income: item.total };
    });
    const categoryData = Object.values(merged);

    return (
      <div className="split">
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Linha do tempo</p>
              <h3>Receitas x Despesas</h3>
            </div>
            <StatusPill tone="info">Mensal</StatusPill>
          </div>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="periodMonth" tickFormatter={(v) => formatMonth(v)} stroke="var(--muted)" />
                <YAxis tickFormatter={(v) => v / 1000 + 'k'} stroke="var(--muted)" />
                <Tooltip formatter={(v) => formatCurrency(v)} labelFormatter={(v) => formatMonth(v)} />
                <Area type="monotone" dataKey="income" name="Receitas" stroke="var(--primary)" fill="var(--primary-soft)" />
                <Area type="monotone" dataKey="expense" name="Despesas" stroke="var(--warning)" fill="var(--warning-soft)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Categorias</p>
              <h3>Distribuição por categoria</h3>
            </div>
          </div>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v) => v / 1000 + 'k'} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Legend />
                <Bar dataKey="expense" name="Despesas" fill="var(--warning)" />
                <Bar dataKey="income" name="Receitas" fill="var(--success)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  };

  const renderMonthList = () => (
    <div className="card">
      <div className="card-head">
        <div>
          <p className="eyebrow">Resumo mensal</p>
          <h3>Saldo mês a mês</h3>
        </div>
      </div>
      <div className="month-list">
        {monthlySorted.map((m) => (
          <div key={m.periodMonth} className="month-row">
            <div>
              <strong>{formatMonth(m.periodMonth)}</strong>
              <p className="muted">Receitas {formatCurrency(m.income)} · Despesas {formatCurrency(m.expense)}</p>
            </div>
            <StatusPill tone={m.net >= 0 ? 'success' : 'danger'}>
              {formatCurrency(m.net)}
            </StatusPill>
          </div>
        ))}
      </div>
    </div>
  );

  const renderProjection = () => {
    if (!projection) {
      return (
        <div className="card compact">
          <div className="card-head">
            <div>
              <p className="eyebrow">Projeção</p>
              <h3>Próximos passos</h3>
            </div>
          </div>
          <p className="muted">Carregando projeções…</p>
        </div>
      );
    }

    const trendUp = projection.trend >= 0;
    const projectedPositive = projection.projectedNet >= 0;

    return (
      <div className="card compact">
        <div className="card-head">
          <div>
            <p className="eyebrow">Projeção</p>
            <h3>Análise e previsões</h3>
          </div>
          <StatusPill tone={projectedPositive ? 'success' : 'danger'}>
            {projectedPositive ? 'Otimista' : 'Atenção'}
          </StatusPill>
        </div>
        <div className="projection">
          <div className="metric">
            <div className="metric-top">
              <p className="muted">Tendência projetada</p>
              <Icon name={trendUp ? 'trending_up' : 'trending_down'} />
            </div>
            <strong className={projectedPositive ? 'positive' : 'negative'}>
              {formatCurrency(projection.projectedNet || 0)}
            </strong>
            <p className="muted">Saldo previsto para o próximo período</p>
          </div>
          <div className="metric">
            <div className="metric-top">
              <p className="muted">Variação recente</p>
              <Icon name={trendUp ? 'arrow_upward' : 'arrow_downward'} />
            </div>
            <strong className={trendUp ? 'positive' : 'negative'}>
              {formatCurrency(projection.trend || 0)}
            </strong>
            <p className="muted">Comparado ao período anterior</p>
          </div>
        </div>
        <div className="metric-row">
          <div>
            <span className="muted">Dicas rápidas</span>
            <ul className="tip-list">
              {projectedPositive ? (
                <li><Icon name="check_circle" /> Mantenha o controle das despesas variáveis.</li>
              ) : (
                <li><Icon name="warning" /> Revise despesas fixas para possíveis reduções.</li>
              )}
              {trendUp ? (
                <li><Icon name="show_chart" /> Tendência positiva, continue assim!</li>
              ) : (
                <li><Icon name="trending_down" /> Considere aumentar receitas ou cortar custos.</li>
              )}
              <li><Icon name="insights" /> Acompanhe relatórios mensais para mais insights.</li>
            </ul>
          </div>
        </div>
        <div className="insight-list">
          <p className="eyebrow" style={{marginBottom: '0.5rem'}}>Alertas e insights</p>
          {insights.length === 0 && (
            <p className="muted">Nenhum alerta crítico no período. Continue acompanhando o fluxo.</p>
          )}
          {insights.map((item, idx) => {
            const meta = insightMeta[item.type];
            const title = meta?.title || 'Ajuste recomendado';
            const message = meta?.message ? meta.message(item.data || {}) : 'Revise entradas e saídas recentes.';
            const tone = item.severity === 'high' ? 'danger' : item.severity === 'medium' ? 'warning' : 'info';
            const icon = tone === 'danger' ? 'error' : tone === 'warning' ? 'warning' : 'info';
            return (
              <div key={idx} className="insight">
                <StatusPill tone={tone}><Icon name={icon} /></StatusPill>
                <div>
                  <strong>{title}</strong>
                  <p className="muted">{message}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderMonthDetail = () => {
    if (!monthDetail) return null;
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <p className="eyebrow">Detalhes do mês</p>
            <h3>{formatMonth(monthDetail.monthData?.periodMonth || selectedMonth)}</h3>
          </div>
        </div>
        <div className="metric-row">
          <div>
            <span className="muted">Receitas</span>
            <strong>{formatCurrency(monthDetail.monthData?.income || 0)}</strong>
          </div>
          <div>
            <span className="muted">Despesas</span>
            <strong>{formatCurrency(monthDetail.monthData?.expense || 0)}</strong>
          </div>
          <div>
            <span className="muted">Balanço</span>
            <strong className={monthDetail.monthData?.net >= 0 ? 'positive' : 'negative'}>
              {formatCurrency(monthDetail.monthData?.net || 0)}
            </strong>
          </div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Descrição</th>
                <th>Classificação</th>
                <th>Recorrência</th>
                <th>Data</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {monthDetail.txs.map((t) => (
                <tr key={t.id}>
                  <td data-label="Tipo">
                    <StatusPill tone={t.type === 'income' ? 'success' : 'danger'}>
                      {t.type === 'income' ? 'Entrada' : 'Saída'}
                    </StatusPill>
                  </td>
                  <td data-label="Descrição">{t.description}</td>
                  <td data-label="Classificação">
                    <StatusPill tone={getCategoryKindTone(t)}>{getCategoryKindLabel(t)}</StatusPill>
                  </td>
                  <td data-label="Recorrência">
                    <StatusPill tone={t.recurrenceType === 'monthly' ? 'info' : 'neutral'}>
                      {t.recurrenceType === 'monthly' ? 'Mensal' : 'Único'}
                    </StatusPill>
                  </td>
                  <td data-label="Data">{t.date ? new Date(t.date).toLocaleDateString('pt-BR') : formatMonth(t.periodMonth)}</td>
                  <td data-label="Valor" className={t.type === 'income' ? 'positive' : 'negative'}>
                    {formatCurrencyByCode(t.amount, t.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!monthDetail.txs.length && <p className="muted">Sem lançamentos neste mês.</p>}
        </div>
      </div>
    );
  };

  const renderImportTools = () => {
    if (isMaster || !canImport) {
      return null;
    }
    return (
      <div className="card import-card">
        <div className="card-head">
          <div>
            <p className="eyebrow">Importação</p>
            <h3>Importar e exportar dados</h3>
          </div>
          <div className="card-head-actions">
            <StatusPill tone="info">CSV</StatusPill>
          </div>
        </div>
        <div className="form-grid import-grid">
          <label className="form-span-2">
            <span>Arquivo CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
            {importFile && (
              <small className="helper">Selecionado: {importFile.name}</small>
            )}
            <small className="helper import-note">
              Colunas aceitas: tipo, data, descrição, valor, classificação, categoria, moeda, origem, recorrência.
            </small>
          </label>
          <label>
            <span>Formato da data</span>
            <select value={importDateFormat} onChange={(e) => setImportDateFormat(e.target.value)}>
              <option value="auto">Automático</option>
              <option value="dmy">DD/MM/AAAA</option>
              <option value="mdy">MM/DD/AAAA</option>
              <option value="ymd">AAAA-MM-DD</option>
            </select>
            <small className="helper">Use automático para planilhas desconhecidas.</small>
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={importCreateCategories}
              onChange={(e) => setImportCreateCategories(e.target.checked)}
              disabled={!canImport}
            />
            <span>Criar categorias ausentes</span>
          </label>
          <div className="import-actions">
            <button className="btn btn-ghost" type="button" onClick={downloadTemplate}>
              <Icon name="download" /> Modelo CSV
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={exportTransactionsCsv}
              disabled={exporting}
            >
              <Icon name="upload_file" /> {exporting ? 'Exportando...' : 'Exportar CSV'}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={importTransactionsCsv}
              disabled={!importFile || importing || !canImport}
            >
              <Icon name="file_upload" /> {importing ? 'Importando...' : 'Importar CSV'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderTransactions = () => (
    <div className="stack">

      <div className="card transactions-card">
        <div className="card-head">
          <div>
            <p className="eyebrow">Transações</p>
            <h3>Entradas e Saídas</h3>
          </div>
          <div className="chip">{transactions.length} itens</div>
           {canImport && !isMaster && (
             <button className="btn btn-ghost import-export-btn" onClick={() => setShowImportModal(true)} title="Importar/exportar">
               <Icon name="file_upload" />
               <span className="import-export-text">Importar/Exportar</span>
             </button>
           )}
        </div>
        <div className="filters-grid">
          <label>
            <span>Data início</span>
            <input
              type="date"
              value={txFilters.startDate}
              onChange={(e) => setTxFilters({ ...txFilters, startDate: e.target.value })}
            />
          </label>
          <label>
            <span>Data fim</span>
            <input
              type="date"
              value={txFilters.endDate}
              onChange={(e) => setTxFilters({ ...txFilters, endDate: e.target.value })}
            />
          </label>
          <label>
            <span>Tipo</span>
            <select value={txFilters.type} onChange={(e) => setTxFilters({ ...txFilters, type: e.target.value })}>
              <option value="">Todos</option>
              <option value="income">Entrada</option>
              <option value="expense">Saída</option>
            </select>
          </label>
          <label>
            <span>Classificação</span>
            <select
              value={txFilters.categoryKind}
              onChange={(e) => setTxFilters({ ...txFilters, categoryKind: e.target.value })}
            >
              <option value="">Todas</option>
              {categoryKindOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Busca</span>
            <input
              type="search"
              placeholder="Descrição ou origem"
              value={txFilters.q}
              onChange={(e) => setTxFilters({ ...txFilters, q: e.target.value })}
            />
          </label>
        </div>
        <div className="metric-row">
          <div>
            <span className="muted">Receitas</span>
            <strong>{formatCurrency(txSummary.income)}</strong>
          </div>
          <div>
            <span className="muted">Despesas</span>
            <strong>{formatCurrency(txSummary.expense)}</strong>
          </div>
          <div>
            <span className="muted">Saldo</span>
            <strong className={txSummary.net >= 0 ? 'positive' : 'negative'}>
              {formatCurrency(txSummary.net)}
            </strong>
          </div>
        </div>
        <div className="metric-row">
          <div>
            <span className="muted">Despesas fixas</span>
            <strong>{formatCurrency(txSummary.fixedExpense)}</strong>
          </div>
          <div>
            <span className="muted">Despesas variáveis</span>
            <strong>{formatCurrency(txSummary.variableExpense)}</strong>
          </div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Descrição</th>
                <th>Classificação</th>
                <th>Recorrência</th>
                <th>Data</th>
                <th>Valor</th>
                {(canEdit || canDelete) && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td data-label="Tipo">
                    <StatusPill tone={t.type === 'income' ? 'success' : 'danger'}>
                      {t.type === 'income' ? 'Entrada' : 'Saída'}
                    </StatusPill>
                  </td>
                  <td data-label="Descrição">{t.description}</td>
                  <td data-label="Classificação">
                    <StatusPill tone={getCategoryKindTone(t)}>{getCategoryKindLabel(t)}</StatusPill>
                  </td>
                  <td data-label="Recorrência">
                    <StatusPill tone={t.recurrenceType === 'monthly' ? 'info' : 'neutral'}>
                      {t.recurrenceType === 'monthly' ? 'Mensal' : 'Único'}
                    </StatusPill>
                  </td>
                  <td data-label="Data">{t.date ? new Date(t.date).toLocaleDateString('pt-BR') : formatMonth(t.periodMonth)}</td>
                  <td data-label="Valor" className={t.type === 'income' ? 'positive' : 'negative'}>
                    {formatCurrencyByCode(t.amount, t.currency)}
                  </td>
                  {(canEdit || canDelete) && (
                    <td data-label="Ações">
                      <div className="table-actions">
                        {canEdit && (
                          <button className="btn btn-ghost" onClick={() => startEdit(t)}>
                            <Icon name="edit" /> Editar
                          </button>
                        )}
                        {canDelete && (
                          <button className="btn btn-danger" onClick={() => deleteTransaction(t)}>
                            <Icon name="delete" /> Excluir
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const txFormDisabled = editTx ? !canEdit : !canCreate;

  const renderCategoryManager = () => (
    <div className="card">
      <div className="card-head">
        <div>
          <p className="eyebrow">Categorias</p>
          <h3>Criar e gerenciar categorias</h3>
        </div>
        <div className="card-head-actions">
          <button className="btn btn-ghost" type="button" onClick={resetCategories} disabled={!canEdit}>
            <Icon name="restart_alt" /> Reiniciar
          </button>
          <div className="chip">{sortedCategories.length} itens</div>
        </div>
      </div>
        <form className="form-grid category-form form-grid-actions-2" onSubmit={createCategory}>
          <label className="form-span-2">
            <span>Nome</span>
            <input
              type="text"
              value={categoryDraft.name}
              onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })}
              required
            />
          </label>
          <label>
            <span>Classificação</span>
            <select
              value={categoryDraft.kind}
              onChange={(e) => setCategoryDraft({ ...categoryDraft, kind: e.target.value })}
            >
              {categoryKindOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="form-actions align-right inline-actions category-actions">
            <button className="btn btn-primary" type="submit" disabled={!canCreate}>
              Criar categoria
            </button>
          </div>
        </form>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Categoria</th>
              <th>Classificação</th>
              {(canEdit || canDelete) && <th>Ações</th>}
            </tr>
          </thead>
          <tbody>
            {sortedCategories.map((cat) => {
              const draft = categoryEdits[cat.id] || {};
              const kindLabel = defaultCategoryLabels[cat.kind] || defaultCategoryLabels.variable;
              return (
                <tr key={cat.id}>
                  <td data-label="Categoria">
                    <input
                      type="text"
                      value={draft.name ?? cat.name}
                      onChange={(e) => setCategoryEdits((prev) => ({
                        ...prev,
                        [cat.id]: { ...prev[cat.id], name: e.target.value },
                      }))}
                      disabled={!canEdit}
                    />
                  </td>
                  <td data-label="Classificação">
                    <StatusPill tone={getCategoryTone(cat.kind)}>{kindLabel}</StatusPill>
                  </td>
                  {(canEdit || canDelete) && (
                    <td data-label="Ações">
                      <div className="table-actions">
                        {canEdit && (
                          <button className="btn btn-ghost" type="button" onClick={() => saveCategory(cat.id)}>
                            <Icon name="save" /> Salvar
                          </button>
                        )}
                        {canDelete && (
                          <button className="btn btn-danger" type="button" onClick={() => deleteCategory(cat.id)}>
                            <Icon name="delete" /> Excluir
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!sortedCategories.length && <p className="muted">Nenhuma categoria cadastrada.</p>}
      </div>
    </div>
  );

  const renderTxForm = () => (
    <div className="stack">
    <div className="card">
      <div className="card-head">
        <div>
          <p className="eyebrow">Lançamento</p>
          <h3>{editTx ? 'Editar lançamento' : 'Adicionar entrada/saída'}</h3>
        </div>
      </div>
      {!canCreate && !editTx && (
        <div className="error-box">Você não tem permissão para criar lançamentos.</div>
      )}
      <form onSubmit={saveTransaction}>
        <fieldset className="form-grid form-grid-3" disabled={txFormDisabled}>
          <label>
            <span>Tipo</span>
            <select
              value={txForm.type}
              onChange={(e) => setTxForm({ ...txForm, type: e.target.value })}
              required
            >
              <option value="income">Entrada (receita)</option>
              <option value="expense">Saída (despesa)</option>
            </select>
          </label>
          <label>
            <span>Classificação</span>
            <select
              value={txForm.categoryKind}
              onChange={(e) => setTxForm((prev) => ({ ...prev, categoryKind: e.target.value }))}
              disabled={txForm.type === 'income'}
            >
              {categoryKindOptions
                .filter((option) => (txForm.type === 'income' ? option.value === 'income' : option.value !== 'income'))
                .map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
            <small className="helper">Fixa, variável ou receita.</small>
          </label>
          <label>
            <span>Categoria</span>
            <select
              value={txForm.categoryId}
              onChange={(e) => setTxForm((prev) => ({ ...prev, categoryId: e.target.value }))}
            >
              <option value="">Selecione</option>
              {(categoriesByKind[txForm.categoryKind] || []).map((cat) => (
                <option key={cat.id} value={String(cat.id)}>{cat.name}</option>
              ))}
            </select>
            <small className="helper">Escolha a categoria cadastrada.</small>
          </label>
          <label>
            <span>Recorrência</span>
            <select
              value={txForm.recurrenceType}
              onChange={(e) => setTxForm((prev) => ({
                ...prev,
                recurrenceType: e.target.value,
                recurrenceEndMonth: e.target.value === 'monthly' ? prev.recurrenceEndMonth : '',
              }))}
              disabled={!!editTx}
            >
              <option value="one_time">Somente uma vez</option>
              <option value="monthly">Mensal (recorrente)</option>
            </select>
            {editTx && (
              <small className="helper">Para alterar, exclua e crie um novo lançamento.</small>
            )}
          </label>
          <label>
            <span>Data</span>
            <input
              type="date"
              value={txForm.date}
              onChange={(e) => {
                const value = e.target.value;
                setTxForm((prev) => ({
                  ...prev,
                  date: value,
                  periodMonth: prev.periodMonth || (value ? value.slice(0, 7) : ''),
                }));
              }}
              required
            />
          </label>
          <label>
            <span>Moeda</span>
            <select
              value={txForm.currency}
              onChange={(e) => {
                const value = e.target.value;
                setTxForm({ ...txForm, currency: value });
                setCurrencyChoice(value);
              }}
              required
            >
              {Object.entries(currencyOptions).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>
            <small className="helper">Moeda do lançamento.</small>
          </label>
          {txForm.recurrenceType === 'monthly' && !editTx && (
            <label>
              <span>Repetir até</span>
              <input
                type="month"
                value={txForm.recurrenceEndMonth}
                onChange={(e) => setTxForm({ ...txForm, recurrenceEndMonth: e.target.value })}
              />
              <small className="helper">Deixe em branco para só este mês.</small>
            </label>
          )}
          <label className="form-span-2">
            <span>Descrição</span>
            <input
              type="text"
              required
              value={txForm.description}
              onChange={(e) => setTxForm({ ...txForm, description: e.target.value })}
            />
            <small className="helper">Ex: aluguel, zelle, uber.</small>
          </label>
          <label>
            <span>Valor</span>
            <input
              type="number"
              step="0.01"
              required
              value={txForm.amount}
              onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })}
            />
          </label>
          <label>
            <span>Origem / conta</span>
            <input
              type="text"
              value={txForm.source}
              onChange={(e) => setTxForm({ ...txForm, source: e.target.value })}
              placeholder="Opcional"
            />
          </label>
          {editTx && txForm.recurrenceGroupId && (
            <>
              <label className="form-span-2 inline">
                <input
                  type="checkbox"
                  checked={txForm.applyToSeries}
                  onChange={(e) => setTxForm({ ...txForm, applyToSeries: e.target.checked })}
                />
                Aplicar alterações para toda a série mensal
              </label>
              <p className="helper form-span-2">Data e competência aplicam somente a este mês.</p>
            </>
          )}
          {txForm.recurrenceType === 'monthly' && !editTx && (
            <p className="helper form-span-2">
              Lançamentos mensais criam registros para cada mês no período selecionado.
            </p>
          )}
            <div className="form-actions align-right inline-actions tx-actions">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={loading || (editTx ? !canEdit : !canCreate)}
              >
                <Icon name="check_circle" /> {editTx ? 'Atualizar' : 'Salvar lançamento'}
            </button>
            {editTx && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => { setEditTx(null); setTxForm(createDefaultTx(currencyChoice)); }}
              >
                Cancelar edição
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </div>
    {renderCategoryManager()}
    </div>
  );

    const renderUsers = () => {
      const userFormDisabled = isMaster && !activeTenantId;
      return (
      <div className="stack">
        {canManageUsers && (
          <div className="card">
            <div className="card-head">
              <div>
                <p className="eyebrow">Novo usuário</p>
              <h3>Criar acesso</h3>
            </div>
          </div>
          {userFormDisabled && (
            <p className="muted">Selecione uma empresa no painel administrativo para liberar o cadastro.</p>
          )}
            <form className="form-grid form-grid-actions-5 user-form" onSubmit={createUser}>
              <label>
                <span>Nome</span>
                <input
                  type="text"
                  value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                required
                disabled={userFormDisabled}
              />
            </label>
            <label>
              <span>Usuário</span>
              <input
                type="text"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                required
                disabled={userFormDisabled}
              />
            </label>
            <label>
              <span>E-mail</span>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                required
                disabled={userFormDisabled}
              />
            </label>
            <label>
              <span>Senha</span>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  required
                  disabled={userFormDisabled}
                />
              </label>
              <div className="form-actions align-right inline-actions user-actions">
                <button className="btn btn-primary" type="submit" disabled={userFormDisabled}>
                  Criar usuário
                </button>
              </div>
            </form>
          </div>
        )}
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Equipe</p>
              <h3>Controle de acesso</h3>
              {isMaster && activeTenant && (
                <p className="muted">Empresa selecionada: {activeTenant.name}</p>
              )}
            </div>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Usuário</th>
                  <th>E-mail</th>
                  <th>Função</th>
                  <th>Permissões</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Nome">
                      <input
                        type="text"
                        value={u.name || ''}
                        onChange={(e) => updateUserLocal(u.id, { name: e.target.value })}
                        disabled={!canManageUsers}
                      />
                    </td>
                    <td data-label="Usuário">
                      <input
                        type="text"
                        value={u.username || ''}
                        onChange={(e) => updateUserLocal(u.id, { username: e.target.value })}
                        disabled={!canManageUsers}
                      />
                    </td>
                    <td data-label="E-mail">
                      <input
                        type="email"
                        value={u.email || ''}
                        onChange={(e) => updateUserLocal(u.id, { email: e.target.value })}
                        disabled={!canManageUsers}
                      />
                    </td>
                    <td data-label="Função">
                      <select value={u.role} onChange={(e) => saveUserRole(u.id, e.target.value)} disabled={!canManageUsers}>
                        <option value="admin">Administrador</option>
                        <option value="guest">Colaborador</option>
                      </select>
                    </td>
                    <td data-label="Permissões">
                      <div className="permission-row">
                        <label className="inline">
                          <input
                            type="checkbox"
                            checked={u.can_view}
                            onChange={(e) => saveUserPermissions(u.id, {
                              canView: e.target.checked,
                              canCreate: u.can_create,
                              canEdit: u.can_edit,
                              canDelete: u.can_delete,
                            })}
                            disabled={!canManageUsers}
                          />
                          Ver
                        </label>
                        <label className="inline">
                          <input
                            type="checkbox"
                            checked={u.can_create}
                            onChange={(e) => saveUserPermissions(u.id, {
                              canView: u.can_view,
                              canCreate: e.target.checked,
                              canEdit: u.can_edit,
                              canDelete: u.can_delete,
                            })}
                            disabled={!canManageUsers}
                          />
                          Criar
                        </label>
                        <label className="inline">
                          <input
                            type="checkbox"
                            checked={u.can_edit}
                            onChange={(e) => saveUserPermissions(u.id, {
                              canView: u.can_view,
                              canCreate: u.can_create,
                              canEdit: e.target.checked,
                              canDelete: u.can_delete,
                            })}
                            disabled={!canManageUsers}
                          />
                          Editar
                        </label>
                        <label className="inline">
                          <input
                            type="checkbox"
                            checked={u.can_delete}
                            onChange={(e) => saveUserPermissions(u.id, {
                              canView: u.can_view,
                              canCreate: u.can_create,
                              canEdit: u.can_edit,
                              canDelete: e.target.checked,
                            })}
                            disabled={!canManageUsers}
                          />
                          Excluir
                        </label>
                      </div>
                    </td>
                    <td data-label="Ações">
                      {canManageUsers && (
                        <div className="table-actions stack-actions">
                          <button
                            className="btn btn-primary"
                            type="button"
                            onClick={() => saveUserProfile(u.id, buildUserProfilePayload(u))}
                          >
                            <Icon name="save" /> Salvar
                          </button>
                          <button className="btn btn-ghost" type="button" onClick={() => resetUserPassword(u.id)}>
                            Resetar senha
                          </button>
                          <button className="btn btn-danger" type="button" onClick={() => deleteUser(u.id)}>
                            Excluir
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      );
    };

  const renderAccount = () => (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <p className="eyebrow">Perfil</p>
            <h3>Informações pessoais</h3>
          </div>
        </div>
        <div className="form-grid form-grid-actions-4">
          <label>
            <span>Nome</span>
            <input
              type="text"
              value={profileForm.name}
              onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
            />
          </label>
          <label>
            <span>Usuário</span>
            <input
              type="text"
              value={profileForm.username}
              onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
              disabled={!canEditIdentity}
            />
          </label>
          <label>
            <span>E-mail</span>
            <input
              type="email"
              value={profileForm.email}
              onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
              disabled={!canEditIdentity}
            />
          </label>
              <div className="form-actions align-right inline-actions">
                <button className="btn btn-primary" onClick={updateProfile}>Salvar perfil</button>
              </div>
        </div>
      </div>
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Segurança</p>
              <h3>Trocar senha</h3>
            </div>
          </div>
          <div className="form-grid form-grid-actions-4">
            <label>
              <span>Senha atual</span>
              <input
                type="password"
                value={profileForm.currentPassword}
                onChange={(e) => setProfileForm({ ...profileForm, currentPassword: e.target.value })}
              />
            </label>
            <label>
              <span>Nova senha</span>
              <input
                type="password"
                value={profileForm.newPassword}
                onChange={(e) => setProfileForm({ ...profileForm, newPassword: e.target.value })}
              />
            </label>
            <label>
              <span>Confirmar nova senha</span>
              <input
                type="password"
                value={profileForm.confirmPassword}
                onChange={(e) => setProfileForm({ ...profileForm, confirmPassword: e.target.value })}
              />
            </label>
            <div className="form-actions align-right inline-actions">
              <button className="btn btn-ghost" type="button" onClick={updatePassword}>
                Atualizar senha
              </button>
            </div>
        </div>
      </div>
    </div>
  );

  const renderReports = () => {
    if (!canSendReports) {
      return (
        <div className="card">
          <p className="muted">Você não tem permissão para gerar relatórios.</p>
        </div>
      );
    }
    return (
      <div className="stack">
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Relatórios</p>
              <h3>Relatório mensal por e-mail</h3>
            </div>
          </div>
          <div className="form-grid form-grid-actions-3">
            <label>
              <span>Mês</span>
              <input
                type="month"
                value={reportForm.month}
                onChange={(e) => setReportForm({ ...reportForm, month: e.target.value })}
              />
            </label>
            <label>
              <span>E-mail de destino</span>
              <input
                type="email"
                value={reportForm.email}
                onChange={(e) => setReportForm({ ...reportForm, email: e.target.value })}
              />
            </label>
            <div className="form-actions align-right inline-actions">
              <button className="btn btn-primary" type="button" onClick={sendMonthlyReport}>
                Enviar relatório
              </button>
            </div>
            <div className="form-span-2">
              <p className="muted">Selecione o conteúdo do relatório:</p>
            </div>
            <label className="inline">
              <input
                type="checkbox"
                checked={reportForm.includeSummary}
                onChange={(e) => setReportForm({ ...reportForm, includeSummary: e.target.checked })}
              />
              <span>Resumo geral</span>
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={reportForm.includeFixedVariable}
                disabled={!reportForm.includeSummary}
                onChange={(e) => setReportForm({ ...reportForm, includeFixedVariable: e.target.checked })}
              />
              <span>Detalhar despesas fixas e variáveis</span>
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={reportForm.includeCategories}
                onChange={(e) => setReportForm({ ...reportForm, includeCategories: e.target.checked })}
              />
              <span>Top categorias</span>
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={reportForm.includeTransactions}
                onChange={(e) => setReportForm({ ...reportForm, includeTransactions: e.target.checked })}
              />
              <span>Lista de lançamentos</span>
            </label>
          </div>
        </div>
      </div>
    );
  };

  const renderAdminSmtp = () => (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <p className="eyebrow">SMTP</p>
            <h3>Configuração de e-mail</h3>
          </div>
        </div>
        {smtpLoading && <p className="muted">⏳ Carregando configurações...</p>}
        <div className="smtp-form">
          {/* Seção: Servidor e Porta */}
          <div className="smtp-section">
            <label className="smtp-full">
              <span>Servidor SMTP</span>
              <input
                type="text"
                value={smtpForm.host}
                onChange={(e) => setSmtpForm({ ...smtpForm, host: e.target.value })}
                placeholder="smtp.gmail.com ou smtp.outlook.com"
              />
            </label>
            <label className="smtp-half">
              <span>Porta</span>
              <input
                type="number"
                value={smtpForm.port}
                onChange={(e) => setSmtpForm({ ...smtpForm, port: Number(e.target.value) || 587 })}
                min="1"
                max="65535"
              />
            </label>
            <label className="smtp-half">
              <input
                type="checkbox"
                checked={smtpForm.secure}
                onChange={(e) => setSmtpForm({ ...smtpForm, secure: e.target.checked })}
              />
              <span>Usar TLS/SSL (porta 465)</span>
            </label>
          </div>

          {/* Seção: Autenticação */}
          <div className="smtp-section">
            <label className="smtp-half">
              <span>Usuário (Email)</span>
              <input
                type="text"
                value={smtpForm.username}
                onChange={(e) => setSmtpForm({ ...smtpForm, username: e.target.value })}
                placeholder="seu-email@gmail.com"
              />
            </label>
            <label className="smtp-half">
              <span>Senha ou App Password</span>
              <input
                type="password"
                value={smtpForm.password}
                onChange={(e) => setSmtpForm({ ...smtpForm, password: e.target.value })}
                placeholder={smtpForm.hasPassword ? '••••••••••' : 'Informe a senha'}
              />
            </label>
          </div>

          {/* Seção: Endereços */}
          <div className="smtp-section">
            <label className="smtp-half">
              <span>Remetente (From)</span>
              <input
                type="text"
                value={smtpForm.fromAddress}
                onChange={(e) => setSmtpForm({ ...smtpForm, fromAddress: e.target.value })}
                placeholder="seu-email@gmail.com"
              />
            </label>
            <label className="smtp-half">
              <span>Reply-to (Responder para)</span>
              <input
                type="text"
                value={smtpForm.replyTo}
                onChange={(e) => setSmtpForm({ ...smtpForm, replyTo: e.target.value })}
                placeholder="contato@seu-dominio.com"
              />
            </label>
          </div>

          {/* Seção: E-mail de Teste */}
          <div className="smtp-section">
            <label className="smtp-full">
              <span>E-mail de teste</span>
              <input
                type="email"
                value={smtpForm.testEmail}
                onChange={(e) => setSmtpForm({ ...smtpForm, testEmail: e.target.value })}
                placeholder={userMeta?.email || 'teste@seu-dominio.com'}
              />
            </label>
          </div>

          {/* Seção: Botões */}
          <div className="smtp-buttons">
            <button 
              className="btn btn-ghost" 
              type="button" 
              onClick={verifySmtpConnection} 
              disabled={smtpVerifying || !smtpForm.host}
              title="Testar conexão com servidor SMTP"
            >
              {smtpVerifying ? '⏳ Validando...' : '🔍 Validar Conexão'}
            </button>
            <button 
              className="btn btn-ghost" 
              type="button" 
              onClick={sendSmtpTest} 
              disabled={smtpTesting || !smtpForm.host}
              title="Enviar e-mail de teste"
            >
              {smtpTesting ? '⏳ Enviando...' : '📧 Enviar Teste'}
            </button>
            <button 
              className="btn btn-primary" 
              type="button" 
              onClick={saveSmtpSettings} 
              disabled={smtpSaving || !smtpForm.host}
            >
              {smtpSaving ? '⏳ Salvando...' : '💾 Salvar SMTP'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderDashboard = () => (
    <div className="stack">
      {renderTopbar()}

      {renderSummaryCards()}
      {renderCharts()}
      <div className="split">
        {renderMonthList()}
        {renderProjection()}
      </div>
      {renderMonthDetail()}
    </div>
  );

  const renderMaster = () => (
    <div className="stack">
      {renderTopbar()}
      <div className="card">
        <div className="card-head">
          <div>
            <p className="eyebrow">Empresas</p>
            <h3>Controles financeiros</h3>
          </div>
          <div className="chip">{tenants.length} empresas</div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Usuários</th>
                <th>Criado em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td data-label="Empresa">
                    <div className="cell-stack">
                      <strong>{tenant.name}</strong>
                      <small className="muted">ID {tenant.id}</small>
                      {activeTenantId === tenant.id && (
                        <StatusPill tone="info">Selecionada</StatusPill>
                      )}
                    </div>
                  </td>
                  <td data-label="Usuários">{tenant.user_count || 0}</td>
                  <td data-label="Criado em">
                    {tenant.created_at ? new Date(tenant.created_at).toLocaleDateString('pt-BR') : '-'}
                  </td>
                  <td data-label="Ações">
                    <div className="table-actions">
                      <button className="btn btn-ghost" onClick={() => fetchUsers(tenant.id)}>
                        <Icon name="group" /> Ver usuários
                      </button>
                      <button className="btn btn-ghost" onClick={() => renameTenant(tenant)}>
                        <Icon name="edit" /> Renomear
                      </button>
                      <button className="btn btn-danger" onClick={() => deleteTenant(tenant)}>
                        <Icon name="delete" /> Remover
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tenants.length && <p className="muted">Nenhuma empresa cadastrada.</p>}
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <div>
            <p className="eyebrow">Nova empresa</p>
            <h3>Criar controle financeiro</h3>
          </div>
        </div>
        <form className="form-grid" onSubmit={createTenant}>
          <label className="form-span-2">
            <span>Nome da empresa</span>
              <input
                type="text"
                value={tenantForm.name}
                onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })}
                placeholder="Nome da empresa"
                required
              />
          </label>
          <label>
            <span>Nome do admin</span>
            <input
              type="text"
              value={tenantForm.adminName}
              onChange={(e) => setTenantForm({ ...tenantForm, adminName: e.target.value })}
              placeholder="Nome completo"
            />
          </label>
          <label>
            <span>Usuário do admin</span>
            <input
              type="text"
              value={tenantForm.adminUsername}
              onChange={(e) => setTenantForm({ ...tenantForm, adminUsername: e.target.value })}
              placeholder="usuário"
            />
          </label>
          <label>
            <span>E-mail do admin</span>
            <input
              type="email"
              value={tenantForm.adminEmail}
              onChange={(e) => setTenantForm({ ...tenantForm, adminEmail: e.target.value })}
              required
            />
          </label>
          <label>
            <span>Senha do admin</span>
            <input
              type="password"
              value={tenantForm.adminPassword}
              onChange={(e) => setTenantForm({ ...tenantForm, adminPassword: e.target.value })}
              required
            />
          </label>
            <div className="form-actions form-span-2 align-right">
              <button className="btn btn-primary" type="submit">Criar empresa</button>
            </div>
        </form>
      </div>
      {activeTenantId && (
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Identidade</p>
              <h3>Nome do controle financeiro</h3>
              {activeTenant && (
                <p className="muted">Empresa selecionada: {activeTenant.name}</p>
              )}
            </div>
          </div>
          <div className="form-grid">
            <label className="form-span-2">
              <span>Nome do sistema</span>
              <input
                type="text"
                value={activeTenantNameDraft}
                onChange={(e) => setActiveTenantNameDraft(e.target.value)}
                placeholder="Nome do sistema"
              />
              <small className="helper">
                Esse nome aparece como Controle Financeiro de {activeTenantNameDraft || '...'}.
              </small>
            </label>
              <div className="form-actions form-span-2 align-right">
                <button className="btn btn-primary" onClick={updateActiveTenantName}>
                  Atualizar nome
                </button>
              </div>
          </div>
        </div>
      )}
      {activeTenantId && (
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Equipe</p>
              <h3>Usuários da empresa selecionada</h3>
            </div>
            <button className="btn btn-ghost" onClick={() => { setActiveTenantId(null); setUsers([]); }}>
              Fechar
            </button>
          </div>
        </div>
      )}
      {activeTenantId && renderUsers()}
    </div>
  );

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return renderDashboard();
      case 'transacoes':
        return renderTransactions();
      case 'relatorios':
        return renderReports();
      case 'nova':
        return renderTxForm();
      case 'master':
        return renderMaster();
      case 'smtp':
        return renderAdminSmtp();
      case 'usuarios':
        return renderUsers();
      case 'conta':
        return renderAccount();
      default:
        return isMaster ? renderMaster() : renderDashboard();
    }
  };

  return (
      <div className="app-shell">
        <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand mini">
          <div className="logo-dot">
            <Icon name="account_balance_wallet" />
          </div>
          <div>
              <p className="eyebrow">{isMaster ? 'Administrativo' : 'Controle financeiro'}</p>
              <strong>{isMaster ? 'Administrativo' : (tenantName || 'Financeiro')}</strong>
          </div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-btn ${activePage === item.id ? 'active' : ''}`}
              onClick={() => { setActivePage(item.id); setNavOpen(false); }}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button className="btn btn-ghost" onClick={handleLogout}>
            <Icon name="logout" /> Sair
          </button>
        </div>
        <div className="sidebar-bottom">
           {!isMaster && (
             <div className="sidebar-foot">
               <p className="muted">Saldo atual</p>
                <strong className={((currentMonthSummary?.saldo ?? summary?.saldo) ?? 0) >= 0 ? 'positive' : 'negative'}>
                  {console.log('Sidebar balance:', { currentMonthSummary, summary, currentSaldo: currentMonthSummary?.saldo, summarySaldo: summary?.saldo, computed: (currentMonthSummary?.saldo ?? summary?.saldo) || 0 })}
                  {formatCurrency((currentMonthSummary?.saldo ?? summary?.saldo) || 0)}
                </strong>
             </div>
           )}
          <div className="sidebar-version">{appVersion}</div>
        </div>
      </aside>
      {navOpen && <div className="backdrop" onClick={() => setNavOpen(false)} />}
      <main>
        <div className="mobile-top">
          <button
            className="btn btn-ghost btn-icon mobile-menu"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Abrir menu"
          >
            <Icon name="menu" />
          </button>
          <div className="mobile-actions">
            {!isMaster && activePage === 'dashboard' && (
              <button className="btn btn-ghost btn-icon" onClick={() => setShowFiltersModal(true)} title="Filtros de período">
                <Icon name="filter_list" />
              </button>
            )}
            <button className="btn btn-ghost btn-icon" onClick={toggleTheme} title={themeLabels[themeChoice]}>
              <Icon name={themeIcons[themeChoice]} />
            </button>
            <button className="btn btn-ghost btn-icon" onClick={handleLogout} aria-label="Sair">
              <Icon name="logout" />
            </button>
            <div className="chip">{displayRole}</div>
          </div>
        </div>
        {error && <div className="error-box">{error}</div>}
        {renderPage()}
      </main>
      {showScrollTop && (
        <button
          className="scroll-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Voltar ao topo"
        >
          <Icon name="north" />
        </button>
      )}
      {renderGlobalLayers()}
    </div>
  );
}














