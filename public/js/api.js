// API调用封装
const API_BASE = '/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('token');
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  async request(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(API_BASE + url, {
        ...options,
        headers
      });

      const data = await response.json();
      
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.setToken(null);
          window.location.hash = '#/login';
        }
        throw new Error(data.error || '请求失败');
      }
      
      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // 认证
  async login(username, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (data.success) {
      this.setToken(data.data.token);
    }
    return data;
  }

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.setToken(null);
    }
  }

  async getMe() {
    return this.request('/auth/me');
  }

  // 仪表盘
  async getDashboard() {
    return this.request('/dashboard');
  }

  // 经办人接口
  async getFillerTodos() {
    return this.request('/filler/todos');
  }

  async getFillerTask(assignmentId) {
    return this.request(`/filler/task/${assignmentId}`);
  }

  async saveDraft(assignmentId, data) {
    return this.request('/filler/save-draft', {
      method: 'POST',
      body: JSON.stringify({ assignment_id: assignmentId, data })
    });
  }

  async submitForm(assignmentId, data) {
    return this.request('/filler/submit', {
      method: 'POST',
      body: JSON.stringify({ assignment_id: assignmentId, data })
    });
  }

  async getNotifications() {
    return this.request('/notifications');
  }

  // 表单模板
  async getTemplates() {
    return this.request('/templates');
  }

  async getTemplate(id) {
    return this.request(`/templates/${id}`);
  }

  async createTemplate(data) {
    return this.request('/templates', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateTemplate(id, data) {
    return this.request(`/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deleteTemplate(id) {
    return this.request(`/templates/${id}`, { method: 'DELETE' });
  }

  // 收集任务
  async getTasks(status) {
    const query = status && status !== 'all' ? `?status=${status}` : '';
    return this.request(`/tasks${query}`);
  }

  async getTask(id) {
    return this.request(`/tasks/${id}`);
  }

  async createTask(data) {
    return this.request('/tasks', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateTaskStatus(id, status) {
    return this.request(`/tasks/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });
  }

  async deleteTask(id) {
    return this.request(`/tasks/${id}`, { method: 'DELETE' });
  }

  // 汇总分析
  async getAnalysis(taskId) {
    return this.request(`/analysis/tasks/${taskId}`);
  }

  async remind(assignmentId) {
    return this.request(`/analysis/remind/${assignmentId}`, { method: 'POST' });
  }

  async remindBatch(taskId) {
    return this.request('/analysis/remind-batch', {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId })
    });
  }

  getExportUrl(taskId) {
    return `${API_BASE}/analysis/export/${taskId}?token=${this.token}`;
  }

  // 审计日志
  async getAuditLogs(params) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/audit?${query}`);
  }

  // 组织架构
  async getUnits() {
    return this.request('/units');
  }

  async getUnitsFlat() {
    return this.request('/units/flat');
  }

  async createUnit(data) {
    return this.request('/units', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateUnit(id, data) {
    return this.request(`/units/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deleteUnit(id) {
    return this.request(`/units/${id}`, { method: 'DELETE' });
  }

  // 用户管理
  async getUsers() {
    return this.request('/users');
  }

  async createUser(data) {
    return this.request('/users', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateUser(id, data) {
    return this.request(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deleteUser(id) {
    return this.request(`/users/${id}`, { method: 'DELETE' });
  }

  // 统计
  async getStats() {
    return this.request('/stats');
  }
}

window.api = new ApiClient();
