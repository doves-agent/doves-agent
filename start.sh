#!/bin/bash

# 白鸽启动脚本
# 完整链路: CLI -> Gateway -> MongoDB -> Doves

set -e

cd "$(dirname "$0")"

echo "========================================"
echo "  白鸽启动脚本"
echo "========================================"

# 加载环境变量
if [ -f "../.env" ]; then
    export $(grep -v '^#' ../.env | xargs)
fi

# 检查 MongoDB 连接
echo ""
echo "[1/3] 检查 MongoDB 连接..."
if command -v mongosh &> /dev/null; then
    mongosh "$MONGODB" --eval "db.runCommand({ping:1})" > /dev/null 2>&1 && echo "✓ MongoDB 连接正常" || echo "✗ MongoDB 连接失败"
else
    echo "⚠ 无法检查 MongoDB（mongosh 未安装）"
fi

# 启动 Server
echo ""
echo "[2/3] 启动服务端..."
cd Server

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "  安装服务端依赖..."
    npm install
fi

# 后台启动服务端
if ! lsof -i :3003 > /dev/null 2>&1; then
    echo "  启动服务端 (加密TCP端口 3003)..."
    nohup node index.js > ../logs/server.log 2>&1 &
    sleep 2
    echo "✓ 服务端已启动"
else
    echo "✓ 服务端已在运行"
fi

cd ..

# 启动 doves
echo ""
echo "[3/3] 启动鸽群..."
cd doves

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "  安装鸽子依赖..."
    npm install
fi

# 后台启动鸽子
echo "  启动鸽子服务..."
nohup node 入口.js > ../logs/doves.log 2>&1 &
sleep 2
echo "✓ 鸽群已启动"

cd ..

echo ""
echo "========================================"
echo "  启动完成！"
echo "========================================"
echo ""
echo "服务端地址: 加密TCP localhost:3003"
echo "连通测试: dove ping"
echo ""
echo "CLI 使用:"
echo "  cd CLI && npm install"
echo "  node index.js login -a        # 匿名登录"
echo "  node index.js chat            # 开始对话"
echo "  node index.js task list       # 查看任务列表"
echo ""
echo "日志位置: ./logs/"
echo ""
