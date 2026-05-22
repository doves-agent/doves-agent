/**
 * @file dove-task/任务操作
 * @description 鸽子任务的操作路由：提交结果、心跳、放弃任务、释放残留任务
 * 
 * 从 dove-task.js 拆分，KISS 原则
 */

import { Router } from 'express';
import { logger } from '../../core.js';
import { 
  getMongoClient, getAdminDb, getUserDb, createTimestampFields
} from '../../db.js';
import { 
  heartbeatLimiter, 
  submitResultLimiter 
} from '../../middleware/rate-limiter.js';
import { 记录审计 } from '../../审计日志.js';
import { 重新计算鸽子统计 } from './统计.js';
import { 验证同机器鸽子 } from '../../../common/机器标识.js';

/**
 * 异步验证同机器鸽子
 * 比较两个鸽子ID的机器前缀 {os}_{hash} 是否一致
 */
export async function 异步验证同机器(requestDoveId, authDoveId) {
  return 验证同机器鸽子(requestDoveId, authDoveId);
}

const router = Router();

/**
 * 提交任务结果
 * 
 * 请求参数：
 * - taskId: 任务ID
 * - result: 执行结果
 * - success: 是否成功
 * - error: 错误信息（失败时）
 * 
 * 限制：1分钟内最多20次请求
 */
