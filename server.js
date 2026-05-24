const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { client, initDB, addAuditLog } = require('./db');
const { authenticateToken, requireRole, login, getCurrentUser } = require('./auth');

const app = express();

// 中间件
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 初始化数据库（首次请求时）
let dbInitialized = false;
async function ensureDB() {
  if (!dbInitialized) {
    await initDB();
    dbInitialized = true;
  }
}

// 中间件：确保数据库已初始化
app.use(async (req, res, next) => {
  await ensureDB();
  next();
});

// API路由前缀
const API = '/api';

// 通用响应包装
function resSuccess(res, data) {
  res.json({ success: true, data });
}

function resError(res, message, status = 400) {
  res.status(status).json({ success: false, error: message });
}

// ==================== 认证相关 ====================

app.post(`${API}/auth/login`, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return resError(res, '请输入用户名和密码');
    }
    const result = await login(username, password, req.ip);
    if (result.success) {
      resSuccess(res, result);
    } else {
      resError(res, result.message, 401);
    }
  } catch (err) {
    console.error(err);
    resError(res, '登录失败', 500);
  }
});

app.get(`${API}/auth/me`, authenticateToken, async (req, res) => {
  try {
    const user = await getCurrentUser(req.user.id);
    if (user) {
      const { password_hash, ...userInfo } = user;
      resSuccess(res, userInfo);
    } else {
      resError(res, '用户不存在', 404);
    }
  } catch (err) {
    console.error(err);
    resError(res, '获取用户信息失败', 500);
  }
});

app.post(`${API}/auth/logout`, authenticateToken, async (req, res) => {
  await addAuditLog(req.user.id, '登出', `用户 ${req.user.realName} 退出系统`, req.ip);
  resSuccess(res, { message: '登出成功' });
});

// ==================== 工作台/仪表盘 ====================

app.get(`${API}/dashboard`, authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    let data = {};

    if (user.role === 'admin' || user.role === 'finance') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const activeResult = await client.execute({
        sql: `SELECT COUNT(*) as count FROM collection_tasks WHERE status = 'active' AND created_at >= ?`,
        args: [weekAgo.toISOString()]
      });
      data.activeTasks = activeResult.rows[0].count;

      const unitsResult = await client.execute('SELECT COUNT(*) as count FROM units');
      data.unitCount = unitsResult.rows[0].count;

      const statsResult = await client.execute(`
        SELECT 
          SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
          COUNT(*) as total
        FROM task_assignments
      `);
      const stats = statsResult.rows[0];
      data.submitRate = stats.total > 0 ? Math.round((stats.submitted / stats.total) * 100) : 0;

      const pendingResult = await client.execute(`SELECT COUNT(*) as count FROM task_assignments WHERE status != 'submitted'`);
      data.pendingCount = pendingResult.rows[0].count;

      const templatesResult = await client.execute('SELECT COUNT(*) as count FROM form_templates');
      data.templateCount = templatesResult.rows[0].count;

      const tasksResult = await client.execute(`
        SELECT ct.*, ft.name as form_name, u.real_name as creator_name,
          (SELECT COUNT(*) FROM task_assignments WHERE task_id = ct.id) as total_assignments,
          (SELECT COUNT(*) FROM task_assignments WHERE task_id = ct.id AND status = 'submitted') as submitted_count
        FROM collection_tasks ct
        LEFT JOIN form_templates ft ON ct.form_id = ft.id
        LEFT JOIN users u ON ct.creator_id = u.id
        ORDER BY ct.created_at DESC
        LIMIT 10
      `);
      data.tasks = tasksResult.rows;
    } else {
      const userInfo = await getCurrentUser(user.id);
      const tasksResult = await client.execute({
        sql: `SELECT ct.*, ft.name as form_name, ta.status as my_status, ta.id as assignment_id
          FROM collection_tasks ct
          LEFT JOIN form_templates ft ON ct.form_id = ft.id
          LEFT JOIN task_assignments ta ON ct.id = ta.task_id AND ta.unit_id = ?
          WHERE ct.status = 'active'
          ORDER BY ct.deadline ASC`,
        args: [userInfo.unit_id]
      });
      data.tasks = tasksResult.rows;
    }

    resSuccess(res, data);
  } catch (err) {
    console.error(err);
    resError(res, '获取仪表盘数据失败', 500);
  }
});

