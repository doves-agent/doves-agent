/**
 * 能力管理认证中间件
 * 职责：JWT + API Key 双认证，用于能力管理路由
 * 
 * 从 server/routes/capability.js 拆分，遵循KISS原则
 */

import { CONFIG, logger } from '../../core.js';
import { getMongoClient, getAdminDb } from '../../db.js';

/**
 * 鸽子认证中间件（简化版）
 */
export async function simpleAuthMiddleware(req, res, next) {
  const token = req.headers['x-token'] || req.headers['x-auth-token'] || 
                req.headers['authorization']?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ success: false, error: '未提供认证令牌' });
  }
  
  try {
    // 尝试 JWT 验证
    const jwt = (await import('jsonwebtoken')).default;
    const decoded = jwt.verify(token, CONFIG.jwtSecret);
    
    req.user = {
      userId: decoded.userId || decoded.sub || decoded._id,
      username: decoded.username,
      role: decoded.role,
      doveId: decoded.doveId
    };
    next();
  } catch (e) {
    // 尝试 API Key 验证
    try {
      await getMongoClient();
      const adminDb = getAdminDb();
      
      // API Key 格式: sk_{doveId}_{48hex_secret}
      // doveId 可能包含下划线（如 win_48e77d00_dove_0），secret 固定 48 位 hex
      const keyMatch = token.match(/^sk_(.*)_([0-9a-f]{48})$/);
      if (!keyMatch) {
        return res.status(401).json({ success: false, error: '无效的认证令牌' });
      }
      
      const keyId = keyMatch[1];
      const keySecret = keyMatch[2];
      
      const keyDoc = await adminDb.collection('API密钥').findOne({ 
        keyId,
        状态: '活跃'
      });
      
      if (!keyDoc) {
        return res.status(401).json({ success: false, error: '无效的认证令牌' });
      }
      
      const bcrypt = (await import('bcryptjs')).default;
      const isMatch = await bcrypt.compare(keySecret, keyDoc.keySecret);
      
      if (isMatch) {
        req.user = {
          userId: keyDoc.用户ID || keyDoc.userId,
          role: keyDoc.role || 'user',
          doveId: keyDoc.鸽子ID || keyDoc.doveId
        };
        return next();
      }
      
      return res.status(401).json({ success: false, error: '无效的认证令牌' });
    } catch (authErr) {
      return res.status(401).json({ success: false, error: '认证失败' });
    }
  }
}
