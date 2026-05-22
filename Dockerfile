# 白鸽多阶段构建 Dockerfile
# 支持: server / dove / full 三种模式

# ==================== 基础镜像 ====================
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

# ==================== 依赖安装阶段 ====================
FROM base AS deps

# 先复制 package.json 以利用 Docker 缓存
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY doves/package.json ./doves/
COPY cli/package.json ./cli/

# 安装依赖
RUN npm ci --omit=dev && \
    cd server && npm ci --omit=dev && \
    cd ../doves && npm ci --omit=dev && \
    cd ../cli && npm ci --omit=dev

# ==================== 构建阶段 ====================
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/doves/node_modules ./doves/node_modules
COPY --from=deps /app/cli/node_modules ./cli/node_modules
COPY . .

# ==================== 运行阶段 ====================
FROM base AS runtime

# 安装运行时依赖（PM2 for process management）
RUN npm install -g pm2

# 复制构建产物
COPY --from=build /app/package.json /app/package-lock.json /app/ecosystem.config.cjs ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/doves ./doves
COPY --from=build /app/cli ./cli
COPY --from=build /app/common ./common

# 创建日志目录
RUN mkdir -p logs

# 环境变量默认值
ENV NODE_ENV=production
ENV PORT=3100
ENV HOST=0.0.0.0

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

# 暴露端口
EXPOSE ${PORT}

# 数据卷（日志、配置）
VOLUME ["/app/logs", "/app/.env"]

# 默认启动命令：独立进程模式（服务端 + 鸽子）
CMD ["pm2-runtime", "start", "ecosystem.config.cjs"]