// ==================== 经办人专用接口 ====================

app.get(`${API}/filler/todos`, authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'filler') {
      return resError(res, '非经办人账号', 403);
    }

    const userInfo = await getCurrentUser(user.id);

    const pendingResult = await client.execute({
      sql: `SELECT ct.id as task_id, ct.title, ct.deadline, ct.status as task_status, 
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
        ct.deadline ASC`,
      args: [userInfo.unit_id]
    });

    const submittedResult = await client.execute({
      sql: `SELECT ct.id as task_id, ct.title, ct.deadline, 
        ft.name as form_name,
        ta.id as assignment_id, ta.submitted_at,
        fs.data_json as saved_data
      FROM collection_tasks ct
      INNER JOIN task_assignments ta ON ct.id = ta.task_id AND ta.unit_id = ?
      INNER JOIN form_templates ft ON ct.form_id = ft.id
      INNER JOIN form_submissions fs ON ta.id = fs.assignment_id AND fs.status = 'submitted'
      ORDER BY ta.submitted_at DESC
      LIMIT 20`,
      args: [userInfo.unit_id]
    });

    const pendingTasks = pendingResult.rows;
    const submittedRecords = submittedResult.rows;

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
  } catch (err) {
    console.error(err);
    resError(res, '获取待办失败', 500);
  }
});

app.get(`${API}/filler/task/:assignmentId`, authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { assignmentId } = req.params;
    const userInfo = await getCurrentUser(user.id);

    const result = await client.execute({
      sql: `SELECT ct.*, ft.name as form_name, ft.description as form_desc, ft.fields_json,
        ta.id as assignment_id, ta.status as my_status, ta.unit_id,
        fs.data_json as saved_data, fs.status as submission_status, fs.submitted_at,
        u.real_name as creator_name
      FROM collection_tasks ct
      INNER JOIN task_assignments ta ON ct.id = ta.task_id AND ta.id = ?
      INNER JOIN form_templates ft ON ct.form_id = ft.id
      LEFT JOIN form_submissions fs ON ta.id = fs.assignment_id
      LEFT JOIN users u ON ct.creator_id = u.id`,
      args: [assignmentId]
    });
    const task = result.rows[0];

    if (!task) {
      return resError(res, '任务不存在', 404);
    }

    if (user.role === 'filler' && task.unit_id !== userInfo.unit_id) {
      return resError(res, '无权访问此任务', 403);
    }

    const fields = JSON.parse(task.fields_json || '[]');
    const savedData = task.saved_data ? JSON.parse(task.saved_data) : {};

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
  } catch (err) {
    console.error(err);
    resError(res, '获取任务详情失败', 500);
  }
});

app.post(`${API}/filler/save-draft`, authenticateToken, async (req, res) => {
  try {
    const { assignment_id, data } = req.body;
    const user = req.user;
    const userInfo = await getCurrentUser(user.id);

    const assignResult = await client.execute({
      sql: 'SELECT * FROM task_assignments WHERE id = ?',
      args: [assignment_id]
    });
    const assignment = assignResult.rows[0];
    if (!assignment) {
      return resError(res, '任务不存在');
    }
    if (user.role === 'filler' && assignment.unit_id !== userInfo.unit_id) {
      return resError(res, '无权操作');
    }

    await client.execute({
      sql: "UPDATE task_assignments SET status = 'filling' WHERE id = ?",
      args: [assignment_id]
    });

    const existingResult = await client.execute({
      sql: 'SELECT id FROM form_submissions WHERE assignment_id = ?',
      args: [assignment_id]
    });

    if (existingResult.rows.length > 0) {
      await client.execute({
        sql: 'UPDATE form_submissions SET data_json = ?, updated_at = CURRENT_TIMESTAMP WHERE assignment_id = ?',
        args: [JSON.stringify(data), assignment_id]
      });
    } else {
      await client.execute({
        sql: "INSERT INTO form_submissions (assignment_id, data_json, status) VALUES (?, ?, 'draft')",
        args: [assignment_id, JSON.stringify(data)]
      });
    }

    await addAuditLog(user.id, '暂存草稿', `暂存任务分配ID: ${assignment_id}`, req.ip);
    resSuccess(res, { message: '草稿保存成功' });
  } catch (err) {
    console.error(err);
    resError(res, '保存草稿失败', 500);
  }
});

