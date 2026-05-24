#!/bin/bash
# 财务表单收集系统 - 一键部署脚本 (Vercel + Turso)
# 使用方法: bash deploy.sh

set -e

echo "========================================="
echo "  财务表单收集系统 - 一键云部署"
echo "========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 检查命令是否存在
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# 第一步：检查并安装 Node.js
echo -e "${YELLOW}[1/6] 检查 Node.js...${NC}"
if ! command_exists node; then
  echo "未检测到 Node.js，正在安装..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install node
  elif [[ "$OSTYPE" == "linux"* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
fi
echo -e "${GREEN}Node.js $(node -v) ✓${NC}"
echo ""

# 第二步：克隆项目
echo -e "${YELLOW}[2/6] 克隆项目...${NC}"
if [ -d "form-collector" ]; then
  echo "目录已存在，拉取最新代码..."
  cd form-collector && git pull
else
  git clone https://github.com/yuanjingwu87/form-collector.git
  cd form-collector
fi
echo -e "${GREEN}项目代码就绪 ✓${NC}"
echo ""

# 第三步：安装依赖
echo -e "${YELLOW}[3/6] 安装依赖...${NC}"
npm install
echo -e "${GREEN}依赖安装完成 ✓${NC}"
echo ""

# 第四步：安装并配置 Turso
echo -e "${YELLOW}[4/6] 配置 Turso 数据库...${NC}"
if ! command_exists turso; then
  echo "安装 Turso CLI..."
  curl -sSfL https://get.tur.so/install.sh | bash
  export PATH="$HOME/.turso:$PATH"
fi

# 检查是否已登录 Turso
if ! turso auth whoami 2>/dev/null | grep -q "Username"; then
  echo ""
  echo -e "${YELLOW}需要在浏览器中登录 Turso（支持 GitHub 一键登录）${NC}"
  echo "即将打开浏览器，请完成登录后回到终端..."
  turso auth login
fi

echo ""
echo "已登录 Turso: $(turso auth whoami)"
echo ""

# 创建数据库
DB_NAME="form-collector"
EXISTING_DB=$(turso db list 2>/dev/null | grep "$DB_NAME" || true)
if [ -z "$EXISTING_DB" ]; then
  echo "创建 Turso 数据库: $DB_NAME ..."
  turso db create "$DB_NAME"
  echo -e "${GREEN}数据库创建成功 ✓${NC}"
else
  echo "数据库 $DB_NAME 已存在，跳过创建"
fi

# 获取数据库连接信息
TURSO_URL=$(turso db show "$DB_NAME" --url 2>/dev/null)
echo -e "${GREEN}数据库 URL: $TURSO_URL ✓${NC}"

# 生成数据库 Auth Token
TURSO_AUTH_TOKEN=$(turso db tokens create "$DB_NAME" 2>/dev/null)
echo -e "${GREEN}数据库 Token 已生成 ✓${NC}"
echo ""

# 第五步：初始化数据库
echo -e "${YELLOW}[5/6] 初始化数据库表和默认数据...${NC}"
TURSO_URL="$TURSO_URL" TURSO_AUTH_TOKEN="$TURSO_AUTH_TOKEN" node -e "
const { createClient } = require('@libsql/client');
async function init() {
  const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  // 导入db.js的初始化逻辑
  const { initDB } = require('./db');
  await initDB();
  console.log('数据库初始化完成');
}
init().catch(e => { console.error('初始化失败:', e.message); process.exit(1); });
" 2>&1 || echo "数据库可能已初始化，继续..."
echo -e "${GREEN}数据库初始化 ✓${NC}"
echo ""

# 第六步：部署到 Vercel
echo -e "${YELLOW}[6/6] 部署到 Vercel...${NC}"
if ! command_exists vercel; then
  echo "安装 Vercel CLI..."
  npm install -g vercel
fi

# 检查是否已登录 Vercel
if ! vercel whoami 2>/dev/null | grep -q "@"; then
  echo ""
  echo -e "${YELLOW}需要在浏览器中登录 Vercel（支持 GitHub 一键登录）${NC}"
  echo "即将打开浏览器，请完成登录后回到终端..."
  vercel login
fi

echo ""
echo "已登录 Vercel: $(vercel whoami)"
echo ""

# 部署项目（带环境变量）
echo "开始部署..."
vercel --yes \
  --env TURSO_URL="$TURSO_URL" \
  --env TURSO_AUTH_TOKEN="$TURSO_AUTH_TOKEN" \
  --env JWT_SECRET="5eae4cd8eaf249155b7194cf9f842dab4a071a8810cbc16844079a1b6bfdf8c9"

echo ""
echo "========================================="
echo -e "${GREEN}  部署完成！${NC}"
echo "========================================="
echo ""
echo "测试账号："
echo "  管理员: admin / admin123"
echo "  财务:   finance / finance123"
echo "  经办人: filler / filler123"
echo ""
echo "如需自定义域名，请在 Vercel 控制台设置。"
