/**
 * @file tools/mcp客户端/Stdio传输
 * @description MCP Stdio 传输实现
 */

import { spawn } from 'child_process';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('MCP-Stdio', { 前缀: '[MCP Stdio]', 级别: 'debug', 显示调用位置: true });

export class StdioTransport {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.process = null;
    this.messageId = 0;
    this.pendingRequests = new Map();
    this.buffer = '';
  }
  
  async connect() {
    const { command, args, env, cwd } = this.config;
    
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(command, args, {
          env,
          cwd,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        this.process.on('error', (err) => {
          logger.error(`进程错误: ${this.name}`, err);
          reject(err);
        });
        
        this.process.on('exit', (code) => {
          logger.info(`进程退出: ${this.name} (code: ${code})`);
          this.process = null;
        });
        
        // 接收响应
        this.process.stdout.on('data', (data) => {
          this.buffer += data.toString();
          this._processBuffer();
        });
        
        // 错误输出
        this.process.stderr.on('data', (data) => {
          logger.warn(`${this.name} stderr:`, data.toString());
        });
        
        // 给进程一点启动时间
        setTimeout(() => resolve(true), 100);
      } catch (err) {
        reject(err);
      }
    });
  }
  
  _processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // 保留不完整的行
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const response = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        
        if (pending) {
          this.pendingRequests.delete(response.id);
          
          if (response.error) {
            pending.reject(new Error(response.error.message || 'MCP Error'));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (e) {
        logger.error('解析响应失败:', e.message);
      }
    }
  }
  
  async sendRequest(request) {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        reject(new Error('进程未运行'));
        return;
      }
      
      const id = ++this.messageId;
      const jsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        ...request
      };
      
      this.pendingRequests.set(id, { resolve, reject });
      
      try {
        this.process.stdin.write(JSON.stringify(jsonRpcRequest) + '\n');
        
        // 超时处理
        setTimeout(() => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            reject(new Error('请求超时'));
          }
        }, 30000);
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }
  
  async close() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    
    // 拒绝所有待处理请求
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('连接已关闭'));
    }
    this.pendingRequests.clear();
  }
}
