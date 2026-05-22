# 白鸽 (Doves)

智能体应用平台框架 —— 白鸽 = 底座 + 运行时，白鸽应用 = 垂直智能体。

## 架构

```
CLI ══加密TCP══▶ Server ◀══加密TCP══ Doves
 │                 │                    ▲
 │                 ▼                    │
 │         MongoDB / OSS / 快照 / 向量  │
 │         (仅 Server 有权直接访问)      │
 │                                      │
 └══════加密TCP（同账号直连）════════════─┘
```

- **Server** — 纯数据网关（认证 + 数据代理 + 任务入队）
- **Doves** — 智能体运行时（LLM 调用、工具执行、技能扩展）
- **CLI** — 命令行客户端

全链路 Noise NX 加密 TCP，无明文 HTTP。

## 快速开始

### Docker 部署（推荐）

```bash
cp .env.example .env   # 编辑配置
docker compose up -d
```

### 手动部署

```bash
npm install
npm run build
npm start
```

### 一键安装（Linux）

```bash
curl -fsSL https://raw.githubusercontent.com/doves-agent/doves-agent/main/install.sh | bash
```

## 配置

复制 `.env.example` 并编辑：

- `MONGODB` — MongoDB 连接字符串
- `JWT_SECRET` / `HASH_SECRET` — 认证密钥（部署时自动生成）
- `OSS_*` — 对象存储配置（可选）

## 许可证

MIT
