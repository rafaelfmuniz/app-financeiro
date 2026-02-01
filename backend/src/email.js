const nodemailer = require('nodemailer');
const { fetchSmtpSettings } = require('./smtp');

const resolveEnvSettings = () => {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    username: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASS || '',
    fromAddress: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@localhost',
    replyTo: process.env.SMTP_REPLY_TO || '',
  };
};

const resolveSettings = async () => {
  try {
    const dbSettings = await fetchSmtpSettings();
    if (dbSettings?.host) {
      return dbSettings;
    }
  } catch (err) {
    return resolveEnvSettings();
  }
  return resolveEnvSettings();
};

/**
 * Detecta o provedor de SMTP baseado no host
 * @param {string} host - Host SMTP
 * @returns {string} Nome do provedor
 */
const detectProvider = (host) => {
  const lowerHost = String(host).toLowerCase();
  if (lowerHost.includes('gmail') || lowerHost.includes('google')) {
    return 'gmail';
  }
  if (lowerHost.includes('outlook') || lowerHost.includes('hotmail') || lowerHost.includes('office365')) {
    return 'outlook';
  }
  return 'generic';
};

/**
 * Constrói as opções de transporte SMTP com suporte otimizado
 * @param {Object} settings - Configurações SMTP
 * @returns {Object} Opções do transporte
 */
const buildTransportOptions = (settings) => {
  if (!settings?.host) {
    return null;
  }

  const auth = settings.username && settings.password
    ? { user: settings.username, pass: settings.password }
    : undefined;

  const port = Number(settings.port || 587);
  const secure = typeof settings.secure === 'boolean' ? settings.secure : port === 465;
  const provider = detectProvider(settings.host);

  const baseOptions = {
    host: settings.host,
    port,
    secure,
    auth,
    name: settings.host || undefined,
    // Configurações de conexão melhoradas
    maxConnections: 1,
    maxMessages: Infinity,
    rateDelta: 250,
    rateLimit: 50,
    connectionTimeout: 10000,
    socketTimeout: 10000,
    greetingTimeout: 5000,
    // Headers necessários para melhorar entrega
    headers: {
      'X-Mailer': 'Controle-Financeiro/1.0',
      'X-Priority': '3',
      'Importance': 'normal',
    },
  };

  // Otimizações específicas por provedor
  if (provider === 'gmail') {
    baseOptions.service = 'gmail';
    // Gmail trabalha melhor com TLS explícito na porta 587
    if (port === 587) {
      baseOptions.secure = false;
      baseOptions.requireTLS = true;
    }
  } else if (provider === 'outlook') {
    baseOptions.service = 'outlook365';
    // Outlook recomenda TLS na porta 587
    if (port === 587) {
      baseOptions.secure = false;
      baseOptions.requireTLS = true;
    }
  } else {
    // Para servidores SMTP customizados (domínios próprios)
    if (port === 465) {
      // SSL/TLS implícito
      baseOptions.secure = true;
      baseOptions.requireTLS = false;
    } else if (port === 587) {
      // STARTTLS
      baseOptions.secure = false;
      baseOptions.requireTLS = true;
    }
  }

  // Debug mode
  if (process.env.SMTP_DEBUG === 'true') {
    baseOptions.logger = true;
    baseOptions.debug = true;
  }

  // TLS inseguro (para ambientes de teste apenas)
  if (process.env.SMTP_TLS_INSECURE === 'true') {
    baseOptions.tls = { rejectUnauthorized: false };
  } else if (!baseOptions.tls) {
    // Configurações TLS seguras por padrão
    baseOptions.tls = {
      minVersion: 'TLSv1.2',
      ciphers: 'HIGH:!aNULL:!MD5',
      rejectUnauthorized: true,
    };
  }

  return baseOptions;
};

const buildTransport = async (settings) => {
  const options = buildTransportOptions(settings);
  if (!options) {
    return null;
  }
  return nodemailer.createTransport(options);
};
/**
 * Verifica se a configuração SMTP está funcionando (verifica conexão/auth)
 * @returns {Promise<boolean|Object>} true ou objeto com info
 */
const verifySmtp = async () => {
  const settings = await resolveSettings();
  if (!settings || !settings.host) {
    throw new Error('SMTP não configurado');
  }

  const transport = await buildTransport(settings);
  if (!transport) {
    throw new Error('Não foi possível construir o transporte SMTP');
  }

  try {
    await transport.verify();
    return true;
  } catch (err) {
    const msg = err && err.message ? err.message : 'Erro ao verificar SMTP';
    const e = new Error(msg);
    e.details = {
      responseCode: err.responseCode,
      response: err.response,
      message: msg,
    };
    throw e;
  }
};


/**
 * Envia um e-mail usando as configurações resolvidas
 * @param {Object} options - { to, subject, text, html }
 * @returns {Promise<Object>} result { messageId, accepted, rejected, response }
 */