app.post(`${API}/filler/submit`, authenticateToken, async (req, res) => {
  try {
    const { assignment_id, data } = req.body;
    const user = req.user;
    const userInfo = await getCurrentUser(user.id);

    const assignResult = await client.execute({
      sql: 'SELECT * FROM task_assignments WHERE id = ?',
      args: [assignment_id]
    });
    const assignment = assignResult.rows[0];
    if (!assignment) {
      return resError(res, '任务不存在');
    }
    if (user.role === 'filler' && assignment.unit_id !== userInfo.unit_id) {
      return resError(res, '无权操作');
    }

    const taskResult = await client.execute({
      sql: `SELECT ct.form_id FROM task_assignments ta
        JOIN collection_tasks ct ON ta.task_id = ct.id
        WHERE ta.id = ?`,
      args: [assignment_id]
    });
    const task = taskResult.rows[0];

    const templateResult = await client.execute({
      sql: 'SELECT fields_json FROM form_templates WHERE id = ?',
      args: [task.form_id]
    });
    const template = templateResult.rows[0];
    const fields = JSON.parse(template.fields_json || '[]');

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

    const existingResult = await client.execute({
      sql: 'SELECT id FROM form_submissions WHERE assignment_id = ?',
      args: [assignment_id]
    });

    if (existingResult.rows.length > 0) {
      await client.execute({
        sql: `UPDATE form_submissions SET data_json = ?, status = 'submitted', 
          submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE assignment_id = ?`,
        args: [JSON.stringify(data), assignment_id]
      });
    } else {
      await client.execute({
        sql: `INSERT INTO form_submissions (assignment_id, data_json, status, submitted_at)
          VALUES (?, ?, 'submitted', CURRENT_TIMESTAMP)`,
        args: [assignment_id, JSON.stringify(data)]
      });
    }

    await client.execute({
      sql: `UPDATE task_assignments SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, 
        submitter_id = ? WHERE id = ?`,
      args: [userInfo.id, assignment_id]
    });

    await addAuditLog(user.id, '提交表单', `提交任务分配ID: ${assignment_id}`, req.ip);
    resSuccess(res, { message: '提交成功' });
  } catch (err) {
    console.error(err);
    resError(res, '提交失败', 500);
  }
});

// ==================== 表单模板 ====================

app.get(`${API}/templates`, authenticateToken, async (req, res) => {
  try {
    const result = await client.execute(`
      SELECT ft.*, u.real_name as creator_name
      FROM form_templates ft
      LEFT JOIN users u ON ft.creator_id = u.id
      ORDER BY ft.created_at DESC
    `);
    resSuccess(res, result.rows.map(t => ({ ...t, fields_json: JSON.parse(t.fields_json || '[]') })));
  } catch (err) {
    console.error(err);
    resError(res, '获取模板列表失败', 500);
  }
});

app.get(`${API}/templates/:id`, authenticateToken, async (req, res) => {
  try {
    const result = await client.execute({
      sql: `SELECT ft.*, u.real_name as creator_name
        FROM form_templates ft
        LEFT JOIN users u ON ft.creator_id = u.id
        WHERE ft.id = ?`,
      args: [req.params.id]
    });
    const template = result.rows[0];
    if (template) {
      template.fields_json = JSON.parse(template.fields_json || '[]');
      resSuccess(res, template);
    } else {
      resError(res, '模板不存在', 404);
    }
  } catch (err) {
    console.error(err);
    resError(res, '获取模板失败', 500);
  }
});

