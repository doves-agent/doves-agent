/**
 * @file tools/oss存储/核心
 * @description OSS 配置管理、客户端初始化、日志器、路径生成
 */

import { readFileSync, existsSync } from 'fs';
import { extname, join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { 创建日志器 } from '@dove/common/日志管理器.js';

// 配置缓存
let ossConfig = null;
let ossClient = null;

/**
 * 简单日志器
 */
const logger = 创建日志器('OSS', { 前缀: '[OSS]', 级别: 'debug', 显示调用位置: true });

/**
 * 从 .env 文件加载配置
 */
function loadEnvConfig() {
  if (ossConfig) return ossConfig;
  
  const envConfig = {
    enabled: process.env.OSS_ENABLED === 'true' || !!process.env.OSS_ACCESS_KEY_ID,
    region: process.env.OSS_REGION || '',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.OSS_BUCKET || '',
    prefix: process.env.OSS_PREFIX ? `${process.env.OSS_PREFIX}/agent/` : 'dove/agent/',
    endpoint: process.env.OSS_REGION ? `https://oss-${process.env.OSS_REGION}.aliyuncs.com` : ''
  };
  
  // 尝试从 .env 文件加载（同步方式）
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const envPath = join(__dirname, '../../../.env');
    
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      const lines = envContent.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim();
        
        if (key === 'OSS_ENABLED') envConfig.enabled = value === 'true';
        if (key === 'OSS_REGION') envConfig.region = value;
        if (key === 'OSS_ACCESS_KEY_ID') envConfig.accessKeyId = value;
        if (key === 'OSS_ACCESS_KEY_SECRET') envConfig.accessKeySecret = value;
        if (key === 'OSS_BUCKET') envConfig.bucket = value;
      }
    }
  } catch (e) {
    logger.debug('未找到 .env 文件或解析失败:', e.message);
  }
  
  ossConfig = envConfig;
  return envConfig;
}

/**
 * 初始化 OSS 配置
 * @param {object} config - OSS 配置
 * @returns {boolean} 是否初始化成功
 */
export function 初始化(config = {}) {
  ossConfig = {
    enabled: !!(config.accessKeyId || process.env.OSS_ACCESS_KEY_ID),
    region: config.region || process.env.OSS_REGION || '',
    accessKeyId: config.accessKeyId || process.env.OSS_ACCESS_KEY_ID || '',
    accessKeySecret: config.accessKeySecret || process.env.OSS_ACCESS_KEY_SECRET || '',
    bucket: config.bucket || process.env.OSS_BUCKET || '',
    prefix: config.prefix || (process.env.OSS_PREFIX ? `${process.env.OSS_PREFIX}/agent/` : 'dove/agent/'),
    endpoint: config.endpoint || (process.env.OSS_REGION ? `https://oss-${process.env.OSS_REGION}.aliyuncs.com` : '')
  };
  
  // 重置客户端
  ossClient = null;
  
  if (ossConfig.enabled) {
    logger.info(`配置已加载: ${ossConfig.bucket}/${ossConfig.prefix}`);
  }
  
  return ossConfig.enabled;
}

/**
 * 获取 OSS 客户端（懒加载）
 */
async function 获取客户端() {
  if (ossClient) return ossClient;
  
  const config = loadEnvConfig();
  
  if (!config.enabled) {
    return null;
  }
  
  try {
    // 动态导入 ali-oss
    const OSS = (await import('ali-oss')).default;
    
    ossClient = new OSS({
      region: config.region,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      bucket: config.bucket,
      secure: true
    });
    
    logger.info('客户端已初始化');
    return ossClient;
  } catch (e) {
    logger.error('客户端初始化失败:', e.message);
    return null;
  }
}

/**
 * 检查 OSS 是否可用
 * @returns {boolean}
 */
export function 是否可用() {
  const config = loadEnvConfig();
  return config.enabled === true && !!config.accessKeyId;
}

/**
 * 生成 OSS 文件路径
 * @param {string} 原始文件名 
 * @returns {string} OSS 路径
 */
function 生成路径(原始文件名) {
  const ext = extname(原始文件名);
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  const fileName = `${timestamp}_${random}${ext}`;
  return `${ossConfig?.prefix || 'agent/'}${fileName}`;
}

export { logger, loadEnvConfig, 获取客户端, 生成路径, ossConfig, ossClient };
