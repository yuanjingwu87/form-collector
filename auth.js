const jwt = require('jsonwebtoken');
const { client, addAuditLog } = require('./db');

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

// 角色验证中间件
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

// 登录
async function login(username, password, ip) {
  const result = await client.execute({
    sql: 'SELECT * FROM users WHERE username = ?',
    args: [username]
  });
  const user = result.rows[0];

  if (!user) {
    return { success: false, message: '用户名或密码错误' };
  }

  const bcrypt = require('bcryptjs');
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return { success: false, message: '用户名或密码错误' };
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, realName: user.real_name, role: user.role, unitId: user.unit_id },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  await addAuditLog(user.id, '登录', `用户 ${user.real_name} 登录系统`, ip);

  return {
    success: true,
    token,
    user: { id: user.id, username: user.username, realName: user.real_name, role: user.role, unitId: user.unit_id }
  };
}

// 获取当前用户
async function getCurrentUser(userId) {
  const result = await client.execute({
    sql: 'SELECT * FROM users WHERE id = ?',
    args: [userId]
  });
  return result.rows[0];
}

module.exports = { authenticateToken, requireRole, login, getCurrentUser };
