const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { initDB, db, addAuditLog } = require('./db');
const { authenticateToken, requireRole, login, getCurrentUser } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化数据库
initDB();

// 中间件
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API路由前缀
const API = '/api';

// 通用响应包装
function resSuccess(res, data) {
  res.json({ success: true, data });
}

function resError(res, message, status = 400) {
  res.json({ success: false, error: message }, status);
}

// ==================== 认证相关 ====================

// 登录
app.post(`${API}/auth/login`, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return resError(res, '请输入用户名和密码');
  }
  const result = login(username, password, req.ip);
  if (result.success) {
    resSuccess(res, result);
  } else {
    resError(res, result.message, 401);
  }
});

// 获取当前用户
app.get(`${API}/auth/me`, authenticateToken, (req, res) => {
  const user = getCurrentUser(req.user.id);
  if (user) {
    const { password_hash, ...userInfo } = user;
    resSuccess(res, userInfo);
  } else {
    resError(res, '用户不存在', 404);
  }
});

// 登出
app.post(`${API}/auth/logout`, authenticateToken, (req, res) => {
  addAuditLog(req.user.id, '登出', `用户 ${req.user.realName} 退出系统`, req.ip);
  resSuccess(res, { message: '登出成功' });
});

// ==================== 工作台/仪表盘 ====================

app.get(`${API}/dashboard`, authenticateToken, (req, res) => {
  const user = req.user;
  let data = {};

  if (user.role === 'admin' || user.role === 'finance') {
    // 进行中任务数（本周新增）
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const activeTasks = db.prepare(`
      SELECT COUNT(*) as count FROM collection_tasks 
      WHERE status = 'active' AND created_at >= ?
    `).get(weekAgo.toISOString());
    data.activeTasks = activeTasks.count;

    // 应填单位数
    const units = db.prepare('SELECT COUNT(*) as count FROM units').get();
    data.unitCount = units.count;

    // 平均提交率
    const stats = db.prepare(`
      SELECT 
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
        COUNT(*) as total
      FROM task_assignments
    `).get();
    data.submitRate = stats.total > 0 ? Math.round((stats.submitted / stats.total) * 100) : 0;

    // 待催办数
    const pending = db.prepare(`
      SELECT COUNT(*) as count FROM task_assignments WHERE status != 'submitted'
    `).get();
    data.pendingCount = pending.count;

    // 模板库数量
    const templates = db.prepare('SELECT COUNT(*) as count FROM form_templates').get();
    data.templateCount = templates.count;

    // 任务列表
    data.tasks = db.prepare(`
      SELECT ct.*, ft.name as form_name, u.real_name as creator_name,
        (SELECT COUNT(*) FROM task_assignments WHERE task_id = ct.id) as total_assignments,
        (SELECT COUNT(*) FROM task_assignments WHERE task_id = ct.id AND status = 'submitted') as submitted_count
      FROM collection_tasks ct
      LEFT JOIN form_templates ft ON ct.form_id = ft.id
      LEFT JOIN users u ON ct.creator_id = u.id
      ORDER BY ct.created_at DESC
      LIMIT 10
    `).all();
  } else {
    // 填报单位只看到自己的任务
    const userInfo = getCurrentUser(user.id);
    data.tasks = db.prepare(`
      SELECT ct.*, ft.name as form_name, ta.status as my_status, ta.id as assignment_id
      FROM collection_tasks ct
      LEFT JOIN form_templates ft ON ct.form_id = ft.id
      LEFT JOIN task_assignments ta ON ct.id = ta.task_id AND ta.unit_id = ?
      WHERE ct.status = 'active'
      ORDER BY ct.deadline ASC
    `).all(userInfo.unit_id);
  }

  resSuccess(res, data);
});

// ==================== 经办人专用接口 ====================

