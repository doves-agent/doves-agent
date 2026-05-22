/**
 * 白鸽服务端核心模块
 * 职责：配置、常量、日志
 */

import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { formatLocalTime } from '../common/时间工具.js';
import { 获取或生成机器标识, 生成分组标识 } from '../common/机器标识.js';
import { 创建日志器 } from '../common/日志管理器.js';

// 加载环境变量
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });

// ==================== 配置 ====================

// 🔒 安全检查：敏感配置必须在启动时验证
const REQUIRED_SECRETS = {
  JWT_SECRET: {
    env: 'JWT_SECRET',
    description: 'JWT 令牌签名密钥',
    minLength: 32
  },
  HASH_SECRET: {
    env: 'HASH_SECRET', 
    description: '临时目录 Hash 签名密钥',
    minLength: 32
  },
  OFFICIAL_DEV_SIGNING_KEY: {
    env: 'OFFICIAL_DEV_SIGNING_KEY',
    description: '官方开发者签名密钥（签署官方扩展 manifest）',
    minLength: 40  // dvsk_dev_official_ + 至少16字符 secret
  }
};

/**
 * 验证敏感环境变量
 */
function validateSecrets() {
  const errors = [];
  const knownDefaults = [
    'dove-default-secret',
    'temp-dir-hash-secret',
    'default',
    'secret',
    'password',
    'changeme'
  ];
  
  for (const [name, config] of Object.entries(REQUIRED_SECRETS)) {
    const value = process.env[name];
    
    if (!value) {
      errors.push(`${name} 未设置（${config.description}）`);
      continue;
    }
    
    const lowerValue = value.toLowerCase();
    if (knownDefaults.some(d => lowerValue.includes(d.toLowerCase()))) {
      errors.push(`${name} 不能使用默认值或常见弱密钥`);
    }
    
    if (value.length < config.minLength) {
      errors.push(`${name} 长度必须至少 ${config.minLength} 字符（当前 ${value.length}）`);
    }
  }
  
  if (errors.length > 0) {
    console.error('\n' + '='.repeat(60));
    console.error('🔒 安全配置错误：');
    console.error('='.repeat(60));
    errors.forEach(err => console.error(`  ❌ ${err}`));
    console.error('\n请在 .env 文件中设置正确的值：');
    console.error('  JWT_SECRET=<至少32字符的随机字符串>');
    console.error('  HASH_SECRET=<至少32字符的随机字符串>');
    console.error('  OFFICIAL_DEV_SIGNING_KEY=<官方扩展签名密钥，格式 dvsk_dev_official_<secret>>');
    console.error('\n生成随机密钥示例：');
    console.error('  openssl rand -hex 32');
    console.error('='.repeat(60) + '\n');
    process.exit(1);
  }
}

// 启动时验证
validateSecrets();

// 🔐 信任策略提示（非阻塞，仅日志提醒）
const trustPolicy = process.env.DOVE_TRUST_ON_FIRST_USE;
if (trustPolicy === undefined) {
  console.warn('⚠️  未设置 DOVE_TRUST_ON_FIRST_USE，客户端首次连接将自动信任服务端（TOFU 模式）。');
  console.warn('   官方生产环境建议设为 false 并通过 known_hosts 预置官方 Server 指纹。');
  console.warn('   自建部署可设为 true 或忽略此提示。\n');
} else if (trustPolicy === 'true') {
  console.warn('⚠️  DOVE_TRUST_ON_FIRST_USE=true，客户端首次连接自动信任服务端。');
  console.warn('   如需更严格的安全策略，请设为 false 并预置 known_hosts。\n');
}

export const CONFIG = {
  host: process.env.SERVER_HOST || '127.0.0.1',
  port: parseInt(process.env.SERVER_PORT) || 3003,
  jwtSecret: process.env.JWT_SECRET,
  machineId: 获取或生成机器标识(),
  serverInstanceId: 生成分组标识(获取或生成机器标识(), 'server', 0),
  mongoUri: process.env.MONGODB_URI || process.env.MONGODB,
  adminDb: process.env.MONGODB_ADMIN_DB || 'doves_admin',
  userDb: process.env.MONGODB_USER_DB || 'doves_user_data',
  ossEnabled: process.env.OSS_ENABLED === 'true' || !!process.env.OSS_ACCESS_KEY_ID,
  hashSecret: process.env.HASH_SECRET,
  officialDevSigningKey: process.env.OFFICIAL_DEV_SIGNING_KEY,
  allowAnonymous: process.env.ALLOW_ANONYMOUS === 'true' || (process.env.NODE_ENV !== 'production' && !process.env.ALLOW_ANONYMOUS),
  ossPublicUrl: process.env.OSS_PUBLIC_URL || (
    process.env.OSS_BUCKET && process.env.OSS_REGION
      ? `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com`
      : ''
  ),
  ossEndpoint: process.env.OSS_ENDPOINT || `https://${process.env.OSS_REGION || 'oss-cn-shanghai'}.aliyuncs.com`
};

// ==================== 配额配置 ====================

export const QUOTAS = {
  documents: {
    '任务': 1000,
    '对话': 100,
    '文件元数据': 500
  },
  maxDocumentSize: 512 * 1024,  // 512KB
  maxTotalStorage: 100 * 1024 * 1024,  // 100MB
  maxStreamBuffer: 1000
};

// ==================== MongoDB 权限控制 ====================

// 核心系统集合白名单（仅包含白鸽框架自身的集合）
// 扩展包的集合通过 manifest.databases 声明 → extensionDBRegistry 动态注册
// 新增扩展集合无需修改此列表
export const ALLOWED_COLLECTIONS = [
  // 中文集合名（用户数据）
  '对话', '任务', '文件元数据', 'API密钥', '能力', '日志', '技能', '技能可靠性', '文档', '执行轨迹', '事件', 'IM通知队列', '经验',
  // 英文集合名（鸽子系统使用）
  'documents',      // 文档管理
  'ssh_hosts',      // SSH agent 主机配置
  'users',          // 用户数据
  'dove_contexts',  // 鸽子上下文
  'conversations',  // 对话（英文别名）
  'tasks',          // 任务（英文别名）
  'file_meta',      // 文件元数据（英文别名）
];

export const ALLOWED_ACTIONS = ['findOne', 'find', 'insertOne', 'updateOne', 'deleteOne', 'aggregate', 'watch', 'updateMany', 'deleteMany', 'insertMany', 'countDocuments', 'findOneAndUpdate', 'findOneAndDelete'];

// ==================== 默认系统配置 ====================

export const DEFAULT_SYSTEM_CONFIG = {
  llm: {
    bailian: { enabled: true, apiKey: '', models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'qwen3.6-plus', 'qwen3.6-flash', 'qwen3.5-omni-flash'] },
    deepseek: { enabled: true, apiKey: '', models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v3', 'deepseek-r1', 'deepseek-chat'] },
    glm: { enabled: true, apiKey: '', models: ['glm-5.1', 'glm-5', 'glm-4v', 'glm-4-flash'] }
  },
  oss: {
    enabled: false,
    region: '',
    accessKeyId: '',
    accessKeySecret: '',
    bucket: ''
  },
  gitStorage: {
    enabled: true,
    reposPath: ''
  }
};

// ==================== 日志器 ====================

export const logger = 创建日志器('server', { 前缀: '[Server]', 显示调用位置: true });
