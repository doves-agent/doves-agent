/**
 * LSP 客户端类
 * 职责：管理与单个 LSP Server 的连接、消息收发、请求-响应匹配
 */

import { spawn } from 'child_process';
import { basename } from 'path';
import { toUri, fromUri, parseLocations, parseSymbols, parseHover, parseCallHierarchyItems, parseCallHierarchyCalls } from './解析器.js';
import { encodeMessage, parseMessages, logger } from '../LSP客户端.js';

/**
 * LSP 客户端类
 */
class LSPClient {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.languageConfig = options.languageConfig || { languageId: 'plaintext', serverCommand: null, serverArgs: [], projectFiles: [] };
    this.serverCommand = options.serverCommand || this.languageConfig.serverCommand;
    this.serverArgs = options.serverArgs || [...this.languageConfig.serverArgs];
    this.extraArgs = options.extraArgs || []; // 用户自定义额外参数

    this._process = null;       // child_process 引用
    this._stdin = null;         // 可写流
    this._buffer = Buffer.alloc(0); // 接收缓冲区
    this._pending = new Map();   // Map<id, { resolve, reject, timer }>
    this._nextId = 1;
    this._initialized = false;
    this._shuttingDown = false;
    this._capabilities = null;  // Server Capabilities
    this._openDocuments = new Set(); // 已打开的文档 URI 集合

