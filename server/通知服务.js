import { getUserDb, getAdminDb } from './db.js';
import { createTimestampFields, toLocalISOString, getTimestamp } from '../common/时间工具.js';
import { ObjectId } from 'mongodb';
import { logger } from './core.js';
import { 发送IM消息, 适配器注册表 } from './im/适配器.js';
import { 发送邮件通知 } from './通知服务/邮件发送.js';

const 去重窗口 = 5 * 60 * 1000; // 5 分钟
const 重试延迟 = [5000, 30000, 120000]; // 5s, 30s, 120s

/**
 * 投递通知（统一入口）
 */
export async function 投递通知({ userId, 来源类型, 来源ID, 来源名称, 标题, 摘要, 详情 }) {
  const userDb = getUserDb();
  const 通知集合 = userDb.collection('通知');
  const 去重键 = `${来源类型}:${来源ID}`;

  // 去重：同一去重键 5 分钟内不重复
  const 最近通知 = await 通知集合.findOne({
    去重键,
    创建时间戳: { $gt: getTimestamp() - 去重窗口 }
  });
  if (最近通知) {
    logger.debug(`[通知服务] 去重跳过: ${去重键}`);
    return null;
  }

  const ts = createTimestampFields();
  const 通知ID = new ObjectId().toString();

  const 通知文档 = {
    通知ID,
    userId,
    来源类型,
    来源ID,
    来源名称: 来源名称 || '',
    标题: (标题 || '').slice(0, 50),
    摘要: (摘要 || '').slice(0, 200),
    详情: 详情 || null,
    投递状态: 'pending',
    投递渠道: null,
    投递时间: null,
    失败原因: null,
    重试次数: 0,
    去重键,
    创建时间: ts.localTime,
    创建时间戳: ts.timestamp,
    读取时间: null,
  };

  await 通知集合.insertOne(通知文档);

  // 异步投递（不阻塞调用方）
  _尝试投递(通知ID, userId).catch(e => {
    logger.warn(`[通知服务] 投递异常: ${e.message}`);
  });

  return 通知ID;
}

/**
 * 尝试投递通知到用户配置的渠道
 */
async function _尝试投递(通知ID, userId, 重试序号 = 0) {
  const userDb = getUserDb();
  const adminDb = getAdminDb();
  const 通知集合 = userDb.collection('通知');

  const 通知 = await 通知集合.findOne({ 通知ID });
  if (!通知 || 通知.投递状态 === 'delivered' || 通知.投递状态 === 'read') return;

  // 读取用户通知配置
  const 用户 = await adminDb.collection('用户').findOne({ 用户ID: userId });
  const 通知配置 = 用户?.通知配置;

  if (!通知配置 || !通知配置.默认渠道) {
    // 无渠道配置，保持 pending 等 CLI 拉取
    return;
  }

  // 静默时段检查
  if (_在静默时段(通知配置.静默时段)) {
    return;
  }

  // 找到启用的默认渠道
  const 渠道配置 = (通知配置.渠道列表 || []).find(
    c => c.渠道 === 通知配置.默认渠道 && c.启用
  );
  if (!渠道配置) return;

  const 渠道 = 渠道配置.渠道;
  const 用户标识 = 渠道配置.用户标识;

  try {
    if (渠道 === 'email') {
      await 发送邮件通知(用户标识, 通知.标题, 通知.摘要);
    } else {
      // IM 渠道 (wechat / dingtalk / feishu)
      if (!适配器注册表.是否可用(渠道)) {
        throw new Error(`IM 渠道不可用: ${渠道}`);
      }
      await 发送IM消息(渠道, 用户标识, {
        toText() { return `[白鸽通知] ${通知.标题}\n${通知.摘要}`; },
        toMarkdown() { return `**${通知.标题}**\n\n${通知.摘要}`; },
        toJSON() { return { title: 通知.标题, content: 通知.摘要 }; },
      });
    }

    // 成功
    await 通知集合.updateOne(
      { 通知ID },
      {
        $set: {
          投递状态: 'delivered',
          投递渠道: 渠道,
          投递时间: toLocalISOString(new Date()),
        }
      }
    );
    logger.info(`[通知服务] 已投递: ${通知.标题} → ${渠道}(${用户标识})`);

  } catch (e) {
    logger.warn(`[通知服务] 投递失败(第${重试序号 + 1}次): ${e.message}`);

    await 通知集合.updateOne(
      { 通知ID },
      {
        $set: { 失败原因: e.message },
        $inc: { 重试次数: 1 },
      }
    );

    if (重试序号 < 重试延迟.length - 1) {
      setTimeout(() => {
        _尝试投递(通知ID, userId, 重试序号 + 1).catch(() => {});
      }, 重试延迟[重试序号]);
    } else {
      await 通知集合.updateOne(
        { 通知ID },
        { $set: { 投递状态: 'failed' } }
      );
      logger.error(`[通知服务] 投递彻底失败: ${通知.标题} (${通知ID})`);
    }
  }
}

/**
 * 检查当前是否在静默时段
 */
function _在静默时段(静默时段) {
  if (!静默时段?.开始 || !静默时段?.结束) return false;

  const now = new Date();
  const 当前分钟 = now.getHours() * 60 + now.getMinutes();
  const [开始时, 开始分] = 静默时段.开始.split(':').map(Number);
  const [结束时, 结束分] = 静默时段.结束.split(':').map(Number);
  const 开始分钟 = 开始时 * 60 + 开始分;
  const 结束分钟 = 结束时 * 60 + 结束分;

  if (开始分钟 <= 结束分钟) {
    return 当前分钟 >= 开始分钟 && 当前分钟 < 结束分钟;
  }
  // 跨午夜：如 23:00 - 08:00
  return 当前分钟 >= 开始分钟 || 当前分钟 < 结束分钟;
}