// 经办人待办任务
app.get(`${API}/filler/todos`, authenticateToken, (req, res) => {
  const user = req.user;
  if (user.role !== 'filler') {
    return resError(res, '非经办人账号', 403);
  }

  const userInfo = getCurrentUser(user.id);

  // 待填报任务（按紧急程度排序）
  const pendingTasks = db.prepare(`
    SELECT ct.id as task_id, ct.title, ct.deadline, ct.status as task_status, 
      ft.name as form_name, ft.description as form_desc,
      ta.id as assignment_id, ta.status as my_status, ta.reminder_count,
      fs.data_json as saved_data, fs.status as submission_status,
      u.real_name as creator_name
    FROM collection_tasks ct
    INNER JOIN task_assignments ta ON ct.id = ta.task_id AND ta.unit_id = ?
    INNER JOIN form_templates ft ON ct.form_id = ft.id
    LEFT JOIN form_submissions fs ON ta.id = fs.assignment_id
    LEFT JOIN users u ON ct.creator_id = u.id
    WHERE ct.status = 'active' AND ta.status != 'submitted'
    ORDER BY 
      CASE WHEN ta.status = 'pending' THEN 0 ELSE 1 END,
      ct.deadline ASC
  `).all(userInfo.unit_id);

  // 已提交记录
  const submittedRecords = db.prepare(`
    SELECT ct.id as task_id, ct.title, ct.deadline, 
      ft.name as form_name,
      ta.id as assignment_id, ta.submitted_at,
      fs.data_json as saved_data
    FROM collection_tasks ct
    INNER JOIN task_assignments ta ON ct.id = ta.task_id AND ta.unit_id = ?
    INNER JOIN form_templates ft ON ct.form_id = ft.id
    INNER JOIN form_submissions fs ON ta.id = fs.assignment_id AND fs.status = 'submitted'
    ORDER BY ta.submitted_at DESC
    LIMIT 20
  `).all(userInfo.unit_id);

  // 统计
  const stats = {
    pending: pendingTasks.filter(t => t.my_status === 'pending').length,
    filling: pendingTasks.filter(t => t.my_status === 'filling').length,
    total: pendingTasks.length,
    overdue: pendingTasks.filter(t => t.deadline && new Date(t.deadline) < new Date()).length
  };

  resSuccess(res, {
    pendingTasks: pendingTasks.map(t => ({
      ...t,
      saved_data: t.saved_data ? JSON.parse(t.saved_data) : {},
      isOverdue: t.deadline && new Date(t.deadline) < new Date(),
      daysLeft: t.deadline ? Math.ceil((new Date(t.deadline) - new Date()) / (1000 * 60 * 60 * 24)) : null
    })),
    submittedRecords: submittedRecords.map(r => ({
      ...r,
      saved_data: r.saved_data ? JSON.parse(r.saved_data) : {}
    })),
    stats
  });
});

// 获取单个填单任务详情
app.get(`${API}/filler/task/:assignmentId`, authenticateToken, (req, res) => {
  const user = req.user;
  const { assignmentId } = req.params;
  const userInfo = getCurrentUser(user.id);

  const task = db.prepare(`
    SELECT ct.*, ft.name as form_name, ft.description as form_desc, ft.fields_json,
      ta.id as assignment_id, ta.status as my_status, ta.unit_id,
      fs.data_json as saved_data, fs.status as submission_status, fs.submitted_at,
      u.real_name as creator_name
    FROM collection_tasks ct
    INNER JOIN task_assignments ta ON ct.id = ta.task_id AND ta.id = ?
    INNER JOIN form_templates ft ON ct.form_id = ft.id
    LEFT JOIN form_submissions fs ON ta.id = fs.assignment_id
    LEFT JOIN users u ON ct.creator_id = u.id
  `).get(assignmentId);

  if (!task) {
    return resError(res, '任务不存在', 404);
  }

  // 检查权限
  if (user.role === 'filler' && task.unit_id !== userInfo.unit_id) {
    return resError(res, '无权访问此任务', 403);
  }

  const fields = JSON.parse(task.fields_json || '[]');
  const savedData = task.saved_data ? JSON.parse(task.saved_data) : {};

  // 计算填写进度
  const requiredFields = fields.filter(f => f.required);
  const filledRequired = requiredFields.filter(f => savedData[f.id] && savedData[f.id].toString().trim() !== '').length;
  const filledTotal = fields.filter(f => savedData[f.id] && savedData[f.id].toString().trim() !== '').length;

  resSuccess(res, {
    ...task,
    fields,
    saved_data: savedData,
    progress: {
      required: requiredFields.length,
      filledRequired,
      total: fields.length,
      filledTotal,
      percentage: fields.length > 0 ? Math.round((filledTotal / fields.length) * 100) : 100
    },
    isOverdue: task.deadline && new Date(task.deadline) < new Date(),
    canEdit: task.my_status !== 'submitted' || task.status === 'active'
  });
});