    // 通知处理器
    this._notificationHandlers = {
      'textDocument/publishDiagnostics': [],
      'window/logMessage': [],
      'window/showMessage': [],
    };
  }

  /**
   * 获取语言 ID
   */
  get languageId() {
    return this.languageConfig.languageId || 'plaintext';
  }

  /**
   * 获取 Server Capabilities
   */
  get serverCapabilities() {
    return this._capabilities;
  }

  /**
   * 连接是否活跃
   */
  get isConnected() {
    return this._process !== null && this._process.exitCode === null && !this._shuttingDown;
  }

  /**
   * 初始化连接：启动 LSP Server 进程 + 发送 initialize 请求
   */
  async initialize() {
    if (this._initialized) return;
    if (!this.serverCommand) {
      throw new Error(`未配置 LSP Server 命令（语言: ${this.languageId}），请先安装 LSP Server:\n  npm install -g ${this.languageConfig.serverCommand || 'typescript-language-server'}`);
    }

    // 启动进程
    return new Promise((resolve, reject) => {
      try {
        const allArgs = [...this.serverArgs, ...this.extraArgs];
        logger.info(`启动 LSP Server: ${this.serverCommand} ${allArgs.join(' ')} (项目: ${this.projectRoot})`);

        this._process = spawn(this.serverCommand, allArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: this.projectRoot,
          env: { ...process.env },
        });

        this._stdin = this._process.stdin;
        this._process.stdout.on('data', (data) => this._onData(data));
        this._process.stderr.on('data', (data) => {
          // LSP Server 可能把日志输出到 stderr
          const msg = data.toString().trim();
          if (msg) logger.debug(`[${this.languageId} stderr]`, msg);
        });

        this._process.on('error', (err) => {
          logger.error(`LSP Server 启动失败: ${err.message}`);
          this._cleanup();
          reject(new Error(`LSP Server 启动失败: ${err.message}`));
        });

        this._process.on('exit', (code, signal) => {
          logger.info(`LSP Server 已退出 (code: ${code}, signal: ${signal})`);
          this._cleanup();
          // 重连逻辑：如果不是手动关闭的，等待后尝试重新初始化
          if (!this._shuttingDown && this._initialized) {
            logger.info('LSP Server 意外退出，重连中...');
            this._initialized = false;
            setTimeout(() => this.initialize().catch(e => logger.error('重连失败:', e.message)), 1000);
          }
        });

        // 等待进程启动，发送 initialize
        this._process.on('spawn', async () => {
          try {
            await this._sendInitialize();
            this._initialized = true;
            resolve();
          } catch (e) {
            reject(e);
          }
        });

        // 如果进程立即退出
        setTimeout(() => {
          if (!this._initialized && this._process && this._process.exitCode === null) {
            // 还没初始化但进程还活着，继续等
          }
        }, 100);
      } catch (e) {
        reject(new Error(`启动 LSP Server 失败: ${e.message}`));
      }
    });
  }

  /**
   * 发送 initialize 请求 + initialized 通知
   */
  async _sendInitialize() {
    const capabilities = await this._request('initialize', {
      processId: process.pid,
      rootUri: `file://${this.projectRoot.replace(/\\/g, '/')}`,
      rootPath: this.projectRoot,
      capabilities: {
        textDocument: {
          synchronization: {
            didSave: true,
            willSave: false,
            willSaveWaitUntil: false,
          },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          definition: { linkSupport: true },
          references: true,
          hover: { contentFormat: ['markdown', 'plaintext'] },
          callHierarchy: true,
          implementation: true,
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: {
          symbol: true,
          workspaceFolders: true,
        },
      },
      initializationOptions: {},
      workspaceFolders: [{ uri: `file://${this.projectRoot.replace(/\\/g, '/')}`, name: basename(this.projectRoot) }],
    });

    this._capabilities = capabilities.capabilities || {};

    // 发送 initialized 通知
    this._notify('initialized', {});
    logger.info(`LSP Server ${this.languageId} 初始化完成`);
  }

  /**
   * 打开文档（通知 LSP Server 加载文件）
   */
  async openDocument(filePath) {
    const uri = toUri(filePath);
    if (this._openDocuments.has(uri)) return;

    let content;
    try {
      const fs = await import('fs/promises');
      content = await fs.readFile(filePath, 'utf-8');
    } catch (e) {
      throw new Error(`读取文件失败: ${e.message}`);
    }

    this._notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: this.languageId,
        version: 1,
        text: content,
      },
    });
    this._openDocuments.add(uri);
  }

  /**
   * 更新文档内容
   */
  async changeDocument(filePath, newContent, version = 1) {
    const uri = toUri(filePath);
    this._notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text: newContent }],
    });
  }

  /**
   * 关闭文档
   */
  async closeDocument(filePath) {
    const uri = toUri(filePath);
    if (!this._openDocuments.has(uri)) return;

    this._notify('textDocument/didClose', {
      textDocument: { uri },
    });
    this._openDocuments.delete(uri);
  }

  // ==================== LSP 请求方法 ====================

  /**
   * 跳转到符号定义
   */
  async getDefinition(filePath, line, character) {
    await this._ensureOpen(filePath);
    const result = await this._request('textDocument/definition', {
      textDocument: { uri: toUri(filePath) },
      position: { line: line - 1, character: character - 1 }, // LSP 是 0-based
    });
    return parseLocations(result);
  }

  /**
   * 查找符号引用
   */
  async findReferences(filePath, line, character, includeDeclaration = false) {
    await this._ensureOpen(filePath);
    const result = await this._request('textDocument/references', {
      textDocument: { uri: toUri(filePath) },
      position: { line: line - 1, character: character - 1 },
      context: { includeDeclaration },
    });
    return parseLocations(result);
  }

  /**
   * 获取文档符号列表（含层级关系）
   */
  async getDocumentSymbols(filePath) {
    await this._ensureOpen(filePath);
    const result = await this._request('textDocument/documentSymbol', {
      textDocument: { uri: toUri(filePath) },
    });
    return parseSymbols(result);
  }

  /**
   * 查找接口实现
   */
  async findImplementations(filePath, line, character) {
    await this._ensureOpen(filePath);
    const result = await this._request('textDocument/implementation', {
      textDocument: { uri: toUri(filePath) },
      position: { line: line - 1, character: character - 1 },
    });
    return parseLocations(result);
  }

  /**
   * 获取悬停信息（类型签名+文档）
   */
  async getHoverInfo(filePath, line, character) {
    await this._ensureOpen(filePath);
    const result = await this._request('textDocument/hover', {
      textDocument: { uri: toUri(filePath) },
      position: { line: line - 1, character: character - 1 },
    });
    return parseHover(result);
  }

  /**
   * 准备调用层级（获取选中符号的调用层级项）
   */
  async prepareCallHierarchy(filePath, line, character) {
    await this._ensureOpen(filePath);
    const result = await this._request('textDocument/prepareCallHierarchy', {
      textDocument: { uri: toUri(filePath) },
      position: { line: line - 1, character: character - 1 },
    });
    return parseCallHierarchyItems(result);
  }

  /**
   * 获取入调用（谁调用了这个符号）
   */
  async getIncomingCalls(callHierarchyItem) {
    const result = await this._request('callHierarchy/incomingCalls', {
      item: callHierarchyItem,
    });
    return parseCallHierarchyCalls(result);
  }

  /**
   * 获取出调用（这个符号调用了谁）
   */
  async getOutgoingCalls(callHierarchyItem) {
    const result = await this._request('callHierarchy/outgoingCalls', {
      item: callHierarchyItem,
    });
    return parseCallHierarchyCalls(result);
  }

  /**
   * 获取工作区符号（项目范围内搜索符号）
   */
  async getWorkspaceSymbols(query) {
    const result = await this._request('workspace/symbol', { query });
    return parseSymbols(result);
  }

  /**
   * 获取文档诊断信息（错误/警告）
   */
  onDiagnostics(handler) {
    this._notificationHandlers['textDocument/publishDiagnostics'].push(handler);
  }

  /**
   * 获取注册的诊断通知
   */
  getDiagnosticHandlers() {
    return this._notificationHandlers['textDocument/publishDiagnostics'];
  }

  // ==================== 关闭与清理 ====================

  /**
   * 关闭连接
   */
  async close() {
    if (this._shuttingDown) return;
    this._shuttingDown = true;

    // 关闭所有已打开的文档
    for (const uri of this._openDocuments) {
      this._notify('textDocument/didClose', { textDocument: { uri } });
    }
    this._openDocuments.clear();

    // 发送 shutdown
    try {
      await this._request('shutdown', null);
    } catch (e) {
      // 忽略 shutdown 阶段的错误
    }

    // 发送 exit 通知
    this._notify('exit', null);

    // 清理所有 pending 请求
    for (const [id, { reject }] of this._pending) {
      clearTimeout(this._pending.get(id).timer);
      reject(new Error('LSP 连接已关闭'));
    }
    this._pending.clear();

    this._cleanup();
    logger.info(`LSP Server ${this.languageId} 已关闭`);
  }

  // ==================== 内部方法 ====================

  /**
   * 确保文档已打开
   */
  async _ensureOpen(filePath) {
    if (!this.isConnected) {
      await this.initialize();
    }
    await this.openDocument(filePath);
  }

  /**
   * 发送请求（JSON-RPC 2.0 request）
   */
  _request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`LSP 请求超时: ${method}`));
      }, 30000); // 30s 超时

      this._pending.set(id, { resolve, reject, timer });
      this._send(message);
    });
  }

  /**
   * 发送通知（JSON-RPC 2.0 notification，无需响应）
   */
  _notify(method, params) {
    if (!this._stdin || !this.isConnected) {
      logger.warn(`LSP 未连接，无法发送通知: ${method}`);
      return;
    }
    const message = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this._send(message);
  }

  /**
   * 发送原始数据到 LSP Server
   */
  _send(message) {
    if (!this._stdin) return;
    const raw = encodeMessage(message);
    logger.debug('>>>', JSON.stringify(message).substring(0, 200));
    this._stdin.write(raw);
  }

  /**
   * 处理接收数据（解析消息、分派响应/通知）
   */
  _onData(data) {
    this._buffer = Buffer.concat([this._buffer, data]);
    const { messages, remaining } = parseMessages(this._buffer);
    this._buffer = Buffer.from(remaining, 'utf-8');

    for (const msg of messages) {
      this._dispatchMessage(msg);
    }
  }

  /**
   * 分派消息到对应的处理器
   */
  _dispatchMessage(msg) {
    logger.debug('<<<', JSON.stringify(msg).substring(0, 200));

    // 响应（有 id）
    if (msg.id != null) {
      const pending = this._pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this._pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(`LSP 错误: ${msg.error.message} (code: ${msg.error.code})`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // 通知（无 id）
    if (msg.method && this._notificationHandlers[msg.method]) {
      for (const handler of this._notificationHandlers[msg.method]) {
        try {
          handler(msg.params);
        } catch (e) {
          logger.error(`通知处理器错误: ${e.message}`);
        }
      }
    }
  }

  /**
   * 清理资源
   */
  _cleanup() {
    if (this._process) {
      try { this._process.kill(); } catch (e) { logger.debug(`LSP进程清理失败: ${e.message}`); }
    }
    this._process = null;
    this._stdin = null;
    this._buffer = Buffer.alloc(0);
  }
}

export { LSPClient };
