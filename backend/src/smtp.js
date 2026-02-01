const crypto = require('crypto');
const { pool } = require('./db');

const algorithm = 'aes-256-gcm';

const getKey = () => {
  const secret = process.env.JWT_SECRET || 'controle-financeiro';
  return crypto.createHash('sha256').update(secret).digest();
};

const encryptSecret = (value) => {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

const decryptSecret = (payload) => {
  if (!payload) return '';
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) return '';
  try {
    const decipher = crypto.createDecipheriv(algorithm, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    return '';
  }
};

const fetchSmtpSettings = async () => {
  const result = await pool.query(
    `
      SELECT host, port, secure, username, password_encrypted, from_address, reply_to
      FROM smtp_settings
      WHERE id = 1
    `
  );
  if (result.rowCount === 0) {
    return null;
  }
  const row = result.rows[0];
  return {
    host: row.host || '',
    port: row.port || null,
    secure: !!row.secure,
    username: row.username || '',
    password: decryptSecret(row.password_encrypted),
    hasPassword: !!row.password_encrypted,
    fromAddress: row.from_address || '',
    replyTo: row.reply_to || '',
  };
};

const saveSmtpSettings = async ({
  host,
  port,
  secure,
  username,
  password,
  fromAddress,
  replyTo,
}) => {
  const current = await pool.query(
    'SELECT password_encrypted FROM smtp_settings WHERE id = 1'
  );
  const existingPassword = current.rows[0]?.password_encrypted || null;
  const nextPassword = password ? encryptSecret(password) : existingPassword;
  await pool.query(
    `
      INSERT INTO smtp_settings (id, host, port, secure, username, password_encrypted, from_address, reply_to, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (id) DO UPDATE
      SET host = EXCLUDED.host,
          port = EXCLUDED.port,
          secure = EXCLUDED.secure,
          username = EXCLUDED.username,
          password_encrypted = EXCLUDED.password_encrypted,
          from_address = EXCLUDED.from_address,
          reply_to = EXCLUDED.reply_to,
          updated_at = NOW()
    `,
    [
      host || '',
      port ? Number(port) : null,
      !!secure,
      username || '',
      nextPassword,
      fromAddress || '',
      replyTo || '',
    ]
  );
};

/**
 * Valida as configurações SMTP antes de salvar
 * @param {Object} settings - Configurações SMTP
 * @returns {Object} { valid: boolean, errors: string[] }
 */
const validateSmtpSettings = (settings) => {
  const errors = [];

  if (!settings.host || !String(settings.host).trim()) {
    errors.push('Host SMTP é obrigatório');
  }

  const port = Number(settings.port || 587);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push('Porta deve ser um número entre 1 e 65535');
  }

  if (settings.username && !String(settings.username).trim()) {
    errors.push('Usuário não pode estar vazio se fornecido');
  }

  if (settings.fromAddress && !String(settings.fromAddress).trim().includes('@')) {
    errors.push('Endereço de origem deve ser um e-mail válido');
  }

  if (settings.replyTo && !String(settings.replyTo).trim().includes('@')) {
    errors.push('Endereço de resposta deve ser um e-mail válido');
  }

  // Validar combinação porta/segura
  if (port === 465 && !settings.secure) {
    errors.push('Porta 465 requer conexão segura (TLS/SSL)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

module.exports = {
  fetchSmtpSettings,
  saveSmtpSettings,
  validateSmtpSettings,
};