// 保存草稿
app.post(`${API}/filler/save-draft`, authenticateToken, (req, res) => {
  const { assignment_id, data } = req.body;
  const user = req.user;
  const userInfo = getCurrentUser(user.id);

  // 验证权限
  const assignment = db.prepare('SELECT * FROM task_assignments WHERE id = ?').get(assignment_id);
  if (!assignment) {
    return resError(res, '任务不存在');
  }
  if (user.role === 'filler' && assignment.unit_id !== userInfo.unit_id) {
    return resError(res, '无权操作');
  }

  // 更新分配状态
  db.prepare(`UPDATE task_assignments SET status = 'filling' WHERE id = ?`).run(assignment_id);

  // upsert草稿
  const existing = db.prepare('SELECT id FROM form_submissions WHERE assignment_id = ?').get(assignment_id);
  if (existing) {
    db.prepare(`
      UPDATE form_submissions SET data_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE assignment_id = ?
    `).run(JSON.stringify(data), assignment_id);
  } else {
    db.prepare(`
      INSERT INTO form_submissions (assignment_id, data_json, status)
      VALUES (?, ?, 'draft')
    `).run(assignment_id, JSON.stringify(data));
  }

  addAuditLog(user.id, '暂存草稿', `暂存任务分配ID: ${assignment_id}`, req.ip);
  resSuccess(res, { message: '草稿保存成功' });
});

// 提交表单
app.post(`${API}/filler/submit`, authenticateToken, (req, res) => {
  const { assignment_id, data } = req.body;
  const user = req.user;
  const userInfo = getCurrentUser(user.id);

  // 验证权限
  const assignment = db.prepare('SELECT * FROM task_assignments WHERE id = ?').get(assignment_id);
  if (!assignment) {
    return resError(res, '任务不存在');
  }
  if (user.role === 'filler' && assignment.unit_id !== userInfo.unit_id) {
    return resError(res, '无权操作');
  }

  // 获取表单模板验证必填
  const task = db.prepare(`
    SELECT ct.form_id FROM task_assignments ta
    JOIN collection_tasks ct ON ta.task_id = ct.id
    WHERE ta.id = ?
  `).get(assignment_id);

  const template = db.prepare('SELECT fields_json FROM form_templates WHERE id = ?').get(task.form_id);
  const fields = JSON.parse(template.fields_json || '[]');

  // 验证必填字段
  const errors = [];
  for (const field of fields) {
    if (field.required) {
      const value = data[field.id];
      if (!value || (typeof value === 'string' && value.trim() === '') || value === null) {
        errors.push(field.label);
      }
    }
  }
  if (errors.length > 0) {
    return resError(res, `请填写以下必填字段: ${errors.join('、')}`);
  }

  // 保存或更新提交
  const existing = db.prepare('SELECT id FROM form_submissions WHERE assignment_id = ?').get(assignment_id);
  if (existing) {
    db.prepare(`
      UPDATE form_submissions SET data_json = ?, status = 'submitted', 
        submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE assignment_id = ?
    `).run(JSON.stringify(data), assignment_id);
  } else {
    db.prepare(`
      INSERT INTO form_submissions (assignment_id, data_json, status, submitted_at)
      VALUES (?, ?, 'submitted', CURRENT_TIMESTAMP)
    `).run(assignment_id, JSON.stringify(data));
  }

  // 更新分配状态
  db.prepare(`
    UPDATE task_assignments SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, 
      submitter_id = ? WHERE id = ?
  `).run(userInfo.id, assignment_id);

  addAuditLog(user.id, '提交表单', `提交任务分配ID: ${assignment_id}`, req.ip);
  resSuccess(res, { message: '提交成功' });
});

