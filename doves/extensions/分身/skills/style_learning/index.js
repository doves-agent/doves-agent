/**
 * 语气学习技能 (style_learning)
 * 分析导入的聊天记录 → 提取用户语气特征 → 生成/更新语气档案
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';
import { getDovesProxy } from '../../../../tools/存储接口.js';

const logger = 创建日志器('style_learning', { 前缀: '[style_learning]', 级别: 'debug', 显示调用位置: true });

/**
 * 从Git记忆检索聊天记录样本
 */
async function 检索聊天样本(ownerName, sampleSize, context) {
  const { 工具调用 } = context;
  
  // 通过记忆检索找到用户发送的消息
  // 搜索用户自己发送的消息作为语气分析样本
  try {
    if (工具调用?.搜索记忆) {
      return await 工具调用.搜索记忆({
        类型: 'chat_segment',
        关键词: ownerName,
        限制: Math.ceil(sampleSize / 10), // 每个段落约10条消息
      });
    }
  } catch (e) {
    logger.error('检索聊天样本失败:', e.message);
  }
  return [];
}

/**
 * 分析消息的语气特征
 */
function 分析语气特征(消息列表, focusAreas) {
  const 全部分析 = focusAreas.includes('all');
  
  // 1. 口头禅分析
  let 口头禅 = [];
  if (全部分析 || focusAreas.includes('口头禅')) {
    const 短语频率 = new Map();
    for (const msg of 消息列表) {
      const words = msg.content.split(/[,，。.!！?？\s]+/).filter(w => w.length >= 2 && w.length <= 6);
      for (const word of words) {
        短语频率.set(word, (短语频率.get(word) || 0) + 1);
      }
    }
    口头禅 = [...短语频率.entries()]
      .filter(([, count]) => count >= Math.max(3, 消息列表.length * 0.05))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  // 2. 句式偏好
  let 句式偏好 = [];
  if (全部分析 || focusAreas.includes('句式')) {
    const 句式统计 = { 短句: 0, 长句: 0, 疑问句: 0, 感叹句: 0, 陈述句: 0 };
    for (const msg of 消息列表) {
      const len = msg.content.length;
      if (len < 10) 句式统计.短句++;
      else if (len > 50) 句式统计.长句++;
      if (msg.content.endsWith('？') || msg.content.endsWith('?')) 句式统计.疑问句++;
      if (msg.content.endsWith('！') || msg.content.endsWith('!')) 句式统计.感叹句++;
      else 句式统计.陈述句++;
    }
    const total = 消息列表.length || 1;
    句式偏好 = Object.entries(句式统计)
      .filter(([, v]) => v / total > 0.15)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
  }

  // 3. emoji/表情偏好
  let emoji偏好 = [];
  if (全部分析 || focusAreas.includes('emoji')) {
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu;
    const emojiCount = new Map();
    for (const msg of 消息列表) {
      const emojis = msg.content.match(emojiRegex) || [];
      for (const e of emojis) {
        emojiCount.set(e, (emojiCount.get(e) || 0) + 1);
      }
    }
    emoji偏好 = [...emojiCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([e]) => e);
  }

  // 4. 语气强度 (基于标点、语气词密度)
  let 语气强度 = 0.5;
  if (全部分析 || focusAreas.includes('语气强度')) {
    const 语气词 = ['吧', '呢', '啊', '呀', '嘛', '哦', '哈', '啦', '呗', '咯'];
    let 语气词数 = 0;
    let 标点强调数 = 0; // !! 或 ?? 或 ～～
    for (const msg of 消息列表) {
      for (const w of 语气词) {
        if (msg.content.includes(w)) 语气词数++;
      }
      if (/([!！?？])\1/.test(msg.content)) 标点强调数++;
      if (msg.content.includes('～') || msg.content.includes('~')) 标点强调数++;
    }
    const 语气密度 = 语气词数 / Math.max(1, 消息列表.length);
    语气强度 = Math.min(1, Math.max(0.1, 语气密度 * 3 + 标点强调数 / Math.max(1, 消息列表.length)));
  }

  // 5. 正式度
  let 正式度 = 0.5;
  if (全部分析 || focusAreas.includes('正式度')) {
    const 正式词 = ['您', '请', '谢谢', '抱歉', '麻烦', '感谢', '收到', '明白', '确认'];
    const 口语词 = ['哈哈', '嗯嗯', '好嘞', '哦哦', '啦', '呀', '嘛'];
    let 正式度分 = 0;
    for (const msg of 消息列表) {
      for (const w of 正式词) if (msg.content.includes(w)) 正式度分++;
      for (const w of 口语词) if (msg.content.includes(w)) 正式度分--;
    }
    正式度 = Math.min(1, Math.max(0, 0.5 + 正式度分 / Math.max(1, 消息列表.length * 0.3)));
  }

  // 6. 回复速度
  let 回复速度 = '中等';
  if (全部分析 || focusAreas.includes('回复速度')) {
    const 平均长度 = 消息列表.reduce((sum, m) => sum + m.content.length, 0) / Math.max(1, 消息列表.length);
    if (平均长度 < 15) 回复速度 = '快速';
    else if (平均长度 > 60) 回复速度 = '慢速';
    else 回复速度 = '中等';
  }

  // 7. 常用话题
  let 常用话题 = [];
  if (全部分析 || focusAreas.includes('常用话题')) {
    const 话题关键词 = {
      '技术': ['代码', 'bug', '需求', '上线', '部署', '接口', '数据库', '前端', '后端'],
      '工作': ['开会', '周报', '进度', '项目', '任务', '同事', '老板'],
      '生活': ['吃饭', '睡觉', '天气', '周末', '电影', '游戏', '运动'],
      '产品': ['用户', '体验', '设计', '功能', '优化', '版本'],
    };
    const 话题分数 = {};
    for (const msg of 消息列表) {
      for (const [话题, 关键词] of Object.entries(话题关键词)) {
        for (const kw of 关键词) {
          if (msg.content.includes(kw)) {
            话题分数[话题] = (话题分数[话题] || 0) + 1;
          }
        }
      }
    }
    常用话题 = Object.entries(话题分数)
      .filter(([, v]) => v >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);
  }

  return {
    口头禅,
    句式偏好,
    emoji偏好,
    回复速度,
    语气强度: Math.round(语气强度 * 100) / 100,
    正式度: Math.round(正式度 * 100) / 100,
    常用话题,
    分析消息数: 消息列表.length,
  };
}

/**
 * 保存语气档案（更新或创建）
 */
async function 保存语气档案(档案, context) {
  const { 工具调用, userId } = context;
  
  try {
    if (工具调用?.更新记忆) {
      return await 工具调用.更新记忆({
        类型: 'style_profile',
        内容: JSON.stringify(档案),
        元数据: { 更新时间: new Date().toISOString() },
      });
    }
    // fallback: 通过加密通道调用 memory API
    const proxy = await getDovesProxy();
    return await proxy.fetch('/api/memory', { method: 'PUT', body: {
      类型: 'style_profile',
      内容: JSON.stringify(档案),
    } });
  } catch (e) {
    logger.error('保存语气档案失败:', e.message);
  }
  return null;
}

/**
 * 执行语气学习
 */
async function execute(args, context) {
  const { ownerName, sampleSize = 500, focusAreas = ['all'], memoryId } = args;

  try {
    // 1. 检索用户聊天样本
    logger.info(`开始语气学习: owner=${ownerName}, sample=${sampleSize}`);
    const 样本段落 = await 检索聊天样本(ownerName, sampleSize, context);

    // 2. 提取用户自己的消息
    let 用户消息 = [];
    for (const 段落 of (样本段落 || [])) {
      const 段落消息 = (段落.内容 || '').split('\n')
        .filter(line => line.startsWith(`${ownerName}:`))
        .map(line => ({
          content: line.replace(`${ownerName}:`, '').trim(),
          sender: ownerName,
        }));
      用户消息.push(...段落消息);
    }

    if (用户消息.length === 0) {
      return {
        成功: false,
        错误: `未找到用户 "${ownerName}" 的聊天记录。请先使用 chat_import 技能导入聊天记录`,
        建议: '请确保聊天记录已导入且 ownerName 与聊天记录中的发送者名称一致',
      };
    }

    // 3. 限制样本量
    if (用户消息.length > sampleSize) {
      用户消息 = 用户消息.slice(0, sampleSize);
    }

    // 4. 分析语气特征
    logger.info(`分析 ${用户消息.length} 条消息的语气特征...`);
    const 特征 = 分析语气特征(用户消息, focusAreas);

    // 5. 构建语气档案
    const 档案 = {
      用户ID: context.userId,
      用户名: ownerName,
      ...特征,
      训练数据量: 用户消息.length,
      最后训练时间: new Date().toISOString(),
      版本: 1,
    };

    // 6. 保存档案
    await 保存语气档案(档案, context);

    return {
      成功: true,
      数据: {
        分析消息数: 用户消息.length,
        语气档案: 档案,
        摘要: `语气学习完成！分析了 ${用户消息.length} 条消息：
- 口头禅: ${特征.口头禅.slice(0, 5).join('、') || '未检测到'}
- 句式偏好: ${特征.句式偏好.join('、') || '均衡'}
- emoji偏好: ${特征.emoji偏好.slice(0, 3).join(' ') || '无'}
- 语气强度: ${(特征.语气强度 * 100).toFixed(0)}%
- 正式度: ${(特征.正式度 * 100).toFixed(0)}%
- 回复速度: ${特征.回复速度}
- 常用话题: ${特征.常用话题.join('、') || '未识别'}`,
      },
    };
  } catch (e) {
    logger.error('语气学习失败:', e.message);
    return {
      成功: false,
      错误: `语气学习失败: ${e.message}`,
    };
  }
}

export default {
  name: 'style_learning',
  description: '语气学习技能 — 分析用户聊天记录提取口头禅/句式/emoji偏好/语气强度/正式度/回复速度等特征，生成语气档案存入Git记忆',
  abilities: ['分身', '语气学习'],
  parameters: {
    type: 'object',
    properties: {
      ownerName: { type: 'string', description: '用户自己的名字（用于识别自己的消息）' },
      sampleSize: { type: 'number', description: '分析的样本消息数（默认500）' },
      focusAreas: {
        type: 'array',
        items: { type: 'string', enum: ['口头禅', '句式', 'emoji', '语气强度', '正式度', '回复速度', '常用话题', 'all'] },
        description: '重点分析的语气维度',
      },
      memoryId: { type: 'string', description: '已导入聊天记录的Git记忆ID' },
    },
    required: ['ownerName'],
  },
  execute,
};
