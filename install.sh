#!/bin/bash
# ==========================================
# 白鸽一键部署脚本
# ==========================================
# 使用方法:
#   curl -fsSL https://raw.githubusercontent.com/doves-agent/doves-agent/main/install.sh | bash
#   或: ./install.sh [选项]
#
# 选项:
#   --docker        使用 Docker 部署（默认）
#   --bare-metal    裸机部署（Node.js + PM2）
#   --port PORT     指定端口号（默认 3100）
#   --with-mongo    包含 MongoDB 容器
#   --skip-mongo    使用外部 MongoDB
#   --help          显示帮助
# ==========================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 默认配置
DEPLOY_MODE="docker"
PORT=3100
WITH_MONGO=true
INSTALL_DIR="$HOME/dove"

# ==================== 工具函数 ====================

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

check_command() {
  if ! command -v "$1" &> /dev/null; then
    error "$1 未安装，请先安装: $2"
  fi
}

# ==================== 参数解析 ====================

while [[ $# -gt 0 ]]; do
  case $1 in
    --docker) DEPLOY_MODE="docker"; shift ;;
    --bare-metal) DEPLOY_MODE="bare-metal"; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --with-mongo) WITH_MONGO=true; shift ;;
    --skip-mongo) WITH_MONGO=false; shift ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --help) 
      echo "白鸽一键部署脚本"
      echo "用法: ./install.sh [选项]"
      echo "  --docker        Docker 部署（默认）"
      echo "  --bare-metal    裸机部署（Node.js + PM2）"
      echo "  --port PORT     端口号（默认 3100）"
      echo "  --with-mongo    包含 MongoDB（默认）"
      echo "  --skip-mongo    使用外部 MongoDB"
      echo "  --dir DIR       安装目录（默认 ~/dove）"
      exit 0 ;;
    *) error "未知选项: $1" ;;
  esac
done

# ==================== 环境检查 ====================

info "检查运行环境..."

if [ "$DEPLOY_MODE" = "docker" ]; then
  check_command "docker" "https://docs.docker.com/get-docker/"
  check_command "docker-compose" "或使用 docker compose (Docker Compose V2)"
  
  # 检查 Docker 是否运行
  if ! docker info &> /dev/null; then
    error "Docker 未运行，请先启动 Docker"
  fi
  success "Docker 环境检查通过"
  
elif [ "$DEPLOY_MODE" = "bare-metal" ]; then
  check_command "node" "https://nodejs.org/ (需要 >= 18.0.0)"
  check_command "npm" "随 Node.js 安装"
  
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    error "Node.js 版本需要 >= 18.0.0，当前: $(node -v)"
  fi
  success "Node.js 环境检查通过 (v$(node -v))"
fi

# ==================== 获取代码 ====================

info "准备白鸽代码..."

if [ -d "$INSTALL_DIR/.git" ]; then
  info "检测到已有安装，更新代码..."
  cd "$INSTALL_DIR"
  git pull || warn "Git 更新失败，继续使用现有代码"
else
  info "克隆代码到 $INSTALL_DIR..."
  git clone https://github.com/doves-agent/doves-agent.git "$INSTALL_DIR" || {
    # 如果 Git 不可用，提示手动下载
    warn "Git 克隆失败，请手动下载代码到 $INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
  }
  cd "$INSTALL_DIR"
fi

# ==================== 配置环境 ====================

if [ ! -f .env ]; then
  info "创建配置文件 .env..."
  
  # 生成随机密钥
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  HASH_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  
  cat > .env << EOF
# 白鸽云端服务配置 - 自动生成
# 请根据实际环境修改以下配置

# 安全密钥
JWT_SECRET=${JWT_SECRET}
HASH_SECRET=${HASH_SECRET}

# 服务配置
PORT=${PORT}
HOST=0.0.0.0
NODE_ENV=production

# MongoDB 连接
MONGODB=mongodb://doves_admin:changeme@localhost:27017/admin
MONGODB_ADMIN_DB=doves_admin
MONGODB_USER_DB=doves_user_data