// ==================== 表单模板 ====================

app.get(`${API}/templates`, authenticateToken, (req, res) => {
  const templates = db.prepare(`
    SELECT ft.*, u.real_name as creator_name
    FROM form_templates ft
    LEFT JOIN users u ON ft.creator_id = u.id
    ORDER BY ft.created_at DESC
  `).all();
  resSuccess(res, templates.map(t => ({ ...t, fields_json: JSON.parse(t.fields_json || '[]') })));
});

app.get(`${API}/templates/:id`, authenticateToken, (req, res) => {
  const template = db.prepare(`
    SELECT ft.*, u.real_name as creator_name
    FROM form_templates ft
    LEFT JOIN users u ON ft.creator_id = u.id
    WHERE ft.id = ?
  `).get(req.params.id);
  if (template) {
    template.fields_json = JSON.parse(template.fields_json || '[]');
    resSuccess(res, template);
  } else {
    resError(res, '模板不存在', 404);
  }
});

app.post(`${API}/templates`, authenticateToken, requireRole('admin', 'finance'), (req, res) => {
  const { name, description, fields, is_fixed } = req.body;
  if (!name || !fields) {
    return resError(res, '请填写表单名称和字段');
  }
  const result = db.prepare(`
    INSERT INTO form_templates (name, description, fields_json, creator_id, is_fixed)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, description || '', JSON.stringify(fields), req.user.id, is_fixed ? 1 : 0);
  addAuditLog(req.user.id, '创建表单', `创建表单模板: ${name}`, req.ip);
  resSuccess(res, { id: result.lastInsertRowid, message: '创建成功' });
});

app.put(`${API}/templates/:id`, authenticateToken, requireRole('admin', 'finance'), (req, res) => {
  const { name, description, fields } = req.body;
  db.prepare(`
    UPDATE form_templates SET name = ?, description = ?, fields_json = ?
    WHERE id = ?
  `).run(name, description || '', JSON.stringify(fields), req.params.id);
  addAuditLog(req.user.id, '更新表单', `更新表单模板: ${name}`, req.ip);
  resSuccess(res, { message: '更新成功' });
});

app.delete(`${API}/templates/:id`, authenticateToken, requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM form_templates WHERE id = ?').run(req.params.id);
  addAuditLog(req.user.id, '删除表单', `删除表单模板ID: ${req.params.id}`, req.ip);
  resSuccess(res, { message: '删除成功' });
});

// ==================== 收集任务 ====================

app.get(`${API}/tasks`, authenticateToken, (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT ct.*, ft.name as form_name, u.real_name as creator_name,
      (SELECT COUNT(*) FROM task_assignments WHERE task_id = ct.id) as total_assignments,
      (SELECT COUNT(*) FROM task_assignments WHERE task_id = ct.id AND status = 'submitted') as submitted_count,
      (SELECT COUNT(*) FROM task_assignments WHERE task_id = ct.id AND status = 'filling') as filling_count
    FROM collection_tasks ct
    LEFT JOIN form_templates ft ON ct.form_id = ft.id
    LEFT JOIN users u ON ct.creator_id = u.id
  `;
  if (status && status !== 'all') {
    sql += ` WHERE ct.status = '${status}'`;
  }
  sql += ' ORDER BY ct.created_at DESC';
  resSuccess(res, db.all(sql));
});

app.get(`${API}/tasks/:id`, authenticateToken, (req, res) => {
  const task = db.prepare(`
    SELECT ct.*, ft.name as form_name, ft.fields_json, u.real_name as creator_name
    FROM collection_tasks ct
    LEFT JOIN form_templates ft ON ct.form_id = ft.id
    LEFT JOIN users u ON ct.creator_id = u.id
    WHERE ct.id = ?
  `).get(req.params.id);
  if (task) {
    task.fields_json = JSON.parse(task.fields_json || '[]');
    task.assignments = db.prepare(`
      SELECT ta.*, un.name as unit_name, un.level
      FROM task_assignments ta
      LEFT JOIN units un ON ta.unit_id = un.id
      WHERE ta.task_id = ?
      ORDER BY un.level, un.sort_order
    `).all(req.params.id);
    resSuccess(res, task);
  } else {
    resError(res, '任务不存在', 404);
  }
});

app.post(`${API}/tasks`, authenticateToken, requireRole('admin', 'finance'), (req, res) => {
  const { form_id, title, deadline, unit_ids } = req.body;
  if (!form_id || !title) {
    return resError(res, '请填写任务信息');
  }
  const result = db.prepare(`
    INSERT INTO collection_tasks (form_id, title, status, deadline, creator_id)
    VALUES (?, ?, 'active', ?, ?)
  `).run(form_id, title, deadline || null, req.user.id);
  const taskId = result.lastInsertRowid;

  if (unit_ids && unit_ids.length > 0) {
    const insertAssign = db.prepare(`INSERT INTO task_assignments (task_id, unit_id, status) VALUES (?, ?, 'pending')`);
    for (const unitId of unit_ids) {
      insertAssign.run(taskId, unitId);
    }
  }
  addAuditLog(req.user.id, '发布任务', `发布收集任务: ${title}`, req.ip);
  resSuccess(res, { id: taskId, message: '任务创建成功' });
});

app.put(`${API}/tasks/:id/status`, authenticateToken, requireRole('admin', 'finance'), (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE collection_tasks SET status = ? WHERE id = ?').run(status, req.params.id);
  addAuditLog(req.user.id, '更新任务', `更新任务ID ${req.params.id} 状态为 ${status}`, req.ip);
  resSuccess(res, { message: '状态更新成功' });
});

app.delete(`${API}/tasks/:id`, authenticateToken, requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM task_assignments WHERE task_id = ?').run(req.params.id);
  db.prepare('DELETE FROM collection_tasks WHERE id = ?').run(req.params.id);
  addAuditLog(req.user.id, '删除任务', `删除任务ID: ${req.params.id}`, req.ip);
  resSuccess(res, { message: '删除成功' });
});

