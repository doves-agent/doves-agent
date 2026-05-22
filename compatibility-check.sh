#!/bin/bash
# ==========================================
# 白鸽 2.0 多平台兼容性测试
# ==========================================
# 检测当前环境是否满足白鸽运行要求
# 支持: Linux / macOS / Windows (Git Bash / WSL)
# ==========================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

pass() { PASS=$((PASS+1)); echo -e "  ${GREEN}[PASS]${NC} $1"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${RED}[FAIL]${NC} $1"; }
warn() { WARN=$((WARN+1)); echo -e "  ${YELLOW}[WARN]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

# ==================== 操作系统检测 ====================

info "=== 操作系统 ==="
OS="$(uname -s)"
case "$OS" in
  Linux*)   pass "Linux 系统";;
  Darwin*)  pass "macOS 系统";;
  MINGW*|MSYS*|CYGWIN*) pass "Windows (Git Bash/Cygwin) 系统";;
  *)        warn "未知系统: $OS";;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)  pass "x86_64 架构";;
  aarch64|arm64) pass "ARM64 架构";;
  *)              warn "未测试架构: $ARCH";;
esac

# ==================== Node.js 检测 ====================

info "=== Node.js ==="
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 18 ]; then
    pass "Node.js $(node -v) (>= 18.0.0)"
  else
    fail "Node.js $(node -v) - 需要 >= 18.0.0"
  fi
  
  # 检查 ES Modules 支持
  if node -e "import('fs')" 2>/dev/null; then
    pass "ES Modules 支持正常"
  else
    fail "ES Modules 支持异常"
  fi
  
  # 检查 Node.js 可用内存
  NODE_MEM=$(node -e "console.log(Math.round(require('os').totalmem() / 1024 / 1024))")
  if [ "$NODE_MEM" -ge 512 ]; then
    pass "可用内存: ${NODE_MEM}MB"
  else
    warn "可用内存较低: ${NODE_MEM}MB (推荐 >= 512MB)"
  fi
else
  fail "Node.js 未安装"
fi

# ==================== npm 检测 ====================

info "=== npm ==="
if command -v npm &> /dev/null; then
  pass "npm $(npm -v)"
else
  fail "npm 未安装"
fi

# ==================== MongoDB 连接检测 ====================

info "=== MongoDB ==="
if command -v mongosh &> /dev/null; then
  pass "mongosh 已安装"
elif command -v mongo &> /dev/null; then
  warn "mongo CLI 已安装 (建议升级到 mongosh)"
else
  warn "MongoDB CLI 未安装（非必需，可通过应用连接）"
fi

# 检查 .env 中的 MongoDB 配置
if [ -f .env ]; then
  if grep -q "^MONGODB=" .env; then
    MONGO_URL=$(grep "^MONGODB=" .env | cut -d= -f2-)
    if [ -n "$MONGO_URL" ]; then
      pass ".env 中已配置 MONGODB 连接"
    else
      fail ".env 中 MONGODB 连接为空"
    fi
  else
    warn ".env 中未配置 MONGODB"
  fi
else
  warn ".env 文件不存在（首次部署需创建）"
fi

# ==================== Docker 检测 ====================

info "=== Docker ==="
if command -v docker &> /dev/null; then
  pass "Docker 已安装: $(docker --version)"
  if docker info &> /dev/null; then
    pass "Docker 守护进程运行中"
  else
    warn "Docker 守护进程未运行"
  fi
else
  warn "Docker 未安装（可选，用于容器化部署）"
fi

if command -v docker-compose &> /dev/null || docker compose version &> /dev/null 2>&1; then
  pass "Docker Compose 可用"
else
  warn "Docker Compose 不可用"
fi

# ==================== PM2 检测 ====================

info "=== PM2 ==="
if command -v pm2 &> /dev/null; then
  pass "PM2 已安装: $(pm2 -v)"
else
  warn "PM2 未安装（裸机部署需要，Docker 部署不需要）"
fi

# ==================== 网络检测 ====================

info "=== 网络 ==="
if curl -sf --connect-timeout 5 https://registry.npmjs.org/ > /dev/null 2>&1; then
  pass "npm registry 可访问"
else
  warn "npm registry 不可访问（可能需要配置代理或镜像源）"
fi

if curl -sf --connect-timeout 5 https://developer.mozilla.org > /dev/null 2>&1; then
  pass "外网连接正常"
else
  warn "外网连接异常（LLM API 可能不可用）"
fi

# ==================== 端口检测 ====================

info "=== 端口 ==="
CHECK_PORT=${PORT:-3100}
if command -v lsof &> /dev/null; then
  if lsof -i :$CHECK_PORT &> /dev/null; then
    warn "端口 $CHECK_PORT 已被占用"
  else
    pass "端口 $CHECK_PORT 可用"
  fi
elif command -v netstat &> /dev/null; then
  if netstat -an 2>/dev/null | grep ":$CHECK_PORT " | grep LISTEN &> /dev/null; then
    warn "端口 $CHECK_PORT 已被占用"
  else
    pass "端口 $CHECK_PORT 可用"
  fi
else
  warn "无法检测端口 $CHECK_PORT 状态"
fi

# ==================== 磁盘空间 ====================

info "=== 磁盘空间 ==="
if command -v df &> /dev/null; then
  AVAIL=$(df -m . 2>/dev/null | tail -1 | awk '{print $4}')
  if [ -n "$AVAIL" ] && [ "$AVAIL" -ge 1024 ]; then
    pass "磁盘可用空间: ${AVAIL}MB"
  elif [ -n "$AVAIL" ]; then
    warn "磁盘可用空间较低: ${AVAIL}MB (推荐 >= 1GB)"
  fi
fi

# ==================== 汇总 ====================

echo ""
echo "=========================================="
TOTAL=$((PASS + FAIL + WARN))
echo -e "  ${GREEN}通过: ${PASS}${NC}  ${RED}失败: ${FAIL}${NC}  ${YELLOW}警告: ${WARN}${NC}  总计: ${TOTAL}"
echo "=========================================="

if [ $FAIL -gt 0 ]; then
  echo -e "${RED}存在未通过项，请解决后再部署${NC}"
  exit 1
elif [ $WARN -gt 0 ]; then
  echo -e "${YELLOW}存在警告项，不影响基本功能但建议处理${NC}"
  exit 0
else
  echo -e "${GREEN}所有检查通过，环境就绪！${NC}"
  exit 0
fi