# 注册限制
DAILY_LIMIT=100
IP_DAILY_LIMIT=5

# OSS 配置（可选）
# OSS_ENABLED=false
# OSS_REGION=oss-cn-shanghai
# OSS_ACCESS_KEY_ID=
# OSS_ACCESS_KEY_SECRET=
# OSS_BUCKET=
EOF
  
  success "配置文件已创建: .env"
  warn "请编辑 .env 文件，配置 MongoDB 连接和 LLM API Key"
else
  info "配置文件 .env 已存在，跳过"
fi

# ==================== Docker 部署 ====================

if [ "$DEPLOY_MODE" = "docker" ]; then
  info "使用 Docker 部署..."
  
  # 构建 Docker 镜像
  info "构建 Docker 镜像（首次可能需要几分钟）..."
  docker build -t dove:latest . || error "Docker 镜像构建失败"
  success "Docker 镜像构建完成"
  
  if [ "$WITH_MONGO" = true ]; then
    info "启动白鸽服务（含 MongoDB）..."
    docker compose up -d || error "Docker Compose 启动失败"
  else
    info "启动白鸽服务（使用外部 MongoDB）..."
    docker compose up -d dove || error "Docker 启动失败"
  fi
  
  success "Docker 部署完成"
  
# ==================== 裸机部署 ====================

elif [ "$DEPLOY_MODE" = "bare-metal" ]; then
  info "使用裸机部署..."
  
  # 安装依赖
  info "安装依赖..."
  npm run install:all || error "依赖安装失败"
  success "依赖安装完成"
  
  # 安装 PM2
  if ! command -v pm2 &> /dev/null; then
    info "安装 PM2 进程管理器..."
    npm install -g pm2 || error "PM2 安装失败"
  fi
  
  # 启动服务
  info "启动白鸽服务..."
  PORT=$PORT npm run start:prod || error "服务启动失败"
  
  # 保存 PM2 配置
  pm2 save
  
  # 尝试设置开机自启
  if pm2-startup install 2>/dev/null; then
    success "已配置开机自启"
  else
    warn "开机自启配置失败，请手动运行: pm2-startup install && pm2 save"
  fi
  
  success "裸机部署完成"
fi

# ==================== 健康检查 ====================

info "等待服务启动..."
sleep 5

HEALTH_URL="http://localhost:${PORT}/health"
MAX_RETRIES=10
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    success "白鸽服务运行正常！"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  info "等待服务启动... ($RETRY_COUNT/$MAX_RETRIES)"
  sleep 3
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  warn "健康检查未通过，请检查日志"
  if [ "$DEPLOY_MODE" = "docker" ]; then
    echo "  查看日志: docker compose logs -f dove"
  else
    echo "  查看日志: pm2 logs"
  fi
fi

# ==================== 部署信息 ====================

echo ""
echo "=========================================="
success "白鸽部署完成！"
echo "=========================================="
echo ""
echo "  服务地址: http://localhost:${PORT}"
echo "  健康检查: http://localhost:${PORT}/health"
echo "  API 版本: http://localhost:${PORT}/api/versions"
echo "  协议文档: http://localhost:${PORT}/api/protocol-doc"
echo ""
echo "  部署模式: $DEPLOY_MODE"
echo "  安装目录: $INSTALL_DIR"
echo ""

if [ "$DEPLOY_MODE" = "docker" ]; then
  echo "  常用命令:"
  echo "    查看日志: docker compose logs -f dove"
  echo "    停止服务: docker compose down"
  echo "    重启服务: docker compose restart"
  echo "    数据库面板: docker compose --profile debug up -d"
else
  echo "  常用命令:"
  echo "    查看日志: pm2 logs"
  echo "    停止服务: pm2 stop ecosystem.config.cjs"
  echo "    重启服务: pm2 restart ecosystem.config.cjs"
  echo "    查看状态: pm2 status"
fi

echo ""
warn "重要: 请编辑 .env 文件配置 LLM API Key 和数据库连接"
echo "  配置文件: $INSTALL_DIR/.env"
echo ""