// ==================== 汇总分析 ====================

app.get(`${API}/analysis/tasks/:id`, authenticateToken, requireRole('admin', 'finance'), (req, res) => {
  const task = db.prepare(`
    SELECT ct.*, ft.name as form_name, ft.fields_json
    FROM collection_tasks ct
    LEFT JOIN form_templates ft ON ct.form_id = ft.id
    WHERE ct.id = ?
  `).get(req.params.id);
  if (!task) return resError(res, '任务不存在', 404);

  task.fields_json = JSON.parse(task.fields_json || '[]');
  const assignments = db.prepare(`
    SELECT ta.*, un.name as unit_name, un.level, un.parent_id,
      u.real_name as submitter_name, fs.data_json
    FROM task_assignments ta
    LEFT JOIN units un ON ta.unit_id = un.id
    LEFT JOIN users u ON ta.submitter_id = u.id
    LEFT JOIN form_submissions fs ON ta.id = fs.assignment_id
    WHERE ta.task_id = ?
    ORDER BY un.level, un.sort_order
  `).all(req.params.id);

  resSuccess(res, {
    task,
    assignments: assignments.map(a => ({ ...a, data_json: a.data_json ? JSON.parse(a.data_json) : null }))
  });
});

app.post(`${API}/analysis/remind/:assignmentId`, authenticateToken, requireRole('admin', 'finance'), (req, res) => {
  const assignment = db.prepare('SELECT * FROM task_assignments WHERE id = ?').get(req.params.assignmentId);
  if (!assignment) return resError(res, '分配不存在');
  db.prepare(`UPDATE task_assignments SET reminder_count = reminder_count + 1, last_reminder_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.assignmentId);
  addAuditLog(req.user.id, '催办提醒', `催办任务分配ID: ${req.params.assignmentId}`, req.ip);
  resSuccess(res, { message: '催办成功' });
});

// 批量催办
app.post(`${API}/analysis/remind-batch`, authenticateToken, requireRole('admin', 'finance'), (req, res) => {
  const { task_id } = req.body;
  db.prepare(`UPDATE task_assignments SET reminder_count = reminder_count + 1, last_reminder_at = CURRENT_TIMESTAMP WHERE task_id = ? AND status != 'submitted'`).run(task_id);
  addAuditLog(req.user.id, '批量催办', `催办任务ID: ${task_id}下所有未提交单位`, req.ip);
  resSuccess(res, { message: '批量催办成功' });
});

app.get(`${API}/analysis/export/:taskId`, authenticateToken, requireRole('admin', 'finance'), (req, res) => {
  const task = db.prepare(`
    SELECT ct.*, ft.name as form_name, ft.fields_json
    FROM collection_tasks ct
    LEFT JOIN form_templates ft ON ct.form_id = ft.id
    WHERE ct.id = ?
  `).get(req.params.taskId);
  if (!task) return resError(res, '任务不存在', 404);

  const fields = JSON.parse(task.fields_json || '[]');
  const assignments = db.prepare(`
    SELECT ta.*, un.name as unit_name, fs.data_json
    FROM task_assignments ta
    LEFT JOIN units un ON ta.unit_id = un.id
    LEFT JOIN form_submissions fs ON ta.id = fs.assignment_id
    WHERE ta.task_id = ?
    ORDER BY un.level, un.sort_order
  `).all(req.params.taskId);

  let csv = '\uFEFF';
  const headers = ['单位名称', '状态', '提交时间', ...fields.map(f => f.label)];
  csv += headers.join(',') + '\n';

  for (const a of assignments) {
    const data = JSON.parse(a.data_json || '{}');
    const row = [a.unit_name, a.status === 'submitted' ? '已提交' : (a.status === 'filling' ? '填写中' : '未填报'), a.submitted_at || ''];
    for (const f of fields) {
      let val = data[f.id] || '';
      if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
        val = '"' + val.replace(/"/g, '""') + '"';
      }
      row.push(val);
    }
    csv += row.join(',') + '\n';
  }

  res.setHeader('Content-Type', 'text/csv;charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${task.title}_汇总.csv"`);
  res.send(csv);
});

