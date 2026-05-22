/**
 * 词阵对弈 - 工具定义
 * 提供 LLM 驱动的成语校验和效果生成工具
 */
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('词阵对弈工具', { 前缀: '[ci_zhen_dui_yi]', 级别: 'debug', 显示调用位置: true });

export const extTools = [
  {
    name: 'idiom_validate',
    description: '通过LLM校验输入的成语或词语是否合规，返回验证结果',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '待校验的成语或词语' },
      },
      required: ['text'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        type: { type: 'string', enum: ['idiom', 'word', 'invalid'] },
        meaning: { type: 'string' },
        suggestion: { type: 'string' },
      },
    },
  },
  {
    name: 'generate_battle_effects',
    description: '通过LLM分析各方成语含义和典故，生成战斗效果',
    inputSchema: {
      type: 'object',
      properties: {
        teamLeft: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              playerId: { type: 'string' },
              idiom: { type: 'string' },
              meaning: { type: 'string' },
            },
          },
          description: '左队每个玩家选的成语',
        },
        teamRight: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              playerId: { type: 'string' },
              idiom: { type: 'string' },
              meaning: { type: 'string' },
            },
          },
          description: '右队每个玩家选的成语',
        },
        gameType: { type: 'string', enum: ['idiom', 'word'], description: '游戏类型' },
      },
      required: ['teamLeft', 'teamRight', 'gameType'],
    },
  },
  {
    name: 'ai_pick_idiom',
    description: 'AI玩家根据战局自动选取合适的成语/词语',
    inputSchema: {
      type: 'object',
      properties: {
        teamIdioms: {
          type: 'array',
          items: { type: 'string' },
          description: '己方已选的成语列表',
        },
        opponentIdioms: {
          type: 'array',
          items: { type: 'string' },
          description: '对方已选的成语列表(可能为空)',
        },
        gameType: { type: 'string', enum: ['idiom', 'word'] },
        strategy: { type: 'string', enum: ['attack', 'defense', 'balanced'] },
      },
      required: ['gameType', 'strategy'],
    },
  },
];

export const extToolSafetyLevels = {
  idiom_validate: '安全',
  generate_battle_effects: '安全',
  ai_pick_idiom: '安全',
};

/**
 * 通用工具执行入口
 */
export async function handleExtTool(toolName, args) {
  switch (toolName) {
    case 'idiom_validate':
      return await validateIdiom(args.text);
    case 'generate_battle_effects':
      return await generateEffects(args.teamLeft, args.teamRight, args.gameType);
    case 'ai_pick_idiom':
      return await aiPickIdiom(args.teamIdioms, args.opponentIdioms, args.gameType, args.strategy);
    default:
      return null; // 不认识的工具返回 null，让其他扩展处理
  }
}

// ==================== 工具实现 ====================

/**
 * LLM校验成语/词语
 */
async function validateIdiom(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return { valid: false, type: 'invalid', suggestion: '请输⼊有效的成语或词语' };
  }

  const clean = text.trim();

  // 快速规则过滤
  if (clean.length < 2) {
    return { valid: false, type: 'invalid', suggestion: '成语至少2个字' };
  }
  if (clean.length > 20) {
    return { valid: false, type: 'invalid', suggestion: '成语/词语过长，请不要超过20个字' };
  }

  try {
    const { default: 快速校验 } = await import('./_llm_validator.js');
    const result = await 快速校验.校验成语(clean);
    return result;
  } catch (e) {
    logger.error('LLM校验失败:', e.message);
    throw e;
  }
}

/**
 * LLM生成战斗效果
 * 分析双方成语含义和典故，生成贴合效果的战斗数据
 */
async function generateEffects(teamLeft, teamRight, gameType) {
  if (!teamLeft || !teamRight || teamLeft.length === 0 || teamRight.length === 0) {
    return { error: '双方都需要至少一个成语' };
  }

  try {
    const { default: 效果生成器 } = await import('./_effect_generator.js');
    return await 效果生成器.生成效果(teamLeft, teamRight, gameType);
  } catch (e) {
    logger.warn('LLM效果生成失败:', e.message);
    return generateFallbackEffects(teamLeft, teamRight, gameType);
  }
}

/**
 * 效果生成
 */
function generateFallbackEffects(teamLeft, teamRight, gameType) {
  const effects = [];

  for (const p of teamLeft) {
    effects.push({
      team: 'left',
      playerId: p.playerId,
      idiom: p.idiom,
      effect: {
        type: 'attack',
        value: Math.floor(Math.random() * 15) + 10,
        description: `${p.idiom} — 基础攻击`,
        animation: 'shake',
      },
    });
  }

  for (const p of teamRight) {
    effects.push({
      team: 'right',
      playerId: p.playerId,
      idiom: p.idiom,
      effect: {
        type: 'attack',
        value: Math.floor(Math.random() * 15) + 10,
        description: `${p.idiom} — 基础攻击`,
        animation: 'shake',
      },
    });
  }

  return {
    battleEffects: effects,
    battleScene: '古风战场',
    narrative: `双方成语碰撞，展开激烈战斗！`,
  };
}

/**
 * AI选取成语
 */
async function aiPickIdiom(teamIdioms, opponentIdioms, gameType, strategy) {
  try {
    const { default: AI玩家 } = await import('./_ai_picker.js');
    return await AI玩家.选取成语(teamIdioms, opponentIdioms, gameType, strategy);
  } catch (e) {
    logger.warn('AI选词失败:', e.message);
    return aiPickFallback(gameType, strategy);
  }
}

/**
 * AI选词
 */
function aiPickFallback(gameType, strategy) {
  const idioms = {
    attack: ['势如破竹', '雷霆万钧', '摧枯拉朽', '横扫千军', '所向披靡'],
    defense: ['固若金汤', '铜墙铁壁', '坚不可摧', '稳如泰山', '岿然不动'],
    balanced: ['龙飞凤舞', '行云流水', '出神入化', '鬼斧神工', '炉火纯青'],
  };

  const list = idioms[strategy] || idioms.balanced;
  const pick = list[Math.floor(Math.random() * list.length)];

  return {
    idiom: pick,
    strategy,
    type: gameType === 'idiom' ? 'idiom' : 'word',
    meaning: `AI策略选择 - ${strategy}`,
  };
}
