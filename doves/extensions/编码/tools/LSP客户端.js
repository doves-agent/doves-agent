/**
 * @file tools/LSP客户端
 * @description 通用 LSP (Language Server Protocol) 客户端框架
 * 
 * 通过 stdio 与任意 LSP Server 通信，支持：
 * - 多语言多项目并发连接（连接池）
 * - Lazy 初始化（首次调用才启动 Server）
 * - 自动项目根检测
 * - Keep-alive + 自动重连
 * - JSON-RPC 2.0 标准协议
 * - 配置化：可通过环境变量或全局配置覆盖 LSP Server 命令
 * 
 * 使用方式：
 *   import { LSPManager } from './LSP客户端.js';
 *   const manager = new LSPManager();
 *   const symbol = await manager.getDefinition('/project/src/index.js', 10, 5);
 */

import { existsSync } from 'fs';
import { dirname, basename, extname, join } from 'path';
import { LSPClient } from './LSP客户端/客户端.js';
import { toUri } from './LSP客户端/解析器.js';

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('LSP', { 前缀: '[LSP]', 级别: 'debug', 显示调用位置: true });

// ==============================
// LSP Server 配置映射
// ==============================
const LSP_SERVER_CONFIG = {
  javascript: {
    languageId: 'javascript',
    serverCommand: 'typescript-language-server',
    serverArgs: ['--stdio'],
    projectFiles: ['package.json', 'tsconfig.json', 'jsconfig.json']
  },
  typescript: {
    languageId: 'typescript',
    serverCommand: 'typescript-language-server',
    serverArgs: ['--stdio'],
    projectFiles: ['tsconfig.json', 'package.json', 'jsconfig.json']
  },
  javascriptreact: {
    languageId: 'javascriptreact',
    serverCommand: 'typescript-language-server',
    serverArgs: ['--stdio'],
    projectFiles: ['package.json', 'tsconfig.json', 'jsconfig.json']
  },
  typescriptreact: {
    languageId: 'typescriptreact',
    serverCommand: 'typescript-language-server',
    serverArgs: ['--stdio'],
    projectFiles: ['tsconfig.json', 'package.json', 'jsconfig.json']
  },
  python: {
    languageId: 'python',
    serverCommand: 'pyright-langserver',
    serverArgs: ['--stdio'],
    projectFiles: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile']
  },
  go: {
    languageId: 'go',
    serverCommand: 'gopls',
    serverArgs: [],
    projectFiles: ['go.mod']
  },
  rust: {
    languageId: 'rust',
    serverCommand: 'rust-analyzer',
    serverArgs: [],
    projectFiles: ['Cargo.toml']
  },
  java: {
    languageId: 'java',
    serverCommand: 'jdtls',
    serverArgs: [],
    projectFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts']
  },
  // 默认回退
  _default: {
    languageId: 'plaintext',
    serverCommand: null,
    serverArgs: [],
    projectFiles: []
  }
};

/**
 * 根据文件扩展名检测语言
 */
function detectLanguage(filePath) {
  const ext = extname(filePath).toLowerCase();
  const base = basename(filePath).toLowerCase();
  const extMap = {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'javascriptreact',
    '.ts': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.tsx': 'typescriptreact',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.json': 'javascript', // JSON files use TS server for schema support
    '.vue': 'typescript',
    '.svelte': 'typescript',
  };
  return extMap[ext] || (base === 'eslintrc' ? 'javascript' : null);
}

/**
 * 向上查找项目根目录（找到特征文件为止）
 */
function findProjectRoot(filePath, projectFiles) {
  let dir = dirname(filePath);
  let lastDir = null;
  const maxDepth = 10; // 最多向上找 10 层

  for (let i = 0; i < maxDepth; i++) {
    if (dir === lastDir) break; // 到根了
    for (const pf of projectFiles) {
      if (existsSync(join(dir, pf))) {
        return dir;
      }
    }
    lastDir = dir;
    dir = dirname(dir);
  }
  // 没找到特征文件，用文件所在目录
  return dirname(filePath);
}

// ==============================
// JSON-RPC 消息编解码
// ==============================

/**
 * 编码 JSON-RPC 消息为 LSP 传输格式（Content-Length 头 + JSON 体）
 */