// ==================== 审计日志 ====================

app.get(`${API}/audit`, authenticateToken, requireRole('admin', 'finance'), (req, res) => {
  const { start_date, end_date, action, page = 1, pageSize = 20 } = req.query;
  let sql = `SELECT al.*, u.real_name as user_name, u.username FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id WHERE 1=1`;
  const params = [];

  if (start_date) { sql += ` AND al.created_at >= ?`; params.push(start_date); }
  if (end_date) { sql += ` AND al.created_at <= ?`; params.push(end_date + ' 23:59:59'); }
  if (action) { sql += ` AND al.action = ?`; params.push(action); }
  sql += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));

  const logs = db.prepare(sql).all(...params);
  const countSql = `SELECT COUNT(*) as count FROM audit_logs al WHERE 1=1` +
    (start_date ? ` AND al.created_at >= '${start_date}'` : '') +
    (end_date ? ` AND al.created_at <= '${end_date} 23:59:59'` : '') +
    (action ? ` AND al.action = '${action}'` : '');
  const total = db.prepare(countSql).get();

  resSuccess(res, { logs, total: total.count, page: parseInt(page), pageSize: parseInt(pageSize) });
});

// ==================== 组织架构 ====================

app.get(`${API}/units`, authenticateToken, (req, res) => {
  const units = db.prepare('SELECT * FROM units ORDER BY level, sort_order').all();
  const map = {};
  const roots = [];
  units.forEach(u => { map[u.id] = { ...u, children: [] }; });
  units.forEach(u => {
    if (u.parent_id && map[u.parent_id]) {
      map[u.parent_id].children.push(map[u.id]);
    } else {
      roots.push(map[u.id]);
    }
  });
  resSuccess(res, { units, tree: roots });
});