app.post(`${API}/templates`, authenticateToken, requireRole('admin', 'finance'), async (req, res) => {
  try {
    const { name, description, fields, is_fixed } = req.body;
    if (!name || !fields) {
      return resError(res, '请填写表单名称和字段');
    }
    const result = await client.execute({
      sql: `INSERT INTO form_templates (name, description, fields_json, creator_id, is_fixed)
        VALUES (?, ?, ?, ?, ?) RETURNING id`,
      args: [name, description || '', JSON.stringify(fields), req.user.id, is_fixed ? 1 : 0]
    });
    await addAuditLog(req.user.id, '创建表单', `创建表单模板: ${name}`, req.ip);
    resSuccess(res, { id: result.rows[0].id, message: '创建成功' });
  } catch (err) {
    console.error(err);
    resError(res, '创建模板失败', 500);
  }
});

app.put(`${API}/templates/:id`, authenticateToken, requireRole('admin', 'finance'), async (req, res) => {
  try {
    const { name, description, fields } = req.body;
    await client.execute({
      sql: 'UPDATE form_templates SET name = ?, description = ?, fields_json = ? WHERE id = ?',
      args: [name, description || '', JSON.stringify(fields), req.params.id]
    });
    await addAuditLog(req.user.id, '更新表单', `更新表单模板: ${name}`, req.ip);
    resSuccess(res, { message: '更新成功' });
  } catch (err) {
    console.error(err);
    resError(res, '更新模板失败', 500);
  }
});

app.delete(`${API}/templates/:id`, authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await client.execute({
      sql: 'DELETE FROM form_templates WHERE id = ?',
      args: [req.params.id]
    });
    await addAuditLog(req.user.id, '删除表单', `删除表单模板ID: ${req.params.id}`, req.ip);
    resSuccess(res, { message: '删除成功' });
  } catch (err) {
    console.error(err);
    resError(res, '删除模板失败', 500);
  }
});

// ==================== 收集任务 ====================

app.get(`${API}/tasks`, authenticateToken, async (req, res) => {
  try {
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
    const args = [];
    if (status && status !== 'all') {
      sql += ` WHERE ct.status = ?`;
      args.push(status);
    }
    sql += ' ORDER BY ct.created_at DESC';
    const result = await client.execute({ sql, args });
    resSuccess(res, result.rows);
  } catch (err) {
    console.error(err);
    resError(res, '获取任务列表失败', 500);
  }
});

app.get(`${API}/tasks/:id`, authenticateToken, async (req, res) => {
  try {
    const taskResult = await client.execute({
      sql: `SELECT ct.*, ft.name as form_name, ft.fields_json, u.real_name as creator_name
        FROM collection_tasks ct
        LEFT JOIN form_templates ft ON ct.form_id = ft.id
        LEFT JOIN users u ON ct.creator_id = u.id
        WHERE ct.id = ?`,
      args: [req.params.id]
    });
    const task = taskResult.rows[0];
    if (task) {
      task.fields_json = JSON.parse(task.fields_json || '[]');
      const assignResult = await client.execute({
        sql: `SELECT ta.*, un.name as unit_name, un.level
          FROM task_assignments ta
          LEFT JOIN units un ON ta.unit_id = un.id
          WHERE ta.task_id = ?
          ORDER BY un.level, un.sort_order`,
        args: [req.params.id]
      });
      task.assignments = assignResult.rows;
      resSuccess(res, task);
    } else {
      resError(res, '任务不存在', 404);
    }
  } catch (err) {
    console.error(err);
    resError(res, '获取任务详情失败', 500);
  }
});