function encodeMessage(message) {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`;
  return header + body;
}

/**
 * 解析 LSP 传输格式数据，返回完整消息数组
 * 处理 TCP 粘包/拆包问题
 */
function parseMessages(buffer) {
  const messages = [];
  const text = buffer.toString('utf-8');
  const headerEnd = '\r\n\r\n';
  let pos = 0;

  while (pos < text.length) {
    const headerIdx = text.indexOf(headerEnd, pos);
    if (headerIdx === -1) break; // 不完整的头部

    const header = text.substring(pos, headerIdx);
    const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!contentLengthMatch) break;

    const contentLength = parseInt(contentLengthMatch[1], 10);
    const bodyStart = headerIdx + headerEnd.length;

    if (text.length - bodyStart < contentLength) break; // 数据还没收全

    const body = text.substring(bodyStart, bodyStart + contentLength);
    try {
      messages.push(JSON.parse(body));
    } catch (e) {
      logger.warn(`JSON-RPC 解析失败: ${e.message}`);
    }
    pos = bodyStart + contentLength;
  }

  return { messages, remaining: text.substring(pos) };
}

// ==============================
// LSP 连接管理器（连接池）
// ==============================

/**
 * LSP 连接管理器
 * 管理多个 LSP 客户端，按(项目根+语言)唯一键缓存
 */
class LSPManager {
  constructor() {
    this._clients = new Map(); // key → LSPClient
    this._config = null;       // 用户自定义配置
    this._customCommands = new Map(); // 用户自定义 LSP 命令
  }

  /**
   * 设置配置（可选）
   */
  setConfig(config) {
    this._config = config;
    // 解析自定义 LSP 命令
    if (config && config.lspCommands) {
      for (const [lang, cmd] of Object.entries(config.lspCommands)) {
        this._customCommands.set(lang, cmd);
      }
    }
  }

  /**
   * 获取 LSP 客户端（按需创建）
   */
  async getClient(filePath) {
    const language = detectLanguage(filePath);
    if (!language) {
      throw new Error(`不支持的文件类型: ${filePath}`);
    }

    const langConfig = LSP_SERVER_CONFIG[language];
    if (!langConfig || !langConfig.serverCommand) {
      throw new Error(`未找到 ${language} 的 LSP 配置`);
    }

    const projectRoot = findProjectRoot(filePath, langConfig.projectFiles);
    const key = `${projectRoot}|${language}`;

    // 缓存命中
    if (this._clients.has(key)) {
      const client = this._clients.get(key);
      if (client.isConnected) return client;
      // 连接已断开，重新创建
      logger.info(`LSP 客户端 ${key} 已断开，重新创建`);
    }

    // 检查是否有用户自定义命令
    const customCmd = this._customCommands.get(language) || process.env[`LSP_CMD_${language.toUpperCase()}`];

    const client = new LSPClient({
      projectRoot,
      languageConfig: langConfig,
      serverCommand: customCmd || langConfig.serverCommand,
    });

    await client.initialize();
    this._clients.set(key, client);
    return client;
  }

  // ==================== 便捷 API ====================

  async getDefinition(filePath, line, character) {
    const client = await this.getClient(filePath);
    return client.getDefinition(filePath, line, character);
  }

  async findReferences(filePath, line, character, includeDeclaration = false) {
    const client = await this.getClient(filePath);
    return client.findReferences(filePath, line, character, includeDeclaration);
  }

  async getDocumentSymbols(filePath) {
    const client = await this.getClient(filePath);
    return client.getDocumentSymbols(filePath);
  }

  async findImplementations(filePath, line, character) {
    const client = await this.getClient(filePath);
    return client.findImplementations(filePath, line, character);
  }

  async getHoverInfo(filePath, line, character) {
    const client = await this.getClient(filePath);
    return client.getHoverInfo(filePath, line, character);
  }

  async getCallHierarchy(filePath, line, character) {
    const client = await this.getClient(filePath);
    const items = await client.prepareCallHierarchy(filePath, line, character);
    if (!items || items.length === 0) return { item: null, incoming: [], outgoing: [] };

    const item = items[0];
    const [incoming, outgoing] = await Promise.all([
      client.getIncomingCalls(item._raw).catch(() => []),
      client.getOutgoingCalls(item._raw).catch(() => []),
    ]);

    return {
      item: { name: item.name, kind: item.kind, detail: item.detail, filePath: item.filePath, range: item.range },
      incoming,
      outgoing,
    };
  }

  async getWorkspaceSymbols(query) {
    // 需要先有一个已连接的客户端
    for (const client of this._clients.values()) {
      if (client.isConnected) {
        return client.getWorkspaceSymbols(query);
      }
    }
    throw new Error('没有已连接的 LSP 客户端，请先调用其他 API 建立连接');
  }

  async getDiagnostics(filePath) {
    const client = await this.getClient(filePath);
    return new Promise((resolve) => {
      const diagnostics = [];
      const handler = (params) => {
        const uri = params.uri;
        if (uri === toUri(filePath)) {
          diagnostics.push(...(params.diagnostics || []));
        }
      };
      client.onDiagnostics(handler);

      // 触发诊断：先关闭再重新打开
      // 注：有些 LSP Server 在 didOpen 后自动推送诊断
      client.openDocument(filePath).then(() => {
        // 等待 Server 推送诊断
        setTimeout(() => {
          resolve(diagnostics.map(d => ({
            message: d.message,
            severity: d.severity, // 1=Error, 2=Warning, 3=Info, 4=Hint
            range: {
              start: { line: d.range.start.line + 1, character: d.range.start.character + 1 },
              end: { line: d.range.end.line + 1, character: d.range.end.character + 1 },
            },
            source: d.source || '',
            code: d.code || null,
          })));
        }, 2000); // 给 Server 2s 时间收集诊断
      });
    });
  }

  /**
   * 关闭所有连接
   */
  async closeAll() {
    const clients = Array.from(this._clients.values());
    this._clients.clear();
    await Promise.allSettled(clients.map(c => c.close().catch(() => {})));
    logger.info('所有 LSP 连接已关闭');
  }
}

// ==============================
// 全局单例
// ==============================
const globalLSPManager = new LSPManager();

export {
  LSPClient,
  LSPManager,
  globalLSPManager,
  detectLanguage,
  findProjectRoot,
  LSP_SERVER_CONFIG,
  logger,
  encodeMessage,
  parseMessages,
};