app.get(`${API}/units/flat`, authenticateToken, (req, res) => {
  resSuccess(res, db.prepare('SELECT * FROM units ORDER BY level, sort_order').all());
});

app.post(`${API}/units`, authenticateToken, requireRole('admin'), (req, res) => {
  const { name, parent_id, level } = req.body;
  if (!name) return resError(res, '请输入单位名称');
  const maxOrder = db.prepare(`SELECT MAX(sort_order) as max_order FROM units WHERE parent_id IS ? AND level = ?`).get(parent_id || null, level || 1);
  const result = db.prepare(`INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?)`).run(name, parent_id || null, level || 1, (maxOrder.max_order || 0) + 1);
  addAuditLog(req.user.id, '创建单位', `创建单位: ${name}`, req.ip);
  resSuccess(res, { id: result.lastInsertRowid, message: '创建成功' });
});

app.put(`${API}/units/:id`, authenticateToken, requireRole('admin'), (req, res) => {
  const { name } = req.body;
  db.prepare('UPDATE units SET name = ? WHERE id = ?').run(name, req.params.id);
  addAuditLog(req.user.id, '更新单位', `更新单位ID: ${req.params.id}`, req.ip);
  resSuccess(res, { message: '更新成功' });
});

app.delete(`${API}/units/:id`, authenticateToken, requireRole('admin'), (req, res) => {
  const children = db.prepare('SELECT COUNT(*) as count FROM units WHERE parent_id = ?').get(req.params.id);
  if (children.count > 0) return resError(res, '请先删除子单位');
  const users = db.prepare('SELECT COUNT(*) as count FROM users WHERE unit_id = ?').get(req.params.id);
  if (users.count > 0) return resError(res, '该单位下有用户，无法删除');
  db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id);
  addAuditLog(req.user.id, '删除单位', `删除单位ID: ${req.params.id}`, req.ip);
  resSuccess(res, { message: '删除成功' });
});

// ==================== 用户管理 ====================

app.get(`${API}/users`, authenticateToken, requireRole('admin'), (req, res) => {
  resSuccess(res, db.prepare(`
    SELECT u.id, u.username, u.real_name, u.role, u.unit_id, u.created_at, un.name as unit_name
    FROM users u LEFT JOIN units un ON u.unit_id = un.id ORDER BY u.created_at DESC
  `).all());
});

app.post(`${API}/users`, authenticateToken, requireRole('admin'), (req, res) => {
  const { username, password, real_name, role, unit_id } = req.body;
  if (!username || !password || !real_name || !role) return resError(res, '请填写完整信息');
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return resError(res, '用户名已存在');
  const hash = require('bcryptjs').hashSync(password, 10);
  const result = db.prepare(`INSERT INTO users (username, password_hash, real_name, role, unit_id) VALUES (?, ?, ?, ?, ?)`).run(username, hash, real_name, role, unit_id || null);
  addAuditLog(req.user.id, '创建用户', `创建用户: ${username}`, req.ip);
  resSuccess(res, { id: result.lastInsertRowid, message: '创建成功' });
});