const sendMail = async ({ to, subject, text, html } = {}) => {
  const settings = await resolveSettings();
  if (!settings || !settings.host) {
    throw new Error('SMTP não configurado');
  }

  const transport = await buildTransport(settings);
  if (!transport) {
    throw new Error('Não foi possível construir o transporte SMTP');
  }

  // Garantir que o From é sempre um email válido
  const envelopeFrom = settings.fromAddress || settings.username || 'no-reply@localhost';
  const fromHeader = settings.fromAddress || settings.username || envelopeFrom;

  // Headers críticos para autenticação e entrega
  const messageHeaders = {
    'X-Mailer': 'Controle-Financeiro/1.0',
    'X-Priority': '3',
    'Importance': 'normal',
    'X-Originating-IP': '[unknown]',
  };

  // Adicionar Sender header APENAS se for diferente do From
  if (envelopeFrom !== fromHeader) {
    messageHeaders['Sender'] = `<${envelopeFrom}>`;
  }

  // Replyto deve estar no domínio confiável
  const replyToAddress = settings.replyTo || fromHeader;

  const envelope = { from: envelopeFrom, to: Array.isArray(to) ? to : [to] };

  if (process.env.SMTP_DEBUG === 'true') {
    console.log(`\n📧 [SMTP DEBUG] Enviando email:`);
    console.log(`   Host: ${settings.host}:${settings.port}`);
    console.log(`   Envelope From: ${envelopeFrom}`);
    console.log(`   From Header: ${fromHeader}`);
    console.log(`   Reply-To: ${replyToAddress}`);
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}`);
  }

  try {
    const result = await transport.sendMail({
      from: fromHeader,
      to,
      subject,
      text: text || undefined,
      html: html || undefined,
      replyTo: replyToAddress,
      headers: messageHeaders,
      envelope,
      date: new Date(),
      // Deixar nodemailer gerar o messageId automaticamente com formato correto
      // NÃO usar messageId: true pois gera <true> inválido
    });

    const response = {
      messageId: result.messageId,
      accepted: result.accepted || [],
      rejected: result.rejected || [],
      response: result.response || undefined,
    };

    if (process.env.SMTP_DEBUG === 'true') {
      console.log(`✅ [SMTP DEBUG] Email enviado com sucesso`);
      console.log(`   MessageId: ${response.messageId}`);
      console.log(`   Accepted: ${JSON.stringify(response.accepted)}`);
      console.log(`   Rejected: ${JSON.stringify(response.rejected)}`);
      console.log(`   Server Response: ${response.response}`);
    }

    return response;
  } catch (err) {
    if (process.env.SMTP_DEBUG === 'true') {
      console.error(`❌ [SMTP DEBUG] Erro ao enviar email:`);
      console.error(`   Error Message: ${err.message}`);
      console.error(`   Error Code: ${err.code}`);
      console.error(`   SMTP Code: ${err.responseCode}`);
      console.error(`   SMTP Response: ${err.response}`);
      console.error(`   Accepted: ${JSON.stringify(err.accepted)}`);
      console.error(`   Rejected: ${JSON.stringify(err.rejected)}`);
    }

    let userMessage = (err && err.message) ? err.message : 'Erro desconhecido no envio';

    if (userMessage.includes('ECONNREFUSED')) {
      userMessage = `❌ Não conseguiu conectar ao servidor SMTP ${settings.host}:${settings.port}. Verifique host, porta e se o servidor está online.`;
    } else if (userMessage.includes('ENOTFOUND')) {
      userMessage = `❌ Servidor SMTP ${settings.host} não encontrado. Verifique o host configurado.`;
    } else if (userMessage.includes('ETIMEDOUT')) {
      userMessage = `❌ Timeout na conexão com ${settings.host}. O servidor pode estar lento ou indisponível.`;
    } else if (userMessage.toLowerCase().includes('authentication failed') || userMessage.includes('535')) {
      userMessage = `❌ Falha na autenticação SMTP (código 535). Verifique usuário e senha.`;
    } else if (userMessage.includes('self signed certificate')) {
      userMessage = `❌ Certificado SSL/TLS inválido. Desabilitar "Usar TLS/SSL" se for um servidor com certificado auto-assinado.`;
    } else if (userMessage.includes('EHLO')) {
      userMessage = `❌ Erro de handshake SMTP. Verifique configurações de TLS/SSL e porta.`;
    } else if (userMessage.includes('550') || userMessage.includes('554')) {
      userMessage = `❌ Servidor SMTP rejeitou o email (código ${err.responseCode}). Pode ser: SPF/DKIM/DMARC falho, destinatário inválido ou remetente bloqueado.`;
    } else if (userMessage.includes('SMTP code:')) {
      userMessage = `❌ Erro do servidor SMTP: ${userMessage}`;
    }

    const e = new Error(userMessage);
    e.details = {
      responseCode: err.responseCode,
      response: err.response,
      rejected: err.rejected || [],
      accepted: err.accepted || [],
      smtpCode: err.responseCode,
    };
    throw e;
  }
};

module.exports = {
  sendMail,
  verifySmtp,
  buildTransportOptions,
  detectProvider,
};
