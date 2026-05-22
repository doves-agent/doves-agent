/**
 * 通用认证中间件
 * 
 * 支持：
 * 1. JWT 认证（用户、管理员、鸽子）
 * 2. API Key 认证（鸽子专用）- keyId 快速查找 + keySecret 哈希验证
 * 
 * Token 获取优先级：
 *   x-token / x-auth-token → Authorization: Bearer → X-API-Key → query.token
 * 
 * API Key 格式: sk_{keyId}_{secret}
 * 
 */

import jwt from 'jsonwebtoken';
import { CONFIG } from '../core.js';
import { getAdminDb } from '../db.js';
import { 错误码, 创建错误响应 } from '../../common/错误码.js';

/**
 * 通用认证中间件
 * 支持 JWT 和 API Key 两种认证方式
 */
export async function authMiddleware(req, res, next) {
  // 按优先级提取 token
  let token = req.headers['x-token'] || req.headers['x-auth-token'] || req.query?.token;
  
  // 支持标准 Authorization: Bearer xxx 格式
  const authHeader = req.headers['authorization'];
  if (!token && authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }
  }
  
  // 支持 X-API-Key 头格式（鸽子进程使用）
  const apiKeyHeader = req.headers['x-api-key'];
  if (!token && apiKeyHeader) {
    token = apiKeyHeader;
  }
  
  if (!token) {
    return res.status(401).json(创建错误响应(错误码.AUTH_001, req.requestId));
  }
  
  try {
    // 尝试 JWT 验证
    const decoded = jwt.verify(token, CONFIG.jwtSecret);
    req.user = {
      userId: decoded.userId || decoded.sub || decoded._id,
      username: decoded.username,
      role: decoded.role || (decoded.authType === 'admin' ? 'admin' : undefined),
      // system_dove 角色从 JWT 直接获取，不走 fallback 推导
      authType: decoded.authType,
      anonymous: decoded.anonymous || false,
      doveId: decoded.doveId
    };
    req.token = token;
    req.tokenDecoded = decoded;
    return next();
  } catch (e) {
    // JWT 验证失败，尝试 API Key 认证
    try {
      // API Key 格式: sk_{doveId}_{48hex_secret}
      // doveId 可能包含下划线（如 win_48e77d00_dove_0），secret 固定 48 位 hex
      const keyMatch = token.match(/^sk_(.*)_([0-9a-f]{48})$/);
      if (!keyMatch) {
        return res.status(401).json(创建错误响应(错误码.AUTH_002, req.requestId));
      }
      
      const keyId = keyMatch[1];
      const keySecret = keyMatch[2];
      
      // 使用 keyId 快速查找
      const adminDb = getAdminDb();
      const keyDoc = await adminDb.collection('API密钥').findOne({ 
        keyId,
        状态: '活跃'
      });
      
      if (!keyDoc) {
        return res.status(401).json(创建错误响应(错误码.AUTH_002, req.requestId));
      }
      
      // 检查 API Key 是否已过期
      if (keyDoc.过期时间 && new Date(keyDoc.过期时间) < new Date()) {
        // 标记为已过期
        await adminDb.collection('API密钥').updateOne(
          { _id: keyDoc._id },
          { $set: { 状态: '已过期' } }
        );
        return res.status(401).json(创建错误响应(错误码.AUTH_005, req.requestId, 'API密钥已过期，请重新生成'));
      }
      
      // 即将过期预警：过期前7天，在响应头中提示
      if (keyDoc.过期时间) {
        const daysUntilExpiry = (new Date(keyDoc.过期时间) - Date.now()) / (24 * 60 * 60 * 1000);
        if (daysUntilExpiry <= 7) {
          res.setHeader('X-API-Key-Expiry-Warning', `API密钥将在${Math.ceil(daysUntilExpiry)}天后过期`);
        }
      }
      
      // 使用 bcrypt 验证 keySecret
      const bcrypt = (await import('bcryptjs')).default;
      const isMatch = await bcrypt.compare(keySecret, keyDoc.keySecret);
      
      if (isMatch) {
        req.user = {
          userId: keyDoc.用户ID || keyDoc.userId,
          role: keyDoc.role || 'user',
          authType: 'apikey',
          keyId: keyDoc._id,
          doveId: keyDoc.鸽子ID || keyDoc.doveId,
          权限列表: keyDoc.权限列表 || []
        };
        req.token = token;
        return next();
      } else {
        return res.status(401).json(创建错误响应(错误码.AUTH_002, req.requestId));
      }
    } catch (dbError) {
      // 区分数据库故障 vs 令牌确实无效
      // 数据库断连时返回 503，让客户端知道是基础设施问题而非认证问题
      const isDbError = dbError.name === 'MongoNetworkError'
        || dbError.name === 'MongoNotConnectedError'
        || dbError.name === 'MongooseError'
        || dbError.message?.includes('timed out')
        || dbError.message?.includes('ECONNREFUSED')
        || dbError.message?.includes('connection');

      if (isDbError) {
        return res.status(503).json({ success: false, error: '认证服务暂时不可用', retryAfter: 30 });
      }
      return res.status(401).json(创建错误响应(错误码.AUTH_002, req.requestId));
    }
  }
}

export default authMiddleware;