app.put(`${API}/users/:id`, authenticateToken, requireRole('admin'), (req, res) => {
  const { real_name, role, unit_id, password } = req.body;
  if (password) {
    const hash = require('bcryptjs').hashSync(password, 10);
    db.prepare(`UPDATE users SET real_name = ?, role = ?, unit_id = ?, password_hash = ? WHERE id = ?`).run(real_name, role, unit_id || null, hash, req.params.id);
  } else {
    db.prepare(`UPDATE users SET real_name = ?, role = ?, unit_id = ? WHERE id = ?`).run(real_name, role, unit_id || null, req.params.id);
  }
  addAuditLog(req.user.id, '更新用户', `更新用户ID: ${req.params.id}`, req.ip);
  resSuccess(res, { message: '更新成功' });
});

app.delete(`${API}/users/:id`, authenticateToken, requireRole('admin'), (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return resError(res, '不能删除自己');
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  addAuditLog(req.user.id, '删除用户', `删除用户ID: ${req.params.id}`, req.ip);
  resSuccess(res, { message: '删除成功' });
});

// ==================== 系统统计 ====================

app.get(`${API}/stats`, authenticateToken, (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
    units: db.prepare('SELECT COUNT(*) as count FROM units').get().count,
    templates: db.prepare('SELECT COUNT(*) as count FROM form_templates').get().count,
    tasks: db.prepare('SELECT COUNT(*) as count FROM collection_tasks').get().count,
    submissions: db.prepare('SELECT COUNT(*) as count FROM form_submissions WHERE status = ?').get('submitted').count
  };
  resSuccess(res, stats);
});

// 消息通知（催办提醒）
app.get(`${API}/notifications`, authenticateToken, (req, res) => {
  const user = req.user;
  const userInfo = getCurrentUser(user.id);
  const notifications = [];

  // 获取本单位的催办提醒
  const reminders = db.prepare(`
    SELECT ta.reminder_count, ta.last_reminder_at, ct.title, un.name as unit_name
    FROM task_assignments ta
    JOIN collection_tasks ct ON ta.task_id = ct.id
    JOIN units un ON ta.unit_id = un.id
    WHERE ta.unit_id = ? AND ta.reminder_count > 0
    ORDER BY ta.last_reminder_at DESC
  `).all(userInfo.unit_id);

  for (const r of reminders) {
    if (r.last_reminder_at) {
      const daysAgo = Math.floor((new Date() - new Date(r.last_reminder_at)) / (1000 * 60 * 60 * 24));
      notifications.push({
        type: 'reminder',
        title: '催办提醒',
        message: `您有一项任务被催办 ${r.reminder_count} 次: ${r.title}`,
        time: r.last_reminder_at,
        daysAgo
      });
    }
  }

  // 临近截止的任务
  const upcomingTasks = db.prepare(`
    SELECT ct.title, ct.deadline
    FROM collection_tasks ct
    JOIN task_assignments ta ON ct.id = ta.task_id
    WHERE ta.unit_id = ? AND ct.status = 'active' AND ta.status != 'submitted'
    AND ct.deadline IS NOT NULL
    AND ct.deadline <= datetime('now', '+3 days')
  `).all(userInfo.unit_id);

  for (const t of upcomingTasks) {
    const daysLeft = Math.ceil((new Date(t.deadline) - new Date()) / (1000 * 60 * 60 * 24));
    notifications.push({
      type: 'deadline',
      title: daysLeft <= 0 ? '已过期' : '临近截止',
      message: `任务 "${t.title}" ${daysLeft <= 0 ? '已过期' : `还剩 ${daysLeft} 天`}`,
      time: t.deadline,
      daysLeft
    });
  }

  resSuccess(res, notifications.slice(0, 10));
});

// 捕获所有其他请求，返回index.html（SPA）
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`财务表单收集系统已启动: http://localhost:${PORT}`);
  console.log(`默认管理员: admin / admin123`);
  console.log(`经办人账号: filler / filler123`);
});