router.post('/submit-result', submitResultLimiter, async (req, res) => {
  const { taskId, result, success, error, targetStatus, doveId: requestDoveId } = req.body;
  const authDoveId = req.user.doveId || req.user.userId;
  
  // 支持子实例提交结果（同机器前缀验证）
  let doveId = authDoveId;
  if (requestDoveId && requestDoveId !== authDoveId) {
    if (!(await 异步验证同机器(requestDoveId, authDoveId))) {
      return res.status(403).json({ success: false, error: '请求的鸽子ID与认证身份不属于同一台机器' });
    }
    doveId = requestDoveId;
  }
  
  if (!taskId) {
    return res.status(400).json({ success: false, error: '任务ID必填' });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    // 确定目标状态：支持 completed / completed_with_errors / failed / cancelled
    const 终态列表 = ['已完成', '已完成(部分失败)', '失败', '已取消'];
    const finalStatus = (targetStatus && 终态列表.includes(targetStatus))
      ? targetStatus
      : (success ? '已完成' : '失败');
    const isSuccessful = finalStatus !== '失败' && finalStatus !== '已取消';

    // 1. 原子更新：验证执行者 + 更新状态（乐观锁：执行者必须匹配且状态为 running）
    const updateResult = await userDb.collection('任务').updateOne(
      { 
        任务ID: taskId, 
        执行者: doveId, 
        状态: { $in: ['执行中', '等待子任务'] }
      },
      {
        $set: {
          状态: finalStatus,
          结果: result,
          完成者: isSuccessful ? doveId : undefined,
          完成时间: ts.localTime,
          完成时间戳: ts.timestamp,
          错误: isSuccessful ? undefined : error,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        }
      }
    );
    
    if (updateResult.matchedCount === 0) {
      logger.warn(`提交结果失败: taskId=${taskId}, doveId=${doveId}, 任务不存在或状态已变更`);
      return res.status(400).json({ success: false, error: '任务不存在、非本鸽子执行、或状态已变更' });
    }
    
    // 2. 更新鸽子统计
    const 统计更新 = isSuccessful
      ? { '统计.完成任务数': 1 }
      : { '统计.失败任务数': 1 };
    await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId },
      { $inc: 统计更新 }
    );

    // 获取任务信息用于计算耗时和结算
    const 任务 = await userDb.collection('任务').findOne({ 任务ID: taskId });

    // 重新计算衍生统计字段（成功率 + 平均耗时）
    if (isSuccessful && 任务?.领取时间戳) {
      const 本次耗时 = ts.timestamp - 任务.领取时间戳;
      await 重新计算鸽子统计(adminDb, doveId, 本次耗时);
    } else {
      await 重新计算鸽子统计(adminDb, doveId, 0);
    }
    
    // 3. 处理饲料结算
    if (isSuccessful) {
      const 饲料奖励 = 任务?.饲料奖励 || 1;
      
      // 结算饲料：获得奖励
      await adminDb.collection('鸽子身份').updateOne(
        { 鸽子ID: doveId },
        {
          $inc: {
            '饲料.余额': 饲料奖励,
            '饲料.累计获得': 饲料奖励
          }
        }
      );
      
      // 信誉加分
      await adminDb.collection('鸽子身份').updateOne(
        { 鸽子ID: doveId },
        { $inc: { 信誉分: 5 } }
      );
      
      logger.info(`任务完成: ${taskId} 由 ${doveId} 完成，奖励 ${饲料奖励} 饲料`);
    } else {
      // 取消：不扣信誉分（鸽子只是执行用户取消指令）
      if (finalStatus !== '已取消') {
        // 失败：扣信誉分
        await adminDb.collection('鸽子身份').updateOne(
          { 鸽子ID: doveId },
          { $inc: { 信誉分: -3 } }
        );
      }
      
      logger.info(`任务${finalStatus === '已取消' ? '取消' : '失败'}: ${taskId} 由 ${doveId} 报告`);
    }
    
    res.json({ 
      success: true, 
      data: { 
        taskId, 
        status: finalStatus,
        已结算: true
      } 
    });
  } catch (e) {
    logger.error('提交结果失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 心跳 API（v2 标准化协议）
 * 鸽子定期发送心跳，更新在线状态
 * 
 * 限制：1分钟内最多30次请求
 */
router.post('/heartbeat', heartbeatLimiter, async (req, res) => {
  const authDoveId = req.user.doveId || req.user.userId;
  const { 
    currentTasks = [], 
    负载: clientLoad = {},
    能力变更: clientCapabilityChanges = [],
    doveId: requestDoveId
  } = req.body;
  
  // 支持子实例心跳
  let doveId = authDoveId;
  if (requestDoveId && requestDoveId !== authDoveId) {
    if (await 异步验证同机器(requestDoveId, authDoveId)) {
      doveId = requestDoveId;
    }
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const ts = createTimestampFields();
    
    // 构建心跳更新字段
    const heartbeatUpdate = {
      状态: currentTasks.length > 0 ? '忙碌' : '在线',
      最后心跳时间: ts.localTime,
      最后心跳时间戳: ts.timestamp
    };
    
    // 如果客户端上报了负载信息，记录到鸽子身份
    if (clientLoad && Object.keys(clientLoad).length > 0) {
      heartbeatUpdate.负载 = {
        CPU使用率: clientLoad.CPU使用率 ?? null,
        内存使用率: clientLoad.内存使用率 ?? null,
        活跃任务数: currentTasks.length,
        最大任务数: clientLoad.最大任务数 ?? null,
        上报时间: ts.localTime
      };
    } else {
      heartbeatUpdate['负载.活跃任务数'] = currentTasks.length;
      heartbeatUpdate['负载.上报时间'] = ts.localTime;
    }
    
    // 更新心跳时间与负载
    await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId },
      { $set: heartbeatUpdate }
    );
    
    // 处理客户端上报的能力变更
    let serverCapabilityChanges = [];
    if (clientCapabilityChanges && clientCapabilityChanges.length > 0) {
      for (const change of clientCapabilityChanges) {
        if (change.操作 === 'add' && change.能力名称) {
          await adminDb.collection('能力').updateOne(
            { 鸽子ID: doveId, 名称: change.能力名称 },
            { $set: { 状态: '活跃', 更新时间: ts.localTime } },
            { upsert: true }
          );
        } else if (change.操作 === 'remove' && change.能力名称) {
          await adminDb.collection('能力').updateOne(
            { 鸽子ID: doveId, 名称: change.能力名称 },
            { $set: { 状态: '已停用', 更新时间: ts.localTime } }
          );
        }
      }
      记录审计({
        操作者ID: doveId,
        操作者类型: 'dove',
        操作: 'heartbeat_capability_change',
        目标ID: doveId,
        结果: 'success',
        详情: { 变更数量: clientCapabilityChanges.length, 变更: clientCapabilityChanges }
      });
    }
    
    // 检查是否有服务器端下发的强制能力变更
    const pendingChanges = await adminDb.collection('能力变更队列').find({
      鸽子ID: doveId,
      状态: '等待中'
    }).toArray();
    
    if (pendingChanges.length > 0) {
      serverCapabilityChanges = pendingChanges.map(c => ({
        操作: c.操作,
        能力名称: c.能力名称,
        参数: c.参数 || {},
        原因: c.原因 || ''
      }));
      
      const changeIds = pendingChanges.map(c => c._id);
      await adminDb.collection('能力变更队列').updateMany(
        { _id: { $in: changeIds } },
        { $set: { 状态: 'delivered', 下发时间: ts.localTime } }
      );
    }
    
    // 检查是否有配置更新
    const pigeon = await adminDb.collection('鸽子身份').findOne(
      { 鸽子ID: doveId },
      { projection: { 权限策略: 1, 配置版本: 1, 鸽子类型: 1 } }
    );
    
    const configUpdate = {};
    if (pigeon?.权限策略) {
      configUpdate.权限策略 = pigeon.权限策略;
    }
    
    // 构建标准化响应
    res.json({ 
      success: true, 
      data: { 
        时间: ts.localTime,
        下次心跳间隔: 30000,
        状态: currentTasks.length > 0 ? '忙碌' : '在线',
        负载: {
          服务器时间: ts.localTime,
          在线鸽子数: await adminDb.collection('鸽子身份').countDocuments({
              状态: '在线',
            最后心跳时间戳: { $gt: ts.timestamp - 120000 }
          })
        },
        能力变更: serverCapabilityChanges,
        配置更新: Object.keys(configUpdate).length > 0 ? configUpdate : undefined
      } 
    });
  } catch (e) {
    logger.error('心跳失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 放弃任务
 */
router.post('/abandon-task', async (req, res) => {
  const { taskId, reason, doveId: requestDoveId } = req.body;
  const authDoveId = req.user.doveId || req.user.userId;
  
  // 支持子实例放弃任务
  let doveId = authDoveId;
  if (requestDoveId && requestDoveId !== authDoveId) {
    if (!(await 异步验证同机器(requestDoveId, authDoveId))) {
      return res.status(403).json({ success: false, error: '请求的鸽子ID与认证身份不属于同一台机器' });
    }
    doveId = requestDoveId;
  }
  
  if (!taskId) {
    return res.status(400).json({ success: false, error: '任务ID必填' });
  }
  
  try {
    await getMongoClient();
    const adminDb = getAdminDb();
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    // 原子操作：执行者必须匹配且状态为活跃态，才能放弃
    const abandonResult = await userDb.collection('任务').updateOne(
      { 任务ID: taskId, 执行者: doveId, 状态: { $in: ['执行中', '等待子任务'] } },
      {
        $set: {
          状态: '已就绪',
          执行者: null,
          领取时间: null,
          领取时间戳: null,
          放弃原因: reason,
          放弃时间: ts.localTime,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        }
      }
    );
    
    if (abandonResult.matchedCount === 0) {
      return res.status(400).json({ success: false, error: '任务不存在、非本鸽子执行、或已不在执行状态' });
    }
    
    // 扣信誉分
    await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId },
      {
        $inc: {
          '统计.放弃任务数': 1,
          信誉分: -2
        }
      }
    );

    // 重新计算衍生统计字段（成功率）
    await 重新计算鸽子统计(adminDb, doveId, 0);
    
    logger.info(`任务放弃: 鸽子 ${doveId} 放弃任务 ${taskId}，原因: ${reason}`);
    
    res.json({ success: true, data: { taskId, status: '已就绪' } });
  } catch (e) {
    logger.error('放弃任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Dove 发送非最终响应给 CLI（如请求文件上传）
 * 将任务状态改为 awaiting_cli，等待 CLI 处理后回复
 */
router.post('/respond', async (req, res) => {
  const { taskId, response } = req.body;
  const authDoveId = req.user.doveId || req.user.userId;

  if (!taskId || !response) {
    return res.status(400).json({ success: false, error: 'taskId 和 response 必填' });
  }

  try {
    await getMongoClient();
    const userDb = getUserDb();
    const ts = createTimestampFields();

    const updateResult = await userDb.collection('任务').updateOne(
      { 任务ID: taskId, 执行者: authDoveId, 状态: { $in: ['执行中', '等待子任务'] } },
      {
        $set: {
          状态: 'awaiting_cli',
          响应: response,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp,
        },
        $unset: { 执行者: '' },
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(400).json({ success: false, error: '任务不存在或状态不匹配' });
    }

    logger.info(`[respond] 任务 ${taskId} 进入 awaiting_cli，响应类型: ${response.type}`);
    res.json({ success: true });
  } catch (e) {
    logger.error('respond 失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 批量释放鸽子的所有 executing 任务
 * 用于鸽子启动时清理上次未完成的残留任务
 * 
 * 请求参数：
 * - reason: 释放原因（可选，默认 '鸽子重启，回收残留任务'）
 */
router.post('/release-stale-tasks', async (req, res) => {
  const authDoveId = req.user.doveId || req.user.userId;
  const { reason } = req.body;
  const releaseReason = reason || '鸽子重启，回收残留任务';
  
  if (!authDoveId) {
    return res.status(401).json({ success: false, error: '鸽子身份未认证' });
  }
  
  try {
    await getMongoClient();
    const userDb = getUserDb();
    const ts = createTimestampFields();
    
    const adminDb = getAdminDb();
    
    // 收集同机器的所有鸽子ID
    const { 提取机器标识 } = await import('../../../common/机器标识.js');
    const machinePrefix = 提取机器标识(authDoveId);
    const doveIdsToRelease = [authDoveId];
    
    // 通过机器前缀查找同机器实例
    if (machinePrefix) {
      const sameMachineDoves = await adminDb.collection('鸽子身份').find(
        { 鸽子ID: { $regex: '^' + machinePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_dove_' } }
      ).project({ 鸽子ID: 1 }).toArray();
      for (const d of sameMachineDoves) {
        if (d.鸽子ID !== authDoveId && !doveIdsToRelease.includes(d.鸽子ID)) {
          doveIdsToRelease.push(d.鸽子ID);
        }
      }
    }
    
    // 原子操作：批量释放同机器所有鸽子的活跃态任务
    const result = await userDb.collection('任务').updateMany(
      {
        执行者: { $in: doveIdsToRelease },
        状态: { $in: ['执行中', '等待子任务'] }
      },
      {
        $set: {
          状态: '已就绪',
          执行者: null,
          领取时间: null,
          领取时间戳: null,
          释放原因: releaseReason,
          释放时间: ts.localTime,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp
        }
      }
    );
    
    const releasedCount = result.modifiedCount;
    
    logger.info(`[release-stale-tasks] 机器 ${machinePrefix} 释放了 ${releasedCount} 个残留任务 (鸽子: ${doveIdsToRelease.join(', ')})`);
    
    res.json({ 
      success: true, 
      data: { 
        releasedCount,
        message: `已释放 ${releasedCount} 个残留任务` 
      }
    });
  } catch (e) {
    logger.error('释放残留任务失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
