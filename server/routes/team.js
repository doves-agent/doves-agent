/**
 * @file team.js
 * @description 多智能体团队配置 API——用户的智能体团队增删改查
 */

import { Router } from 'express';
import { getMongoClient, getUserDb, createTimestampFields } from '../db.js';
import { 获取默认配置, 验证配置, 默认主智能体角色名 } from '../../common/多智能体默认配置.js';

const router = Router();
const 集合名 = '多智能体配置';

/**
 * 获取当前用户的多智能体配置
 * 如果用户没有自定义配置，返回系统默认配置
 * GET /api/team/config
 */
router.get('/config', async (req, res) => {
  const userId = req.user.userId;
  try {
    await getMongoClient();
    const userDb = getUserDb();
    const doc = await userDb.collection(集合名).findOne({ userId });

    if (doc?.配置) {
      return res.json({
        success: true,
        data: {
          ...doc.配置,
          来源: '用户自定义',
          更新时间: doc.更新时间,
        },
      });
    }

    // 返回系统默认配置
    const 默认 = 获取默认配置();
    return res.json({
      success: true,
      data: {
        ...默认,
        来源: '系统默认',
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取系统默认配置（参考模板）
 * GET /api/team/default
 */
router.get('/default', async (req, res) => {
  try {
    const 默认 = 获取默认配置();
    return res.json({
      success: true,
      data: {
        ...默认,
        说明: '这是系统默认的多智能体团队模板，可作为参考。使用 PUT /api/team/config 保存你自己的配置。',
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 保存/更新用户的多智能体配置
 * PUT /api/team/config
 * Body: { 智能体列表: [...], 主智能体角色名: "主智能体" }
 */
router.put('/config', async (req, res) => {
  const userId = req.user.userId;
  const { 智能体列表, 主智能体角色名: 主角色名 } = req.body;

  if (!Array.isArray(智能体列表) || 智能体列表.length === 0) {
    return res.status(400).json({ success: false, error: '智能体列表不能为空' });
  }

  const 配置 = {
    主智能体角色名: 主角色名 || 默认主智能体角色名,
    智能体列表,
  };

  const 验证 = 验证配置(配置);
  if (!验证.合法) {
    return res.status(400).json({ success: false, error: 验证.错误 });
  }

  try {
    await getMongoClient();
    const userDb = getUserDb();
    const ts = createTimestampFields();

    await userDb.collection(集合名).updateOne(
      { userId },
      {
        $set: {
          配置,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp,
        },
        $setOnInsert: {
          userId,
          创建时间: ts.localTime,
          创建时间戳: ts.timestamp,
        },
      },
      { upsert: true }
    );

    return res.json({
      success: true,
      data: {
        ...配置,
        来源: '用户自定义',
        更新时间: ts.localTime,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 添加一个智能体到团队
 * POST /api/team/agent
 * Body: { 角色名, 模型提供商, 模型名, 系统提示词, 是否主智能体 }
 */
router.post('/agent', async (req, res) => {
  const userId = req.user.userId;
  const { 角色名, 模型提供商, 模型名, 系统提示词, 是否主智能体 } = req.body;

  if (!角色名) {
    return res.status(400).json({ success: false, error: '角色名必填' });
  }
  if (!模型名) {
    return res.status(400).json({ success: false, error: '模型名必填' });
  }

  try {
    await getMongoClient();
    const userDb = getUserDb();
    const ts = createTimestampFields();

    const doc = await userDb.collection(集合名).findOne({ userId });
    const 当前列表 = doc?.配置?.智能体列表 || 获取默认配置().智能体列表;

    // 检查角色名是否重复
    if (当前列表.some(a => a.角色名 === 角色名)) {
      return res.status(400).json({ success: false, error: `角色名"${角色名}"已存在` });
    }

    // 如果是主智能体，检查是否已存在
    if (是否主智能体 && 当前列表.some(a => a.是否主智能体)) {
      return res.status(400).json({ success: false, error: '主智能体已存在，不能添加第二个' });
    }

    const 新智能体 = {
      角色名,
      模型提供商: 模型提供商 || '百炼',
      模型名,
      系统提示词: 系统提示词 || '',
      是否主智能体: !!是否主智能体,
      排序: 当前列表.length,
    };

    当前列表.push(新智能体);

    const 新配置 = {
      主智能体角色名: doc?.配置?.主智能体角色名 || 默认主智能体角色名,
      智能体列表: 当前列表,
    };

    await userDb.collection(集合名).updateOne(
      { userId },
      {
        $set: {
          配置: 新配置,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp,
        },
        $setOnInsert: {
          userId,
          创建时间: ts.localTime,
          创建时间戳: ts.timestamp,
        },
      },
      { upsert: true }
    );

    return res.json({ success: true, data: 新智能体 });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 删除一个智能体
 * DELETE /api/team/agent/:角色名
 */
router.delete('/agent/:角色名', async (req, res) => {
  const userId = req.user.userId;
  const { 角色名 } = req.params;

  if (!角色名) {
    return res.status(400).json({ success: false, error: '角色名必填' });
  }

  try {
    await getMongoClient();
    const userDb = getUserDb();
    const ts = createTimestampFields();

    const doc = await userDb.collection(集合名).findOne({ userId });
    const 当前列表 = doc?.配置?.智能体列表 || 获取默认配置().智能体列表;

    const 目标 = 当前列表.find(a => a.角色名 === 角色名);
    if (!目标) {
      return res.status(404).json({ success: false, error: `未找到智能体"${角色名}"` });
    }

    if (目标.是否主智能体) {
      return res.status(400).json({ success: false, error: '主智能体不可删除' });
    }

    const 新列表 = 当前列表.filter(a => a.角色名 !== 角色名);

    const 新配置 = {
      主智能体角色名: doc?.配置?.主智能体角色名 || 默认主智能体角色名,
      智能体列表: 新列表,
    };

    await userDb.collection(集合名).updateOne(
      { userId },
      {
        $set: {
          配置: 新配置,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp,
        },
      }
    );

    return res.json({ success: true, data: { 已删除: 角色名 } });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 修改某个智能体的配置
 * PUT /api/team/agent/:角色名
 * Body: { 模型提供商?, 模型名?, 系统提示词?, 是否主智能体? }
 */
router.put('/agent/:角色名', async (req, res) => {
  const userId = req.user.userId;
  const { 角色名 } = req.params;
  const 更新字段 = req.body;

  if (!角色名) {
    return res.status(400).json({ success: false, error: '角色名必填' });
  }

  try {
    await getMongoClient();
    const userDb = getUserDb();
    const ts = createTimestampFields();

    const doc = await userDb.collection(集合名).findOne({ userId });
    const 当前列表 = doc?.配置?.智能体列表 || 获取默认配置().智能体列表;

    const 目标 = 当前列表.find(a => a.角色名 === 角色名);
    if (!目标) {
      return res.status(404).json({ success: false, error: `未找到智能体"${角色名}"` });
    }

    // 不允许把其他智能体改成主智能体（主智能体只能有一个）
    if (更新字段.是否主智能体 && !目标.是否主智能体) {
      const 已有主智能体 = 当前列表.some(a => a.是否主智能体 && a.角色名 !== 角色名);
      if (已有主智能体) {
        return res.status(400).json({ success: false, error: '主智能体已存在，不能将其他智能体改为主智能体' });
      }
    }

    // 不允许取消主智能体的主智能体标记
    if (更新字段.是否主智能体 === false && 目标.是否主智能体) {
      return res.status(400).json({ success: false, error: '主智能体的"是否主智能体"标记不可取消' });
    }

    // 合并更新
    if (更新字段.模型提供商 !== undefined) 目标.模型提供商 = 更新字段.模型提供商;
    if (更新字段.模型名 !== undefined) 目标.模型名 = 更新字段.模型名;
    if (更新字段.系统提示词 !== undefined) 目标.系统提示词 = 更新字段.系统提示词;
    if (更新字段.是否主智能体 !== undefined && !目标.是否主智能体) 目标.是否主智能体 = 更新字段.是否主智能体;

    const 新配置 = {
      主智能体角色名: doc?.配置?.主智能体角色名 || 默认主智能体角色名,
      智能体列表: 当前列表,
    };

    await userDb.collection(集合名).updateOne(
      { userId },
      {
        $set: {
          配置: 新配置,
          更新时间: ts.localTime,
          更新时间戳: ts.timestamp,
        },
      }
    );

    return res.json({ success: true, data: 目标 });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

export default router;

