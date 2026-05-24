// 财务表单收集系统 - 主应用
(function() {
  'use strict';

  // 全局状态
  const state = {
    user: null,
    currentPage: 'dashboard',
    params: {}
  };

  // 工具函数
  const utils = {
    formatDate(dateStr) {
      if (!dateStr) return '-';
      const d = new Date(dateStr);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    formatDateTime(dateStr) {
      if (!dateStr) return '-';
      const d = new Date(dateStr);
      return `${this.formatDate(dateStr)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
    formatRelativeTime(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      const now = new Date();
      const diff = now - d;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      if (days === 0) return '今天';
      if (days === 1) return '昨天';
      if (days < 7) return `${days}天前`;
      if (days < 30) return `${Math.floor(days / 7)}周前`;
      return `${Math.floor(days / 30)}月前`;
    },
    getDaysLeft(deadline) {
      if (!deadline) return null;
      const d = new Date(deadline);
      const now = new Date();
      return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    },
    escapeHtml(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  };

  // Toast提示
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i> ${utils.escapeHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // 模态框
  function showModal(title, content, actions) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">${content}</div>
        ${actions ? `<div class="modal-footer"></div>` : ''}
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    
    if (actions) {
      const footer = overlay.querySelector('.modal-footer');
      actions.forEach(action => {
        const btn = document.createElement('button');
        btn.className = `btn ${action.class || 'btn-secondary'}`;
        btn.textContent = action.text;
        btn.onclick = () => { action.onClick(); close(); };
        footer.appendChild(btn);
      });
    }
    
    return { close, overlay };
  }

  // 确认对话框
  function confirm(message, onConfirm) {
    showModal('确认操作', `<p style="text-align:center;padding:20px;">${message}</p>`, [
      { text: '取消', class: 'btn-secondary', onClick: () => {} },
      { text: '确认', class: 'btn-primary', onClick: onConfirm }
    ]);
  }

  // 登录页面
  function renderLogin() {
    return `
      <div class="login-container">
        <div class="login-box">
          <div class="login-logo">
            <div class="logo-icon">财</div>
            <h1>财务表单收集系统</h1>
            <p>中土集团财务部</p>
          </div>
          <form class="login-form" id="loginForm">
            <div class="form-group">
              <label>用户名</label>
              <input type="text" name="username" placeholder="请输入用户名" required>
            </div>
            <div class="form-group">
              <label>密码</label>
              <input type="password" name="password" placeholder="请输入密码" required>
            </div>
            <button type="submit" class="login-btn">登 录</button>
          </form>
          <div class="login-tip">
            <strong>测试账号：</strong><br>
            管理员：<code>admin</code> / <code>admin123</code><br>
            财务：<code>finance</code> / <code>finance123</code><br>
            经办人：<code>filler</code> / <code>filler123</code>
          </div>
        </div>
      </div>
    `;
  }

  // 侧边栏
  function renderSidebar() {
    const roleLabels = { admin: '管理员', finance: '财务人员', filler: '经办人' };
    const initials = state.user.realName?.substring(0, 1) || 'U';
    
    let navItems = [];
    
    if (state.user.role === 'admin' || state.user.role === 'finance') {
      navItems = [
        { id: 'dashboard', icon: 'fa-home', label: '工作台' },
        { id: 'form-builder', icon: 'fa-file-alt', label: '新建表单' },
        { id: 'publish', icon: 'fa-paper-plane', label: '发布对象' },
        { id: 'analysis', icon: 'fa-chart-bar', label: '汇总分析' },
        { id: 'audit', icon: 'fa-history', label: '审计日志' }
      ];
      if (state.user.role === 'admin') {
        navItems.push({ id: 'settings', icon: 'fa-cog', label: '系统设置' });
      }
    } else {
      navItems = [
        { id: 'filler-home', icon: 'fa-home', label: '我的待办' },
        { id: 'filler-history', icon: 'fa-history', label: '提交记录' }
      ];
    }

    return `
      <div class="sidebar">
        <div class="sidebar-logo">
          <div class="logo-icon">财</div>
          <div class="logo-text">
            <h2>表单收集系统</h2>
            <span>中土集团</span>
          </div>
        </div>
        <nav class="sidebar-nav">
          ${navItems.map(item => `
            <div class="nav-item ${state.currentPage === item.id ? 'active' : ''}" data-page="${item.id}">
              <i class="fas ${item.icon}"></i>
              <span>${item.label}</span>
            </div>
          `).join('')}
        </nav>
        <div class="sidebar-footer">
          <div class="user-info">
            <div class="user-avatar">${initials}</div>
            <div class="user-details">
              <div class="name">${utils.escapeHtml(state.user.realName || '')}</div>
              <div class="role">${roleLabels[state.user.role] || ''}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // 顶部栏
  function renderTopbar(title) {
    return `
      <div class="topbar">
        <div class="topbar-title">${title}</div>
        <div class="topbar-actions">
          ${state.user.role === 'filler' ? `
            <div class="notifications" id="notificationBtn">
              <i class="fas fa-bell" style="font-size:20px;cursor:pointer;"></i>
              <span class="notification-badge" id="notifBadge" style="display:none;">0</span>
              <div class="notification-dropdown" id="notifDropdown"></div>
            </div>
          ` : ''}
          <button class="btn btn-secondary btn-sm" id="logoutBtn">
            <i class="fas fa-sign-out-alt"></i> 退出
          </button>
        </div>
      </div>
    `;
  }

  // 主布局
  function renderLayout(content, title) {
    return `
      <div class="app-container">
        ${renderSidebar()}
        <div class="main-content">
          ${renderTopbar(title)}
          <div class="content">${content}</div>
        </div>
      </div>
    `;
  }

  // ========== 经办人首页 ==========
  async function renderFillerHome() {
    try {
      const { data } = await api.getFillerTodos();
      
      const content = `
        <div class="filler-home">
          <div class="filler-hero">
            <div>
              <h2>您好，${utils.escapeHtml(state.user.realName || '')}</h2>
              <p>您有 <strong>${data.stats.total}</strong> 项待填报任务</p>
            </div>
            <div class="filler-stats">
              <div class="filler-stat">
                <div class="filler-stat-value" style="color:#faad14;">${data.stats.pending + data.stats.filling}</div>
                <div class="filler-stat-label">待填报</div>
              </div>
              <div class="filler-stat">
                <div class="filler-stat-value" style="color:#ff4d4f;">${data.stats.overdue}</div>
                <div class="filler-stat-label">已逾期</div>
              </div>
            </div>
          </div>

          <div class="quick-actions">
            <div class="quick-action-btn" onclick="navigate('filler-home')">
              <div class="quick-action-icon blue"><i class="fas fa-edit"></i></div>
              <div class="quick-action-text">
                <h4>立即填报</h4>
                <p>${data.stats.total}项待办任务</p>
              </div>
            </div>
            <div class="quick-action-btn" onclick="navigate('filler-history')">
              <div class="quick-action-icon green"><i class="fas fa-check-circle"></i></div>
              <div class="quick-action-text">
                <h4>已提交</h4>
                <p>查看历史记录</p>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h3><i class="fas fa-list-alt"></i> 待填报任务</h3>
            </div>
            <div class="card-body">
              ${data.pendingTasks.length === 0 ? `
                <div class="empty-state">
                  <i class="fas fa-check-circle"></i>
                  <h4>暂无待填报任务</h4>
                  <p>您已完成所有填报任务</p>
                </div>
              ` : `
                <div class="task-grid">
                  ${data.pendingTasks.map(task => {
                    const daysLeft = task.daysLeft;
                    const isUrgent = daysLeft !== null && daysLeft <= 2;
                    const isOverdue = task.isOverdue;
                    
                    return `
                      <div class="task-card ${isUrgent || isOverdue ? 'urgent' : ''}">
                        <div class="task-card-header">
                          <div>
                            <div class="task-card-title">${utils.escapeHtml(task.title)}</div>
                            <div class="task-card-form">${utils.escapeHtml(task.form_name)}</div>
                          </div>
                          <span class="status-badge ${task.my_status}">${task.my_status === 'pending' ? '待填报' : '填报中'}</span>
                        </div>
                        <div class="task-card-body">
                          <div class="task-card-info">
                            <div class="task-info-item">
                              <i class="fas fa-building"></i>
                              <span>${utils.escapeHtml(state.user.unitName || '')}</span>
                            </div>
                            <div class="task-info-item">
                              <i class="fas fa-clock"></i>
                              <span class="${isOverdue ? 'deadline-warning' : (isUrgent ? 'deadline-warning' : '')}">
                                ${isOverdue ? '已逾期' : (daysLeft !== null ? `剩余 ${daysLeft} 天` : '未设置截止')}
                              </span>
                            </div>
                            ${task.creator_name ? `
                              <div class="task-info-item">
                                <i class="fas fa-user"></i>
                                <span>发布人：${utils.escapeHtml(task.creator_name)}</span>
                              </div>
                            ` : ''}
                            ${task.reminder_count > 0 ? `
                              <div class="task-info-item" style="color:#ff4d4f;">
                                <i class="fas fa-bell"></i>
                                <span>已被催办 ${task.reminder_count} 次</span>
                              </div>
                            ` : ''}
                          </div>
                        </div>
                        <div class="task-card-footer">
                          <span style="font-size:13px;color:#999;">
                            ${task.submission_status === 'draft' ? '📝 有草稿' : ''}
                          </span>
                          <button class="task-action-btn fill" onclick="openFillingPage(${task.assignment_id})">
                            ${task.my_status === 'filling' && task.submission_status === 'draft' ? '继续填报' : '开始填报'}
                          </button>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              `}
            </div>
          </div>
        </div>
      `;
      
      document.getElementById('app').innerHTML = renderLayout(content, '我的待办');
      loadNotifications();
      
    } catch (error) {
      showToast('加载失败: ' + error.message, 'error');
    }
  }

  // 加载通知
  async function loadNotifications() {
    if (state.user.role !== 'filler') return;
    try {
      const { data } = await api.getNotifications();
      const badge = document.getElementById('notifBadge');
      const dropdown = document.getElementById('notifDropdown');
      
      if (data.length > 0) {
        badge.style.display = 'flex';
        badge.textContent = data.length;
        dropdown.innerHTML = `
          <div style="padding:10px 16px;font-weight:500;border-bottom:1px solid #eee;">通知</div>
          ${data.map(n => `
            <div class="notification-item">
              <div class="notification-title">${utils.escapeHtml(n.title)}</div>
              <div class="notification-message">${utils.escapeHtml(n.message)}</div>
              <div class="notification-time">${utils.formatRelativeTime(n.time)}</div>
            </div>
          `).join('')}
        `;
        
        const btn = document.getElementById('notificationBtn');
        btn.onclick = () => dropdown.classList.toggle('active');
        document.onclick = (e) => {
          if (!btn.contains(e.target)) dropdown.classList.remove('active');
        };
      }
    } catch (e) {}
  }

  // 填单页面
  async function openFillingPage(assignmentId) {
    try {
      const { data: task } = await api.getFillerTask(assignmentId);
      const progress = task.progress;
      
      const content = `
        <div class="filling-container">
          <div class="filling-header">
            <div class="filling-progress">
              <div class="progress-circle" style="--progress: ${progress.percentage}%">
                <span>${progress.percentage}%</span>
              </div>
              <div class="progress-text">
                <h3>${utils.escapeHtml(task.title)}</h3>
                <p>已填写 ${progress.filledTotal} / ${progress.total} 个字段（必填 ${progress.filledRequired} / ${progress.required}）</p>
              </div>
            </div>
            <div class="filling-meta">
              <div class="meta-item">
                <i class="fas fa-file-alt"></i>
                <span>${utils.escapeHtml(task.form_name)}</span>
              </div>
              <div class="meta-item">
                <i class="fas fa-clock"></i>
                <span class="${task.isOverdue ? 'deadline-warning' : ''}">
                  截止：${utils.formatDateTime(task.deadline) || '未设置'}
                </span>
              </div>
              ${task.creator_name ? `
                <div class="meta-item">
                  <i class="fas fa-user"></i>
                  <span>发布人：${utils.escapeHtml(task.creator_name)}</span>
                </div>
              ` : ''}
            </div>
          </div>

          <div class="filling-form">
            <form id="fillingForm">
              <input type="hidden" name="assignment_id" value="${assignmentId}">
              ${task.fields.map(field => renderField(field, task.saved_data[field.id], task.canEdit)).join('')}
              
              <div class="filling-actions">
                ${task.canEdit ? `
                  <button type="button" class="btn btn-secondary" onclick="saveDraft()">
                    <i class="fas fa-save"></i> 保存草稿
                  </button>
                  <button type="button" class="btn btn-success" onclick="submitForm()">
                    <i class="fas fa-paper-plane"></i> 提交表单
                  </button>
                ` : `
                  <div style="color:#52c41a;font-size:14px;">
                    <i class="fas fa-check-circle"></i> 已提交于 ${utils.formatDateTime(task.submitted_at)}
                  </div>
                  <button type="button" class="btn btn-secondary" onclick="navigate('filler-home')">
                    返回待办
                  </button>
                `}
              </div>
            </form>
          </div>
        </div>
      `;
      
      document.getElementById('app').innerHTML = renderLayout(content, task.form_name);
      
    } catch (error) {
      showToast('加载失败: ' + error.message, 'error');
    }
  }

  function renderField(field, value, canEdit) {
    const required = field.required ? '<span class="field-required">*</span>' : '';
    const disabled = canEdit ? '' : 'disabled';
    
    let input = '';
    switch (field.type) {
      case 'text':
        input = `<input type="text" class="form-input" name="${field.id}" value="${utils.escapeHtml(value || '')}" ${disabled} placeholder="请输入">`;
        break;
      case 'number':
        input = `<input type="number" class="form-input" name="${field.id}" value="${value || ''}" ${disabled} placeholder="请输入数字">`;
        break;
      case 'date':
        input = `<input type="date" class="form-input" name="${field.id}" value="${value || ''}" ${disabled}>`;
        break;
      case 'textarea':
        input = `<textarea class="form-input" name="${field.id}" ${disabled} placeholder="请输入">${utils.escapeHtml(value || '')}</textarea>`;
        break;
      case 'select':
        input = `
          <select class="form-input" name="${field.id}" ${disabled}>
            <option value="">请选择</option>
            ${(field.options || []).map(opt => `<option value="${utils.escapeHtml(opt)}" ${value === opt ? 'selected' : ''}>${utils.escapeHtml(opt)}</option>`).join('')}
          </select>
        `;
        break;
      case 'file':
        input = `
          <div class="file-upload" onclick="document.getElementById('file_${field.id}').click()">
            <i class="fas fa-cloud-upload-alt"></i>
            <p>点击上传文件</p>
            <span class="hint">支持 PDF、Word、图片等文件</span>
          </div>
          <input type="file" id="file_${field.id}" name="${field.id}" style="display:none;" ${disabled}>
          ${value ? `<p style="margin-top:8px;font-size:13px;color:#52c41a;"><i class="fas fa-check"></i> 已上传: ${utils.escapeHtml(value)}</p>` : ''}
        `;
        break;
      default:
        input = `<input type="text" class="form-input" name="${field.id}" value="${utils.escapeHtml(value || '')}" ${disabled}>`;
    }
    
    return `
      <div class="form-field">
        <div class="field-label">
          ${required}
          <span>${utils.escapeHtml(field.label)}</span>
          <span class="field-type">${field.type}</span>
        </div>
        ${input}
      </div>
    `;
  }

  // 保存草稿
  window.saveDraft = async function() {
    const form = document.getElementById('fillingForm');
    const formData = new FormData(form);
    const data = {};
    for (let [key, value] of formData.entries()) {
      data[key] = value;
    }
    
    try {
      const assignmentId = formData.get('assignment_id');
      await api.saveDraft(assignmentId, data);
      showToast('草稿保存成功', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  // 提交表单
  window.submitForm = async function() {
    const form = document.getElementById('fillingForm');
    const formData = new FormData(form);
    const data = {};
    for (let [key, value] of formData.entries()) {
      data[key] = value;
    }
    
    confirm('确认提交表单？提交后将无法修改。', async () => {
      try {
        const assignmentId = formData.get('assignment_id');
        await api.submitForm(assignmentId, data);
        showToast('提交成功', 'success');
        setTimeout(() => navigate('filler-home'), 1500);
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  };

  // 经办人历史记录
  async function renderFillerHistory() {
    try {
      const { data } = await api.getFillerTodos();
      
      const content = `
        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-history"></i> 提交记录</h3>
          </div>
          <div class="card-body">
            ${data.submittedRecords.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <h4>暂无提交记录</h4>
                <p>您还没有提交过任何表单</p>
              </div>
            ` : `
              <table>
                <thead>
                  <tr>
                    <th>任务名称</th>
                    <th>表单类型</th>
                    <th>提交时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.submittedRecords.map(r => `
                    <tr>
                      <td>${utils.escapeHtml(r.title)}</td>
                      <td>${utils.escapeHtml(r.form_name)}</td>
                      <td>${utils.formatDateTime(r.submitted_at)}</td>
                      <td>
                        <button class="btn btn-secondary btn-sm" onclick="viewSubmission(${r.assignment_id})">
                          查看详情
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>
      `;
      
      document.getElementById('app').innerHTML = renderLayout(content, '提交记录');
    } catch (error) {
      showToast('加载失败: ' + error.message, 'error');
    }
  }

  // 查看已提交的表单
  window.viewSubmission = async function(assignmentId) {
    await openFillingPage(assignmentId);
  };

  // ========== 工作台/仪表盘 ==========
  async function renderDashboard() {
    try {
      const [dashRes, unitsRes] = await Promise.all([
        api.getDashboard(),
        api.getUnits()
      ]);
      
      const data = dashRes.data;
      const units = unitsRes.data.units;
      
      const content = `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon blue"><i class="fas fa-tasks"></i></div>
            <div class="stat-info">
              <h3>${data.activeTasks}</h3>
              <p>本周新增任务</p>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon green"><i class="fas fa-building"></i></div>
            <div class="stat-info">
              <h3>${data.unitCount}</h3>
              <p>覆盖单位数</p>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon orange"><i class="fas fa-chart-pie"></i></div>
            <div class="stat-info">
              <h3>${data.submitRate}%</h3>
              <p>平均提交率</p>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon purple"><i class="fas fa-file-alt"></i></div>
            <div class="stat-info">
              <h3>${data.templateCount}</h3>
              <p>表单模板库</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="tabs">
            <div class="tab active" data-status="all">全部任务</div>
            <div class="tab" data-status="active">进行中</div>
            <div class="tab" data-status="completed">已结束</div>
          </div>
          <div class="card-body" id="taskList">
            ${renderTaskList(data.tasks)}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-project-diagram"></i> 主业务流程</h3>
          </div>
          <div class="card-body">
            <div class="workflow">
              <div class="workflow-step">
                <div class="step-icon"><i class="fas fa-drafting-compass"></i></div>
                <div class="step-label">设计表单</div>
                <div class="step-number">Step 1</div>
              </div>
              <div class="workflow-step">
                <div class="step-icon"><i class="fas fa-users-cog"></i></div>
                <div class="step-label">配置对象</div>
                <div class="step-number">Step 2</div>
              </div>
              <div class="workflow-step">
                <div class="step-icon"><i class="fas fa-paper-plane"></i></div>
                <div class="step-label">发布任务</div>
                <div class="step-number">Step 3</div>
              </div>
              <div class="workflow-step">
                <div class="step-icon"><i class="fas fa-edit"></i></div>
                <div class="step-label">单位填报</div>
                <div class="step-number">Step 4</div>
              </div>
              <div class="workflow-step">
                <div class="step-icon"><i class="fas fa-bell"></i></div>
                <div class="step-label">催办提醒</div>
                <div class="step-number">Step 5</div>
              </div>
              <div class="workflow-step">
                <div class="step-icon"><i class="fas fa-chart-bar"></i></div>
                <div class="step-label">汇总分析</div>
                <div class="step-number">Step 6</div>
              </div>
            </div>
          </div>
        </div>
      `;
      
      document.getElementById('app').innerHTML = renderLayout(content, '工作台');
      
      // 标签切换
      document.querySelectorAll('.tabs .tab').forEach(tab => {
        tab.onclick = async () => {
          document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const status = tab.dataset.status;
          const res = await api.getTasks(status);
          document.getElementById('taskList').innerHTML = renderTaskList(res.data);
          bindTaskListEvents();
        };
      });
      
      bindTaskListEvents();
      
    } catch (error) {
      showToast('加载失败: ' + error.message, 'error');
    }
  }

  function renderTaskList(tasks) {
    if (!tasks || tasks.length === 0) {
      return `
        <div class="empty-state">
          <i class="fas fa-inbox"></i>
          <h4>暂无任务</h4>
          <p>点击上方按钮创建新任务</p>
        </div>
      `;
    }
    
    return `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>任务名称</th>
              <th>表单</th>
              <th>进度</th>
              <th>截止时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${tasks.map(task => {
              const progress = task.total_assignments > 0 
                ? Math.round((task.submitted_count / task.total_assignments) * 100) 
                : 0;
              const submitted = task.submitted_count || 0;
              const filling = task.filling_count || 0;
              const pending = (task.total_assignments || 0) - submitted - filling;
              
              return `
                <tr>
                  <td>${utils.escapeHtml(task.title)}</td>
                  <td>${utils.escapeHtml(task.form_name || '-')}</td>
                  <td>
                    <div style="display:flex;align-items:center;gap:10px;">
                      <div class="progress-bar" style="width:100px;">
                        <div class="filled green" style="width:${progress}%"></div>
                      </div>
                      <span style="font-size:12px;color:#666;">${submitted}/${task.total_assignments}</span>
                    </div>
                    <div style="font-size:11px;color:#999;margin-top:4px;">
                      <span style="color:#52c41a">● 已提交 ${submitted}</span>
                      <span style="color:#faad14;margin-left:8px;">● 填报中 ${filling}</span>
                      <span style="color:#ff4d4f;margin-left:8px;">● 未填报 ${pending}</span>
                    </div>
                  </td>
                  <td>${utils.formatDateTime(task.deadline)}</td>
                  <td><span class="status-badge ${task.status}">${task.status === 'active' ? '进行中' : task.status === 'completed' ? '已结束' : '草稿'}</span></td>
                  <td>
                    <button class="btn btn-primary btn-sm" onclick="viewTask(${task.id})">
                      <i class="fas fa-eye"></i> 查看
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="navigate('analysis', {taskId: ${task.id}})">
                      <i class="fas fa-chart-bar"></i> 汇总
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function bindTaskListEvents() {
    // 事件绑定
  }

  // 查看任务详情
  window.viewTask = async function(taskId) {
    try {
      const { data: task } = await api.getTask(taskId);
      
      const submitted = task.assignments.filter(a => a.status === 'submitted').length;
      const filling = task.assignments.filter(a => a.status === 'filling').length;
      const pending = task.assignments.filter(a => a.status === 'pending').length;
      
      const content = `
        <div class="card">
          <div class="card-header">
            <h3>${utils.escapeHtml(task.title)}</h3>
            <span class="status-badge ${task.status}">${task.status === 'active' ? '进行中' : task.status === 'completed' ? '已结束' : '草稿'}</span>
          </div>
          <div class="card-body">
            <div style="margin-bottom:20px;">
              <p><strong>表单：</strong>${utils.escapeHtml(task.form_name || '-')}</p>
              <p><strong>截止时间：</strong>${utils.formatDateTime(task.deadline) || '未设置'}</p>
              <p><strong>创建人：</strong>${utils.escapeHtml(task.creator_name || '-')}</p>
            </div>
            
            <div class="submission-status">
              <div class="status-item submitted">
                <div class="status-count">${submitted}</div>
                <div class="status-label">已提交</div>
              </div>
              <div class="status-item filling">
                <div class="status-count">${filling}</div>
                <div class="status-label">填报中</div>
              </div>
              <div class="status-item pending">
                <div class="status-count">${pending}</div>
                <div class="status-label">未填报</div>
              </div>
            </div>

            <h4 style="margin:20px 0 10px;">填报单位列表</h4>
            <table>
              <thead>
                <tr>
                  <th>单位名称</th>
                  <th>层级</th>
                  <th>状态</th>
                  <th>提交时间</th>
                </tr>
              </thead>
              <tbody>
                ${task.assignments.map(a => `
                  <tr>
                    <td>${utils.escapeHtml(a.unit_name || '-')}</td>
                    <td>第${a.level}级</td>
                    <td><span class="status-badge ${a.status}">${a.status === 'submitted' ? '已提交' : a.status === 'filling' ? '填报中' : '未填报'}</span></td>
                    <td>${utils.formatDateTime(a.submitted_at)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <div style="margin-top:20px;display:flex;gap:10px;">
              <button class="btn btn-secondary" onclick="navigate('analysis', {taskId: ${task.id}})">
                查看汇总分析
              </button>
            </div>
          </div>
        </div>
      `;
      
      document.getElementById('app').innerHTML = renderLayout(content, '任务详情');
      
    } catch (error) {
      showToast('加载失败: ' + error.message, 'error');
    }
  };

  // ========== 新建表单 ==========
  async function renderFormBuilder() {
    const templates = await api.getTemplates();
    
    const content = `
      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-plus-circle"></i> 新建表单模板</h3>
        </div>
        <div class="card-body">
          <form id="templateForm">
            <div class="form-group">
              <label>表单名称 <span style="color:red">*</span></label>
              <input type="text" class="form-control" name="name" required placeholder="如：月度财务收支表">
            </div>
            <div class="form-group">
              <label>表单描述</label>
              <textarea class="form-control" name="description" rows="2" placeholder="简要描述表单用途"></textarea>
            </div>
            
            <div class="form-group">
              <label>字段类型</label>
              <div class="field-types">
                <button type="button" class="field-type-btn" onclick="addField('text')">
                  <i class="fas fa-font"></i> 单行文本
                </button>
                <button type="button" class="field-type-btn" onclick="addField('number')">
                  <i class="fas fa-hashtag"></i> 数字
                </button>
                <button type="button" class="field-type-btn" onclick="addField('date')">
                  <i class="fas fa-calendar"></i> 日期
                </button>
                <button type="button" class="field-type-btn" onclick="addField('textarea')">
                  <i class="fas fa-align-left"></i> 多行文本
                </button>
                <button type="button" class="field-type-btn" onclick="addField('select')">
                  <i class="fas fa-list"></i> 下拉选择
                </button>
                <button type="button" class="field-type-btn" onclick="addField('file')">
                  <i class="fas fa-paperclip"></i> 文件上传
                </button>
              </div>
            </div>

            <div class="form-group">
              <label>表单字段</label>
              <div class="field-list" id="fieldList">
                <div class="empty-state" style="padding:40px;">
                  <i class="fas fa-plus-square"></i>
                  <h4>暂无字段</h4>
                  <p>点击上方按钮添加字段</p>
                </div>
              </div>
            </div>

            <div style="display:flex;gap:10px;margin-top:20px;">
              <button type="button" class="btn btn-primary" onclick="saveTemplate()">
                <i class="fas fa-save"></i> 保存模板
              </button>
              <button type="button" class="btn btn-secondary" onclick="previewTemplate()">
                <i class="fas fa-eye"></i> 预览
              </button>
            </div>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-list"></i> 已有模板</h3>
        </div>
        <div class="card-body">
          <table>
            <thead>
              <tr>
                <th>模板名称</th>
                <th>描述</th>
                <th>字段数</th>
                <th>创建人</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${templates.data.map(t => `
                <tr>
                  <td>${utils.escapeHtml(t.name)}</td>
                  <td>${utils.escapeHtml(t.description || '-')}</td>
                  <td>${(t.fields_json || []).length}</td>
                  <td>${utils.escapeHtml(t.creator_name || '-')}</td>
                  <td>${utils.formatDate(t.created_at)}</td>
                  <td>
                    <button class="btn btn-secondary btn-sm" onclick="loadTemplate(${t.id})">编辑</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteTemplate(${t.id})">删除</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    document.getElementById('app').innerHTML = renderLayout(content, '新建表单');
    window.currentFields = [];
  }

  let fieldIdCounter = 0;
  window.addField = function(type) {
    const id = 'f' + (++fieldIdCounter);
    const labels = {
      text: '单行文本',
      number: '数字',
      date: '日期',
      textarea: '多行文本',
      select: '下拉选择',
      file: '文件上传'
    };
    
    let optionsHtml = '';
    if (type === 'select') {
      optionsHtml = `
        <div class="form-group" style="margin-top:10px;">
          <label>选项（每行一个）</label>
          <textarea class="form-control" id="options_${id}" rows="3" placeholder="选项1&#10;选项2&#10;选项3"></textarea>
        </div>
      `;
    }
    
    const modal = showModal(`添加${labels[type]}字段`, `
      <div class="form-group">
        <label>字段标签 <span style="color:red">*</span></label>
        <input type="text" class="form-control" id="fieldLabel_${id}" placeholder="请输入字段显示名称">
      </div>
      <div class="form-group">
        <label><input type="checkbox" id="fieldRequired_${id}" checked> 必填字段</label>
      </div>
      ${optionsHtml}
    `, [
      { text: '取消', class: 'btn-secondary', onClick: () => {} },
      { text: '添加', class: 'btn-primary', onClick: () => {
        const label = document.getElementById(`fieldLabel_${id}`).value.trim();
        if (!label) {
          showToast('请输入字段标签', 'error');
          return;
        }
        
        const field = {
          id,
          type,
          label,
          required: document.getElementById(`fieldRequired_${id}`).checked
        };
        
        if (type === 'select') {
          const options = document.getElementById(`options_${id}`).value.trim().split('\n').filter(o => o.trim());
          if (options.length > 0) {
            field.options = options;
          }
        }
        
        window.currentFields.push(field);
        renderFieldList();
      }}
    ]);
  };

  function renderFieldList() {
    const container = document.getElementById('fieldList');
    if (window.currentFields.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:40px;">
          <i class="fas fa-plus-square"></i>
          <h4>暂无字段</h4>
          <p>点击上方按钮添加字段</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = window.currentFields.map((f, i) => `
      <div class="field-item">
        <div class="field-drag"><i class="fas fa-bars"></i></div>
        <div class="field-item-content">
          <div class="field-item-label">
            ${f.required ? '<span style="color:red">*</span>' : ''} ${utils.escapeHtml(f.label)}
          </div>
          <div class="field-item-type">${f.type}${f.options ? ' - ' + f.options.length + '个选项' : ''}</div>
        </div>
        <div class="field-item-actions">
          <button type="button" class="btn btn-secondary btn-sm" onclick="removeField(${i})">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `).join('');
  }

  window.removeField = function(index) {
    window.currentFields.splice(index, 1);
    renderFieldList();
  };

  window.saveTemplate = async function() {
    const form = document.getElementById('templateForm');
    const name = form.name.value.trim();
    const description = form.description.value.trim();
    
    if (!name) {
      showToast('请输入表单名称', 'error');
      return;
    }
    if (window.currentFields.length === 0) {
      showToast('请添加至少一个字段', 'error');
      return;
    }
    
    try {
      await api.createTemplate({ name, description, fields: window.currentFields });
      showToast('保存成功', 'success');
      renderFormBuilder();
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  window.previewTemplate = function() {
    if (window.currentFields.length === 0) {
      showToast('请先添加字段', 'error');
      return;
    }
    
    const content = `
      <div class="filling-form">
        ${window.currentFields.map(f => `
          <div class="form-field">
            <div class="field-label">
              ${f.required ? '<span class="field-required">*</span>' : ''}
              <span>${utils.escapeHtml(f.label)}</span>
              <span class="field-type">${f.type}</span>
            </div>
            ${renderField({...f, required: false}, '', true)}
          </div>
        `).join('')}
      </div>
    `;
    
    showModal('表单预览', content, [{ text: '关闭', class: 'btn-secondary', onClick: () => {} }]);
  };

  window.loadTemplate = async function(id) {
    try {
      const { data } = await api.getTemplate(id);
      document.querySelector('[name=name]').value = data.name;
      document.querySelector('[name=description]').value = data.description || '';
      window.currentFields = data.fields_json || [];
      renderFieldList();
      showToast('已加载模板', 'info');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  window.deleteTemplate = function(id) {
    confirm('确定删除此模板？', async () => {
      try {
        await api.deleteTemplate(id);
        showToast('删除成功', 'success');
        renderFormBuilder();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  };

  // ========== 发布任务 ==========
  async function renderPublish() {
    const [templatesRes, unitsRes] = await Promise.all([
      api.getTemplates(),
      api.getUnits()
    ]);
    
    const templates = templatesRes.data;
    const units = unitsRes.data.tree;
    
    const content = `
      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-paper-plane"></i> 发布收集任务</h3>
        </div>
        <div class="card-body">
          <form id="taskForm">
            <div class="form-group">
              <label>任务名称 <span style="color:red">*</span></label>
              <input type="text" class="form-control" name="title" required placeholder="如：2024年12月财务收支汇总">
            </div>
            
            <div class="form-group">
              <label>选择表单模板 <span style="color:red">*</span></label>
              <select class="form-control" name="form_id" required>
                <option value="">请选择表单</option>
                ${templates.map(t => `<option value="${t.id}">${utils.escapeHtml(t.name)}</option>`).join('')}
              </select>
            </div>
            
            <div class="form-group">
              <label>截止时间</label>
              <input type="datetime-local" class="form-control" name="deadline">
            </div>
            
            <div class="form-group">
              <label>选择填报单位 <span style="color:red">*</span></label>
              <div class="checkbox-tree" id="unitTree">
                ${renderUnitTree(units, [])}
              </div>
            </div>

            <button type="button" class="btn btn-primary" onclick="createTask()">
              <i class="fas fa-paper-plane"></i> 发布任务
            </button>
          </form>
        </div>
      </div>
    `;
    
    document.getElementById('app').innerHTML = renderLayout(content, '发布对象');
  }

  function renderUnitTree(units, selected = []) {
    return units.map(unit => `
      <div class="tree-node">
        <div class="tree-item">
          <input type="checkbox" id="unit_${unit.id}" name="unit_ids" value="${unit.id}" ${selected.includes(unit.id) ? 'checked' : ''}>
          <label for="unit_${unit.id}">${utils.escapeHtml(unit.name)} <span style="color:#999;font-size:12px;">(第${unit.level}级)</span></label>
        </div>
        ${unit.children && unit.children.length > 0 ? renderUnitTree(unit.children, selected) : ''}
      </div>
    `).join('');
  }

  window.createTask = async function() {
    const form = document.getElementById('taskForm');
    const title = form.title.value.trim();
    const form_id = form.form_id.value;
    const deadline = form.deadline.value;
    
    if (!title) {
      showToast('请输入任务名称', 'error');
      return;
    }
    if (!form_id) {
      showToast('请选择表单模板', 'error');
      return;
    }
    
    const unitIds = Array.from(form.querySelectorAll('[name=unit_ids]:checked')).map(cb => parseInt(cb.value));
    if (unitIds.length === 0) {
      showToast('请选择至少一个填报单位', 'error');
      return;
    }
    
    try {
      await api.createTask({ title, form_id: parseInt(form_id), deadline, unit_ids: unitIds });
      showToast('任务发布成功', 'success');
      navigate('dashboard');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  // ========== 汇总分析 ==========
  async function renderAnalysis() {
    const tasksRes = await api.getTasks('active');
    const tasks = tasksRes.data;
    
    const content = `
      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-chart-bar"></i> 汇总分析</h3>
        </div>
        <div class="card-body">
          <div class="form-group" style="max-width:400px;">
            <label>选择任务</label>
            <select class="form-control" id="analysisTaskSelect">
              <option value="">请选择任务</option>
              ${tasks.map(t => `<option value="${t.id}">${utils.escapeHtml(t.title)}</option>`).join('')}
            </select>
          </div>
          <div id="analysisContent" style="display:none;">
            <div id="analysisStats"></div>
            <div id="analysisChart" style="height:300px;margin:20px 0;"></div>
            <div id="analysisTable"></div>
          </div>
        </div>
      </div>
    `;
    
    document.getElementById('app').innerHTML = renderLayout(content, '汇总分析');
    
    document.getElementById('analysisTaskSelect').onchange = async (e) => {
      const taskId = e.target.value;
      if (taskId) {
        await loadAnalysis(parseInt(taskId));
      } else {
        document.getElementById('analysisContent').style.display = 'none';
      }
    };
    
    // 如果有预选任务
    if (state.params.taskId) {
      document.getElementById('analysisTaskSelect').value = state.params.taskId;
      await loadAnalysis(state.params.taskId);
    }
  }

  async function loadAnalysis(taskId) {
    try {
      const { data } = await api.getAnalysis(taskId);
      const task = data.task;
      const assignments = data.assignments;
      
      const submitted = assignments.filter(a => a.status === 'submitted').length;
      const filling = assignments.filter(a => a.status === 'filling').length;
      const pending = assignments.filter(a => a.status === 'pending').length;
      const total = assignments.length;
      
      document.getElementById('analysisContent').style.display = 'block';
      
      document.getElementById('analysisStats').innerHTML = `
        <div class="submission-status">
          <div class="status-item submitted">
            <div class="status-count">${submitted}</div>
            <div class="status-label">已提交 (${total > 0 ? Math.round(submitted/total*100) : 0}%)</div>
          </div>
          <div class="status-item filling">
            <div class="status-count">${filling}</div>
            <div class="status-label">填报中 (${total > 0 ? Math.round(filling/total*100) : 0}%)</div>
          </div>
          <div class="status-item pending">
            <div class="status-count">${pending}</div>
            <div class="status-label">未填报 (${total > 0 ? Math.round(pending/total*100) : 0}%)</div>
          </div>
        </div>
        <div style="margin-top:15px;">
          <button class="btn btn-primary btn-sm" onclick="location.href='${api.getExportUrl(taskId)}'">
            <i class="fas fa-download"></i> 导出Excel
          </button>
          ${pending > 0 ? `
            <button class="btn btn-warning btn-sm" onclick="batchRemind(${taskId})">
              <i class="fas fa-bell"></i> 批量催办
            </button>
          ` : ''}
        </div>
      `;
      
      // 图表
      const chart = echarts.init(document.getElementById('analysisChart'));
      chart.setOption({
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          data: [
            { value: submitted, name: '已提交', itemStyle: { color: '#52c41a' } },
            { value: filling, name: '填报中', itemStyle: { color: '#faad14' } },
            { value: pending, name: '未填报', itemStyle: { color: '#ff4d4f' } }
          ]
        }]
      });
      
      // 表格
      document.getElementById('analysisTable').innerHTML = `
        <table>
          <thead>
            <tr>
              <th>单位名称</th>
              <th>层级</th>
              <th>状态</th>
              <th>提交人</th>
              <th>提交时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${assignments.map(a => `
              <tr>
                <td>${utils.escapeHtml(a.unit_name || '-')}</td>
                <td>第${a.level}级</td>
                <td><span class="status-badge ${a.status}">${a.status === 'submitted' ? '已提交' : a.status === 'filling' ? '填报中' : '未填报'}</span></td>
                <td>${utils.escapeHtml(a.submitter_name || '-')}</td>
                <td>${utils.formatDateTime(a.submitted_at)}</td>
                <td>
                  ${a.status !== 'submitted' ? `
                    <button class="btn btn-warning btn-sm" onclick="remindUnit(${a.id})">
                      <i class="fas fa-bell"></i> 催办
                    </button>
                  ` : `
                    <button class="btn btn-secondary btn-sm" onclick="viewSubmissionData(${a.id}, ${taskId})">
                      <i class="fas fa-eye"></i> 查看
                    </button>
                  `}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      
    } catch (error) {
      showToast('加载失败: ' + error.message, 'error');
    }
  }

  window.remindUnit = async function(assignmentId) {
    try {
      await api.remind(assignmentId);
      showToast('催办成功', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  window.batchRemind = async function(taskId) {
    try {
      await api.remindBatch(taskId);
      showToast('批量催办成功', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  window.viewSubmissionData = function(assignmentId, taskId) {
    // 简单显示填报数据
    loadAnalysis(taskId);
  };

  // ========== 审计日志 ==========
  async function renderAudit() {
    const { data } = await api.getAuditLogs({ page: 1, pageSize: 50 });
    
    const content = `
      <div class="card">
        <div class="card-header">
          <h3><i class="fas fa-history"></i> 审计日志</h3>
        </div>
        <div class="card-body">
          <div style="margin-bottom:20px;">
            <form id="auditFilter" style="display:flex;gap:15px;flex-wrap:wrap;">
              <input type="date" class="form-control" name="start_date" placeholder="开始日期" style="width:150px;">
              <input type="date" class="form-control" name="end_date" placeholder="结束日期" style="width:150px;">
              <select class="form-control" name="action" style="width:150px;">
                <option value="">全部操作</option>
                <option value="登录">登录</option>
                <option value="创建表单">创建表单</option>
                <option value="发布任务">发布任务</option>
                <option value="提交表单">提交表单</option>
                <option value="催办提醒">催办提醒</option>
              </select>
              <button type="submit" class="btn btn-primary btn-sm">筛选</button>
            </form>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>操作类型</th>
                <th>详情</th>
                <th>IP地址</th>
              </tr>
            </thead>
            <tbody>
              ${data.logs.map(log => `
                <tr>
                  <td>${utils.formatDateTime(log.created_at)}</td>
                  <td>${utils.escapeHtml(log.user_name || '-')}</td>
                  <td>${utils.escapeHtml(log.action)}</td>
                  <td>${utils.escapeHtml(log.detail || '-')}</td>
                  <td>${utils.escapeHtml(log.ip || '-')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          ${data.total > data.pageSize ? `
            <div class="pagination">
              <button ${data.page <= 1 ? 'disabled' : ''} onclick="loadAuditPage(${data.page - 1})">上一页</button>
              <span>第 ${data.page} / ${Math.ceil(data.total / data.pageSize)} 页</span>
              <button ${data.page >= Math.ceil(data.total / data.pageSize) ? 'disabled' : ''} onclick="loadAuditPage(${data.page + 1})">下一页</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    
    document.getElementById('app').innerHTML = renderLayout(content, '审计日志');
    
    document.getElementById('auditFilter').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const params = {
        start_date: form.start_date.value,
        end_date: form.end_date.value,
        action: form.action.value
      };
      const { data } = await api.getAuditLogs({ ...params, page: 1, pageSize: 50 });
      // 简单刷新
      renderAudit();
    };
  }

  // ========== 系统设置 ==========
  async function renderSettings() {
    const [usersRes, unitsRes] = await Promise.all([
      api.getUsers(),
      api.getUnits()
    ]);
    
    const users = usersRes.data;
    const units = unitsRes.data.units;
    
    const content = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-users"></i> 用户管理</h3>
            <button class="btn btn-primary btn-sm" onclick="showAddUserModal()">
              <i class="fas fa-plus"></i> 添加用户
            </button>
          </div>
          <div class="card-body">
            <table>
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>姓名</th>
                  <th>角色</th>
                  <th>单位</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${users.map(u => `
                  <tr>
                    <td>${utils.escapeHtml(u.username)}</td>
                    <td>${utils.escapeHtml(u.real_name)}</td>
                    <td><span class="status-badge ${u.role}">${u.role === 'admin' ? '管理员' : u.role === 'finance' ? '财务' : '经办人'}</span></td>
                    <td>${utils.escapeHtml(u.unit_name || '-')}</td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="editUser(${u.id})">编辑</button>
                      <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">删除</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3><i class="fas fa-building"></i> 组织架构</h3>
            <button class="btn btn-primary btn-sm" onclick="showAddUnitModal()">
              <i class="fas fa-plus"></i> 添加单位
            </button>
          </div>
          <div class="card-body" style="max-height:500px;overflow-y:auto;">
            <div id="unitManagement">
              ${renderUnitManagement(units, 0)}
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:20px;">
        <div class="card-header">
          <h3><i class="fas fa-info-circle"></i> 系统信息</h3>
        </div>
        <div class="card-body">
          <p><strong>系统名称：</strong>财务表单收集系统</p>
          <p><strong>版本：</strong>1.0.0</p>
          <p><strong>部署方式：</strong>内网私有化部署</p>
        </div>
      </div>
    `;
    
    document.getElementById('app').innerHTML = renderLayout(content, '系统设置');
  }

  function renderUnitManagement(units, level = 0) {
    const levelUnits = units.filter(u => u.level === level + 1);
    const paddingLeft = level * 20;
    
    return levelUnits.map(u => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0;padding-left:${paddingLeft}px;">
        <span style="flex:1;">${'　'.repeat(level)}${level > 0 ? '└ ' : ''}${utils.escapeHtml(u.name)}</span>
        <button class="btn btn-secondary btn-sm" onclick="editUnit(${u.id}, '${utils.escapeHtml(u.name)}')">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="deleteUnit(${u.id})">删除</button>
      </div>
      ${renderUnitManagement(units, u.level)}
    `).join('');
  }

  window.showAddUserModal = function() {
    const units = window._units || [];
    showModal('添加用户', `
      <div class="form-group">
        <label>用户名</label>
        <input type="text" class="form-control" id="newUsername">
      </div>
      <div class="form-group">
        <label>密码</label>
        <input type="password" class="form-control" id="newPassword">
      </div>
      <div class="form-group">
        <label>姓名</label>
        <input type="text" class="form-control" id="newRealName">
      </div>
      <div class="form-group">
        <label>角色</label>
        <select class="form-control" id="newRole">
          <option value="filler">经办人</option>
          <option value="finance">财务人员</option>
          <option value="admin">管理员</option>
        </select>
      </div>
      <div class="form-group">
        <label>所属单位</label>
        <select class="form-control" id="newUnitId">
          <option value="">无</option>
          ${units.map(u => `<option value="${u.id}">${utils.escapeHtml(u.name)}</option>`).join('')}
        </select>
      </div>
    `, [
      { text: '取消', class: 'btn-secondary', onClick: () => {} },
      { text: '添加', class: 'btn-primary', onClick: async () => {
        try {
          await api.createUser({
            username: document.getElementById('newUsername').value,
            password: document.getElementById('newPassword').value,
            real_name: document.getElementById('newRealName').value,
            role: document.getElementById('newRole').value,
            unit_id: document.getElementById('newUnitId').value || null
          });
          showToast('添加成功', 'success');
          renderSettings();
        } catch (error) {
          showToast(error.message, 'error');
        }
      }}
    ]);
  };

  window.editUser = async function(id) {
    // 简化实现
    showToast('编辑功能开发中', 'info');
  };

  window.deleteUser = function(id) {
    confirm('确定删除此用户？', async () => {
      try {
        await api.deleteUser(id);
        showToast('删除成功', 'success');
        renderSettings();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  };

  window.showAddUnitModal = function() {
    const units = window._units || [];
    showModal('添加单位', `
      <div class="form-group">
        <label>单位名称</label>
        <input type="text" class="form-control" id="newUnitName">
      </div>
      <div class="form-group">
        <label>上级单位</label>
        <select class="form-control" id="newParentId">
          <option value="">无（顶级单位）</option>
          ${units.map(u => `<option value="${u.id}">${utils.escapeHtml(u.name)} (第${u.level}级)</option>`).join('')}
        </select>
      </div>
    `, [
      { text: '取消', class: 'btn-secondary', onClick: () => {} },
      { text: '添加', class: 'btn-primary', onClick: async () => {
        const name = document.getElementById('newUnitName').value.trim();
        const parentId = document.getElementById('newParentId').value;
        const level = parentId ? (units.find(u => u.id == parentId)?.level || 0) + 1 : 1;
        
        if (!name) {
          showToast('请输入单位名称', 'error');
          return;
        }
        
        try {
          await api.createUnit({ name, parent_id: parentId || null, level });
          showToast('添加成功', 'success');
          renderSettings();
        } catch (error) {
          showToast(error.message, 'error');
        }
      }}
    ]);
  };

  window.editUnit = function(id, name) {
    showModal('编辑单位', `
      <div class="form-group">
        <label>单位名称</label>
        <input type="text" class="form-control" id="editUnitName" value="${utils.escapeHtml(name)}">
      </div>
    `, [
      { text: '取消', class: 'btn-secondary', onClick: () => {} },
      { text: '保存', class: 'btn-primary', onClick: async () => {
        const newName = document.getElementById('editUnitName').value.trim();
        if (!newName) {
          showToast('请输入单位名称', 'error');
          return;
        }
        try {
          await api.updateUnit(id, { name: newName });
          showToast('保存成功', 'success');
          renderSettings();
        } catch (error) {
          showToast(error.message, 'error');
        }
      }}
    ]);
  };

  window.deleteUnit = function(id) {
    confirm('确定删除此单位？', async () => {
      try {
        await api.deleteUnit(id);
        showToast('删除成功', 'success');
        renderSettings();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  };

  // ========== 路由与导航 ==========
  
  window.navigate = function(page, params = {}) {
    state.currentPage = page;
    state.params = params;
    window.location.hash = `#/${page}`;
  };

  async function handleRoute() {
    const hash = window.location.hash || '#/';
    const path = hash.replace('#', '') || '/';
    
    // 移除token检查
    if (!api.token) {
      document.getElementById('app').innerHTML = renderLogin();
      bindLoginEvents();
      return;
    }
    
    // 获取用户信息
    if (!state.user) {
      try {
        const { data } = await api.getMe();
        state.user = data;
        window._units = data._units;
      } catch (e) {
        api.setToken(null);
        document.getElementById('app').innerHTML = renderLogin();
        bindLoginEvents();
        return;
      }
    }
    
    // 根据角色重定向
    if (state.user.role === 'filler') {
      if (path === '/' || path === '/dashboard') {
        state.currentPage = 'filler-home';
      } else {
        state.currentPage = path.replace('/', '');
      }
    } else {
      if (path === '/' || path === '/dashboard') {
        state.currentPage = 'dashboard';
      } else {
        state.currentPage = path.replace('/', '');
      }
    }
    
    // 渲染页面
    try {
      switch (state.currentPage) {
        case 'login':
          document.getElementById('app').innerHTML = renderLogin();
          bindLoginEvents();
          break;
        case 'filler-home':
          await renderFillerHome();
          break;
        case 'filler-history':
          await renderFillerHistory();
          break;
        case 'dashboard':
          await renderDashboard();
          break;
        case 'form-builder':
          await renderFormBuilder();
          break;
        case 'publish':
          await renderPublish();
          break;
        case 'analysis':
          await renderAnalysis();
          break;
        case 'audit':
          await renderAudit();
          break;
        case 'settings':
          await renderSettings();
          break;
        default:
          if (state.user.role === 'filler') {
            await renderFillerHome();
          } else {
            await renderDashboard();
          }
      }
    } catch (error) {
      showToast('加载失败: ' + error.message, 'error');
    }
    
    // 绑定导航事件
    bindNavEvents();
    bindLogoutEvent();
  }

  function bindLoginEvents() {
    const form = document.getElementById('loginForm');
    if (!form) return;
    
    form.onsubmit = async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      
      try {
        await api.login(formData.get('username'), formData.get('password'));
        showToast('登录成功', 'success');
        handleRoute();
      } catch (error) {
        showToast(error.message, 'error');
      }
    };
  }

  function bindNavEvents() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.onclick = () => navigate(item.dataset.page);
    });
  }

  function bindLogoutEvent() {
    const btn = document.getElementById('logoutBtn');
    if (!btn) return;
    
    btn.onclick = async () => {
      await api.logout();
      state.user = null;
      api.setToken(null);
      navigate('login');
    };
  }

  // 初始化
  window.addEventListener('hashchange', handleRoute);
  handleRoute();

})();
