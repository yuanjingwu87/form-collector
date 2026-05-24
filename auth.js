const jwt = require('jsonwebtoken');
const { db, addAuditLog } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'form-collector-secret-key-2024';
const JWT_EXPIRES_IN = '24h';

// 验证token中间件
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: '令牌无效或已过期' });
    }
    req.user = user;
    next();
  });
}

// 验证角色权限中间件
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未认证' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

// 登录
function login(username, password, ip) {
  const user = db.prepare(`
    SELECT u.*, un.name as unit_name 
    FROM users u 
    LEFT JOIN units un ON u.unit_id = un.id 
    WHERE u.username = ?
  `).get(username);

  if (!user) {
    return { success: false, message: '用户名或密码错误' };
  }

  const validPassword = require('bcryptjs').compareSync(password, user.password_hash);
  if (!validPassword) {
    return { success: false, message: '用户名或密码错误' };
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, realName: user.real_name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  // 记录登录日志
  addAuditLog(user.id, '登录', `用户 ${user.real_name} 登录系统`, ip);

  return {
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      realName: user.real_name,
      role: user.role,
      unitId: user.unit_id,
      unitName: user.unit_name
    }
  };
}

// 获取当前用户信息
function getCurrentUser(userId) {
  return db.prepare(`
    SELECT u.*, un.name as unit_name 
    FROM users u 
    LEFT JOIN units un ON u.unit_id = un.id 
    WHERE u.id = ?
  `).get(userId);
}

module.exports = { authenticateToken, requireRole, login, getCurrentUser, JWT_SECRET };