app.post(`${API}/tasks`, authenticateToken, requireRole('admin', 'finance'), async (req, res) => {
  try {
    const { form_id, title, deadline, unit_ids } = req.body;
    if (!form_id || !title) {
      return resError(res, '请填写任务信息');
    }
    const taskResult = await client.execute({
      sql: `INSERT INTO collection_tasks (form_id, title, status, deadline, creator_id)
        VALUES (?, ?, 'active', ?, ?) RETURNING id`,
      args: [form_id, title, deadline || null, req.user.id]
    });
    const taskId = taskResult.rows[0].id;

    if (unit_ids && unit_ids.length > 0) {
      for (const unitId of unit_ids) {
        await client.execute({
          sql: "INSERT INTO task_assignments (task_id, unit_id, status) VALUES (?, ?, 'pending')",
          args: [taskId, unitId]
        });
      }
    }
    await addAuditLog(req.user.id, '发布任务', `发布收集任务: ${title}`, req.ip);
    resSuccess(res, { id: taskId, message: '任务创建成功' });
  } catch (err) {
    console.error(err);
    resError(res, '创建任务失败', 500);
  }
});

app.put(`${API}/tasks/:id/status`, authenticateToken, requireRole('admin', 'finance'), async (req, res) => {
  try {
    const { status } = req.body;
    await client.execute({
      sql: 'UPDATE collection_tasks SET status = ? WHERE id = ?',
      args: [status, req.params.id]
    });
    await addAuditLog(req.user.id, '更新任务', `更新任务ID ${req.params.id} 状态为 ${status}`, req.ip);
    resSuccess(res, { message: '状态更新成功' });
  } catch (err) {
    console.error(err);
    resError(res, '更新状态失败', 500);
  }
});

app.delete(`${API}/tasks/:id`, authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await client.execute({
      sql: 'DELETE FROM task_assignments WHERE task_id = ?',
      args: [req.params.id]
    });
    await client.execute({
      sql: 'DELETE FROM collection_tasks WHERE id = ?',
      args: [req.params.id]
    });
    await addAuditLog(req.user.id, '删除任务', `删除任务ID: ${req.params.id}`, req.ip);
    resSuccess(res, { message: '删除成功' });
  } catch (err) {
    console.error(err);
    resError(res, '删除任务失败', 500);
  }
});

// ==================== 汇总分析 ====================

app.get(`${API}/analysis/tasks/:id`, authenticateToken, requireRole('admin', 'finance'), async (req, res) => {
  try {
    const taskResult = await client.execute({
      sql: `SELECT ct.*, ft.name as form_name, ft.fields_json
        FROM collection_tasks ct
        LEFT JOIN form_templates ft ON ct.form_id = ft.id
        WHERE ct.id = ?`,
      args: [req.params.id]
    });
    const task = taskResult.rows[0];
    if (!task) return resError(res, '任务不存在', 404);

    task.fields_json = JSON.parse(task.fields_json || '[]');
    const assignResult = await client.execute({
      sql: `SELECT ta.*, un.name as unit_name, un.level, un.parent_id,
        u.real_name as submitter_name, fs.data_json
      FROM task_assignments ta
      LEFT JOIN units un ON ta.unit_id = un.id
      LEFT JOIN users u ON ta.submitter_id = u.id
      LEFT JOIN form_submissions fs ON ta.id = fs.assignment_id
      WHERE ta.task_id = ?
      ORDER BY un.level, un.sort_order`,
      args: [req.params.id]
    });

    resSuccess(res, {
      task,
      assignments: assignResult.rows.map(a => ({ ...a, data_json: a.data_json ? JSON.parse(a.data_json) : null }))
    });
  } catch (err) {
    console.error(err);
    resError(res, '获取汇总数据失败', 500);
  }
});

