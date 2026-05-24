const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');

const client = createClient({
  url: process.env.TURSO_URL || 'file:local.db',
  authToken: process.env.TURSO_AUTH_TOKEN || ''
});

// 初始化数据库表
async function initDB() {
  // 用户表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      real_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'finance', 'filler')),
      unit_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (unit_id) REFERENCES units(id)
    )
  `);

  // 组织架构表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 4),
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES units(id)
    )
  `);

  // 表单模板表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS form_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      fields_json TEXT NOT NULL,
      creator_id INTEGER,
      is_fixed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    )
  `);

  // 收集任务表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS collection_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'completed')),
      deadline DATETIME,
      creator_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (form_id) REFERENCES form_templates(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    )
  `);

  // 任务分配表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      unit_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'filling', 'submitted')),
      submitted_at DATETIME,
      submitter_id INTEGER,
      reminder_count INTEGER DEFAULT 0,
      last_reminder_at DATETIME,
      FOREIGN KEY (task_id) REFERENCES collection_tasks(id),
      FOREIGN KEY (unit_id) REFERENCES units(id),
      FOREIGN KEY (submitter_id) REFERENCES users(id)
    )
  `);

  // 填报数据表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS form_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL UNIQUE,
      data_json TEXT NOT NULL,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'submitted')),
      submitted_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (assignment_id) REFERENCES task_assignments(id)
    )
  `);

  // 审计日志表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      detail TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 初始化默认数据
  await initDefaultData();
}

