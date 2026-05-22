/**
 * 管理员 IP 白名单中间件
 * 
 * 数据源：数据库 系统配置.admin_ip_whitelist（优先），首次从 .env 导入
 * 
 * 支持格式（逗号分隔）：
 *   - 0.0.0.0          允许所有来源（开发/内网环境）
 *   - 192.168.1.1      单个 IP 精确匹配
 *   - 192.168.0.0/24   CIDR 子网匹配
 *   - 10.0.0.0/8       大网段
 * 
 * 配置示例（.env 或数据库）:
 *   ADMIN_IP_WHITELIST=0.0.0.0                       # 允许所有
 *   ADMIN_IP_WHITELIST=192.168.1.1,10.0.0.0/8        # 允许指定IP和网段
 *   ADMIN_IP_WHITELIST=127.0.0.1,192.168.0.0/24      # 仅本地和内网
 * 
 * 安全策略：未配置时默认拒绝所有（secure by default）
 */

import { logger } from '../core.js';
import { getAdminIpWhitelist } from '../db.js';

/**
 * 解析单个白名单条目
 * @param {string} entry - 如 "0.0.0.0" | "192.168.1.1" | "192.168.0.0/24"
 * @returns {{ type: 'all' } | { type: 'ip', ip: number } | { type: 'cidr', subnet: number, mask: number } | null}
 */
function parseEntry(entry) {
  entry = entry.trim();
  if (!entry) return null;

  // 0.0.0.0 = 允许所有
  if (entry === '0.0.0.0') {
    return { type: 'all' };
  }

  // CIDR 格式: 192.168.0.0/24
  const cidrMatch = entry.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
  if (cidrMatch) {
    const ipInt = ipToInt(cidrMatch[1]);
    if (ipInt === null) return null;
    const prefix = parseInt(cidrMatch[2], 10);
    if (prefix < 0 || prefix > 32) return null;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return { type: 'cidr', subnet: ipInt & mask, mask };
  }

  // 单个 IP
  const ipInt = ipToInt(entry);
  if (ipInt !== null) {
    return { type: 'ip', ip: ipInt };
  }

  return null;
}

/**
 * IPv4 地址转为 32 位无符号整数
 * @param {string} ip - "192.168.1.1"
 * @returns {number | null}
 */
function ipToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (let i = 0; i < 4; i++) {
    const n = parseInt(parts[i], 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

/**
 * 检查 IP 是否匹配白名单规则
 * @param {string} clientIp - 客户端 IP
 * @param {Array} rules - 解析后的白名单规则
 * @returns {boolean}
 */
function isIpAllowed(clientIp, rules) {
  // 先检查 "允许所有" 规则，避免 IPv6 等非 IPv4 地址因转换失败而被误拒
  for (const rule of rules) {
    if (rule.type === 'all') return true;
  }

  const ipInt = ipToInt(clientIp);
  if (ipInt === null) return false;

  for (const rule of rules) {
    if (rule.type === 'ip' && rule.ip === ipInt) return true;
    if (rule.type === 'cidr' && (ipInt & rule.mask) === rule.subnet) return true;
  }

  return false;
}

/**
 * 获取客户端真实 IP
 * 优先 X-Forwarded-For（取第一个，即最原始客户端），fallback 到 req.ip
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // X-Forwarded-For: client, proxy1, proxy2 → 取第一个
    const firstIp = forwarded.split(',')[0].trim();
    // Express 的 req.ip 可能返回 IPv6 映射的 IPv4 地址 "::ffff:192.168.1.1"
    // 统一处理
    return normalizeIp(firstIp);
  }
  return normalizeIp(req.ip || req.socket?.remoteAddress || '');
}

/**
 * 规范化 IP 地址
 * 移除 IPv6 映射前缀 "::ffff:"
 */
function normalizeIp(ip) {
  if (!ip) return '';
  // IPv6 映射的 IPv4 地址: "::ffff:192.168.1.1" → "192.168.1.1"
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  // IPv6 localhost: "::1" → "127.0.0.1"
  if (ip === '::1') {
    return '127.0.0.1';
  }
  return ip;
}

/**
 * 创建管理员 IP 白名单中间件
 * 从数据库缓存读取白名单规则（init 时已从 DB/.env 加载）
 * 未配置时默认拒绝所有请求
 */
export function createAdminIpWhitelistMiddleware() {
  const raw = getAdminIpWhitelist();
  
  if (!raw) {
    // 未配置：默认拒绝，但记录警告
    logger.warn('[Admin IP白名单] 未配置 ADMIN_IP_WHITELIST，默认拒绝所有管理员请求');
    logger.info('[Admin IP白名单] 请在 .env 中设置，如: ADMIN_IP_WHITELIST=127.0.0.1,192.168.0.0/24');
  }

  const rules = raw
    .split(',')
    .map(parseEntry)
    .filter(Boolean);

  if (raw && rules.length === 0) {
    logger.warn(`[Admin IP白名单] 解析失败，原始值: "${raw}"，将拒绝所有请求`);
  }

  const hasAllowAll = rules.some(r => r.type === 'all');
  if (hasAllowAll) {
    logger.info('[Admin IP白名单] 规则: 允许所有来源 (0.0.0.0)');
  } else if (rules.length > 0) {
    const desc = raw.split(',').map(s => s.trim()).filter(Boolean).join(', ');
    logger.info(`[Admin IP白名单] 规则: ${desc}`);
  }

  return function adminIpWhitelistMiddleware(req, res, next) {
    // 未配置任何规则 → 拒绝
    if (rules.length === 0) {
      logger.warn(`[Admin IP白名单] 拒绝: ${getClientIp(req)} (未配置白名单)`);
      return res.status(403).json({
        success: false,
        error: '管理员接口未开放（未配置 IP 白名单）',
        hint: '请联系系统管理员在服务端配置 ADMIN_IP_WHITELIST 环境变量'
      });
    }

    const clientIp = getClientIp(req);
    
    if (isIpAllowed(clientIp, rules)) {
      return next();
    }

    logger.warn(`[Admin IP白名单] 拒绝: ${clientIp} (不在白名单中)`);
    return res.status(403).json({
      success: false,
      error: '禁止访问：当前 IP 不在管理员白名单中',
      clientIp
    });
  };
}

export default createAdminIpWhitelistMiddleware;
