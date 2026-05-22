/**
 * 系统诊断 子路由
 * 职责：网关状态、用户资源配额、OSS 用量诊断
 */

import { Router } from 'express';
import { CONFIG, QUOTAS, logger } from '../../core.js';
import { 
  getMongoClient, getUserDb, getAdminDb,
  getUserQuotaStatsForUser, getOSSClient, toLocalISOString
} from '../../db.js';

const router = Router();

/**
 * 系统诊断
 */
router.get('/diagnostic', async (req, res) => {
  const userId = req.user.userId;
  const isAdmin = req.user.role === 'admin';
  
  try {
    await getMongoClient();
    const userDb = getUserDb();
    
    const diagnostic = {
      timestamp: toLocalISOString(),
      gateway: {
        status: 'online',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '2.0.0'
      },
      user: {
        userId: req.user.userId,
        username: req.user.username,
        authType: req.user.authType,
        anonymous: req.user.anonymous
      }
    };
    
    if (!isAdmin) {
      const adminDb = getAdminDb();
      const quotaStats = await getUserQuotaStatsForUser(userDb, userId, adminDb);
      
      let ossUsage = { files: 0, totalSize: 0, limit: 100 * 1024 * 1024 };
      if (CONFIG.ossEnabled) {
        try {
          const client = await getOSSClient();
          if (client) {
            const result = await client.list({ prefix: `users/${userId}/`, 'max-keys': 1000 });
            ossUsage.files = (result.objects || []).length;
            ossUsage.totalSize = (result.objects || []).reduce((sum, obj) => sum + (obj.size || 0), 0);
          }
        } catch (e) {
          ossUsage.error = e.message;
        }
      }
      
      diagnostic.userResources = {
        database: {
          usage: quotaStats.usage,
          limits: quotaStats.limits,
          percentages: quotaStats.percentages,
          totalDocs: quotaStats.totalDocs,
          maxTotalStorage: QUOTAS.maxTotalStorage
        },
        oss: ossUsage,
        memory: { used: 0, limit: 10000, status: 'not_implemented' },
        storage: { snapshots: 0, limit: 50, mounts: 0, status: 'not_implemented' }
      };
      
      diagnostic.reachability = {
        gateway: '正常',
        database: '正常',
        oss: CONFIG.ossEnabled ? (ossUsage.error ? '异常' : '正常') : '未启用'
      };
    }
    
    res.json({ success: true, data: diagnostic });
  } catch (e) {
    logger.error('诊断失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
