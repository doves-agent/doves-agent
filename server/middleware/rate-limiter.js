/**
 * 速率限制中间件
 *
 * 默认不限流。只有被加入"限流名单"的 IP 才会被限流。
 * 名单存储在数据库中，支持热增删改查（无需重启）。
 */

import { logger } from '../core.js';

// ==================== 限流名单（内存缓存） ====================

const 限流名单 = new Map();

/**
 * 添加 IP 到限流名单
 * @param {string} ip
 * @param {Object} [options]
 * @param {string} [options.备注] - 加入原因
 * @param {number} [options.过期时间] - 自动移除时间戳（ms），不传则永久
 */
export function 添加限流IP(ip, options = {}) {
  限流名单.set(ip, {
    ip,
    备注: options.备注 || '',
    添加时间: Date.now(),
    过期时间: options.过期时间 || null
  });
}

/**
 * 从限流名单移除 IP
 */
export function 移除限流IP(ip) {
  return 限流名单.delete(ip);
}

/**
 * 查询 IP 是否在限流名单中
 */
export function 是否限流IP(ip) {
  if (!限流名单.has(ip)) return false;
  const entry = 限流名单.get(ip);
  if (entry.过期时间 && Date.now() > entry.过期时间) {
    限流名单.delete(ip);
    return false;
  }
  return true;
}

/**
 * 获取完整限流名单
 */
export function 获取限流名单() {
  const now = Date.now();
  const result = [];
  for (const [ip, entry] of 限流名单.entries()) {
    if (entry.过期时间 && now > entry.过期时间) {
      限流名单.delete(ip);
      continue;
    }
    result.push(entry);
  }
  return result;
}

/**
 * 从数据库加载限流名单到内存
 */
export async function 加载限流名单(collection) {
  const docs = await collection.find({ _id: /^rate_limit_ip:/ }).toArray();
  const now = Date.now();
  let loaded = 0;
  for (const doc of docs) {
    if (doc.过期时间 && now > doc.过期时间) continue;
    限流名单.set(doc.ip, {
      ip: doc.ip,
      备注: doc.备注 || '',
      添加时间: doc.添加时间 || now,
      过期时间: doc.过期时间 || null
    });
    loaded++;
  }
  if (loaded > 0) {
    logger.info(`[限流名单] 已从数据库加载 ${loaded} 条`);
  }
}

/**
 * 持久化：写入数据库
 */
export async function 持久化限流IP(collection, ip, options = {}) {
  await collection.updateOne(
    { _id: `rate_limit_ip:${ip}` },
    { $set: { ip, 备注: options.备注 || '', 添加时间: Date.now(), 过期时间: options.过期时间 || null } },
    { upsert: true }
  );
  添加限流IP(ip, options);
}

/**
 * 持久化：从数据库移除
 */
export async function 持久化移除限流IP(collection, ip) {
  await collection.deleteOne({ _id: `rate_limit_ip:${ip}` });
  移除限流IP(ip);
}

// ==================== 限流计数存储 ====================

const rateLimitStore = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ==================== 核心函数 ====================

/**
 * 创建速率限制中间件
 * 只对限流名单中的 IP 生效
 */
export function createRateLimiter(options) {
  const { windowMs, max, keyGenerator, message } = options;

  return (req, res, next) => {
    const clientIp = req.ip || req.connection?.remoteAddress || '';

    if (!是否限流IP(clientIp)) {
      return next();
    }

    const key = keyGenerator ? keyGenerator(req) : clientIp;
    const now = Date.now();

    const record = rateLimitStore.get(key) || { count: 0, resetTime: now + windowMs };

    if (now > record.resetTime) {
      record.count = 0;
      record.resetTime = now + windowMs;
    }

    record.count++;
    rateLimitStore.set(key, record);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
    res.setHeader('X-RateLimit-Reset', record.resetTime);

    if (record.count > max) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      logger.warn(`[限流] ${clientIp} 触发限制: ${key}, 等待 ${retryAfter}s`);

      return res.status(429).json({
        success: false,
        error: message || '请求过于频繁，请稍后再试',
        retryAfter
      });
    }

    next();
  };
}

// ==================== 预定义限制器 ====================

export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: '登录尝试过多，请15分钟后再试',
  keyGenerator: (req) => `login:${req.ip}:${req.body?.username || 'unknown'}`
});

export const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: '注册请求过多，请1小时后再试',
  keyGenerator: (req) => `register:${req.ip}`
});

export const claimTaskLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: '抢任务请求过于频繁，请稍后再试',
  keyGenerator: (req) => `claim:${req.user?.doveId || req.user?.userId || req.ip}`
});

export const apiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 500,
  message: 'API请求过于频繁，请稍后再试',
  keyGenerator: (req) => `api:${req.ip}`
});

export const heartbeatLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: '心跳请求过于频繁',
  keyGenerator: (req) => `heartbeat:${req.user?.doveId || req.ip}`
});

export const submitResultLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: '提交结果请求过于频繁',
  keyGenerator: (req) => `submit:${req.user?.doveId || req.ip}`
});

// ==================== 工具函数 ====================

export function clearRateLimit(key) {
  rateLimitStore.delete(key);
}

export function getRateLimitStats() {
  return {
    totalKeys: rateLimitStore.size,
    限流名单数: 限流名单.size,
    keys: Array.from(rateLimitStore.keys()).slice(0, 100)
  };
}

export default {
  createRateLimiter,
  loginLimiter,
  registerLimiter,
  claimTaskLimiter,
  apiLimiter,
  heartbeatLimiter,
  submitResultLimiter,
  clearRateLimit,
  getRateLimitStats,
  添加限流IP,
  移除限流IP,
  是否限流IP,
  获取限流名单,
  加载限流名单,
  持久化限流IP,
  持久化移除限流IP
};
