const express = require('express');
const { authRequired, requireMaster } = require('../middleware/auth');
const { fetchSmtpSettings, saveSmtpSettings, validateSmtpSettings } = require('../smtp');
const { sendMail, verifySmtp } = require('../email');

const router = express.Router();

router.get('/smtp', authRequired, requireMaster, async (req, res) => {
  try {
    const settings = await fetchSmtpSettings();
    return res.json({
      host: settings?.host || '',
      port: settings?.port || 587,
      secure: settings?.secure || false,
      username: settings?.username || '',
      fromAddress: settings?.fromAddress || '',
      replyTo: settings?.replyTo || '',
      hasPassword: settings?.hasPassword || false,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao carregar configurações SMTP' });
  }
});

router.put('/smtp', authRequired, requireMaster, async (req, res) => {
  const {
    host,
    port,
    secure,
    username,
    password,
    fromAddress,
    replyTo,
  } = req.body || {};

  // Validar configurações antes de salvar
  const validation = validateSmtpSettings({
    host,
    port: port ? Number(port) : 587,
    secure: !!secure,
    username,
    fromAddress,
    replyTo,
  });

  if (!validation.valid) {
    return res.status(400).json({ error: validation.errors.join('; ') });
  }

  try {
    await saveSmtpSettings({
      host: String(host).trim(),
      port: port ? Number(port) : 587,
      secure: !!secure,
      username: String(username || '').trim(),
      password: password ? String(password) : '',
      fromAddress: String(fromAddress || '').trim(),
      replyTo: String(replyTo || '').trim(),
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao salvar SMTP' });
  }
});

router.post('/smtp/verify', authRequired, requireMaster, async (req, res) => {
  try {
    const settings = await fetchSmtpSettings();
    if (!settings?.host) {
      return res.status(400).json({ 
        error: 'SMTP não configurado. Configure o servidor SMTP primeiro.' 
      });
    }

    const result = await verifySmtp();
    return res.json({ 
      ok: true, 
      result: result === true ? 'ok' : result,
      message: 'Configuração SMTP validada com sucesso!'
    });
  } catch (err) {
    console.error('SMTP Verify Error:', err);
    return res.status(500).json({
      error: err.message || 'Erro ao validar SMTP',
      code: err.code,
      response: err.response,
    });
  }
});

router.post('/smtp/test', authRequired, requireMaster, async (req, res) => {
  const target = (req.body?.email || req.user?.email || '').trim();
  if (!target) {
    return res.status(400).json({ error: 'E-mail de destino obrigatório' });
  }

  // Validar formato do e-mail
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(target)) {
    return res.status(400).json({ error: 'E-mail de destino inválido' });
  }

  try {
    const settings = await fetchSmtpSettings();
    if (!settings?.host) {
      return res.status(400).json({ 
        error: 'SMTP não configurado. Configure o servidor SMTP primeiro.' 
      });
    }

    const verifyResult = await verifySmtp();
    
    const result = await sendMail({
      to: target,
      subject: 'Teste de Configuração SMTP',
      text: 'Seu SMTP está configurado corretamente.',
      html: `
        <h2>Teste de Configuração SMTP</h2>
        <p>Seu SMTP está configurado corretamente!</p>
        <p style="color: #666; font-size: 12px; margin-top: 20px;">
          Enviado em: ${new Date().toLocaleString('pt-BR')}
        </p>
      `,
    });

    return res.json({ 
      ok: true, 
      verify: verifyResult === true ? 'ok' : verifyResult,
      messageId: result?.messageId || null,
      accepted: result?.accepted || [],
      rejected: result?.rejected || [],
      response: result?.response || null,
      message: `E-mail de teste enviado (verifique accepted/rejected para status).`
    });
  } catch (err) {
    console.error('SMTP Test Error:', err);
    return res.status(500).json({
      error: err.message || 'Erro ao enviar e-mail de teste',
      code: err.code,
      response: err.response,
    });
  }
});

module.exports = router;
