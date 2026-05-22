# 白鸽 (Doves)

> 让每一个优秀的技能，都能通过白鸽，飞向需要它的人。

白鸽是一个开源的**智能体应用平台框架**。技能开发者部署鸽子、服务用户、获得收益 —— 白鸽是技能的翅膀。

## 理念

| 原则 | 说明 |
|------|------|
| **分配正义** | 技能定价权归开发者，收益全透明，平台不统一定价 |
| **开放生态** | 官方应用与第三方应用完全平等，同一套注册链、同一套权限模型 |
| **能力平权** | 一个人 + 一群鸽子 = 一个小团队的能力。让每个人都有基础能力 |
| **国产优先** | 阿里百炼、DeepSeek、智谱 GLM 原生支持，全中文化 |

## 核心特性

- **KISS 单循环架构** — 百万级上下文推理模型 + 单 LLM 循环，替代旧多层管道
- **多智能体协作** — 主智能体协调多专业智能体，用户自由配置团队角色和模型
- **扩展市场** — 类 VS Code 插件机制，manifest.js 声明式注册，零框架改动即可扩展
- **全链路加密** — Noise NX 加密 TCP，无明文 HTTP，无降级
- **CLI↔Dove 协作** — 鸽子可请求 CLI 上传本地文件，实现人机协作闭环
- **监工模式** — 扫描执行轨迹判定异常，不打硬超时，任务优雅退出

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

| 组件 | 职责 |
|------|------|
| **Server** | 纯数据网关 — 认证 + 数据代理 + 任务入队，不调用 LLM |
| **Doves** | 智能体运行时 — LLM 调用、工具执行、技能扩展、监工 |
| **CLI** | 命令行客户端 — 双通道（直连 + 中转），人机协作界面 |

Server 不感知 Doves 的存在，Doves 自主轮询任务队列拉取执行。

## 内置扩展

编码、Git 版本控制、代码审查、数据分析、MySQL、MongoDB、文档处理、邮箱、视频处理、电脑操作、进度管理、背单词 等。

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
- LLM API Key — 百炼 / DeepSeek / GLM 等

## 许可证

MIT
