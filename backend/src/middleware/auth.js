const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const authRequired = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Token ausente' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin' && !req.user?.isMaster) {
    return res.status(403).json({ error: 'Apenas administradores' });
  }
  return next();
};

const requireMaster = (req, res, next) => {
  if (!req.user?.isMaster) {
    return res.status(403).json({ error: 'Apenas administradores do sistema' });
  }
  return next();
};

const requirePermission = (permission) => async (req, res, next) => {
  if (req.user?.role === 'admin' || req.user?.isMaster) {
    return next();
  }

  try {
    const result = await pool.query(
      `
        SELECT can_view, can_create, can_edit, can_delete
        FROM users
        WHERE id = $1
      `,
      [req.user?.id]
    );
    if (result.rowCount === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    const perms = result.rows[0];
    const allowed = perms[`can_${permission}`];
    if (!allowed) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Erro no servidor' });
  }
};

module.exports = {
  authRequired,
  requireAdmin,
  requireMaster,
  requirePermission,
};
