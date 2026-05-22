/**
 * @file tools/mcp客户端/HTTP传输
 * @description MCP HTTP 传输实现
 */

import http from 'http';
import https from 'https';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('MCP-HTTP', { 前缀: '[MCP HTTP]', 级别: 'debug', 显示调用位置: true });

export class HTTPTransport {
  constructor(name, config) {
    this.name = name;
    this.headers = config.headers || {};
    this.messageId = 0;
    this.pendingRequests = new Map();
    
    // 确保 URL 包含 MCP 端点路径
    let url = config.url || '';
    if (url && !url.endsWith('/mcp') && !url.endsWith('/mcp/') && !url.includes('/sse')) {
      // 如果 URL 不包含 /mcp 路径，自动添加
      url = url.replace(/\/+$/, '') + '/mcp';
      logger.info(`自动添加 /mcp 路径: ${config.url} -> ${url}`);
    }
    this.url = url;
  }
  
  async connect() {
    // HTTP 不需要预连接，发一个 initialize 请求完成协议握手
    try {
      await this.sendRequest({ 
        method: 'initialize', 
        params: { 
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: `dove`, version: '1.0.0' }
        } 
      });
      
      // 发送 initialized 通知（MCP 协议要求）
      await this._sendNotification('notifications/initialized');
      
      return true;
    } catch (e) {
      logger.debug(`初始化连接失败，但将继续: ${e.message}`);
      return true;
    }
  }
  
  async sendRequest(request) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      
      const jsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        ...request
      };
      
      const body = JSON.stringify(jsonRpcRequest);
      const urlObj = new URL(this.url);
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...this.headers
        }
      };
      
      const requester = urlObj.protocol === 'https:' ? https : http;
      
      const req = requester.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            
            if (response.error) {
              reject(new Error(response.error.message || 'MCP Error'));
            } else {
              resolve(response.result);
            }
          } catch (e) {
            reject(new Error(`解析响应失败: ${e.message}`));
          }
        });
      });
      
      req.on('error', reject);
      
      // 超时
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('请求超时'));
      });
      
      req.write(body);
      req.end();
    });
  }
  
  async close() {
    // HTTP 不需要关闭
  }
  
  /**
   * 发送 MCP 通知（不期待响应，无 id 字段）
   * @param {string} method - 通知方法名
   * @param {Object} params - 通知参数
   */
  async _sendNotification(method, params = {}) {
    return new Promise((resolve, reject) => {
      const notification = {
        jsonrpc: '2.0',
        method,
        params
      };
      
      const body = JSON.stringify(notification);
      const urlObj = new URL(this.url);
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...this.headers
        }
      };
      
      const requester = urlObj.protocol === 'https:' ? https : http;
      
      const req = requester.request(options, (res) => {
        // 通知不期待有意义的响应，消耗响应体即可
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(true));
      });
      
      req.on('error', (err) => {
        // 通知失败不阻塞流程
        logger.warn(`发送通知失败: ${method}`, err.message);
        resolve(false);
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        resolve(false);
      });
      
      req.write(body);
      req.end();
    });
  }
}