app.post(`${API}/analysis/remind/:assignmentId`, authenticateToken, requireRole('admin', 'finance'), async (req, res) => {
  try {
    const assignResult = await client.execute({
      sql: 'SELECT * FROM task_assignments WHERE id = ?',
      args: [req.params.assignmentId]
    });
    if (assignResult.rows.length === 0) return resError(res, '分配不存在');
    await client.execute({
      sql: `UPDATE task_assignments SET reminder_count = reminder_count + 1, last_reminder_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [req.params.assignmentId]
    });
    await addAuditLog(req.user.id, '催办提醒', `催办任务分配ID: ${req.params.assignmentId}`, req.ip);
    resSuccess(res, { message: '催办成功' });
  } catch (err) {
    console.error(err);
    resError(res, '催办失败', 500);
  }
});

app.post(`${API}/analysis/remind-batch`, authenticateToken, requireRole('admin', 'finance'), async (req, res) => {
  try {
    const { task_id } = req.body;
    await client.execute({
      sql: "UPDATE task_assignments SET reminder_count = reminder_count + 1, last_reminder_at = CURRENT_TIMESTAMP WHERE task_id = ? AND status != 'submitted'",
      args: [task_id]
    });
    await addAuditLog(req.user.id, '批量催办', `催办任务ID: ${task_id}下所有未提交单位`, req.ip);
    resSuccess(res, { message: '批量催办成功' });
  } catch (err) {
    console.error(err);
    resError(res, '批量催办失败', 500);
  }
});

app.get(`${API}/analysis/export/:taskId`, authenticateToken, requireRole('admin', 'finance'), async (req, res) => {
  try {
    const taskResult = await client.execute({
      sql: `SELECT ct.*, ft.name as form_name, ft.fields_json
        FROM collection_tasks ct
        LEFT JOIN form_templates ft ON ct.form_id = ft.id
        WHERE ct.id = ?`,
      args: [req.params.taskId]
    });
    const task = taskResult.rows[0];
    if (!task) return resError(res, '任务不存在', 404);

    const fields = JSON.parse(task.fields_json || '[]');
    const assignResult = await client.execute({
      sql: `SELECT ta.*, un.name as unit_name, fs.data_json
      FROM task_assignments ta
      LEFT JOIN units un ON ta.unit_id = un.id
      LEFT JOIN form_submissions fs ON ta.id = fs.assignment_id
      WHERE ta.task_id = ?
      ORDER BY un.level, un.sort_order`,
      args: [req.params.taskId]
    });

    let csv = '\uFEFF';
    const headers = ['单位名称', '状态', '提交时间', ...fields.map(f => f.label)];
    csv += headers.join(',') + '\n';

    for (const a of assignResult.rows) {
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
  } catch (err) {
    console.error(err);
    resError(res, '导出失败', 500);
  }
});

// ==================== 审计日志 ====================

app.get(`${API}/audit`, authenticateToken, requireRole('admin', 'finance'), async (req, res) => {
  try {
    const { start_date, end_date, action, page = 1, pageSize = 20 } = req.query;
    let sql = `SELECT al.*, u.real_name as user_name, u.username FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id WHERE 1=1`;
    const args = [];

    if (start_date) { sql += ` AND al.created_at >= ?`; args.push(start_date); }
    if (end_date) { sql += ` AND al.created_at <= ?`; args.push(end_date + ' 23:59:59'); }
    if (action) { sql += ` AND al.action = ?`; args.push(action); }
    sql += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    args.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));

    const logsResult = await client.execute({ sql, args });

    let countSql = `SELECT COUNT(*) as count FROM audit_logs al WHERE 1=1`;
    const countArgs = [];
    if (start_date) { countSql += ` AND al.created_at >= ?`; countArgs.push(start_date); }
    if (end_date) { countSql += ` AND al.created_at <= ?`; countArgs.push(end_date + ' 23:59:59'); }
    if (action) { countSql += ` AND al.action = ?`; countArgs.push(action); }

    const totalResult = await client.execute({ sql: countSql, args: countArgs });

    resSuccess(res, { logs: logsResult.rows, total: totalResult.rows[0].count, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (err) {
    console.error(err);
    resError(res, '获取审计日志失败', 500);
  }
});

// ==================== 组织架构 ====================

app.get(`${API}/units`, authenticateToken, async (req, res) => {
  try {
    const result = await client.execute('SELECT * FROM units ORDER BY level, sort_order');
    const units = result.rows;
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
  } catch (err) {
    console.error(err);
    resError(res, '获取组织架构失败', 500);
  }
});

app.get(`${API}/units/flat`, authenticateToken, async (req, res) => {
  try {
    const result = await client.execute('SELECT * FROM units ORDER BY level, sort_order');
    resSuccess(res, result.rows);
  } catch (err) {
    console.error(err);
    resError(res, '获取单位列表失败', 500);
  }
});

app.post(`${API}/units`, authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { name, parent_id, level } = req.body;
    if (!name) return resError(res, '请输入单位名称');
    const maxResult = await client.execute({
      sql: 'SELECT MAX(sort_order) as max_order FROM units WHERE parent_id IS ? AND level = ?',
      args: [parent_id || null, level || 1]
    });
    const result = await client.execute({
      sql: 'INSERT INTO units (name, parent_id, level, sort_order) VALUES (?, ?, ?, ?) RETURNING id',
      args: [name, parent_id || null, level || 1, (maxResult.rows[0].max_order || 0) + 1]
    });
    await addAuditLog(req.user.id, '创建单位', `创建单位: ${name}`, req.ip);
    resSuccess(res, { id: result.rows[0].id, message: '创建成功' });
  } catch (err) {
    console.error(err);
    resError(res, '创建单位失败', 500);
  }
});

app.put(`${API}/units/:id`, authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { name } = req.body;
    await client.execute({
      sql: 'UPDATE units SET name = ? WHERE id = ?',
      args: [name, req.params.id]
    });
    await addAuditLog(req.user.id, '更新单位', `更新单位ID: ${req.params.id}`, req.ip);
    resSuccess(res, { message: '更新成功' });
  } catch (err) {
    console.error(err);
    resError(res, '更新单位失败', 500);
  }
});

app.delete(`${API}/units/:id`, authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const childrenResult = await client.execute({
      sql: 'SELECT COUNT(*) as count FROM units WHERE parent_id = ?',
      args: [req.params.id]
    });
    if (childrenResult.rows[0].count > 0) return resError(res, '请先删除子单位');
    const usersResult = await client.execute({
      sql: 'SELECT COUNT(*) as count FROM users WHERE unit_id = ?',
      args: [req.params.id]
    });
    if (usersResult.rows[0].count > 0) return resError(res, '该单位下有用户，无法删除');
    await client.execute({
      sql: 'DELETE FROM units WHERE id = ?',
      args: [req.params.id]
    });
    await addAuditLog(req.user.id, '删除单位', `删除单位ID: ${req.params.id}`, req.ip);
    resSuccess(res, { message: '删除成功' });
  } catch (err) {
    console.error(err);
    resError(res, '删除单位失败', 500);
  }
});

// ==================== 用户管理 ====================

app.get(`${API}/users`, authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await client.execute(`
      SELECT u.id, u.username, u.real_name, u.role, u.unit_id, u.created_at, un.name as unit_name
      FROM users u LEFT JOIN units un ON u.unit_id = un.id ORDER BY u.created_at DESC
    `);
    resSuccess(res, result.rows);
  } catch (err) {
    console.error(err);
    resError(res, '获取用户列表失败', 500);
  }
});

app.post(`${API}/users`, authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, real_name, role, unit_id } = req.body;
    if (!username || !password || !real_name || !role) return resError(res, '请填写完整信息');
    const existingResult = await client.execute({
      sql: 'SELECT id FROM users WHERE username = ?',
      args: [username]
    });
    if (existingResult.rows.length > 0) return resError(res, '用户名已存在');
    const hash = require('bcryptjs').hashSync(password, 10);
    const result = await client.execute({
      sql: 'INSERT INTO users (username, password_hash, real_name, role, unit_id) VALUES (?, ?, ?, ?, ?) RETURNING id',
      args: [username, hash, real_name, role, unit_id || null]
    });
    await addAuditLog(req.user.id, '创建用户', `创建用户: ${username}`, req.ip);
    resSuccess(res, { id: result.rows[0].id, message: '创建成功' });
  } catch (err) {
    console.error(err);
    resError(res, '创建用户失败', 500);
  }
});

app.put(`${API}/users/:id`, authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { real_name, role, unit_id, password } = req.body;
    if (password) {
      const hash = require('bcryptjs').hashSync(password, 10);
      await client.execute({
        sql: 'UPDATE users SET real_name = ?, role = ?, unit_id = ?, password_hash = ? WHERE id = ?',
        args: [real_name, role, unit_id || null, hash, req.params.id]
      });
    } else {
      await client.execute({
        sql: 'UPDATE users SET real_name = ?, role = ?, unit_id = ? WHERE id = ?',
        args: [real_name, role, unit_id || null, req.params.id]
      });
    }
    await addAuditLog(req.user.id, '更新用户', `更新用户ID: ${req.params.id}`, req.ip);
    resSuccess(res, { message: '更新成功' });
  } catch (err) {
    console.error(err);
    resError(res, '更新用户失败', 500);
  }
});

app.delete(`${API}/users/:id`, authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) return resError(res, '不能删除自己');
    await client.execute({
      sql: 'DELETE FROM users WHERE id = ?',
      args: [req.params.id]
    });
    await addAuditLog(req.user.id, '删除用户', `删除用户ID: ${req.params.id}`, req.ip);
    resSuccess(res, { message: '删除成功' });
  } catch (err) {
    console.error(err);
    resError(res, '删除用户失败', 500);
  }
});

// ==================== 系统统计 ====================

app.get(`${API}/stats`, authenticateToken, async (req, res) => {
  try {
    const [users, units, templates, tasks, submissions] = await Promise.all([
      client.execute('SELECT COUNT(*) as count FROM users'),
      client.execute('SELECT COUNT(*) as count FROM units'),
      client.execute('SELECT COUNT(*) as count FROM form_templates'),
      client.execute('SELECT COUNT(*) as count FROM collection_tasks'),
      client.execute({ sql: "SELECT COUNT(*) as count FROM form_submissions WHERE status = ?", args: ['submitted'] })
    ]);
    resSuccess(res, {
      users: users.rows[0].count,
      units: units.rows[0].count,
      templates: templates.rows[0].count,
      tasks: tasks.rows[0].count,
      submissions: submissions.rows[0].count
    });
  } catch (err) {
    console.error(err);
    resError(res, '获取统计失败', 500);
  }
});

// 消息通知
app.get(`${API}/notifications`, authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const userInfo = await getCurrentUser(user.id);
    const notifications = [];

    const remindersResult = await client.execute({
      sql: `SELECT ta.reminder_count, ta.last_reminder_at, ct.title, un.name as unit_name
        FROM task_assignments ta
        JOIN collection_tasks ct ON ta.task_id = ct.id
        JOIN units un ON ta.unit_id = un.id
        WHERE ta.unit_id = ? AND ta.reminder_count > 0
        ORDER BY ta.last_reminder_at DESC`,
      args: [userInfo.unit_id]
    });

    for (const r of remindersResult.rows) {
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

    const upcomingResult = await client.execute({
      sql: `SELECT ct.title, ct.deadline
        FROM collection_tasks ct
        JOIN task_assignments ta ON ct.id = ta.task_id
        WHERE ta.unit_id = ? AND ct.status = 'active' AND ta.status != 'submitted'
        AND ct.deadline IS NOT NULL
        AND ct.deadline <= datetime('now', '+3 days')`,
      args: [userInfo.unit_id]
    });

    for (const t of upcomingResult.rows) {
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
  } catch (err) {
    console.error(err);
    resError(res, '获取通知失败', 500);
  }
});

// 捕获所有其他请求，返回index.html（SPA）
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服务器内部错误' });
});

// 本地开发时直接启动
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  (async () => {
    await initDB();
    app.listen(PORT, () => {
      console.log(`财务表单收集系统已启动: http://localhost:${PORT}`);
      console.log(`默认管理员: admin / admin123`);
      console.log(`经办人账号: filler / filler123`);
    });
  })();
}

module.exports = app;