// 初始化默认数据
async function initDefaultData() {
  const countResult = await client.execute('SELECT COUNT(*) as count FROM users');
  if (countResult.rows[0].count > 0) return;

  // 创建管理员
  const adminHash = bcrypt.hashSync('admin123', 10);
  const adminResult = await client.execute({
    sql: 'INSERT INTO users (username, password_hash, real_name, role) VALUES (?, ?, ?, ?) RETURNING id',
    args: ['admin', adminHash, '系统管理员', 'admin']
  });
  const adminId = adminResult.rows[0].id;

  // 创建财务人员
  const financeHash = bcrypt.hashSync('finance123', 10);
  const financeResult = await client.execute({
    sql: 'INSERT INTO users (username, password_hash, real_name, role) VALUES (?, ?, ?, ?) RETURNING id',
    args: ['finance', financeHash, '财务专员', 'finance']
  });
  const financeId = financeResult.rows[0].id;

  // 第一级：集团
  const groupResult = await client.execute({
    sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
    args: ['中土集团总部', null, 1, 1]
  });
  const groupId = groupResult.rows[0].id;

  // 第二级：局
  const bureau1Result = await client.execute({
    sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
    args: ['第一工程局', groupId, 2, 1]
  });
  const bureau1 = bureau1Result.rows[0].id;

  const bureau2Result = await client.execute({
    sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
    args: ['第二工程局', groupId, 2, 2]
  });
  const bureau2 = bureau2Result.rows[0].id;

  const bureau3Result = await client.execute({
    sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
    args: ['第三工程局', groupId, 2, 3]
  });
  const bureau3 = bureau3Result.rows[0].id;

  // 第三级：处
  const dept1Result = await client.execute({
    sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
    args: ['一处', bureau1, 3, 1]
  });
  const dept1 = dept1Result.rows[0].id;

  const dept2Result = await client.execute({
    sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
    args: ['二处', bureau1, 3, 2]
  });
  const dept2 = dept2Result.rows[0].id;

  const dept3Result = await client.execute({
    sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
    args: ['三处', bureau2, 3, 1]
  });
  const dept3 = dept3Result.rows[0].id;

  const dept4Result = await client.execute({
    sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
    args: ['四处', bureau3, 3, 1]
  });
  const dept4 = dept4Result.rows[0].id;

  // 第四级：项目
  await client.execute({ sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?)', args: ['北京地铁项目', dept1, 4, 1] });
  await client.execute({ sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?)', args: ['上海大桥项目', dept1, 4, 2] });
  await client.execute({ sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?)', args: ['广州隧道项目', dept2, 4, 1] });
  await client.execute({ sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?)', args: ['深圳高速项目', dept3, 4, 1] });
  await client.execute({ sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?)', args: ['成都地铁项目', dept4, 4, 1] });

  // 创建填报单位用户
  const fillerHash = bcrypt.hashSync('filler123', 10);
  const fillerResult = await client.execute({
    sql: 'INSERT INTO users (username, password_hash, real_name, role, unit_id) VALUES (?, ?, ?, ?, ?) RETURNING id',
    args: ['filler', fillerHash, '填报员', 'filler', dept1]
  });
  const fillerId = fillerResult.rows[0].id;

  // 创建示例表单模板
  const fields1 = JSON.stringify([
    { id: 'f1', type: 'text', label: '项目名称', required: true },
    { id: 'f2', type: 'number', label: '本月收入(万元)', required: true },
    { id: 'f3', type: 'number', label: '本月支出(万元)', required: true },
    { id: 'f4', type: 'date', label: '统计截止日期', required: true },
    { id: 'f5', type: 'textarea', label: '备注说明', required: false }
  ]);

  const fields2 = JSON.stringify([
    { id: 'f1', type: 'text', label: '单位名称', required: true },
    { id: 'f2', type: 'number', label: '员工人数', required: true },
    { id: 'f3', type: 'date', label: '成立日期', required: true },
    { id: 'f4', type: 'select', label: '资质等级', required: true, options: ['甲级', '乙级', '丙级'] }
  ]);

  const fields3 = JSON.stringify([
    { id: 'f1', type: 'text', label: '合同名称', required: true },
    { id: 'f2', type: 'number', label: '合同金额(万元)', required: true },
    { id: 'f3', type: 'date', label: '签订日期', required: true },
    { id: 'f4', type: 'file', label: '合同扫描件', required: false },
    { id: 'f5', type: 'textarea', label: '合同内容摘要', required: false }
  ]);

  const form1Result = await client.execute({
    sql: 'INSERT INTO form_templates (name, description, fields_json, creator_id, is_fixed) VALUES (?, ?, ?, ?, ?) RETURNING id',
    args: ['月度财务收支表', '用于各项目月度财务收支情况汇总', fields1, adminId, 1]
  });
  const form1 = form1Result.rows[0].id;

  await client.execute({
    sql: 'INSERT INTO form_templates (name, description, fields_json, creator_id, is_fixed) VALUES (?, ?, ?, ?, ?)',
    args: ['单位基本信息表', '记录各单位基本工商信息', fields2, adminId, 1]
  });

  await client.execute({
    sql: 'INSERT INTO form_templates (name, description, fields_json, creator_id, is_fixed) VALUES (?, ?, ?, ?, ?)',
    args: ['合同管理台账', '项目合同签订及执行情况', fields3, financeId, 0]
  });

  // 创建示例收集任务
  const task1Result = await client.execute({
    sql: 'INSERT INTO collection_tasks (form_id, title, status, deadline, creator_id) VALUES (?, ?, ?, ?, ?) RETURNING id',
    args: [form1, '2024年12月月度财务收支汇总', 'active', '2025-01-10 23:59:59', adminId]
  });
  const task1 = task1Result.rows[0].id;

  // 分配任务给各单位
  await client.execute({ sql: "INSERT INTO task_assignments (task_id, unit_id, status) VALUES (?, ?, 'filling')", args: [task1, dept1] });
  await client.execute({ sql: "INSERT INTO task_assignments (task_id, unit_id, status) VALUES (?, ?, 'pending')", args: [task1, dept2] });

  const assign3Result = await client.execute({
    sql: "INSERT INTO task_assignments (task_id, unit_id, status) VALUES (?, ?, 'submitted') RETURNING id",
    args: [task1, dept3]
  });
  const assign3Id = assign3Result.rows[0].id;

  await client.execute({ sql: "INSERT INTO task_assignments (task_id, unit_id, status) VALUES (?, ?, 'pending')", args: [task1, dept4] });

  // 为已提交的添加填报数据
  await client.execute({
    sql: "INSERT INTO form_submissions (assignment_id, data_json, status, submitted_at) VALUES (?, ?, 'submitted', ?)",
    args: [assign3Id, JSON.stringify({
      f1: '一处', f2: '500', f3: '350', f4: '2024-12-31', f5: '本月经营状况良好'
    }), '2025-01-05 10:30:00']
  });

  await client.execute({
    sql: 'UPDATE task_assignments SET submitter_id = ?, submitted_at = ? WHERE id = ?',
    args: [fillerId, '2025-01-05 10:30:00', assign3Id]
  });

  // 审计日志
  await client.execute({
    sql: 'INSERT INTO audit_logs (user_id, action, detail, ip) VALUES (?, ?, ?, ?)',
    args: [adminId, '系统初始化', '系统初始化完成，创建默认数据', '127.0.0.1']
  });
}

// 审计日志记录
async function addAuditLog(userId, action, detail, ip) {
  await client.execute({
    sql: 'INSERT INTO audit_logs (user_id, action, detail, ip) VALUES (?, ?, ?, ?)',
    args: [userId, action, detail, ip]
  });
}

module.exports = { client, initDB, addAuditLog };
